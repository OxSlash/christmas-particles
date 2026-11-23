// Camera lifecycle: verifies the stream is actually released on stop and that
// the tracker recovers afterwards. Complements check-camera-stress.mjs, which
// hammers rapid start/stop cycles.
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
check('auto-starts', await waitFor('running'), (await state())?.status);
// the status flips a moment before React has committed the video element's
// stream, so give the DOM one frame before inspecting it
await page.waitForTimeout(300);

// --- the camera is genuinely live ---------------------------------------
{
  const live = await page.evaluate(() => {
    const v = document.querySelector('video');
    const s = v && v.srcObject;
    return !!s && s.getTracks().some((t) => t.readyState === 'live');
  });
  check('stream has live tracks while running', live);
}

// --- stop releases the device -------------------------------------------
await page.evaluate(() => window.__trackerStop?.());
check('stop reaches idle', await waitFor('idle', 5000), (await state())?.status);
{
  const released = await page.evaluate(() => {
    const v = document.querySelector('video');
    const s = v && v.srcObject;
    return { hasStream: !!s, paused: v ? v.paused : null };
  });
  check('srcObject cleared on stop', !released.hasStream);
  check('video element paused on stop', released.paused === true, `paused=${released.paused}`);
}

// --- restart works after a full stop ------------------------------------
await page.evaluate(() => window.__trackerStart?.());
check('restart reaches running', await waitFor('running'), (await state())?.status);

// --- and the stream is live again ---------------------------------------
{
  const live = await page.evaluate(() => {
    const v = document.querySelector('video');
    const s = v && v.srcObject;
    return !!s && s.getTracks().some((t) => t.readyState === 'live');
  });
  check('stream live again after restart', live);
}

console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'errors: (none)');
if (errors.length) failed++;
console.log(failed === 0 ? 'PASS  camera lifecycle' : `FAIL  camera lifecycle (${failed})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
