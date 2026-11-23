import { Builder, allocate, coneShell, cylinderShell, sphereSolid, starFan } from '../lib/formations/shapes';
import type { Rng } from '../lib/rng';
import { PALETTE, hsl } from '../lib/color';
import type { ColorFn } from '../lib/formations/shapes';
import { goldColor, iceColor, padTo, sprinkleDust, warmColor } from './common';

/** Formation for 2 fingers: a layered Christmas tree with star, garland and ornaments. */
export function buildTree(count: number, rng: Rng): Builder {
  const b = new Builder(rng);

  const weights = [0.6, 0.2, 0.08, 0.06, 0.06];
  const [foliage, ornaments, star, trunk, dust] = allocate(weights, count);

  const green: ColorFn = (r) => {
    const v = r();
    if (v > 0.86) return PALETTE.treeGreen;
    if (v > 0.45) return hsl(146, 0.6, 0.28);
    return PALETTE.treeDeep;
  };

  // three stacked skirts
  const layers = 4;
  const baseY = -1.55;
  const topY = 1.42;
  let remaining = foliage;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const n = i === layers - 1 ? remaining : Math.floor(foliage / layers);
    remaining -= n;
    const y0 = baseY + (topY - baseY) * (t * 0.72);
    const y1 = baseY + (topY - baseY) * Math.min(1, t * 0.72 + 0.42);
    const radius = 1.32 * (1 - t * 0.68);
    coneShell(b, 0, 0, y0, y1, radius, n, green, { baseBias: 0.65, size: 1 });
  }

  // trunk
  cylinderShell(b, [0, baseY - 0.2, 0], 0.16, 0.42, trunk, () => PALETTE.trunk, { size: 1 });

  // star on top
  starFan(b, [0, topY + 0.34, 0], 0.42, 0.17, 5, star, goldColor, { size: 1.15, depth: 0.1 });

  // ornaments + garland
  const ornCount = ornaments;
  for (let i = 0; i < ornCount; i++) {
    const t = Math.pow(b.rng(), 0.75);
    const y = baseY + (topY - baseY) * t;
    const radius = 1.3 * (1 - t * 0.7) * (0.94 + b.rng() * 0.1);
    const a = b.rng() * Math.PI * 2;
    const v = b.rng();
    const c =
      v > 0.72 ? PALETTE.gold : v > 0.5 ? PALETTE.berry : v > 0.28 ? PALETTE.blueOrnament : PALETTE.purpleOrnament;
    const jitter = 0.05;
    for (let k = 0; k < 4; k++) {
      const aa = b.rng() * Math.PI * 2;
      const rr = 0.075 * Math.sqrt(b.rng());
      b.add(
        Math.cos(a) * radius + Math.cos(aa) * rr,
        y + Math.sin(aa) * rr,
        Math.sin(a) * radius + (b.rng() - 0.5) * jitter,
        c,
        1.2,
      );
    }
  }

  sprinkleDust(b, dust, 2.3, 3.4);

  return padTo(b, count);
}
