// Verifies the gesture state machine: confirmation debounce, per-gesture
// mapping (including 4 vs 5 fingers), and that it is timer-free.
import { createGestureMachine, GESTURE_FORMATION } from '../src/hands/gestureMachine';
import type { Gesture } from '../src/hands/gestures';

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const GESTURES: Gesture[] = ['one', 'two', 'three', 'four', 'open', 'fist'];
const EXPECTED: Record<string, string> = {
  one: 'snowman',
  two: 'tree',
  three: 'reindeer',
  four: 'gift',
  open: 'snowflake',
  fist: 'santa',
};

// --- 1. one stray frame must never commit -------------------------------
{
  const m = createGestureMachine({ confirmations: 2 });
  const first = m.update('two', true, 0);
  check('first reading does not commit', first === null, String(first));
  const second = m.update('two', true, 40);
  check('second reading commits', second === 'tree', String(second));
}

// --- 2. a single bad frame in a steady gesture is ignored ---------------
{
  const m = createGestureMachine({ confirmations: 2 });
  m.update('two', true, 0);
  m.update('two', true, 40);
  // one frame of "three" while the hand is really holding two
  const blip = m.update('three', true, 80);
  check('a single blip does not commit', blip === null, String(blip));
  // back to two: still the committed gesture, so no change
  const back = m.update('two', true, 120);
  check('returning to the held gesture does not re-commit', back === null, String(back));
}

// --- 3. every gesture maps to its own formation ------------------------
for (const g of GESTURES) {
  const m = createGestureMachine({ confirmations: 2 });
  m.update(g, true, 0);
  const got = m.update(g, true, 40);
  const want = EXPECTED[g];
  check(`${g.padEnd(6)} -> ${want}`, got === want, String(got));
}

// --- 4. four and five fingers must be distinct -------------------------
{
  const m = createGestureMachine({ confirmations: 2 });
  m.update('four', true, 0);
  const four = m.update('four', true, 40);
  m.update('open', true, 80);
  const five = m.update('open', true, 120);
  check('4 fingers gives the gift box', four === 'gift', String(four));
  check('5 fingers gives the snowflake', five === 'snowflake', String(five));
  check('4 and 5 fingers differ', four !== five, `${four} vs ${five}`);
}

// --- 5. the hand leaving does not reset the shape ----------------------
{
  const m = createGestureMachine({ confirmations: 2 });
  m.update('two', true, 0);
  m.update('two', true, 40);
  m.update('none', false, 80);
  m.update('none', false, 120);
  check('losing the hand keeps the last formation', m.current() === 'tree', String(m.current()));
}

// --- 6. the machine recovers after the hand leaves ---------------------
{
  const m = createGestureMachine({ confirmations: 2 });
  m.update('two', true, 0);
  m.update('two', true, 40);
  // hand drops out of frame for a moment
  m.update('none', false, 80);
  m.update('none', false, 120);
  // a different gesture afterwards must still commit
  m.update('open', true, 160);
  const after = m.update('open', true, 200);
  check('commits a new gesture after a gap', after === 'snowflake', String(after));

  // and repeating the gesture that is already on screen is a no-op
  m.update('open', true, 240);
  const repeat = m.update('open', true, 280);
  check('repeating the current gesture is a no-op', repeat === null, String(repeat));
}

// --- 7. latency is measured in detections, not milliseconds ------------
{
  // With 2 confirmations the commit happens on the 2nd detection, so at 30 fps
  // that is ~33 ms — no timer is involved at all.
  const m = createGestureMachine({ confirmations: 2 });
  let readings = 0;
  for (let i = 0; i < 10; i++) {
    readings++;
    if (m.update('open', true, i * 33) !== null) break;
  }
  check('commits on the 2nd detection', readings === 2, `${readings} detections`);
}

// --- 8. mapping table is complete --------------------------------------
{
  const missing = GESTURES.filter((g) => !GESTURE_FORMATION[g as Exclude<Gesture, 'none'>]);
  check('every gesture has a formation', missing.length === 0, missing.join(','));
}

console.log(failed === 0 ? '\ngesture machine OK' : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
