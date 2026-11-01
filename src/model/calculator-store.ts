/**
 * What the calculator remembers: its switches (one set for the device's
 * user, across notebooks) and a short history per notebook. Pure.
 *
 * Kept in the plugin's data by notebook path rather than in the note: the
 * plugin's data syncs with the vault, and a history is no part of the
 * notebook's content, so writing it into the note would rewrite the file
 * (and its sync) for every sum. A rename carries the history along
 * ({@link renameCalculatorHistory}).
 */

import { type AngleMode, NUMBER_BASES, type NumberBase } from "./calculator";
import { type KeyTab, isKeyTab } from "./calculator-keys";

/** One line of history: what was typed and what it came to, as shown. */
export interface CalcEntry {
  expr: string;
  result: string;
}

export interface CalcPrefs {
  angle: AngleMode;
  fractions: boolean;
  base: NumberBase;
  /** The function keys' tab last used (Graph is never remembered: it belongs to editing a line). */
  tab: Exclude<KeyTab, "graph">;
  /**
   * Basic (a pocket calculator, as the iPhone's in portrait) or Scientific;
   * absent is Scientific, so the calculator stays as it was for those who
   * had it.
   */
  mode?: CalcMode;
}

/** The calculator's two faces: its scientific keys and menus, or a pocket calculator. */
export type CalcMode = "scientific" | "basic";

/** Where a notebook's graph window sat: px from the view's top-left, its size, minimised. */
export interface WindowPlace {
  x: number;
  y: number;
  w: number;
  h: number;
  minimised?: true;
}

export interface CalculatorData {
  prefs: CalcPrefs;
  /** Notebook path → its history, newest first, and when it was last added to. */
  history: Record<string, { entries: CalcEntry[]; at: number }>;
  /** Notebook path → where its graph window was. */
  windows: Record<string, WindowPlace>;
  /** Where the calculator's window was: one place for every notebook, as it is one tool. */
  calcWindow?: WindowPlace;
}

export const HISTORY_MAX = 30;
export const HISTORY_NOTEBOOKS_MAX = 100;
const TEXT_MAX = 500;

export const DEFAULT_CALC_PREFS: Readonly<CalcPrefs> = {
  angle: "deg",
  fractions: false,
  base: 10,
  tab: "basic",
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function parseEntry(raw: unknown): CalcEntry | null {
  if (!isRecord(raw)) return null;
  const { expr, result } = raw;
  if (typeof expr !== "string" || typeof result !== "string" || !expr || !result) return null;
  if (expr.length > TEXT_MAX || result.length > TEXT_MAX) return null;
  return { expr, result };
}

/** Read stored data, keeping what is well formed and dropping the rest. */
export function parseCalculatorData(raw: unknown): CalculatorData {
  const data: CalculatorData = {
    prefs: { ...DEFAULT_CALC_PREFS },
    history: Object.create(null) as CalculatorData["history"],
    windows: Object.create(null) as CalculatorData["windows"],
  };
  if (!isRecord(raw)) return data;
  if (isRecord(raw.prefs)) {
    const { angle, fractions, base, tab, mode } = raw.prefs;
    if (isKeyTab(tab) && tab !== "graph") data.prefs.tab = tab;
    if (mode === "basic" || mode === "scientific") data.prefs.mode = mode;
    if (angle === "deg" || angle === "rad") data.prefs.angle = angle;
    if (typeof fractions === "boolean") data.prefs.fractions = fractions;
    if (NUMBER_BASES.includes(base as NumberBase)) data.prefs.base = base as NumberBase;
  }
  const calcWindow = parsePlace(raw.calcWindow);
  if (calcWindow) data.calcWindow = calcWindow;
  if (isRecord(raw.windows)) {
    for (const [path, value] of Object.entries(raw.windows)) {
      const place = parsePlace(value);
      if (path && place && Object.keys(data.windows).length < HISTORY_NOTEBOOKS_MAX) {
        data.windows[path] = place;
      }
    }
  }
  if (isRecord(raw.history)) {
    for (const [path, value] of Object.entries(raw.history)) {
      if (!path || !isRecord(value) || !Array.isArray(value.entries)) continue;
      const entries = value.entries
        .map(parseEntry)
        .filter((e): e is CalcEntry => e !== null)
        .slice(0, HISTORY_MAX);
      const at = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : 0;
      if (entries.length > 0) data.history[path] = { entries, at };
    }
  }
  return data;
}

function parsePlace(raw: unknown): WindowPlace | null {
  if (!isRecord(raw)) return null;
  const { x, y, w, h, minimised } = raw;
  const ok = [x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v));
  if (!ok || (w as number) <= 0 || (h as number) <= 0) return null;
  const place: WindowPlace = { x: x as number, y: y as number, w: w as number, h: h as number };
  if (minimised === true) place.minimised = true;
  return place;
}

/** `path`'s graph window placed at `place`. */
export function withWindow(data: CalculatorData, path: string, place: WindowPlace): CalculatorData {
  const windows = Object.assign(Object.create(null) as CalculatorData["windows"], data.windows);
  windows[path] = { ...place };
  return { ...data, windows };
}

/** The calculator's window placed at `place`. */
export function withCalcWindow(data: CalculatorData, place: WindowPlace): CalculatorData {
  return { ...data, calcWindow: { ...place } };
}

export function windowOf(data: CalculatorData, path: string): WindowPlace | null {
  return Object.prototype.hasOwnProperty.call(data.windows, path) ? data.windows[path] : null;
}

export function historyOf(data: CalculatorData, path: string): CalcEntry[] {
  return Object.prototype.hasOwnProperty.call(data.history, path) ? data.history[path].entries : [];
}

function copyHistory(data: CalculatorData): CalculatorData["history"] {
  return Object.assign(Object.create(null) as CalculatorData["history"], data.history);
}

/**
 * `entry` added to the top of `path`'s history (a repeat of the top line is
 * not added twice); the notebooks used longest ago are forgotten past
 * {@link HISTORY_NOTEBOOKS_MAX}.
 */
export function withEntry(
  data: CalculatorData,
  path: string,
  entry: CalcEntry,
  now: number,
): CalculatorData {
  const old = historyOf(data, path);
  const same = old[0]?.expr === entry.expr && old[0]?.result === entry.result;
  const entries = same ? old : [entry, ...old].slice(0, HISTORY_MAX);
  const history = copyHistory(data);
  history[path] = { entries, at: now };
  const paths = Object.keys(history);
  if (paths.length > HISTORY_NOTEBOOKS_MAX) {
    paths.sort((a, b) => history[b].at - history[a].at);
    for (const stale of paths.slice(HISTORY_NOTEBOOKS_MAX)) delete history[stale];
  }
  return { ...data, history };
}

export function withoutHistory(data: CalculatorData, path: string): CalculatorData {
  const history = copyHistory(data);
  delete history[path];
  return { ...data, history };
}

export function withPrefs(data: CalculatorData, patch: Partial<CalcPrefs>): CalculatorData {
  return { ...data, prefs: { ...data.prefs, ...patch } };
}

/** The history follows a renamed or moved notebook; null when there was none to move. */
export function renameCalculatorHistory(
  data: CalculatorData,
  from: string,
  to: string,
): CalculatorData | null {
  const own = (record: object): boolean => Object.prototype.hasOwnProperty.call(record, from);
  if (from === to || (!own(data.history) && !own(data.windows))) return null;
  const history = copyHistory(data);
  if (own(history)) {
    history[to] = history[from];
    delete history[from];
  }
  const windows = Object.assign(Object.create(null) as CalculatorData["windows"], data.windows);
  if (own(windows)) {
    windows[to] = windows[from];
    delete windows[from];
  }
  return { ...data, history, windows };
}

/** A graph window is never smaller than this (room for its title bar, a line and a graph). */
export const WINDOW_MIN = { w: 240, h: 200 };
/** A minimised window: the pill it shrinks to. */
export const WINDOW_PILL = { w: 132, h: 40 };
const WINDOW_MARGIN = 8;
/**
 * The calculator's window is never smaller than this: the display, the
 * tabs and both key grids with 30 px keys. Measured in the UI gallery: the
 * keys first spill at 590 px tall, whatever the width.
 */
export const CALC_WINDOW_MIN = { w: 300, h: 600 };

/**
 * Where the calculator's window first opens: the top left of the view, under
 * the toolbar's calculator button, as wide as the old pop-up and as tall as
 * fits.
 */
export function defaultCalcPlace(bounds: { w: number; h: number }): WindowPlace {
  const h = Math.max(CALC_WINDOW_MIN.h, Math.min(680, bounds.h - 80));
  return clampPlace({ x: 16, y: 64, w: 360, h }, bounds, CALC_WINDOW_MIN);
}

/**
 * Where a graph window first opens: the top right of the view, up to 45 % of
 * its width, so on an iPad in landscape it is wide enough for the list to
 * sit beside the plot.
 */
export function defaultPlace(bounds: { w: number; h: number }): WindowPlace {
  const w = Math.max(WINDOW_MIN.w, Math.min(560, Math.round(bounds.w * 0.45)));
  const h = Math.max(WINDOW_MIN.h, Math.min(380, Math.round(bounds.h / 2)));
  return clampPlace({ x: bounds.w - w - 16, y: 64, w, h }, bounds);
}

/**
 * `place` kept inside a view `bounds` (a split view, a rotation): no
 * smaller than `min` ({@link WINDOW_MIN} unless given), no larger than the
 * view, and with its title bar (or the pill) wholly inside.
 */
export function clampPlace(
  place: WindowPlace,
  bounds: { w: number; h: number },
  min: { w: number; h: number } = WINDOW_MIN,
): WindowPlace {
  const roomW = Math.max(min.w, bounds.w - 2 * WINDOW_MARGIN);
  const roomH = Math.max(min.h, bounds.h - 2 * WINDOW_MARGIN);
  const w = Math.min(roomW, Math.max(min.w, place.w));
  const h = Math.min(roomH, Math.max(min.h, place.h));
  const shownW = place.minimised ? WINDOW_PILL.w : w;
  const shownH = place.minimised ? WINDOW_PILL.h : h;
  const clamp = (v: number, size: number, room: number): number =>
    Math.max(WINDOW_MARGIN, Math.min(room - size - WINDOW_MARGIN, v));
  const next: WindowPlace = {
    x: Math.round(clamp(place.x, shownW, bounds.w)),
    y: Math.round(clamp(place.y, shownH, bounds.h)),
    w: Math.round(w),
    h: Math.round(h),
  };
  if (place.minimised) next.minimised = true;
  return next;
}
