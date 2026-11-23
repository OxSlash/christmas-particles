// Screenshots every formation and reports console errors / WebGL failures.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'shots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const keys = [
  ['1', 'snowman'],
  ['2', 'tree'],
  ['3', 'reindeer'],
  ['4', 'gift'],
  ['5', 'snowflake'],
  ['0', 'santa'],
];

for (const [key, name] of keys) {
  await page.keyboard.press(key);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

// fps sample over 3s on the heaviest shape
await page.keyboard.press('0');
await page.waitForTimeout(2000);
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
        else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(tick);
    }),
);

console.log('fps (santa, headless swiftshader):', fps);
console.log('--- console ---');
console.log(logs.length ? logs.join('\n') : '(clean)');

await browser.close();
