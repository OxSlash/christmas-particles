// Robustness test: MediaPipe landmarks are noisy (±2-4% of palm size jitter),
// so a classifier that only works on ideal geometry fails on real hands. This
// perturbs synthetic hands with realistic noise and requires the gesture to stay
// correct across many random draws.
import {
  classify,
  fingerStates,
  type FingerState,
  type Gesture,
} from '../src/hands/gestures';
import { makeRng } from '../src/lib/rng';

type Pt = { x: number; y: number; z: number };

function hand(extended: boolean[], scale = 0.1): Pt[] {
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  lm[0] = { x: 0.5, y: 0.8, z: 0 };

  const fingers = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, dx: -0.6 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, dx: -0.2 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, dx: 0.2 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, dx: 0.6 },
  ];

  for (let f = 0; f < 4; f++) {
    const { mcp, pip, dip, tip, dx } = fingers[f];
    const baseX = 0.5 + dx * scale;
    lm[mcp] = { x: baseX, y: 0.72, z: 0 };
    if (extended[f + 1]) {
      lm[pip] = { x: baseX, y: 0.72 - scale * 0.5, z: 0 };
      lm[dip] = { x: baseX, y: 0.72 - scale * 0.9, z: 0 };
      lm[tip] = { x: baseX, y: 0.72 - scale * 1.25, z: 0 };
    } else {
      lm[pip] = { x: baseX, y: 0.72 - scale * 0.42, z: 0 };
      lm[dip] = { x: baseX, y: 0.72 - scale * 0.2, z: 0 };
      lm[tip] = { x: baseX, y: 0.72 - scale * 0.05, z: 0 };
    }
  }

  lm[1] = { x: 0.5 - scale * 0.4, y: 0.78, z: 0 };
  lm[2] = { x: 0.5 - scale * 0.8, y: 0.76, z: 0 };
  if (extended[0]) {
    lm[3] = { x: 0.5 - scale * 1.15, y: 0.72, z: 0 };
    lm[4] = { x: 0.5 - scale * 1.45, y: 0.68, z: 0 };
  } else {
    lm[3] = { x: 0.5 - scale * 0.55, y: 0.72, z: 0 };
    lm[4] = { x: 0.5 - scale * 0.35, y: 0.73, z: 0 };
  }
  return lm;
}

/** Jitter every landmark by up to `sigma` of the palm size. */
function jitter(lm: Pt[], rng: () => number, sigma: number): Pt[] {
  const palm = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
  return lm.map((p) => ({
    x: p.x + (rng() * 2 - 1) * palm * sigma,
    y: p.y + (rng() * 2 - 1) * palm * sigma,
    z: (p.z ?? 0) + (rng() * 2 - 1) * palm * sigma,
  }));
}

/** Rotate the whole hand by `deg` around the wrist. */
function rotate(lm: Pt[], deg: number): Pt[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const wx = lm[0].x;
  const wy = lm[0].y;
  return lm.map((p) => ({
    x: wx + (p.x - wx) * cos - (p.y - wy) * sin,
    y: wy + (p.x - wx) * sin + (p.y - wy) * cos,
    z: p.z,
  }));
}

const cases: Array<{ name: string; fingers: boolean[]; want: Gesture }> = [
  { name: 'fist', fingers: [false, false, false, false, false], want: 'fist' },
  { name: 'one', fingers: [false, true, false, false, false], want: 'one' },
  { name: 'two', fingers: [false, true, true, false, false], want: 'two' },
  { name: 'three', fingers: [false, true, true, true, false], want: 'three' },
  { name: 'four (thumb in)', fingers: [false, true, true, true, true], want: 'four' },
  { name: 'open (thumb out)', fingers: [true, true, true, true, true], want: 'open' },
];

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const TRIALS = 120;
const rng = makeRng(20261123);

for (const c of cases) {
  let ok = 0;
  let worst = '';
  for (let t = 0; t < TRIALS; t++) {
    const angle = (rng() * 2 - 1) * 35; // hand is never perfectly upright
    const sigma = 0.008 + rng() * 0.014; // realistic landmark jitter
    const lm = jitter(rotate(hand(c.fingers), angle), rng, sigma);
    const got = classify(fingerStates(lm as never));
    if (got === c.want) ok++;
    else if (!worst) worst = `${got} @ ${angle.toFixed(0)}° σ=${sigma.toFixed(3)}`;
  }
  const rate = ok / TRIALS;
  check(
    `${c.name.padEnd(18)} ${(rate * 100).toFixed(0)}% stable`,
    rate >= 0.97,
    worst ? `worst: ${worst}` : '',
  );
}

// the two gestures that share four long fingers must not collapse into each
// other under noise — this is the pair the thumb decides
{
  let fourAsOpen = 0;
  let openAsFour = 0;
  for (let t = 0; t < TRIALS; t++) {
    const sigma = 0.008 + rng() * 0.014;
    const angle = (rng() * 2 - 1) * 35;
    if (classify(fingerStates(jitter(rotate(hand([false, true, true, true, true]), angle), rng, sigma) as never)) !== 'four')
      fourAsOpen++;
    if (classify(fingerStates(jitter(rotate(hand([true, true, true, true, true]), angle), rng, sigma) as never)) !== 'open')
      openAsFour++;
  }
  check('4-finger never drifts to open', fourAsOpen / TRIALS < 0.03, `${fourAsOpen}/${TRIALS}`);
  check('open never drifts to 4-finger', openAsFour / TRIALS < 0.03, `${openAsFour}/${TRIALS}`);
}

console.log(failed === 0 ? '\nrobustness OK' : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
