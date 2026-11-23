// Measures how long a morph takes to become fully crisp.
//
// The complaint this addresses: the gesture response was fast, but the shape
// stayed blurry for a long time afterwards. An exponential lerp never truly
// arrives, so "fully formed" was unbounded. This test pins the total settle time
// to a concrete budget.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(4000);

let failed = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const dbg = () => page.evaluate(() => window.__particleDebug?.());

// settle on a shape first
await page.keyboard.press('1');
await page.waitForTimeout(2000);

// --- time from gesture to a fully crisp shape ---------------------------
const transitions = [
  ['4', 'gift'],
  ['2', 'tree'],
  ['0', 'santa'],
  ['5', 'snowflake'],
];

for (const [key, name] of transitions) {
  const t0 = Date.now();
  await page.keyboard.press(key);

  let crispAt = null;
  let firstFrame = null;
  while (Date.now() - t0 < 4000) {
    const d = await dbg();
    if (!d) break;
    if (firstFrame === null && d.remaining > 0.05) firstFrame = Date.now() - t0;
    // "crisp" = essentially no distance left, i.e. every particle on target
    if (d.remaining < 0.001) {
      crispAt = Date.now() - t0;
      break;
    }
    await page.waitForTimeout(20);
  }

  console.log(`${name}: starts ~${firstFrame}ms, fully formed ~${crispAt}ms`);
  check(`${name} fully forms under 1100ms`, crispAt !== null && crispAt < 1100, `${crispAt}ms`);
}

// --- and it must actually be exact, not merely close --------------------
{
  // wait for the state to be stable rather than sampling on the exact frame the
  // last particle lands
  let d = await dbg();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && d.remaining >= 1e-9) {
    await page.waitForTimeout(60);
    d = await dbg();
  }
  check('final state is exact', d.remaining < 1e-9, `${d.remaining.toExponential(2)}`);
}

// --- idle animation must be alive once settled --------------------------
{
  const a = await dbg();
  await page.waitForTimeout(700);
  const b = await dbg();
  check('idle animation is active', b.idle > 0.9, `idle=${b.idle}`);
  check('idle time keeps advancing', b.time > a.time, `${a.time} -> ${b.time}`);
}

console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'errors: (none)');
if (errors.length) failed++;
console.log(failed === 0 ? 'PASS  settle time' : `FAIL  settle time (${failed})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
