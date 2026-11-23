import { Builder, allocate, cylinderShell, ellipsoidShell, polyline, sphereShell, sphereSolid, torusShell } from '../lib/formations/shapes';
import type { Rng } from '../lib/rng';
import { PALETTE } from '../lib/color';
import { iceColor, padTo, sprinkleDust } from './common';

/** Formation for 1 finger: a snowman with hat, scarf, carrot nose and twig arms. */
export function buildSnowman(count: number, rng: Rng): Builder {
  const b = new Builder(rng);

  const weights = [1.12, 0.66, 0.34, 0.1, 0.1, 0.05, 0.04, 0.05, 0.12, 0.1];
  const [bottom, middle, head, hat, scarf, nose, face, buttons, arms, dust] = allocate(
    weights,
    count,
  );

  // body
  sphereShell(b, [0, -1.14, 0], 1.04, bottom, iceColor, { size: 1 });
  sphereShell(b, [0, 0.06, 0], 0.79, middle, iceColor, { size: 1 });
  sphereShell(b, [0, 0.95, 0], 0.57, head, iceColor, { size: 1 });

  // hat: brim + top
  const hatBrim = Math.floor(hat * 0.42);
  torusShell(b, [0, 1.42, 0], 0.4, 0.075, hatBrim, () => PALETTE.coal, {
    rotX: Math.PI / 2,
    size: 1,
  });
  cylinderShell(b, [0, 1.64, 0], 0.31, 0.44, hat - hatBrim, () => PALETTE.coal, {
    size: 1,
    caps: true,
  });

  // scarf around the neck + hanging tail
  torusShell(b, [0, 0.5, 0], 0.47, 0.095, Math.floor(scarf * 0.62), () => PALETTE.scarfRed, {
    rotX: Math.PI / 2,
    size: 1,
  });
  const tail = scarf - Math.floor(scarf * 0.62);
  for (let i = 0; i < tail; i++) {
    const t = b.rng();
    const x = 0.3 + t * 0.16;
    const y = 0.42 - t * 0.62;
    const z = 0.42 + Math.sin(t * 2.4) * 0.06;
    b.add(x + (b.rng() - 0.5) * 0.11, y, z + (b.rng() - 0.5) * 0.1, PALETTE.scarfRed, 1);
  }

  // carrot nose (points towards +z)
  for (let i = 0; i < nose; i++) {
    const t = Math.pow(b.rng(), 0.7);
    const r = 0.085 * (1 - t);
    const a = b.rng() * Math.PI * 2;
    b.add(
      Math.cos(a) * r,
      0.96 - t * 0.03 + Math.sin(a) * r,
      0.5 + t * 0.42,
      b.rng() > 0.4 ? PALETTE.carrot : PALETTE.warmLight,
      0.9,
    );
  }

  // eyes + smile
  const eyeN = Math.floor(face * 0.55);
  for (let i = 0; i < eyeN; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const a = b.rng() * Math.PI * 2;
    const r = 0.055 * Math.sqrt(b.rng());
    b.add(
      side * 0.19 + Math.cos(a) * r,
      1.1 + Math.sin(a) * r,
      0.5 + Math.sqrt(Math.max(0, 0.06 - r * r)),
      PALETTE.coal,
      0.85,
    );
  }
  const smileN = face - eyeN;
  for (let i = 0; i < smileN; i++) {
    const t = b.rng();
    const a = Math.PI * (0.15 + t * 0.7);
    b.add(
      Math.cos(a) * 0.2,
      0.9 - Math.sin(a) * 0.16,
      0.53,
      PALETTE.coal,
      0.8,
    );
  }

  // buttons down the middle
  const btnPer = Math.max(3, Math.floor(buttons / 3));
  for (let k = 0; k < 3; k++) {
    const y = 0.18 - k * 0.26;
    for (let i = 0; i < btnPer; i++) {
      const a = b.rng() * Math.PI * 2;
      const r = 0.055 * Math.sqrt(b.rng());
      b.add(Math.cos(a) * r, y + Math.sin(a) * r, 0.6, PALETTE.coal, 0.85);
    }
  }

  // twig arms with little branches
  const armN = arms;
  for (let i = 0; i < armN; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const t = b.rng();
    const x = side * (0.72 + t * 0.82);
    const y = 0.16 + t * 0.56 + Math.sin(t * 3.1) * 0.05;
    const z = (b.rng() - 0.5) * 0.12;
    b.add(x, y, z, b.rng() > 0.5 ? PALETTE.twig : PALETTE.reindeerLight, 0.9);
  }
  // small branch stubs
  const stub = Math.floor(armN * 0.35);
  for (let i = 0; i < stub; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const t = b.rng();
    const bx = side * (1.05 + t * 0.4);
    const by = 0.4 + t * 0.5;
    b.add(bx + side * 0.1, by + 0.16, (b.rng() - 0.5) * 0.1, PALETTE.twig, 0.85);
  }

  sprinkleDust(b, dust, 2.4, 3.2);

  return padTo(b, count);
}
