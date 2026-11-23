// Reproduces the "0, 4 and 5 fingers are not detected" report.
//
// Synthetic hands with perfect geometry have passed twice while real footage
// failed, because they encoded idealised assumptions. This model instead
// includes the two things that actually go wrong in practice:
//
//   1. a relaxed fist, where the thumb rests against the side of the index
//      finger rather than being tucked across the palm
//   2. a pinky that is not fully extended — it is the shortest finger and the
//      one people straighten least
//
// Both errors move the count by one, which is exactly what turns
//   4 -> 5 (gift becomes snowflake), 5 -> 4 (snowflake becomes gift)
//   0 -> 1 (santa becomes snowman)
import { createGestureMachine } from '../src/hands/gestureMachine';
import { createFingerSmoother, classify, fingerStates, type Gesture } from '../src/hands/gestures';
import { makeRng } from '../src/lib/rng';

type Pt = { x: number; y: number; z: number };

interface HandOpts {
  /** how many of the four long fingers are up */
  long: number;
  /** 0 = thumb tucked across the palm, 1 = fully abducted */
  thumb: number;
  /** 0 = pinky fully up, 1 = fully curled (only meaningful when long === 4) */
  pinkyCurl?: number;
}

/**
 * MediaPipe-like hand, palm facing the camera. Proportions follow a real adult
 * hand: middle finger longest, pinky shortest, thumb rooted at the wrist side.
 */
function hand(opts: HandOpts, scale = 0.11): Pt[] {
  const { long, thumb } = opts;
  const pinkyCurl = opts.pinkyCurl ?? 0;
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  lm[0] = { x: 0.5, y: 0.84, z: 0 };

  // knuckle x offset, and how long each finger is relative to the palm
  const fingers = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, dx: -0.60, len: 1.30 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, dx: -0.20, len: 1.45 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, dx: 0.20, len: 1.32 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, dx: 0.58, len: 1.00 }, // pinky is short
  ];

  for (let f = 0; f < 4; f++) {
    const { mcp, pip, dip, tip, dx, len } = fingers[f];
    const baseX = 0.5 + dx * scale;
    lm[mcp] = { x: baseX, y: 0.70, z: 0 };

    const isUp = f < long;
    // how far this finger actually extends: 1 = straight, 0 = folded
    let ext = isUp ? 1 : 0;
    if (f === 3 && isUp) ext = 1 - pinkyCurl;

    const reach = scale * len * ext;
    lm[pip] = { x: baseX, y: 0.70 - scale * 0.45 * Math.max(ext, 0.35), z: 0 };
    lm[dip] = { x: baseX, y: 0.70 - reach * 0.72, z: 0 };
    lm[tip] = { x: baseX, y: 0.70 - reach, z: 0 };
  }

  // Thumb: base fixed at the wrist side, tip swings from across the palm to out.
  const base = { x: 0.5 - scale * 0.70, y: 0.77, z: 0 };
  lm[1] = { x: 0.5 - scale * 0.30, y: 0.80, z: 0 };
  lm[2] = base;

  // tucked: tip lies along the side of the index finger
  const tucked = { x: 0.5 - scale * 0.30, y: 0.66, z: 0 };
  // out: tip points away to the side
  const out = { x: 0.5 - scale * 1.95, y: 0.68, z: 0 };
  const tipPt = {
    x: tucked.x + (out.x - tucked.x) * thumb,
    y: tucked.y + (out.y - tucked.y) * thumb,
    z: 0,
  };
  lm[3] = { x: base.x + (tipPt.x - base.x) * 0.62, y: base.y + (tipPt.y - base.y) * 0.62, z: 0 };
  lm[4] = tipPt;
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

const CASES: Array<{ opts: HandOpts; want: Gesture; name: string }> = [
  // A relaxed fist: thumb resting beside the index, not tucked across.
  { opts: { long: 0, thumb: 0.22 }, want: 'fist', name: 'fist, thumb resting' },
  { opts: { long: 0, thumb: 0.0 }, want: 'fist', name: 'fist, thumb tucked' },
  { opts: { long: 1, thumb: 0.1 }, want: 'one', name: '1 finger' },
  { opts: { long: 2, thumb: 0.1 }, want: 'two', name: '2 fingers' },
  { opts: { long: 3, thumb: 0.1 }, want: 'three', name: '3 fingers' },
  // Four fingers with the thumb still folded in: this is the gift box.
  { opts: { long: 4, thumb: 0.12 }, want: 'four', name: '4 fingers, thumb in' },
  // Four fingers where the pinky is not fully straight — still four.
  { opts: { long: 4, thumb: 0.12, pinkyCurl: 0.25 }, want: 'four', name: '4 fingers, pinky slightly bent' },
  // A real open hand: thumb clearly out.
  { opts: { long: 4, thumb: 0.95 }, want: 'open', name: '5 fingers, thumb out' },
  { opts: { long: 4, thumb: 0.75 }, want: 'open', name: '5 fingers, thumb half out' },
];

const rng = makeRng(20261124);
let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

// --- single frame with realistic noise ---------------------------------
console.log('\nsingle frame, 1.5% noise:');
for (const c of CASES) {
  const TRIALS = 80;
  let ok = 0;
  const wrong = new Map<string, number>();
  for (let t = 0; t < TRIALS; t++) {
    const lm = jitter(hand(c.opts), rng, 0.015);
    const got = classify(fingerStates(lm as never));
    if (got === c.want) ok++;
    else wrong.set(got, (wrong.get(got) ?? 0) + 1);
  }
  const rate = ok / TRIALS;
  const detail = [...wrong.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g}x${n}`)
    .join(' ');
  check(`${c.name.padEnd(32)} ${(rate * 100).toFixed(0)}%`, rate >= 0.95, detail);
}

// --- can the machine commit through a live stream? ---------------------
// This is what the user experiences: a gesture that flickers never reaches the
// required consecutive confirmations, so nothing changes on screen.
console.log('\n60 frames held, 2% noise (does it commit?):');
for (const c of CASES) {
  const smooth = createFingerSmoother(3);
  const machine = createGestureMachine({ confirmations: 2 });
  let committed: string | null = null;
  const seen = new Map<string, number>();

  for (let f = 0; f < 60; f++) {
    const lm = jitter(hand(c.opts), rng, 0.02);
    const g = classify(smooth(fingerStates(lm as never)));
    seen.set(g, (seen.get(g) ?? 0) + 1);
    const got = machine.update(g, true, f * 33);
    if (got) committed = got;
  }

  const expectedFormation: Record<string, string> = {
    fist: 'santa',
    one: 'snowman',
    two: 'tree',
    three: 'reindeer',
    four: 'gift',
    open: 'snowflake',
  };
  const want = expectedFormation[c.want];
  const detail = [...seen.entries()].map(([g, n]) => `${g}x${n}`).join(' ');
  check(`${c.name.padEnd(32)} -> ${want}`, committed === want, committed ? `got ${committed}` : `never (${detail})`);
}

// --- a brief tracking dropout must not undo progress -------------------
// MediaPipe drops the hand for a frame or two whenever it changes shape fast.
// Before the grace period, that reset the pending gesture, so every transition
// had to re-earn its confirmations and felt like "not detected".
console.log('\ntracking dropout handling:');
{
  const machine = createGestureMachine({ confirmations: 2, lostGraceMs: 220 });

  // first detection of the new gesture
  machine.update('four', true, 0);
  // hand lost for one frame (33 ms later)
  machine.update('none', false, 33);
  // hand back: this should be the second confirmation and commit
  const got = machine.update('four', true, 66);
  check('one dropped frame does not reset progress', got === 'gift', String(got));
}
{
  const machine = createGestureMachine({ confirmations: 2, lostGraceMs: 220 });
  machine.update('four', true, 0);
  // hand gone for longer than the grace period
  machine.update('none', false, 400);
  const got = machine.update('four', true, 430);
  check('a long dropout does reset progress', got === null, String(got));
}
{
  const machine = createGestureMachine({ confirmations: 2, lostGraceMs: 220 });
  machine.update('two', true, 0);
  machine.update('two', true, 33);
  // tracking drops for a while, then a different gesture arrives
  machine.update('none', false, 100);
  machine.update('none', false, 500);
  machine.update('open', true, 530);
  const got = machine.update('open', true, 560);
  check('recovers after a long dropout', got === 'snowflake', String(got));
}

console.log(failed === 0 ? '\nreal-hand gestures OK' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
