// Headless sanity check for every formation: particle counts, bounds, colour
// ranges. Text rendering is stubbed because there is no DOM in Node.
import { makeRng } from '../src/lib/rng';
import { FORMATIONS } from '../src/formations';

interface StubContext {
  font: string;
  fillStyle: string;
  textAlign: string;
  textBaseline: string;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

globalThis.document = {
  createElement(): { width: number; height: number; getContext(): StubContext } {
    return {
      width: 0,
      height: 0,
      getContext(): StubContext {
        return {
          font: '',
          fillStyle: '',
          textAlign: '',
          textBaseline: '',
          measureText(text: string) {
            return { width: text.length * 70 };
          },
          fillText() {
            /* handled by the getImageData stub */
          },
          getImageData(_x: number, _y: number, w: number, h: number) {
            // paint a centred "text" band so the sampler has pixels to pick
            const data = new Uint8ClampedArray(w * h * 4);
            for (let py = Math.floor(h * 0.35); py < Math.floor(h * 0.62); py++) {
              for (let px = Math.floor(w * 0.12); px < Math.floor(w * 0.88); px++) {
                data[(py * w + px) * 4 + 3] = 255;
              }
            }
            return { data };
          },
        };
      },
    };
  },
} as unknown as Document;

const COUNT = 110_000;
let failed = 0;

for (const def of FORMATIONS) {
  const t0 = performance.now();
  const b = def.build(COUNT, makeRng(12345));
  const ms = performance.now() - t0;

  const n = b.count;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const x = b.pos[i * 3], y = b.pos[i * 3 + 1], z = b.pos[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) bad++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  for (let i = 0; i < n * 3; i++) {
    const c = b.col[i];
    if (!Number.isFinite(c) || c < -0.01 || c > 1.01) bad++;
  }

  const ok = n === COUNT && bad === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${def.id.padEnd(10)} n=${n} bad=${bad} ` +
      `x[${minX.toFixed(2)},${maxX.toFixed(2)}] y[${minY.toFixed(2)},${maxY.toFixed(2)}] ` +
      `z[${minZ.toFixed(2)},${maxZ.toFixed(2)}] ${ms.toFixed(0)}ms`,
  );
}

console.log(failed === 0 ? '\nall formations OK' : `\n${failed} formation(s) failed`);
process.exit(failed === 0 ? 0 : 1);
