/**
 * Stress notebooks for the scale benchmark (`npm run bench:scale`), built
 * from real Pencil ink so their JSON, compression and point counts behave
 * like a real notebook's.
 *
 * Densities are calibrated on two of Joost's real pages: a full copy sheet
 * (1,648 strokes, 32,454 points, 19.7 points a stroke, 38 lines) and a page of
 * lecture notes (643 strokes, 11,283 points). Strokes are windows of about 20
 * points cut from the public real-ink fixtures in tests/ink/fixtures,
 * resampled to the ~1 px spacing real ink has, scaled to letter size and set
 * along ruled lines. Pressure is a constant 128/255, as on those pages.
 *
 * Deterministic: the same arguments always build the same notebook.
 */

import type { InkDocument, Page, Stroke } from "../../src/model/document";
import arrows from "../ink/fixtures/real-pencil-arrows-ipad.json";
import ipad from "../ink/fixtures/real-pencil-ipad.json";
import ipad2 from "../ink/fixtures/real-pencil-ipad-2.json";
import scribbles from "../ink/fixtures/real-scribbles-ipad.json";
import squiggles from "../ink/fixtures/real-handwriting-squiggles.json";
import stars from "../ink/fixtures/real-pencil-stars-clouds-ipad.json";

export type Density = "dense" | "typical" | "light";

/** Strokes per page and lines they sit on, from the real pages named above. */
export const DENSITY: Record<Density, { strokes: number; lines: number }> = {
  dense: { strokes: 1648, lines: 38 },
  typical: { strokes: 643, lines: 27 },
  // A PDF page with a few notes and highlights on it.
  light: { strokes: 60, lines: 4 },
};

const PAGE = { width: 1024, height: 1448 };
const PRESSURE = 128 / 255;
const POINTS_PER_STROKE = 20;

type Xy = [number, number];

/** Every real stroke as x, y pairs, resampled to 1 px steps. */
function sourceStrokes(): Xy[][] {
  const out: Xy[][] = [];
  const withPoints = [ipad, ipad2, arrows, stars] as Array<{ strokes: { points: number[][] }[] }>;
  for (const set of withPoints) {
    for (const s of set.strokes) out.push(s.points.map(([x, y]) => [x, y] as Xy));
  }
  for (const set of [scribbles, squiggles] as Array<{ strokes: { pts: number[] }[] }>) {
    for (const s of set.strokes) {
      const pts: Xy[] = [];
      for (let i = 0; i + 1 < s.pts.length; i += 3) pts.push([s.pts[i], s.pts[i + 1]]);
      out.push(pts);
    }
  }
  return out.map(resample).filter((s) => s.length >= POINTS_PER_STROKE);
}

function resample(points: Xy[]): Xy[] {
  if (points.length < 2) return points;
  const out: Xy[] = [points[0]];
  let [px, py] = points[0];
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    let d = Math.hypot(x - px, y - py);
    while (d >= 1) {
      const t = 1 / d;
      px += (x - px) * t;
      py += (y - py) * t;
      out.push([px, py]);
      d = Math.hypot(x - px, y - py);
    }
  }
  return out;
}

/** Windows of {@link POINTS_PER_STROKE} points, normalised to a 1x1 box at the origin. */
const GLYPHS: Xy[][] = (() => {
  const glyphs: Xy[][] = [];
  for (const stroke of sourceStrokes()) {
    for (let at = 0; at + POINTS_PER_STROKE <= stroke.length; at += 7) {
      const win = stroke.slice(at, at + POINTS_PER_STROKE);
      const xs = win.map((p) => p[0]);
      const ys = win.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const size = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1);
      glyphs.push(win.map(([x, y]) => [(x - x0) / size, (y - y0) / size]));
    }
  }
  return glyphs;
})();

/** A tiny deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ink for one page; `nextId` numbers strokes notebook-wide, as the editor does. */
export function pageInk(
  pageIndex: number,
  density: Density,
  nextId: () => string,
  clock = { t: 0 },
): Stroke[] {
  const { strokes, lines } = DENSITY[density];
  const random = rng(pageIndex * 7919 + 17);
  const perLine = Math.ceil(strokes / lines);
  const lineGap = (PAGE.height - 80) / Math.max(lines, 1);
  const step = (PAGE.width - 80) / perLine;
  const out: Stroke[] = [];
  for (let i = 0; i < strokes; i++) {
    const line = Math.floor(i / perLine);
    const col = i % perLine;
    const glyph = GLYPHS[(pageIndex * 131 + i * 17) % GLYPHS.length];
    const size = 10 + random() * 8;
    const ox = 40 + col * step + random() * 3;
    const oy = 60 + line * lineGap + random() * 4;
    const pts: number[] = [];
    for (const [gx, gy] of glyph) {
      pts.push(ox + gx * size + random() * 0.3, oy + gy * size + random() * 0.3, PRESSURE);
    }
    clock.t += 180 + Math.floor(random() * 400);
    out.push({ id: nextId(), color: "#1a1a1a", size: 2, tool: "pen", pts, t0: clock.t });
  }
  return out;
}

export interface NotebookOptions {
  density: Density;
  /** Back every page with this PDF, page i on page i. */
  pdf?: string;
  /** Pages carrying ink, every n-th; 1 (the default) inks every page. */
  inkEvery?: number;
}

/** A notebook of `pages` pages as the editor holds it. */
export function stressNotebook(pages: number, options: NotebookOptions): InkDocument {
  let id = 0;
  const nextId = (): string => `s${++id}`;
  const clock = { t: 0 };
  const every = options.inkEvery ?? 1;
  return {
    version: 3,
    view: { scrollY: 0, width: PAGE.width, scale: 1 },
    pages: Array.from({ length: pages }, (_, i): Page => ({
      id: `p${i + 1}`,
      kind: "ink",
      geometry: { ...PAGE },
      backdrop: options.pdf
        ? { kind: "pdf", path: options.pdf, page: i }
        : { kind: "ruled-narrow" },
      strokes: i % every === 0 ? pageInk(i, options.density, nextId, clock) : [],
      images: [],
      textBoxes: [],
      epoch: 1_760_000_000_000 + i * 3_600_000,
    })),
  } as InkDocument;
}

/** Points in a notebook. */
export function pointCount(doc: InkDocument): number {
  let n = 0;
  for (const page of doc.pages) for (const s of page.strokes) n += s.pts.length / 3;
  return n;
}
