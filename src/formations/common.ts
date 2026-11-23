import { Builder } from '../lib/formations/shapes';
import type { Rng } from '../lib/rng';
import type { RGB } from '../lib/color';
import { PALETTE } from '../lib/color';
import type { ColorFn } from '../lib/formations/shapes';

/** Pads or trims a builder so every formation has exactly `count` particles. */
export function padTo(b: Builder, count: number): Builder {
  const rng = b.rng;
  if (b.count > count) {
    b.pos.length = count * 3;
    b.col.length = count * 3;
    b.sizes.length = count;
    b.seeds.length = count;
    return b;
  }
  // an empty builder cannot be cloned; seed one neutral particle first
  if (b.count === 0 && count > 0) {
    b.add(0, 0, 0, PALETTE.ice, 1);
  }
  let guard = 0;
  while (b.count < count && guard++ < count * 4) {
    const k = Math.floor(rng() * b.count);
    b.add(
      b.pos[k * 3] + (rng() - 0.5) * 0.01,
      b.pos[k * 3 + 1] + (rng() - 0.5) * 0.01,
      b.pos[k * 3 + 2] + (rng() - 0.5) * 0.01,
      [b.col[k * 3], b.col[k * 3 + 1], b.col[k * 3 + 2]],
      b.sizes[k],
    );
  }
  return b;
}

/** Icy white with a few brighter highlights. */
export const iceColor: ColorFn = (r) => {
  const v = r();
  if (v > 0.9) return PALETTE.white;
  if (v > 0.55) return PALETTE.ice;
  if (v > 0.25) return PALETTE.iceDeep;
  return PALETTE.cyan;
};

export const goldColor: ColorFn = (r) => (r() > 0.55 ? PALETTE.gold : PALETTE.goldDeep);

export function warmColor(r: Rng): RGB {
  const v = r();
  if (v > 0.7) return PALETTE.warmLight;
  if (v > 0.4) return PALETTE.gold;
  return PALETTE.berry;
}

/** Generic ambient dust used to keep the scene alive between morphs. */
export function sprinkleDust(b: Builder, n: number, radius: number, height: number): void {
  b.markCoreEnd();
  const rng = b.rng;
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    b.add(
      Math.cos(a) * r,
      (rng() - 0.5) * height,
      Math.sin(a) * r * 0.6,
      rng() > 0.6 ? PALETTE.iceDeep : PALETTE.ice,
      0.55 + rng() * 0.5,
    );
  }
}
