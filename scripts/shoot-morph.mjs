// Freezes the morph at chosen progress values and screenshots each one, so the
// transition can be inspected frame by frame instead of racing the animation.
//
// Chromium throttles requestAnimationFrame in background/occluded windows, which
// freezes the render loop and makes every screenshot identical. The launch flags
// below disable that so the frozen frames actually get drawn.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'shots/morph';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(3500);

// settle on the snowman, then start a morph to santa
await page.keyboard.press('1');
await page.waitForTimeout(2800);
await page.keyboard.press('0');
await page.waitForTimeout(150);

for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
  await page.evaluate((v) => window.__freezeMorph(v), p);
  // give the render loop a few frames to draw the frozen state
  await page.waitForTimeout(350);
  const dbg = await page.evaluate(() => window.__particleDebug());
  const label = String(Math.round(p * 100)).padStart(3, '0');
  await page.screenshot({ path: `${OUT}/f${label}.png` });
  console.log(
    `p=${p.toFixed(2)} drawn uProgress=${dbg.uProgress.toFixed(2)} abDiff=${dbg.abDiff.toFixed(3)}`,
  );
}

await page.evaluate(() => window.__freezeMorph(null));
console.log('errors:', errors.length ? errors.join(' | ') : '(none)');
await browser.close();
