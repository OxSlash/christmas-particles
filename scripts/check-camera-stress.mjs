// Stress test for the camera lifecycle: rapid start/stop cycles and a stop
// issued while the model is still loading must never wedge the tracker.
//
// The camera now auto-starts and has no visible controls, so this drives the
// hook's start/stop through the test hooks exposed by the app.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--enable-unsafe-swiftshader',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ['camera'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

let failed = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const state = () => page.evaluate(() => window.__trackerState?.());
const start = () => page.evaluate(() => window.__trackerStart?.());
const stop = () => page.evaluate(() => window.__trackerStop?.());

const waitFor = async (want, timeoutMs = 25000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await state();
    if (s?.status === want) return true;
    await page.waitForTimeout(300);
  }
  return false;
};

// --- auto start ---------------------------------------------------------
check('auto-starts without any click', await waitFor('running'), (await state())?.status);

// --- stop then restart --------------------------------------------------
await stop();
check('stop returns to idle', await waitFor('idle', 3000), (await state())?.status);

await start();
check('restart reaches running', await waitFor('running'), (await state())?.status);

// --- rapid stop/start cycles -------------------------------------------
for (let i = 0; i < 4; i++) {
  await stop();
  await page.waitForTimeout(80);
  await start();
  await page.waitForTimeout(120);
}
check('survives rapid cycles', await waitFor('running'), (await state())?.status);

// --- the video element is released when stopped -------------------------
await stop();
await page.waitForTimeout(600);
const released = await page.evaluate(() => {
  const v = document.querySelector('video');
  const s = v && v.srcObject;
  return !s || s.getTracks().every((t) => t.readyState === 'ended');
});
check('camera released on stop', released);

console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'errors: (none)');
if (errors.length) failed++;
console.log(failed === 0 ? 'PASS  camera stress' : `FAIL  camera stress (${failed})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
