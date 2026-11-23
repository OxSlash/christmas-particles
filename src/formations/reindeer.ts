import {
  Builder,
  allocate,
  ellipsoidShell,
  polyline,
  sphereShell,
  sphereSolid,
} from '../lib/formations/shapes';
import type { Rng } from '../lib/rng';
import { PALETTE, hsl, mixRgb } from '../lib/color';
import type { ColorFn, Vec3 } from '../lib/formations/shapes';
import { padTo, sprinkleDust } from './common';

/** Formation for 3 fingers (first half): a reindeer in side profile, facing +x. */
export function buildReindeer(count: number, rng: Rng): Builder {
  const b = new Builder(rng);

  const weights = [0.34, 0.16, 0.2, 0.1, 0.1, 0.1];
  const [body, head, legs, antlers, tail, dust] = allocate(weights, count);

  const fur: ColorFn = (r) => {
    const v = r();
    if (v > 0.82) return PALETTE.reindeerLight;
    if (v > 0.35) return PALETTE.reindeer;
    return mixRgb(PALETTE.reindeer, PALETTE.coal, 0.35);
  };

  // torso: two overlapping ellipsoids so it reads as an animal
  ellipsoidShell(b, [-0.1, 0.06, 0], [0.92, 0.52, 0.44], Math.floor(body * 0.62), fur, { size: 1 });
  ellipsoidShell(b, [0.62, 0.2, 0], [0.44, 0.46, 0.4], body - Math.floor(body * 0.62), fur, {
    size: 1,
  });

  // chest highlight so the silhouette separates from the background
  for (let i = 0; i < Math.floor(body * 0.12); i++) {
    const a = b.rng() * Math.PI * 2;
    const rr = Math.sqrt(b.rng());
    b.add(
      -0.12 + Math.cos(a) * 0.55 * rr,
      0.06 + Math.sin(a) * 0.34 * rr,
      0.44,
      PALETTE.reindeerLight,
      1,
    );
  }

  // neck + head
  const neck: Vec3[] = [
    [0.9, 0.34, 0],
    [1.06, 0.78, 0],
    [1.1, 1.06, 0],
  ];
  polyline(b, neck, 0.14, Math.floor(head * 0.3), fur, { size: 1 });
  ellipsoidShell(b, [1.16, 1.24, 0], [0.34, 0.2, 0.19], Math.floor(head * 0.42), fur, { size: 1 });
  // muzzle
  ellipsoidShell(b, [1.46, 1.16, 0], [0.2, 0.12, 0.12], Math.floor(head * 0.16), fur, { size: 1 });
  // nose
  const noseN = Math.max(8, Math.floor(head * 0.12));
  for (let i = 0; i < noseN; i++) {
    const a = b.rng() * Math.PI * 2;
    const r = 0.045 * Math.sqrt(b.rng());
    b.add(1.62 + Math.cos(a) * r * 0.5, 1.15 + Math.sin(a) * r, Math.sin(a) * r, PALETTE.berry, 0.8);
  }
  // eye
  const eyeN = Math.max(6, Math.floor(head * 0.08));
  for (let i = 0; i < eyeN; i++) {
    const a = b.rng() * Math.PI * 2;
    const r = 0.035 * Math.sqrt(b.rng());
    b.add(1.26 + Math.cos(a) * r, 1.3 + Math.sin(a) * r, 0.17, PALETTE.coal, 0.9);
  }

  // legs: four legs, splayed slightly on z so all of them read at this scale
  const legN = legs;
  const legDefs: Array<{ x: number; z: number }> = [
    { x: 0.62, z: 0.3 },
    { x: 0.5, z: -0.3 },
    { x: -0.62, z: 0.3 },
    { x: -0.5, z: -0.3 },
  ];
  const perLeg = Math.floor(legN / legDefs.length);
  for (let l = 0; l < legDefs.length; l++) {
    const { x, z } = legDefs[l];
    const n = l === legDefs.length - 1 ? legN - perLeg * (legDefs.length - 1) : perLeg;
    for (let i = 0; i < n; i++) {
      const t = b.rng();
      const y = -0.3 - t * 1.06;
      const bend = Math.sin(t * Math.PI) * 0.03;
      const hoof = t > 0.9;
      b.add(
        x + bend + (b.rng() - 0.5) * 0.09,
        y,
        z + (b.rng() - 0.5) * 0.09,
        hoof ? PALETTE.coal : fur(b.rng),
        1,
      );
    }
  }

  // antlers: two branching beams
  const antN = antlers;
  const branch = (pts: Vec3[], share: number) => {
    polyline(b, pts, 0.045, share, () => PALETTE.cream, { size: 0.95 });
  };
  for (const side of [1, -1]) {
    const z = side * 0.13;
    branch(
      [
        [1.02, 1.42, z],
        [1.02, 1.86, z],
        [1.16, 2.2, z],
        [1.44, 2.38, z],
      ],
      Math.floor(antN * 0.34),
    );
    branch(
      [
        [1.04, 1.74, z],
        [0.82, 2.0, z],
        [0.66, 2.22, z],
      ],
      Math.floor(antN * 0.22),
    );
    branch(
      [
        [1.12, 2.02, z],
        [1.34, 2.14, z],
        [1.54, 2.06, z],
      ],
      antN - Math.floor(antN * 0.34) - Math.floor(antN * 0.22),
    );
  }

  // tail
  for (let i = 0; i < tail; i++) {
    const a = b.rng() * Math.PI * 2;
    const r = 0.12 * Math.sqrt(b.rng());
    b.add(-1.0 + Math.cos(a) * r * 0.5, 0.34 + Math.sin(a) * r, (b.rng() - 0.5) * 0.1, PALETTE.cream, 1);
  }

  sprinkleDust(b, dust, 2.2, 3.2);

  return padTo(b, count);
}
