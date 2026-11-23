import type { RGB } from '../color';
import type { Rng } from '../rng';

export type Vec3 = [number, number, number];
export type ColorFn = (rng: Rng) => RGB;

/**
 * Accumulates particles for one formation. Positions are in world units,
 * colors in sRGB (converted to linear when the buffers are baked).
 */
export class Builder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly sizes: number[] = [];
  readonly seeds: number[] = [];
  /**
   * Index where the main shape ends and ambient dust begins. Fitting uses only
   * the main shape, otherwise the scattered dust would inflate the bounds and
   * make every formation render at a different, smaller size.
   */
  coreEnd = -1;

  constructor(readonly rng: Rng) {}

  add(x: number, y: number, z: number, c: RGB, s = 1): void {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    this.sizes.push(s);
    this.seeds.push(this.rng());
  }

  /** Marks the current particle count as the end of the solid shape. */
  markCoreEnd(): void {
    if (this.coreEnd < 0) this.coreEnd = this.sizes.length;
  }

  get count(): number {
    return this.sizes.length;
  }
}

/** Split `total` across weighted parts, largest-remainder method. */
export function allocate(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / sum) * total);
  const counts = raw.map((v) => Math.floor(v));
  let rest = total - counts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (rest > 0) {
    counts[order[k % order.length].i]++;
    rest--;
    k++;
  }
  return counts;
}

export function mergeTransformed(
  dst: Builder,
  src: Builder,
  scale: number,
  tx: number,
  ty: number,
  tz: number,
): void {
  for (let i = 0; i < src.count; i++) {
    dst.add(
      src.pos[i * 3] * scale + tx,
      src.pos[i * 3 + 1] * scale + ty,
      src.pos[i * 3 + 2] * scale + tz,
      [src.col[i * 3], src.col[i * 3 + 1], src.col[i * 3 + 2]],
      src.sizes[i],
    );
  }
}

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

function randDir(rng: Rng): Vec3 {
  const u = rng() * 2 - 1;
  const th = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  return [Math.cos(th) * r, u, Math.sin(th) * r];
}

export function sphereShell(
  b: Builder,
  c: Vec3,
  radius: number,
  n: number,
  color: ColorFn,
  opts: { thickness?: number; size?: number } = {},
): void {
  const thickness = opts.thickness ?? 0.07;
  const size = opts.size ?? 1;
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = randDir(b.rng);
    const k = radius * (1 + (b.rng() - 0.5) * thickness);
    b.add(c[0] + dx * k, c[1] + dy * k, c[2] + dz * k, color(b.rng), size);
  }
}

export function sphereSolid(
  b: Builder,
  c: Vec3,
  radius: number,
  n: number,
  color: ColorFn,
  opts: { size?: number; pow?: number } = {},
): void {
  const size = opts.size ?? 1;
  const pw = opts.pow ?? 0.6;
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = randDir(b.rng);
    const k = radius * Math.pow(b.rng(), pw);
    b.add(c[0] + dx * k, c[1] + dy * k, c[2] + dz * k, color(b.rng), size);
  }
}

export function ellipsoidShell(
  b: Builder,
  c: Vec3,
  radii: Vec3,
  n: number,
  color: ColorFn,
  opts: { thickness?: number; size?: number } = {},
): void {
  const thickness = opts.thickness ?? 0.07;
  const size = opts.size ?? 1;
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = randDir(b.rng);
    const k = 1 + (b.rng() - 0.5) * thickness;
    b.add(
      c[0] + dx * radii[0] * k,
      c[1] + dy * radii[1] * k,
      c[2] + dz * radii[2] * k,
      color(b.rng),
      size,
    );
  }
}

/** Cone with base at y0 (radius r) tapering to apex at y1. */
export function coneShell(
  b: Builder,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  r: number,
  n: number,
  color: ColorFn,
  opts: { size?: number; baseBias?: number; thickness?: number } = {},
): void {
  const size = opts.size ?? 1;
  const bias = opts.baseBias ?? 0.8;
  const thickness = opts.thickness ?? 0.02;
  for (let i = 0; i < n; i++) {
    const t = Math.pow(b.rng(), bias);
    const y = y0 + (y1 - y0) * t;
    const rad = r * (1 - t) * (1 + (b.rng() - 0.5) * thickness);
    const a = b.rng() * Math.PI * 2;
    b.add(cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad, color(b.rng), size);
  }
}

export function cylinderShell(
  b: Builder,
  c: Vec3,
  radius: number,
  height: number,
  n: number,
  color: ColorFn,
  opts: { size?: number; caps?: boolean } = {},
): void {
  const size = opts.size ?? 1;
  const caps = opts.caps ?? false;
  const y0 = c[1] - height / 2;
  for (let i = 0; i < n; i++) {
    const a = b.rng() * Math.PI * 2;
    const y = y0 + b.rng() * height;
    b.add(c[0] + Math.cos(a) * radius, y, c[2] + Math.sin(a) * radius, color(b.rng), size);
  }
  if (caps) {
    const capN = Math.max(2, Math.floor(n * 0.25));
    for (let i = 0; i < capN; i++) {
      const a = b.rng() * Math.PI * 2;
      const rr = Math.sqrt(b.rng()) * radius;
      const top = b.rng() > 0.5;
      const y = top ? y0 + height : y0;
      b.add(c[0] + Math.cos(a) * rr, y, c[2] + Math.sin(a) * rr, color(b.rng), size);
    }
  }
}

export function boxShell(
  b: Builder,
  c: Vec3,
  half: Vec3,
  n: number,
  color: ColorFn,
  opts: { size?: number; only?: number[] } = {},
): void {
  const size = opts.size ?? 1;
  const faces = opts.only ?? [0, 1, 2, 3, 4, 5];
  for (let i = 0; i < n; i++) {
    const face = faces[Math.floor(b.rng() * faces.length)];
    const u = b.rng() * 2 - 1;
    const v = b.rng() * 2 - 1;
    let x = 0;
    let y = 0;
    let z = 0;
    switch (face) {
      case 0: x = u * half[0]; y = v * half[1]; z = half[2]; break;
      case 1: x = u * half[0]; y = v * half[1]; z = -half[2]; break;
      case 2: x = u * half[0]; y = half[1]; z = v * half[2]; break;
      case 3: x = u * half[0]; y = -half[1]; z = v * half[2]; break;
      case 4: x = half[0]; y = u * half[1]; z = v * half[2]; break;
      default: x = -half[0]; y = u * half[1]; z = v * half[2]; break;
    }
    b.add(c[0] + x, c[1] + y, c[2] + z, color(b.rng), size);
  }
}

export function lineTube(
  b: Builder,
  p0: Vec3,
  p1: Vec3,
  thickness: number,
  n: number,
  color: ColorFn,
  opts: { size?: number } = {},
): void {
  const size = opts.size ?? 1;
  for (let i = 0; i < n; i++) {
    const t = b.rng();
    const [dx, dy, dz] = randDir(b.rng);
    b.add(
      p0[0] + (p1[0] - p0[0]) * t + dx * thickness,
      p0[1] + (p1[1] - p0[1]) * t + dy * thickness,
      p0[2] + (p1[2] - p0[2]) * t + dz * thickness,
      color(b.rng),
      size,
    );
  }
}

export function polyline(
  b: Builder,
  pts: Vec3[],
  thickness: number,
  n: number,
  color: ColorFn,
  opts: { size?: number } = {},
): void {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(
      pts[i + 1][0] - pts[i][0],
      pts[i + 1][1] - pts[i][1],
      pts[i + 1][2] - pts[i][2],
    );
    lengths.push(d);
    total += d;
  }
  if (total === 0) return;
  for (let i = 0; i < n; i++) {
    let target = b.rng() * total;
    let seg = 0;
    while (seg < lengths.length - 1 && target > lengths[seg]) {
      target -= lengths[seg];
      seg++;
    }
    const t = lengths[seg] === 0 ? 0 : target / lengths[seg];
    const a = pts[seg];
    const c = pts[seg + 1];
    const [dx, dy, dz] = randDir(b.rng);
    b.add(
      a[0] + (c[0] - a[0]) * t + dx * thickness,
      a[1] + (c[1] - a[1]) * t + dy * thickness,
      a[2] + (c[2] - a[2]) * t + dz * thickness,
      color(b.rng),
      opts.size ?? 1,
    );
  }
}

export function torusShell(
  b: Builder,
  c: Vec3,
  majorR: number,
  minorR: number,
  n: number,
  color: ColorFn,
  opts: { size?: number; arc?: number; rotX?: number; rotY?: number; rotZ?: number } = {},
): void {
  const size = opts.size ?? 1;
  const arc = opts.arc ?? Math.PI * 2;
  const rx = opts.rotX ?? 0;
  const ry = opts.rotY ?? 0;
  const rz = opts.rotZ ?? 0;
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  for (let i = 0; i < n; i++) {
    const a = b.rng() * arc;
    const bb = b.rng() * Math.PI * 2;
    const rr = minorR * (0.85 + b.rng() * 0.3);
    let x = (majorR + Math.cos(bb) * rr) * Math.cos(a);
    let y = Math.sin(bb) * rr;
    let z = (majorR + Math.cos(bb) * rr) * Math.sin(a);
    // rotX
    let ty = y * cosX - z * sinX;
    let tz = y * sinX + z * cosX;
    y = ty; z = tz;
    // rotY
    let tx = x * cosY + z * sinY;
    tz = -x * sinY + z * cosY;
    x = tx; z = tz;
    // rotZ
    tx = x * cosZ - y * sinZ;
    ty = x * sinZ + y * cosZ;
    x = tx; y = ty;
    b.add(c[0] + x, c[1] + y, c[2] + z, color(b.rng), size);
  }
}

/** Filled N-pointed star lying in the XY plane. */
export function starFan(
  b: Builder,
  c: Vec3,
  outer: number,
  inner: number,
  points: number,
  n: number,
  color: ColorFn,
  opts: { size?: number; depth?: number } = {},
): void {
  const size = opts.size ?? 1;
  const depth = opts.depth ?? 0.02;
  const verts: Array<[number, number]> = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    verts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = 0; i < n; i++) {
    const seg = Math.floor(b.rng() * verts.length);
    const v0 = verts[seg];
    const v1 = verts[(seg + 1) % verts.length];
    let u = b.rng();
    let v = b.rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const x = v0[0] * u + v1[0] * v;
    const y = v0[1] * u + v1[1] * v;
    b.add(c[0] + x, c[1] + y, c[2] + (b.rng() - 0.5) * depth, color(b.rng), size);
  }
}

export function dustCloud(
  b: Builder,
  c: Vec3,
  radius: number,
  n: number,
  color: ColorFn,
  opts: { size?: number; flatten?: number } = {},
): void {
  const size = opts.size ?? 0.8;
  const flatten = opts.flatten ?? 1;
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = randDir(b.rng);
    const k = radius * Math.pow(b.rng(), 0.5);
    b.add(c[0] + dx * k, c[1] + dy * k * flatten, c[2] + dz * k, color(b.rng), size);
  }
}
