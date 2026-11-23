// Verifies the app boots into the particle scene with no chrome, and that the
// camera starts on its own.
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

// --- boot overlay clears -------------------------------------------------
let bootGone = false;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(400);
  if ((await page.locator('.boot').count()) === 0) {
    bootGone = true;
    break;
  }
}
check('boot overlay clears', bootGone);

// --- no chrome ------------------------------------------------------------
{
  const counts = await page.evaluate(() => ({
    chips: document.querySelectorAll('.chip').length,
    hints: document.querySelectorAll('.hints').length,
    caption: document.querySelectorAll('.caption').length,
    preview: document.querySelectorAll('.preview').length,
    title: document.querySelectorAll('.hud__title').length,
    hud: document.querySelectorAll('.hud').length,
  }));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  check('no HUD / hints / preview / chips', total === 0, JSON.stringify(counts));
}

// --- the camera video element exists but is invisible --------------------
{
  const v = await page.evaluate(() => {
    const el = document.querySelector('video');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, opacity: getComputedStyle(el).opacity };
  });
  check('a hidden video element feeds MediaPipe', v !== null && v.w <= 2 && v.h <= 2, JSON.stringify(v));
}

// --- camera auto-starts ---------------------------------------------------
let running = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(800);
  const s = await page.evaluate(() => window.__trackerState?.());
  if (s?.status === 'running') {
    running = true;
    break;
  }
}
check('camera starts without any click', running);

// --- keyboard fallback still drives formations ---------------------------
{
  const expect = { '1': 'snowman', '2': 'tree', '3': 'reindeer', '4': 'gift', '5': 'snowflake', '0': 'santa' };
  let allOk = true;
  for (const [key, want] of Object.entries(expect)) {
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => window.__trackerState?.());
    if (s?.formation !== want) {
      allOk = false;
      console.log(`  key ${key} -> ${s?.formation} (want ${want})`);
    }
  }
  check('keyboard 0-5 still works', allOk);
}

console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'errors: (none)');
if (errors.length) failed++;
console.log(failed === 0 ? 'PASS  lifecycle' : `FAIL  lifecycle (${failed})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
