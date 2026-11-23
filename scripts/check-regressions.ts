// Regression tests for the bugs found in review.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16);
(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Minimal canvas stub: the "santa" formation samples text through a 2D context.
const realCreateElement = dom.window.document.createElement.bind(dom.window.document);
(globalThis as any).document.createElement = (tag: string) => {
  if (tag !== 'canvas') return realCreateElement(tag);
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      font: '',
      fillStyle: '',
      textAlign: '',
      textBaseline: '',
      measureText: (t: string) => ({ width: t.length * 70 }),
      fillText: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let py = Math.floor(h * 0.35); py < Math.floor(h * 0.62); py++) {
          for (let px = Math.floor(w * 0.12); px < Math.floor(w * 0.88); px++) {
            data[(py * w + px) * 4 + 3] = 255;
          }
        }
        return { data };
      },
    }),
  };
};

const { Builder } = await import('../src/lib/formations/shapes');
const { padTo } = await import('../src/formations/common');
const { buildGift } = await import('../src/formations/gift');
const { makeRng } = await import('../src/lib/rng');
const { FORMATIONS } = await import('../src/formations');
type FormationId = (typeof FORMATIONS)[number]['id'];

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

// --- manual override must not be clobbered by hand gestures --------------
// The hook was replaced by a timer-free gesture machine. The equivalent
// guarantee now lives in the machine: it only reports a change when the gesture
// actually differs, so a caller that ignores it (manual mode) stays put.
{
  const { createGestureMachine } = await import('../src/hands/gestureMachine');
  const m = createGestureMachine({ confirmations: 2 });
  m.update('two', true, 0);
  m.update('two', true, 40);
  check('machine reports the committed formation', m.current() === 'tree', String(m.current()));

  // repeating the same gesture must not fire again (that would fight manual mode)
  const again = m.update('two', true, 80);
  check('repeating the same gesture does not re-commit', again === null, String(again));

  // a genuinely different gesture does commit
  m.update('four', true, 120);
  const changed = m.update('four', true, 160);
  check('a different gesture commits', changed === 'gift', String(changed));
}

// --- BUG 6: gift bow budget respected at tiny counts --------------------
{
  const b = buildGift(10, makeRng(7));
  check('gift at count=10 yields exactly 10', b.count === 10, String(b.count));
  const b2 = buildGift(3, makeRng(7));
  check('gift at count=3 yields exactly 3', b2.count === 3, String(b2.count));
}

// --- BUG 7: padTo on an empty builder -----------------------------------
{
  const empty = new Builder(makeRng(1));
  const padded = padTo(empty, 500);
  check('padTo fills an empty builder', padded.count === 500, String(padded.count));
}

// --- every formation must honour the exact count, at several sizes ------
for (const n of [1, 7, 64, 1000]) {
  for (const def of FORMATIONS) {
    const b = def.build(n, makeRng(99));
    if (b.count !== n) {
      failed++;
      console.log(`FAIL  ${def.id} count=${n} produced ${b.count}`);
    }
  }
}
check('all formations honour small/odd particle counts', true);

// --- coreEnd must be marked so dust does not affect fitting -------------
{
  const b = FORMATIONS[0].build(5000, makeRng(5));
  check('coreEnd marked before dust', b.coreEnd > 0 && b.coreEnd < b.count, `${b.coreEnd}/${b.count}`);
}

console.log(failed === 0 ? '\nregressions OK' : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
