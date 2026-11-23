import {
  Builder,
  allocate,
  boxShell,
  cylinderShell,
  ellipsoidShell,
  mergeTransformed,
  polyline,
  sphereShell,
  sphereSolid,
  torusShell,
} from '../lib/formations/shapes';
import type { Rng } from '../lib/rng';
import { PALETTE, hsl } from '../lib/color';
import type { ColorFn } from '../lib/formations/shapes';
import { textSamples, textShape } from '../lib/formations/text';
import { goldColor, padTo, sprinkleDust } from './common';
import { buildReindeer } from './reindeer';

const SCALE = 0.6;

/** Formation for a closed fist: Santa on his sleigh, reindeer, and a greeting. */
export function buildSanta(count: number, rng: Rng): Builder {
  const b = new Builder(rng);

  const weights = [0.26, 0.34, 0.32, 0.08];
  const [deerN, sleighN, textN, dust] = allocate(weights, count);

  /* ---------- reindeer team ---------- */
  const deer = buildReindeer(deerN, rng);
  mergeTransformed(b, deer, 0.62, 0.75, 0.5, 0);

  /* ---------- sleigh ---------- */
  const sleigh = new Builder(rng);
  const body = Math.floor(sleighN * 0.34);
  const runner = Math.floor(sleighN * 0.26);
  const santa = Math.floor(sleighN * 0.28);
  const sack = sleighN - body - runner - santa;

  const woodColor: ColorFn = (r) => (r() > 0.7 ? PALETTE.goldDeep : PALETTE.berry);

  // curved runner along the ground
  polyline(
    sleigh,
    [
      [-2.05, -0.72, 0.3],
      [-1.5, -0.86, 0.3],
      [-0.2, -0.88, 0.3],
      [0.55, -0.78, 0.3],
      [0.86, -0.52, 0.3],
    ],
    0.045,
    runner,
    () => PALETTE.gold,
    { size: 1 },
  );
  // struts
  polyline(sleigh, [[-1.5, -0.8, 0.3], [-1.42, -0.2, 0.3]], 0.035, Math.floor(runner * 0.25), () => PALETTE.gold, { size: 0.9 });
  polyline(sleigh, [[0.2, -0.82, 0.3], [0.24, -0.24, 0.3]], 0.035, Math.floor(runner * 0.25), () => PALETTE.gold, { size: 0.9 });

  // sleigh body: a box with a curved back
  boxShell(sleigh, [-0.5, -0.12, 0.3], [0.95, 0.34, 0.34], body, woodColor, { size: 1 });
  polyline(
    sleigh,
    [
      [-1.45, 0.22, 0.3],
      [-1.62, 0.5, 0.3],
      [-1.5, 0.78, 0.3],
    ],
    0.05,
    Math.floor(sleighN * 0.06),
    () => PALETTE.goldDeep,
    { size: 0.95 },
  );

  // santa: body, head, hat, beard
  sphereShell(sleigh, [-0.62, 0.42, 0.3], 0.34, Math.floor(santa * 0.3), () => PALETTE.santaRed, { size: 1 });
  sphereSolid(sleigh, [-0.62, 0.92, 0.3], 0.2, Math.floor(santa * 0.22), () => PALETTE.skin, { size: 1, pow: 0.7 });
  // beard
  sphereShell(sleigh, [-0.62, 0.78, 0.42], 0.2, Math.floor(santa * 0.16), () => PALETTE.white, { size: 0.95 });
  // hat
  cylinderShell(sleigh, [-0.62, 1.14, 0.3], 0.2, 0.22, Math.floor(santa * 0.16), () => PALETTE.santaRed, { size: 1, caps: true });
  torusShell(sleigh, [-0.62, 1.04, 0.3], 0.2, 0.05, Math.floor(santa * 0.08), () => PALETTE.white, { rotX: Math.PI / 2, size: 1 });
  sphereShell(sleigh, [-0.42, 1.3, 0.3], 0.075, Math.floor(santa * 0.08), () => PALETTE.white, { size: 1 });

  // sack behind him
  ellipsoidShell(sleigh, [-1.12, 0.34, 0.3], [0.26, 0.3, 0.24], sack, () => PALETTE.goldDeep, { size: 1 });

  mergeTransformed(b, sleigh, 1, -0.55, -0.15, 0);

  /* ---------- greeting text ---------- */
  const shape = textShape('Merry Christmas', 5.9, { fontPx: 170, weight: 700, italic: true });
  const samples = textSamples(shape, textN, rng, 0.012);
  const textColor: ColorFn = (r) => {
    const v = r();
    if (v > 0.82) return PALETTE.white;
    if (v > 0.5) return PALETTE.gold;
    return PALETTE.warmLight;
  };
  for (let i = 0; i < samples.length; i++) {
    const [x, y] = samples[i];
    b.add(x, y - 2.42, (rng() - 0.5) * 0.16, textColor(rng), 1.15);
  }

  sprinkleDust(b, dust, 2.8, 4.0);

  return padTo(b, count);
}
