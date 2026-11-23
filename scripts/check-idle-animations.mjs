// Verifies each formation has its own idle animation, and that they differ.
//
// "Make it less boring" is easy to fake: a global wobble would satisfy any
// "is it moving" check. This measures the actual pose transform for every
// formation and asserts (a) each one moves and (b) no two share a motion.
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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(4000);

let failed = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const pose = () => page.evaluate(() => window.__idlePose?.());

const formations = [
  ['1', 'snowman'],
  ['2', 'tree'],
  ['3', 'reindeer'],
  ['4', 'gift'],
  ['5', 'snowflake'],
  ['0', 'santa'],
];

const signatures = new Map();

for (const [key, name] of formations) {
  await page.keyboard.press(key);
  // wait for the morph to finish and the idle motion to blend in
  await page.waitForTimeout(2600);

  // sample the pose over time
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const p = await pose();
    if (p) samples.push(p);
    await page.waitForTimeout(220);
  }

  if (samples.length < 4) {
    check(`${name} exposes a pose`, false, 'no samples');
    continue;
  }

  // how much does each channel move over the samples?
  const spread = (get) => {
    const vals = samples.map(get);
    return Math.max(...vals) - Math.min(...vals);
  };
  const rotY = spread((s) => s.rotY);
  const rotX = spread((s) => s.rotX);
  const rotZ = spread((s) => s.rotZ);
  const posX = spread((s) => s.posX);
  const posY = spread((s) => s.posY);

  const moved = rotY + rotX + rotZ + posX + posY;
  check(
    `${name.padEnd(10)} animates`,
    moved > 0.02,
    `rotY=${rotY.toFixed(2)} rotX=${rotX.toFixed(2)} rotZ=${rotZ.toFixed(2)} posX=${posX.toFixed(2)} posY=${posY.toFixed(2)}`,
  );

  // signature: which channels dominate — used to prove the motions differ
  signatures.set(name, {
    rotY: +rotY.toFixed(2),
    rotX: +rotX.toFixed(2),
    rotZ: +rotZ.toFixed(2),
    posX: +posX.toFixed(2),
    posY: +posY.toFixed(2),
  });
}

// --- the motions must not all be the same ------------------------------
{
  const names = [...signatures.keys()];
  let identical = 0;
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = signatures.get(names[i]);
      const b = signatures.get(names[j]);
      const same =
        Math.abs(a.rotY - b.rotY) < 0.02 &&
        Math.abs(a.rotX - b.rotX) < 0.02 &&
        Math.abs(a.posX - b.posX) < 0.02 &&
        Math.abs(a.posY - b.posY) < 0.02;
      if (same) {
        identical++;
        console.log(`  ${names[i]} and ${names[j]} look the same`);
      }
    }
  }
  check('every formation has a distinct motion', identical === 0, `${identical} identical pairs`);
}

// --- the sleigh must actually travel across the screen -----------------
{
  await page.keyboard.press('0');
  await page.waitForTimeout(2600);
  const xs = [];
  for (let i = 0; i < 20; i++) {
    const p = await pose();
    if (p) xs.push(p.posX);
    await page.waitForTimeout(180);
  }
  const travel = Math.max(...xs) - Math.min(...xs);
  check('santa circles the screen', travel > 1.0, `travels ${travel.toFixed(2)} units`);
}

// --- the snowflake must turn in 3D, not just spin flat -----------------
{
  await page.keyboard.press('5');
  await page.waitForTimeout(2600);
  const tilts = [];
  for (let i = 0; i < 20; i++) {
    const p = await pose();
    if (p) tilts.push(Math.abs(p.rotX));
    await page.waitForTimeout(180);
  }
  const maxTilt = Math.max(...tilts);
  check('snowflake tilts out of plane', maxTilt > 0.25, `max tilt ${maxTilt.toFixed(2)} rad`);
}

console.log(signatures.size ? `\nsignatures: ${JSON.stringify(Object.fromEntries(signatures))}` : '');
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'errors: (none)');
if (errors.length) failed++;
console.log(failed === 0 ? '\nidle animations OK' : `\n${failed} check(s) failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
