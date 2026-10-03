/**
 * The PDF rendering test (beta only): its numbers, and the note it writes.
 * Pure. The test itself is `pdf-probe.ts`; research/PDF_RENDERING.md says
 * what each number decides.
 */

/** Main-thread lateness while something ran: how late a 5 ms timer fired. */
export interface Lateness {
  worstMs: number;
  /** Timer firings more than a 60 Hz frame late. */
  over16: number;
  samples: number;
}

/** Lateness from the gaps between timer firings, given the interval asked for. */
export function lateness(gaps: readonly number[], intervalMs: number): Lateness {
  let worst = 0;
  let over16 = 0;
  for (const gap of gaps) {
    const late = Math.max(0, gap - intervalMs);
    worst = Math.max(worst, late);
    if (late > 16) over16++;
  }
  return { worstMs: Math.round(worst), over16, samples: gaps.length };
}

/**
 * Mean absolute difference per channel of two same-sized RGBA buffers, 0-255:
 * 0 is identical, a few points is antialiasing, tens is a different picture.
 */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return Number.NaN;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return Math.round((sum / n) * 10) / 10;
}

export interface EngineRun {
  /** Long edge each page was rendered at, px. */
  edgePx: number;
  pageMs: number[];
  totalMs: number;
  lateness: Lateness;
  /** Drawing each finished page onto a canvas (worker: its ImageBitmap), ms. */
  blitMs?: number[];
  /** Against the main-thread render of the same pages (see `meanAbsDiff`). */
  diffVsMain?: number[];
}

export interface AppleRun {
  /** The PDF drawn as an image at all (WebKit with CoreGraphics only). */
  supported: boolean;
  naturalSize?: string;
  /** Page 1 at the long edge, drawn and read back, ms. */
  pageMs?: number;
  /** 512 px tiles of page 1 at 4x that size, drawn and read back, ms each. */
  tileMs?: number[];
  /** `getImageData` refused after drawing it. */
  tainted?: boolean;
  diffVsPdfjs?: number;
  /** `createImageBitmap(img, { resizeWidth })`, ms, or why it failed. */
  bitmapMs?: number | string;
  lateness?: Lateness;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ProbeResult {
  when: string;
  file: { name: string; pages: number; megabytes: number };
  environment: Record<string, string | number | boolean | null>;
  main: Outcome<EngineRun>;
  worker: Outcome<EngineRun>;
  apple: Outcome<AppleRun>;
}

const ms = (values: readonly number[] | undefined, digits = 0): string =>
  values && values.length ? values.map((v) => v.toFixed(digits)).join(", ") : "–";

const median = (values: readonly number[]): number => {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

function engineLines(name: string, run: Outcome<EngineRun>): string[] {
  if (!run.ok) return [`### ${name}`, "", `Failed: \`${run.error}\``, ""];
  const r = run.value;
  return [
    `### ${name}`,
    "",
    `- Pages at ${r.edgePx} px: ${ms(r.pageMs)} ms (median ${Math.round(median(r.pageMs))}, total ${Math.round(r.totalMs)})`,
    `- Main thread: worst ${r.lateness.worstMs} ms late, ${r.lateness.over16} frames missed`,
    ...(r.blitMs ? [`- Drawing the result: ${ms(r.blitMs, 1)} ms`] : []),
    ...(r.diffVsMain
      ? [`- Difference from the main-thread render (0-255): ${r.diffVsMain.join(", ")}`]
      : []),
    "",
  ];
}

function appleLines(run: Outcome<AppleRun>): string[] {
  if (!run.ok) return ["### Apple's engine (PDF as an image)", "", `Failed: \`${run.error}\``, ""];
  const r = run.value;
  if (!r.supported) {
    return ["### Apple's engine (PDF as an image)", "", "- Not available here.", ""];
  }
  return [
    "### Apple's engine (PDF as an image)",
    "",
    `- Image size: ${r.naturalSize ?? "–"}`,
    `- Page 1, drawn and read back: ${r.pageMs === undefined ? "–" : Math.round(r.pageMs)} ms`,
    `- 512 px tiles at 4x: ${ms(r.tileMs)} ms`,
    `- Canvas readable afterwards: ${r.tainted === undefined ? "–" : r.tainted ? "no (tainted)" : "yes"}`,
    `- Difference from pdf.js (0-255): ${r.diffVsPdfjs ?? "–"}`,
    `- createImageBitmap: ${typeof r.bitmapMs === "number" ? `${Math.round(r.bitmapMs)} ms` : (r.bitmapMs ?? "–")}`,
    ...(r.lateness
      ? [`- Main thread: worst ${r.lateness.worstMs} ms late, ${r.lateness.over16} frames missed`]
      : []),
    "",
  ];
}

/** The note the test writes into the vault: readable first, then the raw JSON. */
export function probeReportMarkdown(result: ProbeResult): string {
  const env = Object.entries(result.environment).map(([k, v]) => `- ${k}: ${String(v)}`);
  return [
    "# FineNotes PDF rendering test",
    "",
    `${result.when} · ${result.file.name} (${result.file.pages} pages, ${result.file.megabytes} MB)`,
    "",
    "## Results",
    "",
    ...engineLines("Obsidian's engine, main thread (today)", result.main),
    ...engineLines("Obsidian's engine, background worker", result.worker),
    ...appleLines(result.apple),
    "## Device",
    "",
    ...env,
    "",
    "## Raw",
    "",
    "```json",
    JSON.stringify(result, null, 2),
    "```",
    "",
  ].join("\n");
}
