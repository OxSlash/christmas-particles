import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  EMPTY_FRAME,
  createFingerSmoother,
  readFrame,
  type HandFrame,
  type Gesture,
} from './gestures';
import { createGestureMachine, type GestureMachine } from './gestureMachine';
import type { FormationId } from '../formations';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

export type CameraStatus = 'idle' | 'loading' | 'running' | 'denied' | 'error';

export interface HandTrackerState {
  status: CameraStatus;
  error: string | null;
  gesture: Gesture;
  frame: HandFrame;
  fps: number;
  /** formation committed by the gesture machine, updated without React latency */
  formationRef: RefObject<FormationId | null>;
  /** gesture machine, exposed so tests can inject detections */
  machineRef: RefObject<GestureMachine>;
  start: () => void;
  stop: () => void;
}

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/mediapipe/hand_landmarker.task';

/**
 * Owns the webcam + MediaPipe HandLandmarker loop. Detection runs at whatever
 * rate the model can keep up with (typically 25-40 Hz); the render loop reads
 * the latest frame instead of waiting on it.
 *
 * start() spans several awaits (camera permission, video.play, a ~7 MB model
 * download), so every await re-checks an abort flag. Without that, a stop or
 * unmount during loading would leave a second render loop running.
 */
export function useHandTracker(videoRef: RefObject<HTMLVideoElement | null>): HandTrackerState {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<HandFrame>(EMPTY_FRAME);
  const [fps, setFps] = useState(0);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastVideoTime = useRef(-1);
  const prevFrame = useRef<HandFrame>(EMPTY_FRAME);
  const runningRef = useRef(false);
  const loadingRef = useRef(false);
  const startTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fpsRef = useRef({ frames: 0, last: performance.now() });
  const smootherRef = useRef(createFingerSmoother(3));
  // Formation is written here the instant a gesture commits, so the render loop
  // can pick it up on the very next frame instead of waiting for a React
  // re-render to propagate down the tree.
  const formationRef = useRef<FormationId | null>(null);
  const machineRef = useRef(
    createGestureMachine({
      confirmations: 2,
      onCommit: (formation) => {
        formationRef.current = formation;
      },
    }),
  );

  const cleanup = useCallback(() => {
    runningRef.current = false;
    // Release the loading latch too: an unmount (or StrictMode remount) during
    // start() would otherwise leave it set, and every later start() call would
    // be rejected by the guard, wedging the tracker in "loading" forever.
    loadingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      // Pause before clearing. Leaving a video element in the "playing" state
      // with no source makes the next play() hang until Chromium gives up with
      // "Timeout starting video source", so a stop -> start cycle fails.
      try {
        v.pause();
      } catch {
        /* already paused */
      }
      v.srcObject = null;
    }
    lastVideoTime.current = -1;
    fpsRef.current = { frames: 0, last: performance.now() };
    setFps(0);
  }, [videoRef]);

  const loop = useCallback(() => {
    if (!runningRef.current) return;
    const video = videoRef.current;
    const lm = landmarkerRef.current;

    if (video && lm && video.readyState >= 2 && video.currentTime !== lastVideoTime.current) {
      lastVideoTime.current = video.currentTime;
      try {
        // MediaPipe requires strictly increasing timestamps; performance.now()
        // is monotonic, unlike video.currentTime which can repeat or reset.
        const result = lm.detectForVideo(video, performance.now());
        const next = readFrame(result, prevFrame.current, smootherRef.current);
        prevFrame.current = next;
        setFrame(next);

        // Commit the gesture right here, inside the detection frame. No timer,
        // no extra state hop: the machine returns a formation and the ref is
        // updated synchronously for the render loop.
        machineRef.current.update(next.gesture, next.present, performance.now());

        const f = fpsRef.current;
        f.frames++;
        const now = performance.now();
        if (now - f.last > 500) {
          setFps(Math.round((f.frames * 1000) / (now - f.last)));
          f.frames = 0;
          f.last = now;
        }
      } catch {
        // a dropped frame is fine; the next one will pick up
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [videoRef]);

  const start = useCallback(async () => {
    if (runningRef.current || loadingRef.current) return;
    loadingRef.current = true;
    // token so an aborted start() cannot clear the loading latch belonging to a
    // newer start() call
    const token = ++startTokenRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    const cancelled = () => abort.signal.aborted || startTokenRef.current !== token;

    setStatus('loading');
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      if (cancelled()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error('Elemen video tidak tersedia');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      if (cancelled()) return;

      if (!landmarkerRef.current) {
        // MediaPipe is ~400 kB gzipped; load it only when the user opts in so
        // the particle scene can start immediately.
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        if (cancelled()) return;
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled()) return;
        landmarkerRef.current = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
          // Lowered from 0.55: the defaults drop tracking whenever the hand
          // changes shape quickly (opening a fist, spreading fingers), which made
          // 4, 5 and 0 fingers feel undetected — the model simply lost the hand
          // for a few frames and the gesture was reset. Detection confidence
          // stays higher to avoid false positives from the background.
          minHandDetectionConfidence: 0.4,
          minHandPresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        });
        if (cancelled()) {
          landmarkerRef.current.close();
          landmarkerRef.current = null;
          return;
        }
      }

      if (cancelled()) return;
      runningRef.current = true;
      setStatus('running');
      smootherRef.current.reset();
      machineRef.current.reset();
      loop();
    } catch (e) {
      if (cancelled()) return;
      const msg = e instanceof Error ? e.message : String(e);
      cleanup();
      if (/permission|denied|NotAllowed|Dismissed/i.test(msg)) {
        setStatus('denied');
        setError('Akses kamera ditolak. Pakai tombol angka 0–5 sebagai gantinya.');
      } else {
        setStatus('error');
        setError(msg);
      }
    } finally {
      if (startTokenRef.current === token) loadingRef.current = false;
    }
  }, [cleanup, loop, videoRef]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    // clear the loading latch so a quick stop -> start is not swallowed by the
    // guard in start(); the aborted start() will bail at its next await anyway
    loadingRef.current = false;
    cleanup();
    setStatus('idle');
    setFrame(EMPTY_FRAME);
    prevFrame.current = EMPTY_FRAME;
  }, [cleanup]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      cleanup();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [cleanup]);

  return {
    status,
    error,
    gesture: frame.gesture,
    frame,
    fps,
    formationRef,
    machineRef,
    start,
    stop,
  };
}
