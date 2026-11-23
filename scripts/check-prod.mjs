// Verifies the production build: assets resolve, WebGL starts, camera path
// works, and the page has no visible chrome.
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
  viewport: { width: 1440, height: 900 },
  permissions: ['camera'],
});
const page = await context.newPage();
const errors = [];
const failedRequests = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
});

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// wasm + model must be reachable in the built output
const assetChecks = await page.evaluate(async () => {
  const urls = [
    '/mediapipe/hand_landmarker.task',
    '/mediapipe/wasm/vision_wasm_internal.wasm',
    '/mediapipe/wasm/vision_wasm_internal.js',
  ];
  const out = {};
  for (const u of urls) {
    const r = await fetch(u, { method: 'HEAD' });
    out[u] = r.status;
  }
  return out;
});

await page.keyboard.press('2');
await page.waitForTimeout(2400);
await page.screenshot({ path: 'shots/prod-tree.png' });

const gl = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return !!c && (!!c.getContext('webgl2') || !!c.getContext('webgl'));
});

// camera should come up on its own
let cameraRunning = false;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(800);
  const s = await page.evaluate(() => window.__trackerState?.());
  if (s?.status === 'running') {
    cameraRunning = true;
    break;
  }
}

const chrome = await page.evaluate(() => ({
  chips: document.querySelectorAll('.chip').length,
  hints: document.querySelectorAll('.hints').length,
  preview: document.querySelectorAll('.preview').length,
  caption: document.querySelectorAll('.caption').length,
}));

console.log('assets:', JSON.stringify(assetChecks));
console.log('webgl:', gl);
console.log('camera auto-start:', cameraRunning);
console.log('chrome:', JSON.stringify(chrome));
console.log('failed requests:', failedRequests.length ? failedRequests.join(' | ') : '(none)');
console.log('errors:', errors.length ? errors.join(' | ') : '(none)');

const ok =
  gl &&
  cameraRunning &&
  Object.values(assetChecks).every((s) => s === 200) &&
  errors.length === 0 &&
  failedRequests.length === 0 &&
  Object.values(chrome).every((n) => n === 0);

console.log(ok ? 'PASS  production build' : 'FAIL  production build');
await browser.close();
process.exit(ok ? 0 : 1);
