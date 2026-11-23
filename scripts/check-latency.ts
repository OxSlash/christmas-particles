// Measures gesture latency at the unit level: how many detections (and how many
// milliseconds at a realistic camera rate) pass before a formation commits.
//
// The design has no polling timer, so latency is purely "detections × frame
// interval". This test pins that down so it cannot regress.
import { createGestureMachine } from '../src/hands/gestureMachine';
import { createFingerSmoother, classify, type FingerState } from '../src/hands/gestures';

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

// Detection rate of the real pipeline (MediaPipe on a laptop webcam).
const FPS = 30;
const FRAME_MS = 1000 / FPS;

// --- state machine: commit latency in detections ------------------------
{
  const m = createGestureMachine({ confirmations: 2 });
  let detections = 0;
  for (let i = 0; i < 10; i++) {
    detections++;
    if (m.update('four', true, i * FRAME_MS) !== null) break;
  }
  const ms = (detections - 1) * FRAME_MS;
  check('commits after 2 detections', detections === 2, `${detections} detections`);
  check('commit latency under 50ms at 30fps', ms < 50, `${ms.toFixed(0)}ms`);
}

// --- smoother: how many frames to reflect a real change -----------------
{
  const smooth = createFingerSmoother(3);
  const one: FingerState = [false, true, false, false, false];
  const two: FingerState = [false, true, true, false, false];

  // steady "one"
  smooth(one);
  smooth(one);
  smooth(one);

  let frames = 0;
  for (let i = 0; i < 10; i++) {
    frames++;
    if (classify(smooth(two)) === 'two') break;
  }
  check('smoother reflects a change within 2 frames', frames <= 2, `${frames} frames`);
}

// --- but a single stray frame is still rejected -------------------------
{
  const smooth = createFingerSmoother(3);
  const open: FingerState = [true, true, true, true, true];
  const dropped: FingerState = [false, true, true, true, true];
  smooth(open);
  smooth(open);
  smooth(dropped);
  smooth(open);
  check('single-frame drop ignored', classify(smooth(open)) === 'open');
}

// --- end to end: detection -> smoother -> machine ------------------------
{
  const smooth = createFingerSmoother(3);
  const m = createGestureMachine({ confirmations: 2 });
  const one: FingerState = [false, true, false, false, false];
  const four: FingerState = [false, true, true, true, true];

  // settle on "one"
  for (let i = 0; i < 6; i++) {
    m.update(classify(smooth(one)), true, i * FRAME_MS);
  }

  // now raise four fingers and count frames until the gift box commits
  let frames = 0;
  let committed: string | null = null;
  for (let i = 0; i < 20; i++) {
    frames++;
    const got = m.update(classify(smooth(four)), true, (6 + i) * FRAME_MS);
    if (got) {
      committed = got;
      break;
    }
  }
  const ms = frames * FRAME_MS;
  console.log(`end-to-end: ${frames} frames ≈ ${ms.toFixed(0)}ms at ${FPS}fps`);
  check('4 fingers commits the gift box', committed === 'gift', String(committed));
  check('end-to-end latency under 120ms at 30fps', ms < 120, `${ms.toFixed(0)}ms`);
}

console.log(failed === 0 ? '\nlatency OK' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
