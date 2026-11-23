// Verifies the lerp-based morph.
//
// The design: each particle stores a *current* position and a *target* position.
// Every frame the animation loop moves current toward target by a small factor,
// so a gesture change never snaps. These checks read the real buffers attached
// to the geometry and confirm they converge gradually.
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
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(3500);

const dbg = () => page.evaluate(() => window.__particleDebug?.());

let failed = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

// --- wiring sanity ------------------------------------------------------
{
  const d = await dbg();
  check('material shares the animated uniforms object', d.sameUniformsObject === true);
  check('geometry is the one attached to the mesh', d.geomIsAttached === true);
  check(
    'geometry position buffer IS the current-positions buffer',
    d.currentIsGeometryPosition === true,
  );
  check('a landed shape has no remaining distance', d.remaining < 1e-4, `remaining=${d.remaining.toExponential(2)}`);
}

// --- the morph must converge gradually, not snap -----------------------
await page.keyboard.press('1');
await page.waitForTimeout(2600);

await page.keyboard.press('0');
const series = [];
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(60);
  const d = await dbg();
  if (d) series.push(d.remaining);
}

const peak = Math.max(...series);
const tail = series[series.length - 1];
// A morph is "gradual" if it passes through clearly intermediate states rather
// than jumping straight to the target. Sampling at 60 ms against a ~620 ms
// morph gives several such frames; counting them is less brittle than timing.
const mids = series.filter((r) => r > peak * 0.15 && r < peak * 0.8).length;
console.log('remaining distance:', series.map((r) => r.toFixed(3)).join(' '));

check('particles start far from the target', peak > 0.2, `peak=${peak.toFixed(2)}`);
check('distance shrinks gradually', mids >= 3, `${mids} intermediate frames`);
check('particles actually land on the shape', tail < peak * 0.08, `tail=${tail.toFixed(3)}`);

// monotonic decrease (allow tiny noise)
let decreasing = true;
for (let i = 1; i < series.length; i++) {
  if (series[i] > series[i - 1] + 0.01) decreasing = false;
}
check('convergence is monotonic', decreasing);

// --- a gesture change mid-flight must not jump -------------------------
{
  // Start a morph, interrupt it partway, and confirm the particles kept the
  // positions they had reached. A buffer-swap implementation would reset them
  // to the previous shape, making the cloud visibly jump backwards.
  await page.keyboard.press('5');
  await page.waitForTimeout(420);
  await page.keyboard.press('2');
  await page.waitForTimeout(80);

  const snap = await page.evaluate(() => window.__switchSnapshot?.());
  if (!snap) {
    check('switch snapshot captured', false, 'no snapshot');
  } else {
    const drift = Math.abs(snap.after - snap.before) / Math.max(1, Math.abs(snap.before));
    check(
      'interrupted morph keeps current positions (no reset)',
      drift < 0.001,
      `drift=${(drift * 100).toFixed(4)}%`,
    );
  }
  const after = await page.evaluate(() => window.__particleDebug?.());
  check('same buffer is still bound after the switch', after.currentIsGeometryPosition === true);
}

// --- swirl only while travelling ---------------------------------------
{
  await page.keyboard.press('0');
  await page.waitForTimeout(250);
  const moving = (await dbg()).swell;
  await page.waitForTimeout(4500);
  const landed = (await dbg()).swell;
  check('turbulence is active mid-morph', moving > 0.01, `swell=${moving.toFixed(3)}`);
  check('turbulence settles once landed', landed < 0.01, `swell=${landed.toFixed(3)}`);
}

console.log('errors:', errors.length ? errors.join(' | ') : '(none)');
if (errors.length) failed++;

console.log(failed === 0 ? '\ntransition OK' : `\n${failed} check(s) failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
