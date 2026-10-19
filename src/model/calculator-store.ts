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

/** One line of history: what was typed and what it came to, as shown. */
export interface CalcEntry {
  expr: string;
  result: string;
}

export interface CalcPrefs {
  angle: AngleMode;
  fractions: boolean;
  base: NumberBase;
}

export interface CalculatorData {
  prefs: CalcPrefs;
  /** Notebook path → its history, newest first, and when it was last added to. */
  history: Record<string, { entries: CalcEntry[]; at: number }>;
}

export const HISTORY_MAX = 30;
export const HISTORY_NOTEBOOKS_MAX = 100;
const TEXT_MAX = 500;

export const DEFAULT_CALC_PREFS: Readonly<CalcPrefs> = { angle: "deg", fractions: false, base: 10 };

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
  };
  if (!isRecord(raw)) return data;
  if (isRecord(raw.prefs)) {
    const { angle, fractions, base } = raw.prefs;
    if (angle === "deg" || angle === "rad") data.prefs.angle = angle;
    if (typeof fractions === "boolean") data.prefs.fractions = fractions;
    if (NUMBER_BASES.includes(base as NumberBase)) data.prefs.base = base as NumberBase;
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
  return { prefs: data.prefs, history };
}

export function withoutHistory(data: CalculatorData, path: string): CalculatorData {
  const history = copyHistory(data);
  delete history[path];
  return { prefs: data.prefs, history };
}

export function withPrefs(data: CalculatorData, patch: Partial<CalcPrefs>): CalculatorData {
  return { prefs: { ...data.prefs, ...patch }, history: data.history };
}

/** The history follows a renamed or moved notebook; null when there was none to move. */
export function renameCalculatorHistory(
  data: CalculatorData,
  from: string,
  to: string,
): CalculatorData | null {
  if (from === to || !Object.prototype.hasOwnProperty.call(data.history, from)) return null;
  const history = copyHistory(data);
  history[to] = history[from];
  delete history[from];
  return { prefs: data.prefs, history };
}
