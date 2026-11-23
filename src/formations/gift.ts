import { Builder, allocate, boxShell } from '../lib/formations/shapes';
import type { Rng } from '../lib/rng';
import { PALETTE } from '../lib/color';
import type { ColorFn } from '../lib/formations/shapes';
import { goldColor, padTo, sprinkleDust } from './common';

const HALF: [number, number, number] = [0.95, 0.95, 0.95];
const CENTER: [number, number, number] = [0, -0.15, 0];

const boxColor: ColorFn = (r) => {
  const v = r();
  if (v > 0.9) return PALETTE.berry;
  if (v > 0.3) return PALETTE.santaRed;
  return PALETTE.scarfRed;
};

/** Vertical ribbon band (runs along y, narrow in x). */
function verticalBand(b: Builder, n: number): void {
  const [hx, hy, hz] = HALF;
  for (let i = 0; i < n; i++) {
    const u = b.rng() * 2 - 1;
    const w = (b.rng() - 0.5) * 0.17;
    const face = Math.floor(b.rng() * 6);
    let x = 0;
    let y = 0;
    let z = 0;
    switch (face) {
      case 0: x = w; y = u * hy; z = hz + 0.014; break;
      case 1: x = w; y = u * hy; z = -hz - 0.014; break;
      case 2: x = w; y = hy + 0.014; z = u * hz; break;
      case 3: x = w; y = -hy - 0.014; z = u * hz; break;
      case 4: x = hx + 0.014; y = u * hy; z = w; break;
      default: x = -hx - 0.014; y = u * hy; z = w; break;
    }
    b.add(CENTER[0] + x, CENTER[1] + y, CENTER[2] + z, goldColor(b.rng), 1.15);
  }
}

/** Horizontal ribbon band (runs along x, narrow in y/z depending on face). */
function horizontalBand(b: Builder, n: number): void {
  const [hx, hy, hz] = HALF;
  for (let i = 0; i < n; i++) {
    const u = b.rng() * 2 - 1;
    const w = (b.rng() - 0.5) * 0.17;
    const face = Math.floor(b.rng() * 6);
    let x = 0;
    let y = 0;
    let z = 0;
    switch (face) {
      case 0: x = u * hx; y = w; z = hz + 0.014; break;
      case 1: x = u * hx; y = w; z = -hz - 0.014; break;
      case 2: x = u * hx; y = hy + 0.014; z = w; break;
      case 3: x = u * hx; y = -hy - 0.014; z = w; break;
      case 4: x = hx + 0.014; y = w; z = u * hz; break;
      default: x = -hx - 0.014; y = w; z = u * hz; break;
    }
    b.add(CENTER[0] + x, CENTER[1] + y, CENTER[2] + z, goldColor(b.rng), 1.15);
  }
}

/** Formation for 3 fingers (second half): a wrapped gift box with a golden bow. */
export function buildGift(count: number, rng: Rng): Builder {
  const b = new Builder(rng);

  const weights = [0.48, 0.22, 0.2, 0.1];
  const [box, ribbon, bow, dust] = allocate(weights, count);

  boxShell(b, CENTER, HALF, box, boxColor, { size: 1 });

  const half = Math.floor(ribbon / 2);
  verticalBand(b, half);
  horizontalBand(b, ribbon - half);

  // bow: two loops + a knot
  const knotN = Math.min(bow, Math.max(4, Math.floor(bow * 0.16)));
  const loopN = Math.max(0, Math.floor((bow - knotN) / 2));
  for (const side of [1, -1]) {
    for (let i = 0; i < loopN; i++) {
      const a = b.rng() * Math.PI * 2;
      const rr = Math.sqrt(b.rng());
      b.add(
        CENTER[0] + side * (0.3 + Math.cos(a) * 0.26 * rr),
        CENTER[1] + HALF[1] + 0.4 + Math.sin(a) * 0.22 * rr,
        CENTER[2] + Math.sin(a * 1.7) * 0.11 * rr,
        goldColor(b.rng),
        1.2,
      );
    }
  }
  for (let i = 0; i < knotN; i++) {
    const a = b.rng() * Math.PI * 2;
    const rr = 0.09 * Math.sqrt(b.rng());
    b.add(
      CENTER[0] + Math.cos(a) * rr,
      CENTER[1] + HALF[1] + 0.42 + Math.sin(a) * rr,
      CENTER[2] + Math.sin(a * 2) * rr,
      PALETTE.gold,
      1.25,
    );
  }

  sprinkleDust(b, dust, 2.2, 3.2);

  return padTo(b, count);
}
