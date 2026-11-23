// Checks small-viewport layout and resize behaviour.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader'],
});
const errors = [];

const sizes = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1600, height: 900 },
];

for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  page.on('pageerror', (e) => errors.push(`${s.name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${s.name}: ${m.text()}`);
  });

  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  await page.keyboard.press('1');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `shots/view-${s.name}.png` });

  // nothing should overflow horizontally
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth };
  });
  const ok = overflow.scrollW <= overflow.clientW + 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${s.name} ${s.width}x${s.height} ` +
      `scrollW=${overflow.scrollW} clientW=${overflow.clientW}`,
  );
  await page.close();
}

// resize mid-session
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`resize: ${e.message}`));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.setViewportSize({ width: 700, height: 900 });
await page.waitForTimeout(1200);
await page.keyboard.press('5');
await page.waitForTimeout(2200);
await page.screenshot({ path: 'shots/view-resized.png' });
console.log('resize handled');

console.log('errors:', errors.length ? errors.join(' | ') : '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
