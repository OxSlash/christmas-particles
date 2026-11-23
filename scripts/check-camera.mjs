// Integration check for the camera path using Chromium's fake video device.
// There is no visible UI anymore, so the tracker state is read from the hook
// itself (exposed for tests) rather than from DOM labels.
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

// the camera starts on its own now — no button to click
let running = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => window.__trackerState?.());
  if (s?.status === 'running') {
    running = true;
    console.log(`camera reached "running" after ~${i + 1}s (${s.fps} fps detection)`);
    break;
  }
  if (s?.status === 'error' || s?.status === 'denied') {
    console.log('camera failed with', s.status, s.error);
    break;
  }
}

console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'errors: (none)');
console.log(running ? 'PASS  camera pipeline running' : 'FAIL  camera pipeline did not start');
await browser.close();
process.exit(running && errors.length === 0 ? 0 : 1);
