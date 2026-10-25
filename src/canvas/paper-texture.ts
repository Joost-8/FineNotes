/**
 * Paper grain for designed paper (`texture` on a synthetic backdrop,
 * contracts/api.md §1 "Designed paper"): specks and, on heavy paper, short
 * fibres, scattered by a hash of fixed cells in page space.
 *
 * Deterministic on purpose: never `Math.random`. The same page draws the
 * same grain in every tile, thumbnail, export and on every device, and a
 * tile asks only for the cells it shows (`region`), so the grain lines up
 * across tile seams and a zoomed-in tile stays cheap.
 *
 * Pure: no DOM. Page px throughout.
 */

import type { PageGeometry, PaperTexture } from "../model/document";

/** A part of the page, page px. Matches the renderer's `Bounds`. */
export interface TextureRegion {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The colours of a grain on one kind of paper. */
export interface TextureInks {
  /** Specks darker than the paper. */
  dark: string;
  /** Specks lighter than the paper. */
  light: string;
  fibre: string;
}

export interface TextureSpec {
  /** One speck per cell this many page px square. */
  cell: number;
  /** A speck's side, page px, from `min` to `max`. */
  size: [number, number];
  /** Share of specks that are dark (the rest are light). */
  darkShare: number;
  /** Chance a cell also holds a fibre, and a fibre's length, page px. */
  fibreChance: number;
  fibreLength: [number, number];
  /** On light paper. */
  onLight: TextureInks;
  /**
   * On dark paper (a dark paper colour, or any page shown dark): fainter,
   * since a light speck on a dark page reads far more than a dark one on a
   * light page.
   */
  onDark: TextureInks;
}

/** The two grains. Colours are translucent, so a grain reads on any paper colour. */
export const TEXTURES: Readonly<Record<PaperTexture, TextureSpec>> = {
  fine: {
    cell: 7,
    size: [0.6, 1.5],
    darkShare: 0.6,
    fibreChance: 0,
    fibreLength: [0, 0],
    onLight: {
      dark: "rgba(80, 64, 40, 0.11)",
      light: "rgba(255, 255, 255, 0.4)",
      fibre: "rgba(80, 64, 40, 0.1)",
    },
    onDark: {
      dark: "rgba(0, 0, 0, 0.22)",
      light: "rgba(255, 255, 255, 0.06)",
      fibre: "rgba(255, 255, 255, 0.05)",
    },
  },
  heavy: {
    cell: 5,
    size: [0.8, 2.2],
    darkShare: 0.62,
    fibreChance: 0.035,
    fibreLength: [6, 16],
    onLight: {
      dark: "rgba(80, 64, 40, 0.17)",
      light: "rgba(255, 255, 255, 0.5)",
      fibre: "rgba(80, 64, 40, 0.16)",
    },
    onDark: {
      dark: "rgba(0, 0, 0, 0.3)",
      light: "rgba(255, 255, 255, 0.09)",
      fibre: "rgba(255, 255, 255, 0.08)",
    },
  },
};

/**
 * Whether paper `color` (`#rrggbb`) is dark enough for the grain's dark
 * inks. Anything that is not a six-digit hex reads as light.
 */
export function isDarkTextureGround(color: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return false;
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

/** Where the grain's specks and fibres are. Flat arrays, as the canvas wants them. */
export interface TextureMarks {
  /** x, y, w, h per dark speck. */
  dark: number[];
  /** x, y, w, h per light speck. */
  light: number[];
  /** x0, y0, x1, y1 per fibre. */
  fibres: number[];
  /** A fibre's line width, page px. */
  fibreWidth: number;
}

/**
 * A number in [0, 1) from a cell and a salt. A 32-bit mix, ended with
 * `>>> 0` after its last XOR: without it half the results come out negative
 * (ledger, 2026-10-06).
 */
export function cellHash(ix: number, iy: number, salt: number): number {
  let h =
    Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 2 ** 32;
}

/**
 * The grain `texture` puts on a page of `geometry`, in the cells that meet
 * `region` (the whole page without one). `weight` coarsens it for a small
 * preview the way it thickens rules there: cells and specks both grow by
 * it, so the paper keeps its tone while the grain stays visible.
 */
export function textureMarks(
  texture: PaperTexture,
  geometry: PageGeometry,
  region?: TextureRegion,
  weight = 1,
): TextureMarks {
  const spec = TEXTURES[texture];
  const k = Number.isFinite(weight) && weight >= 1 ? Math.min(weight, 16) : 1;
  const cell = spec.cell * k;
  const out: TextureMarks = { dark: [], light: [], fibres: [], fibreWidth: 0.6 * k };
  const minX = Math.max(0, region?.minX ?? 0);
  const minY = Math.max(0, region?.minY ?? 0);
  const maxX = Math.min(geometry.width, region?.maxX ?? geometry.width);
  const maxY = Math.min(geometry.height, region?.maxY ?? geometry.height);
  if (!(maxX > minX) || !(maxY > minY) || !(cell > 0)) return out;
  // How far a cell's marks reach past its own square: a speck near its edge
  // overhangs into the next cell, a fibre can lean further.
  const reach = Math.ceil((Math.max(spec.fibreLength[1], spec.size[1]) * k) / cell);
  const ix0 = Math.max(0, Math.floor(minX / cell) - reach);
  const iy0 = Math.max(0, Math.floor(minY / cell) - reach);
  const ix1 = Math.ceil(maxX / cell) + reach;
  const iy1 = Math.ceil(maxY / cell) + reach;
  const [s0, s1] = spec.size;
  for (let iy = iy0; iy < iy1; iy++) {
    for (let ix = ix0; ix < ix1; ix++) {
      const size = (s0 + (s1 - s0) * cellHash(ix, iy, 3)) * k;
      const x = (ix + cellHash(ix, iy, 1)) * cell;
      const y = (iy + cellHash(ix, iy, 2)) * cell;
      if (x < geometry.width && y < geometry.height && x + size > minX && y + size > minY) {
        if (x < maxX && y < maxY) {
          (cellHash(ix, iy, 4) < spec.darkShare ? out.dark : out.light).push(x, y, size, size);
        }
      }
      if (spec.fibreChance > 0 && cellHash(ix, iy, 5) < spec.fibreChance) {
        const [l0, l1] = spec.fibreLength;
        const length = (l0 + (l1 - l0) * cellHash(ix, iy, 6)) * k;
        const angle = cellHash(ix, iy, 7) * Math.PI;
        const dx = (Math.cos(angle) * length) / 2;
        const dy = (Math.sin(angle) * length) / 2;
        const cx = (ix + 0.5) * cell;
        const cy = (iy + 0.5) * cell;
        const x0 = cx - dx;
        const x1 = cx + dx;
        const y0 = cy - dy;
        const y1 = cy + dy;
        const meets =
          Math.max(x0, x1) >= minX &&
          Math.min(x0, x1) <= maxX &&
          Math.max(y0, y1) >= minY &&
          Math.min(y0, y1) <= maxY;
        const onPage = cx < geometry.width && cy < geometry.height;
        if (meets && onPage) out.fibres.push(x0, y0, x1, y1);
      }
    }
  }
  return out;
}
