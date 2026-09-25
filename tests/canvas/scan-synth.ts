/**
 * Synthetic "phone photos of a page" for the scanner's tests: a sheet of
 * paper with lines of writing, seen in perspective on a textured desk, with
 * optional lighting falloff, a shadow and sensor noise — and the page's true
 * corners, so a detector or a warp can be scored against them.
 */

import { type Quad, applyHomography, homographyFromQuads } from "../../src/canvas/homography";
import { type RgbaImage, createRgba } from "../../src/canvas/scan-raster";

/** Deterministic PRNG (mulberry32), so every synthetic photo is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthPhoto {
  photo: RgbaImage;
  /** The page's true corners in the photo, TL TR BR BL. */
  corners: Quad;
}

export interface SynthOptions {
  width?: number;
  height?: number;
  /** Where the page's corners land in the photo. */
  corners: Quad;
  /** Page size in its own units (only the aspect matters). */
  pageWidth?: number;
  pageHeight?: number;
  paper?: [number, number, number];
  desk?: [number, number, number];
  /** Desk texture amplitude (grain), levels. */
  grain?: number;
  /** Paper brightness at the far right as a fraction of the left (lighting falloff). */
  falloff?: number;
  /** A shadow over the part of the photo left of this x (fraction of width), darkening by `shadowDepth`. */
  shadowX?: number;
  shadowDepth?: number;
  /** Width of the shadow's penumbra, px (0 = a hard edge). */
  shadowSoftness?: number;
  /** Sensor noise amplitude, levels. */
  noise?: number;
  /** Lines of "writing" on the page. */
  lines?: number;
  seed?: number;
}

/** Render a synthetic photo; see {@link SynthOptions}. */
export function synthPhoto(options: SynthOptions): SynthPhoto {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const pw = options.pageWidth ?? 210;
  const ph = options.pageHeight ?? 297;
  const paper = options.paper ?? [232, 230, 222];
  const desk = options.desk ?? [120, 86, 60];
  const grain = options.grain ?? 14;
  const falloff = options.falloff ?? 1;
  const noise = options.noise ?? 4;
  const lines = options.lines ?? 14;
  const random = rng(options.seed ?? 7);
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: pw, y: 0 },
    { x: pw, y: ph },
    { x: 0, y: ph },
  ];
  // Photo → page, to ask of every photo pixel where on the page it is.
  const toPage = homographyFromQuads(options.corners, rect);
  if (!toPage) throw new Error("degenerate synthetic page");
  // Writing: each line a band with ragged word gaps, fixed per line.
  const words: Array<Array<[number, number]>> = [];
  for (let l = 0; l < lines; l++) {
    const row: Array<[number, number]> = [];
    let x = pw * 0.1;
    while (x < pw * 0.88) {
      const len = pw * (0.04 + random() * 0.1);
      row.push([x, Math.min(pw * 0.9, x + len)]);
      x += len + pw * 0.02;
    }
    words.push(row);
  }
  const photo = createRgba(width, height);
  const d = photo.data;
  const phase = random() * 10;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const p = applyHomography(toPage, x + 0.5, y + 0.5);
      let rgb: [number, number, number];
      if (p.x >= 0 && p.x <= pw && p.y >= 0 && p.y <= ph) {
        const light = 1 - (1 - falloff) * (x / width);
        rgb = [paper[0] * light, paper[1] * light, paper[2] * light];
        const lineAt = ((p.y - ph * 0.12) / (ph * 0.8)) * lines;
        const l = Math.floor(lineAt);
        const inBand = l >= 0 && l < lines && lineAt - l > 0.55 && lineAt - l < 0.75;
        if (inBand && words[l].some(([a, b]) => p.x >= a && p.x <= b)) {
          rgb = [rgb[0] * 0.3, rgb[1] * 0.3, rgb[2] * 0.35];
        }
      } else {
        const g = grain * Math.sin(x * 0.09 + Math.sin(y * 0.05 + phase) * 2);
        rgb = [desk[0] + g, desk[1] + g * 0.8, desk[2] + g * 0.6];
      }
      if (options.shadowX !== undefined) {
        const soft = Math.max(1e-6, options.shadowSoftness ?? 0);
        const t = Math.max(0, Math.min(1, (options.shadowX * width - x) / soft + 0.5));
        const k = 1 - (options.shadowDepth ?? 0.4) * t;
        rgb = [rgb[0] * k, rgb[1] * k, rgb[2] * k];
      }
      for (let c = 0; c < 3; c++) d[o + c] = rgb[c] + (random() - 0.5) * 2 * noise;
      d[o + 3] = 255;
    }
  }
  return { photo, corners: options.corners };
}

/** Largest distance between matching corners, as a fraction of the photo's diagonal. */
export function cornerError(a: Quad, b: Quad, width: number, height: number): number {
  const diag = Math.hypot(width, height);
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y))) / diag;
}
