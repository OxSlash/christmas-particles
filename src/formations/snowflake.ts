import { Builder, allocate, lineTube, sphereSolid } from '../lib/formations/shapes';
import type { Rng } from '../lib/rng';
import { PALETTE, hsl } from '../lib/color';
import type { ColorFn } from '../lib/formations/shapes';
import { padTo, sprinkleDust } from './common';

/** Formation for 5 fingers: a six-fold glowing snowflake. */
export function buildSnowflake(count: number, rng: Rng): Builder {
  const b = new Builder(rng);

  const weights = [0.34, 0.3, 0.22, 0.14];
  const [arms, branches, hexCore, dust] = allocate(weights, count);

  const flakeColor: ColorFn = (r) => {
    const v = r();
    if (v > 0.88) return PALETTE.white;
    if (v > 0.5) return PALETTE.ice;
    if (v > 0.22) return PALETTE.iceDeep;
    return PALETTE.cyan;
  };

  const armLen = 2.35;
  const perArm = Math.floor(arms / 6);
  const rest = arms - perArm * 6;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const n = k === 0 ? perArm + rest : perArm;
    const tip: [number, number, number] = [Math.cos(a) * armLen, Math.sin(a) * armLen, 0];
    lineTube(b, [0, 0, 0], tip, 0.045, n, flakeColor, { size: 1 });
  }

  // side branches: 3 pairs per arm, shortening toward the tip
  const perBranch = Math.floor(branches / 18);
  const restB = branches - perBranch * 18;
  let bi = 0;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    for (let s = 0; s < 3; s++) {
      const along = 0.75 + s * 0.5;
      const len = 0.62 - s * 0.14;
      for (const dir of [1, -1]) {
        const n = bi === 17 ? perBranch + restB : perBranch;
        bi++;
        const ang = a + dir * (Math.PI / 3.1);
        const base: [number, number, number] = [Math.cos(a) * along, Math.sin(a) * along, 0];
        const tipB: [number, number, number] = [
          base[0] + Math.cos(ang) * len,
          base[1] + Math.sin(ang) * len,
          0,
        ];
        lineTube(b, base, tipB, 0.035, n, flakeColor, { size: 0.95 });
      }
    }
  }

  // hexagonal core ring + centre glow
  const coreN = hexCore;
  const rIn = 0.34;
  const rOut = 0.44;
  for (let i = 0; i < coreN; i++) {
    const t = b.rng();
    const a = t * Math.PI * 2;
    const seg = Math.floor((a / (Math.PI * 2)) * 6);
    const a0 = (seg / 6) * Math.PI * 2;
    const a1 = ((seg + 1) / 6) * Math.PI * 2;
    const f = (a - a0) / (a1 - a0);
    const r = rIn + (rOut - rIn) * (b.rng() * 0.3);
    const ax = Math.cos(a0) * r;
    const ay = Math.sin(a0) * r;
    const bx = Math.cos(a1) * r;
    const by = Math.sin(a1) * r;
    b.add(
      ax + (bx - ax) * f + (b.rng() - 0.5) * 0.03,
      ay + (by - ay) * f + (b.rng() - 0.5) * 0.03,
      (b.rng() - 0.5) * 0.06,
      flakeColor(b.rng),
      1,
    );
  }

  sprinkleDust(b, dust, 2.4, 3.2);

  return padTo(b, count);
}
