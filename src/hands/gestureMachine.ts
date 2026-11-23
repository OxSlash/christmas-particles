import type { FormationId } from '../formations';
import type { Gesture } from './gestures';

/** Every countable gesture maps to exactly one formation. */
export const GESTURE_FORMATION: Record<Exclude<Gesture, 'none'>, FormationId> = {
  fist: 'santa',
  one: 'snowman',
  two: 'tree',
  three: 'reindeer',
  four: 'gift',
  open: 'snowflake',
};

export interface GestureMachineOptions {
  /** Consecutive detections a new gesture needs before it commits. */
  confirmations?: number;
  /** How long a lost hand may stay lost before pending progress is dropped. */
  lostGraceMs?: number;
  /** Called the moment a new formation is committed. */
  onCommit?: (formation: FormationId, gesture: Gesture) => void;
}

export interface GestureMachine {
  /**
   * Feeds one detection. Returns the new formation id when it changed,
   * otherwise null. Synchronous and timer-free on purpose: the caller drives it
   * once per camera frame, so there is no polling interval adding latency.
   */
  update(gesture: Gesture, present: boolean, now: number): FormationId | null;
  /** Current formation, or null before the first commit. */
  current(): FormationId | null;
  /** Forgets the pending gesture (used when leaving manual mode). */
  reset(): void;
}

/**
 * Debounces noisy gesture readings without a timer.
 *
 * A gesture commits once it has been seen `confirmations` times in a row. One
 * stray frame can never commit (it needs a repeat), but a real change lands on
 * the second detection — roughly 60-80 ms at 25-30 fps. The previous design
 * polled on a 25 ms interval with a 110 ms hold, which stacked on top of the
 * detection rate and made every gesture feel late.
 */
export function createGestureMachine(options: GestureMachineOptions = {}): GestureMachine {
  const confirmations = Math.max(1, options.confirmations ?? 2);
  // How long a lost hand may stay lost before the pending gesture is dropped.
  // MediaPipe drops the hand for a frame or two whenever it changes shape fast,
  // and resetting immediately meant every transition had to re-earn its
  // confirmations from scratch — which read as "the gesture is not detected".
  const lostGraceMs = options.lostGraceMs ?? 220;

  let pending: Gesture = 'none';
  let seen = 0;
  let committedGesture: Gesture | null = null;
  let committedFormation: FormationId | null = null;
  let lastSeenAt = 0;

  return {
    update(gesture, present, now) {
      if (!present || gesture === 'none') {
        // Keep the committed shape on screen, and keep the pending gesture
        // alive for a short grace period so a brief tracking dropout does not
        // undo progress towards a commit.
        if (now - lastSeenAt > lostGraceMs) {
          pending = 'none';
          seen = 0;
        }
        return null;
      }

      lastSeenAt = now;

      if (gesture !== pending) {
        pending = gesture;
        seen = 1;
        return null;
      }

      seen++;
      if (seen < confirmations) return null;
      if (gesture === committedGesture) return null;

      committedGesture = gesture;
      committedFormation = GESTURE_FORMATION[gesture];
      options.onCommit?.(committedFormation, gesture);
      return committedFormation;
    },

    current() {
      return committedFormation;
    },

    reset() {
      pending = 'none';
      seen = 0;
      committedGesture = null;
      lastSeenAt = 0;
    },
  };
}
