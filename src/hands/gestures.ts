import type { HandLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';

export type FingerState = [boolean, boolean, boolean, boolean, boolean];

/** Indices into the 21-point landmark array. */
export const LM = {
  wrist: 0,
  thumbCmc: 1,
  thumbMcp: 2,
  thumbIp: 3,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleTip: 12,
  ringMcp: 13,
  ringPip: 14,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyPip: 18,
  pinkyTip: 20,
} as const;

const dist = (a: NormalizedLandmark, b: NormalizedLandmark) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Is the thumb sticking out, or folded across the palm?
 *
 * No single ratio is reliable: a thumb can be straight but tucked, or bent yet
 * still away from the palm. Three independent signals are combined and at least
 * two must agree:
 *
 *  1. unfold    — how far the tip swings away from the pinky knuckle, relative
 *                 to where the thumb base sits. Crossing the palm shrinks it.
 *  2. clearance — how far the tip sits from the index knuckle. A thumb tucked
 *                 across the fingers ends up right next to it.
 *  3. straight  — cosine at the IP joint. A folded thumb curls, an extended one
 *                 stays roughly straight.
 *
 * The two classes are far apart in practice (open hand scores 3/3, tucked
 * thumb 0-1/3), so the vote is stable even on noisy landmarks.
 */
function thumbExtended(lm: NormalizedLandmark[], palm: number): boolean {
  const tip = lm[LM.thumbTip];
  const mcp = lm[LM.thumbMcp];
  const ip = lm[LM.thumbIp];
  const pinky = lm[LM.pinkyMcp];
  const indexMcp = lm[LM.indexMcp];

  const unfold = dist(tip, pinky) / Math.max(1e-4, dist(mcp, pinky));
  const clearance = dist(tip, indexMcp) / palm;

  const ax = ip.x - mcp.x;
  const ay = ip.y - mcp.y;
  const bx = tip.x - ip.x;
  const by = tip.y - ip.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const cos = la > 1e-6 && lb > 1e-6 ? (ax * bx + ay * by) / (la * lb) : 0;

  let votes = 0;
  if (unfold > 1.15) votes++;
  if (clearance > 0.78) votes++;
  if (cos > 0.3) votes++;
  return votes >= 2;
}

/**
 * Decides which fingers are extended.
 *
 * Fingers use the fingertip-vs-PIP-joint distance from the wrist, which is
 * scale invariant and works with the hand rotated.
 */
export function fingerStates(lm: NormalizedLandmark[]): FingerState {
  const wrist = lm[LM.wrist];
  const palm = Math.max(0.0001, dist(wrist, lm[LM.middleMcp]));

  const tipPairs: Array<[number, number]> = [
    [LM.indexTip, LM.indexPip],
    [LM.middleTip, LM.middlePip],
    [LM.ringTip, LM.ringPip],
    [LM.pinkyTip, LM.pinkyPip],
  ];

  const fingers: boolean[] = [];
  for (const [tip, pip] of tipPairs) {
    const tipD = dist(wrist, lm[tip]);
    const pipD = dist(wrist, lm[pip]);
    fingers.push(tipD > pipD * 1.08 && tipD / palm > 1.3);
  }

  return [thumbExtended(lm, palm), fingers[0], fingers[1], fingers[2], fingers[3]];
}

export type Gesture = 'fist' | 'one' | 'two' | 'three' | 'four' | 'open' | 'none';

/**
 * Counts the fingers that are up and maps the total to a gesture.
 *
 * No finger-shape patterns: any one finger is "one", any two are "two", and so
 * on. That keeps the mapping predictable for the user — they only have to hold
 * up a number of fingers, not a specific combination.
 */
export function classify(fingers: FingerState): Gesture {
  let count = 0;
  for (const up of fingers) if (up) count++;

  if (count === 0) return 'fist';
  if (count === 1) return 'one';
  if (count === 2) return 'two';
  if (count === 3) return 'three';
  if (count === 4) return 'four';
  return 'open';
}

/**
 * Majority vote over the last few detections. MediaPipe occasionally drops a
 * single finger for one frame at 20-30 fps.
 *
 * The window is deliberately small: every extra frame adds real latency (at
 * 25 fps one frame is 40 ms), and a long window makes the whole scene feel
 * laggy. Three frames removes single-frame flicker while reacting in ~2 frames.
 */
export function createFingerSmoother(windowSize = 3) {
  let history: FingerState[] = [];
  const smooth = (fingers: FingerState): FingerState => {
    history.push(fingers);
    if (history.length > windowSize) history.shift();
    // until the window is full, trust the newest reading so the very first
    // gesture after the camera starts is not delayed
    if (history.length < 2) return fingers;
    const out: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      let up = 0;
      for (const h of history) if (h[i]) up++;
      out.push(up * 2 > history.length);
    }
    return out as FingerState;
  };
  smooth.reset = () => {
    history = [];
  };
  return smooth;
}

export interface HandFrame {
  gesture: Gesture;
  fingers: FingerState;
  /** normalised palm centre, x mirrored so it matches a mirrored preview */
  palm: { x: number; y: number };
  /** 0..1 — how far the palm centre moved since the previous frame */
  motion: number;
  present: boolean;
  /** raw normalised landmarks for the preview overlay */
  landmarks: Array<{ x: number; y: number }> | null;
}

export const EMPTY_FRAME: HandFrame = {
  gesture: 'none',
  fingers: [false, false, false, false, false],
  palm: { x: 0.5, y: 0.5 },
  motion: 0,
  present: false,
  landmarks: null,
};

export function readFrame(
  result: HandLandmarkerResult | null,
  prev: HandFrame,
  smooth?: (fingers: FingerState) => FingerState,
): HandFrame {
  const lm = result?.landmarks?.[0];
  if (!lm || lm.length < 21) {
    return { ...prev, gesture: 'none', present: false, motion: 0, landmarks: null };
  }
  const palm = {
    x: 1 - (lm[0].x + lm[9].x) / 2,
    y: (lm[0].y + lm[9].y) / 2,
  };
  const motion = Math.min(
    1,
    Math.hypot(palm.x - prev.palm.x, palm.y - prev.palm.y) * 6,
  );
  const raw = fingerStates(lm);
  const fingers = smooth ? smooth(raw) : raw;
  return {
    gesture: classify(fingers),
    fingers,
    palm,
    motion,
    present: true,
    landmarks: lm.map((p) => ({ x: p.x, y: p.y })),
  };
}
