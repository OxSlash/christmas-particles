export type RGB = [number, number, number];

export const rgb = (r: number, g: number, b: number): RGB => [r, g, b];

/** h in degrees, s/l in 0..1 — returns sRGB 0..1 */
export function hsl(h: number, s: number, l: number): RGB {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleRgb(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function toLinear(c: RGB): RGB {
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}

/** Festive palette */
export const PALETTE = {
  ice: hsl(200, 0.85, 0.86),
  iceDeep: hsl(205, 0.9, 0.62),
  cyan: hsl(188, 0.95, 0.72),
  snowWhite: hsl(210, 0.4, 0.97),
  coal: hsl(220, 0.3, 0.42),
  scarfRed: hsl(352, 0.85, 0.58),
  carrot: hsl(24, 0.95, 0.56),
  twig: hsl(28, 0.42, 0.34),
  treeGreen: hsl(145, 0.62, 0.34),
  treeDeep: hsl(152, 0.7, 0.2),
  trunk: hsl(26, 0.45, 0.28),
  gold: hsl(44, 0.95, 0.62),
  goldDeep: hsl(38, 0.9, 0.45),
  warmLight: hsl(36, 1.0, 0.72),
  berry: hsl(350, 0.85, 0.5),
  reindeer: hsl(26, 0.45, 0.42),
  reindeerLight: hsl(32, 0.5, 0.62),
  cream: hsl(38, 0.5, 0.84),
  santaRed: hsl(352, 0.8, 0.48),
  skin: hsl(28, 0.62, 0.72),
  white: hsl(0, 0, 0.97),
  blueOrnament: hsl(210, 0.85, 0.55),
  purpleOrnament: hsl(276, 0.65, 0.56),
} as const;
