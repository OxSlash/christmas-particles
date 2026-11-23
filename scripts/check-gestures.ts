// Verifies finger classification against synthetic landmark sets.
//
// The important cases are the ones that were wrong in real footage:
//   - an open hand whose thumb is only partly abducted must still be 5 fingers
//   - four fingers with the thumb folded in must be 4, not 5
import {
  classify,
  createFingerSmoother,
  fingerStates,
  type FingerState,
  type Gesture,
} from '../src/hands/gestures';

type Pt = { x: number; y: number; z: number };

/**
 * Builds a 21-landmark hand. `extended` is [thumb, index, middle, ring, pinky].
 * The palm sits at origin, fingers point up (-y in normalised space).
 */
function hand(extended: boolean[], scale = 0.1): Pt[] {
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  lm[0] = { x: 0.5, y: 0.8, z: 0 }; // wrist

  const fingers: Array<{ mcp: number; pip: number; dip: number; tip: number; dx: number }> = [
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
      // folded: tip curls back toward the palm
      lm[pip] = { x: baseX, y: 0.72 - scale * 0.42, z: 0 };
      lm[dip] = { x: baseX, y: 0.72 - scale * 0.2, z: 0 };
      lm[tip] = { x: baseX, y: 0.72 - scale * 0.05, z: 0 };
    }
  }

  // thumb: 1..4
  lm[1] = { x: 0.5 - scale * 0.4, y: 0.78, z: 0 };
  lm[2] = { x: 0.5 - scale * 0.8, y: 0.76, z: 0 };
  if (extended[0]) {
    lm[3] = { x: 0.5 - scale * 1.15, y: 0.72, z: 0 };
    lm[4] = { x: 0.5 - scale * 1.45, y: 0.68, z: 0 };
  } else {
    // folded across the palm: tip ends up near the index knuckle, curled
    lm[3] = { x: 0.5 - scale * 0.55, y: 0.72, z: 0 };
    lm[4] = { x: 0.5 - scale * 0.35, y: 0.73, z: 0 };
  }
  return lm;
}

const cases: Array<{ name: string; fingers: boolean[]; want: Gesture }> = [
  { name: 'fist', fingers: [false, false, false, false, false], want: 'fist' },
  // counting semantics: one finger up is "one" whichever finger it is
  { name: 'thumbs up', fingers: [true, false, false, false, false], want: 'one' },
  { name: '1 index', fingers: [false, true, false, false, false], want: 'one' },
  { name: '2 fingers', fingers: [false, true, true, false, false], want: 'two' },
  { name: '3 fingers', fingers: [false, true, true, true, false], want: 'three' },
  { name: '4 fingers, thumb tucked', fingers: [false, true, true, true, true], want: 'four' },
  { name: '5 fingers, thumb out', fingers: [true, true, true, true, true], want: 'open' },
];

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

for (const c of cases) {
  const got = fingerStates(hand(c.fingers) as never);
  const gesture = classify(got);
  check(
    c.name.padEnd(26),
    gesture === c.want,
    `fingers=[${got.map((v) => (v ? '1' : '0')).join('')}] -> ${gesture} (want ${c.want})`,
  );
}

// rotation invariance: the same "2 fingers" hand turned 90° should still read as two
const rotated = hand([false, true, true, false, false]).map((p) => ({
  x: 0.5 + (p.y - 0.72),
  y: 0.72 + (p.x - 0.5),
  z: p.z,
}));
check('rotated-90', classify(fingerStates(rotated as never)) === 'two');

// scale invariance: a smaller hand should classify the same
check('scaled-0.5', classify(fingerStates(hand([false, true, true, false, false], 0.05) as never)) === 'two');

// --- the thumb must be detected across a range of abduction -------------
// Real hands rarely sit at the ideal angle. Sweep from "slightly out" to "wide"
// and require the thumb to be seen every time.
function handWithThumbAbduction(abduction: number): Pt[] {
  const lm = hand([true, true, true, true, true]);
  const pinkyMcp = lm[17];
  const thumbMcp = lm[2];
  const baseDist = Math.hypot(thumbMcp.x - pinkyMcp.x, thumbMcp.y - pinkyMcp.y);
  const angle = Math.atan2(thumbMcp.y - pinkyMcp.y, thumbMcp.x - pinkyMcp.x);
  const tip = {
    x: pinkyMcp.x + Math.cos(angle) * baseDist * abduction,
    y: pinkyMcp.y + Math.sin(angle) * baseDist * abduction,
    z: 0,
  };
  lm[4] = tip;
  // keep the IP joint on the line from the base so the digit stays straight
  lm[3] = {
    x: thumbMcp.x + (tip.x - thumbMcp.x) * 0.6,
    y: thumbMcp.y + (tip.y - thumbMcp.y) * 0.6,
    z: 0,
  };
  return lm;
}

for (const a of [1.2, 1.35, 1.5, 1.8]) {
  const got = fingerStates(handWithThumbAbduction(a) as never);
  check(`thumb abduction ${a.toFixed(2)} -> open`, classify(got) === 'open', `thumb=${got[0]}`);
}

// a genuinely tucked thumb must NOT be counted, or 4 fingers would be lost
{
  const got = fingerStates(hand([false, true, true, true, true]) as never);
  check('tucked thumb reads as four', classify(got) === 'four', `thumb=${got[0]}`);
}

// bent thumb (curled) must not be counted even if it sits away from the palm
{
  const lm = hand([true, true, true, true, true]);
  const mcp = lm[2];
  const tip = lm[4];
  // fold the tip sharply back toward the palm at the IP joint
  lm[3] = { x: mcp.x + (tip.x - mcp.x) * 0.6, y: mcp.y + (tip.y - mcp.y) * 0.6, z: 0 };
  lm[4] = { x: mcp.x + (tip.x - mcp.x) * 0.35, y: mcp.y + (tip.y - mcp.y) * 0.35, z: 0 };
  const got = fingerStates(lm as never);
  check('curled thumb not counted', classify(got) === 'four', `thumb=${got[0]}`);
}

// --- flicker smoothing --------------------------------------------------
{
  const smoother = createFingerSmoother(5);
  const open: FingerState = [true, true, true, true, true];
  const dropped: FingerState = [false, true, true, true, true];
  smoother(open);
  smoother(open);
  smoother(dropped);
  smoother(open);
  const got = smoother(open);
  check('single-frame thumb drop ignored', classify(got) === 'open', classify(got));
}
{
  const smoother = createFingerSmoother(5);
  const four: FingerState = [false, true, true, true, true];
  // a sustained change must still come through
  for (let i = 0; i < 5; i++) smoother(four);
  check('sustained four is detected', classify(smoother(four)) === 'four');
}

console.log(failed === 0 ? '\ngesture logic OK' : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
