// Why 1 and 2 fingers work but 3, 4, 5 and 0 do not.
//
// The classifier gates each finger on `tipD / palm > 1.3`, an absolute ratio
// calibrated on the long fingers. Real hands are not uniform:
//
//   - the pinky is the shortest finger and the one people straighten least
//   - the ring finger is next
//   - so a half-curled pinky/ring fails the gate, the count caps out, and
//     3/4/5 all collapse onto the same (lower) number
//
// A fist fails differently: the thumb resting beside the index still scores as
// "out", so 0 reads as 1.
//
// This test uses anatomically proportioned fingers with realistic partial
// extension, and reports the exact finger flags so the failure is visible.
import { classify, fingerStates, type Gesture } from '../src/hands/gestures';
import { makeRng } from '../src/lib/rng';

type Pt = { x: number; y: number; z: number };

/**
 * Hand in palm-facing-camera pose, in units of palm length (wrist to middle MCP).
 * Segment lengths follow adult proportions: middle > index > ring > pinky.
 */
function hand(opts: {
  /** extension 0..1 for index, middle, ring, pinky */
  ext: [number, number, number, number];
  /** 0 = thumb tucked/resting on the palm, 1 = fully out to the side */
  thumb: number;
}): Pt[] {
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  lm[0] = { x: 0, y: 0, z: 0 }; // wrist

  // knuckle positions, palm pointing up
  const knuckles = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, x: -0.35, y: 0.95, seg: [0.30, 0.22, 0.16] },
    { mcp: 9, pip: 10, dip: 11, tip: 12, x: 0.0, y: 1.0, seg: [0.33, 0.25, 0.18] },
    { mcp: 13, pip: 14, dip: 15, tip: 16, x: 0.35, y: 0.95, seg: [0.30, 0.22, 0.16] },
    { mcp: 17, pip: 18, dip: 19, tip: 20, x: 0.65, y: 0.85, seg: [0.24, 0.17, 0.13] },
  ];

  for (let f = 0; f < 4; f++) {
    const k = knuckles[f];
    const e = opts.ext[f];
    lm[k.mcp] = { x: k.x, y: k.y, z: 0 };

    // Extended: segments point up. Curled: they fold back down toward the palm.
    // Interpolating the angle keeps partial extension continuous, which is what
    // real hands do.
    let cx = k.x;
    let cy = k.y;
    const angles = [0, 0.35, 0.75]; // segment directions when fully curled
    for (let s = 0; s < 3; s++) {
      const len = k.seg[s];
      const upAngle = Math.PI / 2; // straight up
      const curlAngle = -Math.PI / 2 + angles[s]; // folded back down
      const a = upAngle + (curlAngle - upAngle) * (1 - e);
      cx += Math.cos(a) * len;
      cy += Math.sin(a) * len;
      lm[[k.pip, k.dip, k.tip][s]] = { x: cx, y: cy, z: 0 };
    }
  }

  // Thumb: rooted at the wrist side, swings from resting on the palm to out.
  lm[1] = { x: -0.30, y: 0.30, z: 0 };
  lm[2] = { x: -0.50, y: 0.45, z: 0 };
  const restTip = { x: -0.10, y: 0.78, z: 0 }; // lying along the index finger
  const outTip = { x: -1.05, y: 0.72, z: 0 }; // straight out to the side
  const tip = {
    x: restTip.x + (outTip.x - restTip.x) * opts.thumb,
    y: restTip.y + (outTip.y - restTip.y) * opts.thumb,
    z: 0,
  };
  lm[3] = { x: -0.50 + (tip.x + 0.50) * 0.6, y: 0.45 + (tip.y - 0.45) * 0.6, z: 0 };
  lm[4] = tip;
  return lm;
}

function jitter(lm: Pt[], rng: () => number, sigma: number): Pt[] {
  const palm = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
  return lm.map((p) => ({
    x: p.x + (rng() * 2 - 1) * palm * sigma,
    y: p.y + (rng() * 2 - 1) * palm * sigma,
    z: (p.z ?? 0) + (rng() * 2 - 1) * palm * sigma,
  }));
}

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const CASES: Array<{
  name: string;
  ext: [number, number, number, number];
  thumb: number;
  want: Gesture;
}> = [
  // People rarely straighten the ring and pinky completely. 0.85 is generous;
  // 0.65 is what a relaxed hand actually does.
  { name: 'fist (thumb resting)', ext: [0, 0, 0, 0], thumb: 0.15, want: 'fist' },
  { name: 'fist (thumb tucked)', ext: [0, 0, 0, 0], thumb: 0.0, want: 'fist' },
  { name: '1 finger', ext: [1, 0, 0, 0], thumb: 0.1, want: 'one' },
  { name: '2 fingers', ext: [1, 1, 0, 0], thumb: 0.1, want: 'two' },
  { name: '3 fingers (full)', ext: [1, 1, 1, 0], thumb: 0.1, want: 'three' },
  { name: '3 fingers (ring 0.75)', ext: [1, 1, 0.75, 0], thumb: 0.1, want: 'three' },
  { name: '4 fingers (full)', ext: [1, 1, 1, 1], thumb: 0.12, want: 'four' },
  { name: '4 fingers (pinky 0.7)', ext: [1, 1, 1, 0.7], thumb: 0.12, want: 'four' },
  { name: '4 fingers (ring+pinky 0.75)', ext: [1, 1, 0.75, 0.75], thumb: 0.12, want: 'four' },
  { name: '5 fingers (full)', ext: [1, 1, 1, 1], thumb: 0.95, want: 'open' },
  { name: '5 fingers (pinky 0.7)', ext: [1, 1, 1, 0.7], thumb: 0.95, want: 'open' },
  { name: '5 fingers (ring+pinky 0.75)', ext: [1, 1, 0.75, 0.75], thumb: 0.95, want: 'open' },
];

const rng = makeRng(20261125);
let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

console.log('per-finger flags (no noise):\n');
for (const c of CASES) {
  const lm = hand({ ext: c.ext, thumb: c.thumb });
  const flags = fingerStates(lm as never);
  const got = classify(flags);
  const bits = flags.map((b) => (b ? '1' : '0')).join('');
  const names = FINGER_NAMES.filter((_, i) => flags[i]).join('+') || '(none)';
  const ok = got === c.want;
  check(
    `${c.name.padEnd(28)} [${bits}] ${names.padEnd(22)} -> ${got.padEnd(8)} want ${c.want}`,
    ok,
  );
}

// --- with noise, 60 frames held ----------------------------------------
console.log('\n60 frames held, 1.5% noise:');
for (const c of CASES) {
  let ok = 0;
  const TRIALS = 40;
  for (let t = 0; t < TRIALS; t++) {
    const lm = jitter(hand({ ext: c.ext, thumb: c.thumb }), rng, 0.015);
    if (classify(fingerStates(lm as never)) === c.want) ok++;
  }
  const rate = ok / TRIALS;
  check(`${c.name.padEnd(28)} ${(rate * 100).toFixed(0)}%`, rate >= 0.95);
}

console.log(failed === 0 ? '\nhand realism OK' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
