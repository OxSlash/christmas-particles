import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { ParticleField } from './particles/ParticleField';
import { Snowfall } from './particles/Snowfall';
import { Aurora } from './particles/Aurora';
import { Embers } from './particles/Embers';
import { useHandTracker } from './hands/useHandTracker';
import { type FormationId } from './formations';
import { EMPTY_FRAME, classify, type FingerState, type HandFrame } from './hands/gestures';

const PARTICLE_COUNT = 110_000;

const KEY_TO_FORMATION: Record<string, FormationId> = {
  '0': 'santa',
  '1': 'snowman',
  '2': 'tree',
  '3': 'reindeer',
  '4': 'gift',
  '5': 'snowflake',
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HandFrame>(EMPTY_FRAME);
  const tracker = useHandTracker(videoRef);

  // The render loop reads hand data through a ref; React state would re-render
  // the whole tree on every detection frame.
  frameRef.current = tracker.frame;

  // Keyboard fallback drives this; gestures bypass it entirely through
  // tracker.formationRef so they never wait on a React render.
  const [manual, setManual] = useState<FormationId>('snowman');
  const [ready, setReady] = useState(false);

  const startCamera = tracker.start;

  // Start the camera immediately: the piece is meant to just work when opened,
  // with no panels or buttons competing with the particles.
  //
  // No "already started" latch here on purpose. React StrictMode mounts,
  // unmounts and remounts effects in development; the first start gets aborted
  // by the unmount, and a latch would make the remount skip the retry and leave
  // the tracker stuck in "loading". start() is idempotent via its own refs.
  useEffect(() => {
    void startCamera();
  }, [startCamera]);

  // Keyboard fallback so it is still usable without a camera.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const id = KEY_TO_FORMATION[e.key];
      if (id) {
        // Write through the same ref the gesture machine uses, so a keyboard
        // choice and a gesture can never fight over which shape is showing.
        tracker.formationRef.current = id;
        setManual(id);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        (window as unknown as { __particleBurst?: () => void }).__particleBurst?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tracker.formationRef]);

  // Only surface a message when something actually needs the user's attention.
  const needsAttention =
    tracker.status === 'denied' || tracker.status === 'error' || tracker.status === 'idle';

  // Expose state for the browser tests, which have no UI to read.
  useEffect(() => {
    const w = window as unknown as {
      __trackerState?: () => unknown;
      __trackerStart?: () => void;
      __trackerStop?: () => void;
      __injectFingers?: (n: number) => void;
      __fingerDebug?: () => unknown;
    };
    w.__trackerState = () => ({
      status: tracker.status,
      fps: tracker.fps,
      error: tracker.error,
      gesture: tracker.gesture,
      present: tracker.frame.present,
      // the formation the render loop is currently showing (gesture or manual)
      formation: tracker.formationRef.current ?? manual,
      manual,
    });
    w.__trackerStart = () => void startCamera();
    w.__trackerStop = () => tracker.stop();
    // Test hook: synthesise a finger count so the real classifier and gesture
    // machine can be driven end to end without a camera. The machine needs two
    // consecutive detections to commit, so feed it twice like two camera frames.
    w.__injectFingers = (n: number) => {
      const fingers = [0, 1, 2, 3, 4].map((i) => i < n);
      const gesture = classify(fingers as FingerState);
      const now = performance.now();
      tracker.machineRef.current.update(gesture, true, now);
      tracker.machineRef.current.update(gesture, true, now + 16);
    };
    // Test hook: the raw finger flags from the last real detection, so a failing
    // gesture can be diagnosed from numbers instead of guessed at.
    w.__fingerDebug = () => {
      const f = tracker.frame;
      return {
        present: f.present,
        fingers: f.fingers,
        gesture: f.gesture,
        landmarks: f.landmarks,
      };
    };
  }, [
    tracker.status,
    tracker.fps,
    tracker.error,
    tracker.gesture,
    tracker.frame.present,
    tracker.formationRef,
    tracker.machineRef,
    tracker.stop,
    startCamera,
  ]);

  return (
    <div className="app">
      <Canvas
        className="scene"
        dpr={[1, 1.75]}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          stencil: false,
        }}
        camera={{ position: [0, 0, 6.6], fov: 45, near: 0.1, far: 60 }}
        onCreated={({ gl }) => gl.setClearColor(new THREE.Color('#04050a'))}
      >
        <Aurora />
        <ParticleField
          formation={manual}
          count={PARTICLE_COUNT}
          liveFormationRef={tracker.formationRef}
          handRef={frameRef}
          onReady={() => setReady(true)}
        />
        <Snowfall count={900} />
        <Embers count={320} />
        <EffectComposer>
          <Bloom
            intensity={1.25}
            luminanceThreshold={0.05}
            luminanceSmoothing={0.3}
            mipmapBlur
            radius={0.75}
          />
          <Vignette offset={0.2} darkness={0.9} />
        </EffectComposer>
      </Canvas>

      <div className="scrim" />

      {/* MediaPipe reads frames from this element; it is never shown. */}
      <video ref={videoRef} className="hidden-video" playsInline muted />

      {needsAttention && (
        <div className="camera-note">
          <button type="button" className="camera-note__btn" onClick={tracker.start}>
            {tracker.status === 'denied'
              ? 'izinkan kamera'
              : tracker.status === 'error'
                ? 'coba lagi'
                : 'aktifkan kamera'}
          </button>
        </div>
      )}

      {!ready && (
        <div className="boot">
          <div className="boot__ring" />
          <p className="boot__text">menyusun partikel…</p>
        </div>
      )}
    </div>
  );
}
