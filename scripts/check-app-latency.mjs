// End-to-end latency in the real app: inject a gesture and measure how long
// until the particle field actually starts morphing.
//
// This is the number the user feels. It covers the whole chain: classifier ->
// gesture machine -> formation ref -> render loop. There is no polling timer and
// no React state hop in that path, so it should be a couple of frames.
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

const cases = [
  [1, 'snowman'],
  [2, 'tree'],
  [3, 'reindeer'],
  [4, 'gift'],
  [5, 'snowflake'],
  [0, 'santa'],
];

const times = [];
for (const [n, want] of cases) {
  const t0 = Date.now();
  await page.evaluate((k) => window.__injectFingers?.(k), n);
  let got = null;
  while (Date.now() - t0 < 2000) {
    got = await page.evaluate(() => window.__trackerState?.().formation);
    if (got === want) break;
    await page.waitForTimeout(5);
  }
  const dt = Date.now() - t0;
  times.push(dt);
  check(`${n} jari -> ${want} in ${dt}ms`, got === want, got === want ? '' : `got ${got}`);
}

const avg = times.reduce((a, b) => a + b, 0) / times.length;
const worst = Math.max(...times);
console.log(`latency: avg ${avg.toFixed(0)}ms, worst ${worst}ms`);

// The budget is deliberately tight: this path must not regress into the old
// timer-based ~130ms feel.
check('average latency under 60ms', avg < 60, `${avg.toFixed(0)}ms`);
check('worst latency under 150ms', worst < 150, `${worst}ms`);

console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'errors: (none)');
if (errors.length) failed++;
console.log(failed === 0 ? 'PASS  app latency' : `FAIL  app latency (${failed})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
