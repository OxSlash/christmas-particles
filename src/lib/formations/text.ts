import type { Rng } from '../rng';

export interface TextShape {
  /** flat [x, y] pairs in world units, centred on origin, y pointing up */
  points: Float32Array;
  width: number;
  height: number;
}

/**
 * Rasterises `text` on a 2D canvas and returns the filled pixels as points.
 * Uses only always-available system fonts so it never waits on a webfont.
 */
export function textShape(
  text: string,
  targetWidth: number,
  opts: { italic?: boolean; weight?: number; family?: string; fontPx?: number } = {},
): TextShape {
  const fontPx = opts.fontPx ?? 190;
  const italic = opts.italic ?? true;
  const weight = opts.weight ?? 700;
  const family = opts.family ?? 'Georgia, "Times New Roman", serif';
  const font = `${italic ? 'italic ' : ''}${weight} ${fontPx}px ${family}`;

  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  ctx.font = font;
  const metrics = ctx.measureText(text);
  const pad = Math.ceil(fontPx * 0.35);
  const w = Math.ceil(metrics.width) + pad * 2;
  const h = Math.ceil(fontPx * 1.55);

  canvas.width = w;
  canvas.height = h;
  ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const data = ctx.getImageData(0, 0, w, h).data;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] > 140) {
        xs.push(x);
        ys.push(y);
      }
    }
  }

  const scale = targetWidth / w;
  const out = new Float32Array(xs.length * 2);
  for (let i = 0; i < xs.length; i++) {
    out[i * 2] = (xs[i] - w / 2) * scale;
    out[i * 2 + 1] = -(ys[i] - h / 2) * scale;
  }
  return { points: out, width: targetWidth, height: h * scale };
}

/** Picks `count` samples from a text shape (with jitter, repeats allowed). */
export function textSamples(
  shape: TextShape,
  count: number,
  rng: Rng,
  jitter = 0.006,
): Array<[number, number]> {
  const total = shape.points.length / 2;
  const out: Array<[number, number]> = [];
  if (total === 0) {
    for (let i = 0; i < count; i++) out.push([0, 0]);
    return out;
  }
  for (let i = 0; i < count; i++) {
    const k = Math.floor(rng() * total);
    out.push([
      shape.points[k * 2] + (rng() - 0.5) * jitter,
      shape.points[k * 2 + 1] + (rng() - 0.5) * jitter,
    ]);
  }
  return out;
}
