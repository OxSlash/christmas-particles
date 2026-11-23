// Verifies that gestures and the keyboard cannot fight over the shape: a
// keyboard choice must not be stolen back by the last committed gesture, and a
// new gesture must still take over afterwards.
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
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

let failed = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};
const formation = () => page.evaluate(() => window.__trackerState?.().formation);

// gesture drives the shape
await page.evaluate(() => window.__injectFingers?.(2));
await page.waitForTimeout(250);
check('gesture sets the shape', (await formation()) === 'tree', await formation());

// keyboard overrides it and keeps control
await page.keyboard.press('5');
await page.waitForTimeout(300);
check('keyboard overrides a gesture', (await formation()) === 'snowflake', await formation());
await page.waitForTimeout(1500);
check(
  'keyboard choice is not stolen back by the last gesture',
  (await formation()) === 'snowflake',
  await formation(),
);

// and a new gesture takes over again
await page.evaluate(() => window.__injectFingers?.(4));
await page.waitForTimeout(250);
check('a new gesture takes over after keyboard', (await formation()) === 'gift', await formation());

console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'errors: (none)');
if (errors.length) failed++;
console.log(failed === 0 ? 'PASS  input arbitration' : `FAIL  input arbitration (${failed})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
