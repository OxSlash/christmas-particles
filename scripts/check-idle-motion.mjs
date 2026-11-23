// Measures how alive the shape looks while idle.
//
// Two numbers matter, and they disagree in an instructive way:
//
//   raw %      — pixels that changed at all. High values can be pure shimmer:
//                thousands of dots twinkling in place, which the eye filters out.
//   structural — the same comparison after downsampling to 32x22, i.e. low
//                spatial frequencies only. This is what "the shape is moving"
//                looks like to a human. Near zero means the silhouette is
//                frozen and only the texture is flickering.
//
// A shape that only translates as a whole also scores low here, because the eye
// tracks the outline and cancels a uniform shift.
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
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(4000);

// settle on a shape, then sample with no input at all
await page.keyboard.press('1');
await page.waitForTimeout(2600);

const frames = [];
for (let i = 0; i < 6; i++) {
  frames.push((await page.screenshot()).toString('base64'));
  await page.waitForTimeout(400);
}

const b2 = await chromium.launch();
const p2 = await b2.newPage();
const result = await p2.evaluate(async (imgs) => {
  const load = async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const full = document.createElement('canvas');
    full.width = img.width;
    full.height = img.height;
    full.getContext('2d').drawImage(img, 0, 0);

    // low-pass: a tiny canvas keeps only the large-scale structure
    const small = document.createElement('canvas');
    small.width = 32;
    small.height = 22;
    const sctx = small.getContext('2d');
    sctx.drawImage(img, 0, 0, 32, 22);

    return {
      full: full.getContext('2d').getImageData(0, 0, full.width, full.height),
      small: sctx.getImageData(0, 0, 32, 22),
    };
  };

  const datas = [];
  for (const b of imgs) datas.push(await load(b));

  const diff = (a, b, threshold) => {
    let changed = 0;
    let total = 0;
    for (let p = 0; p < a.length; p += 4) {
      total++;
      const d =
        Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]);
      if (d > threshold) changed++;
    }
    return (changed / total) * 100;
  };

  const raw = [];
  const structural = [];
  for (let i = 1; i < datas.length; i++) {
    raw.push(diff(datas[i - 1].full.data, datas[i].full.data, 18));
    structural.push(diff(datas[i - 1].small.data, datas[i].small.data, 8));
  }

  // how much of the screen is lit at all — a sparse shape in a big black void
  // also reads as "empty". Threshold is low on purpose: the aurora is faint, and
  // a higher cutoff would report the background as pure black even when it is
  // clearly tinted on screen.
  const full = datas[0].full.data;
  let lit = 0;
  let sum = 0;
  let deadBlack = 0;
  for (let p = 0; p < full.length; p += 4) {
    const l = (full[p] + full[p + 1] + full[p + 2]) / 3;
    sum += l;
    if (l > 4) lit++;
    if (l < 2) deadBlack++;
  }
  const total = full.length / 4;

  return {
    raw,
    structural,
    litPct: (lit / total) * 100,
    deadBlackPct: (deadBlack / total) * 100,
    meanBrightness: sum / total,
  };
}, frames);

await b2.close();

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const rawAvg = avg(result.raw);
const structAvg = avg(result.structural);

console.log('while idle (no input):');
console.log(`  raw pixel change      : ${rawAvg.toFixed(2)}%`);
console.log(`  structural change     : ${structAvg.toFixed(2)}%   <- what the eye reads as motion`);
console.log(`  lit area of the screen: ${result.litPct.toFixed(2)}%`);
console.log(`  dead-black area       : ${result.deadBlackPct.toFixed(2)}%   <- should be low`);
console.log(`  mean brightness       : ${result.meanBrightness.toFixed(2)}/255`);

let failed = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

// The shape must visibly move, not just shimmer.
check('shape has structural motion', structAvg >= 0.8, `${structAvg.toFixed(2)}%`);
// And it should not be a tiny dot in a void.
check('shape occupies a reasonable area', result.litPct >= 8, `${result.litPct.toFixed(2)}%`);
// The space around the shape must not be a dead black field.
check('background is not dead black', result.deadBlackPct < 30, `${result.deadBlackPct.toFixed(2)}%`);

console.log(failed === 0 ? '\nidle motion OK' : `\n${failed} check(s) failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
