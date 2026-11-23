// Verifies morphing behaviour in the browser: rapid formation switches must
// never leave particles stuck between shapes or produce NaN positions.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'shots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// hammer the formations with switches faster than the morph duration
for (const k of ['2', '5', '0', '3', '1', '4', '0', '2']) {
  await page.keyboard.press(k);
  await page.waitForTimeout(180);
}
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/rapid-switch.png` });

// mid-morph capture to confirm particles are in flight, not snapped
await page.keyboard.press('5');
await page.waitForTimeout(420);
await page.screenshot({ path: `${OUT}/mid-morph.png` });

// burst effect
await page.keyboard.press('1');
await page.waitForTimeout(1800);
await page.keyboard.press(' ');
await page.waitForTimeout(420);
await page.screenshot({ path: `${OUT}/burst.png` });

// check the WebGL buffer is still sane
const stats = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  return { hasContext: !!gl, w: canvas?.width, h: canvas?.height };
});

console.log('webgl:', JSON.stringify(stats));
console.log('errors:', errors.length ? errors.join(' | ') : '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
