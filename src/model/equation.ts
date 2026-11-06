/**
 * Typed equations as one page element (`EquationElement`, discussion #166):
 * the LaTeX source the user typed, its colour and size, and the frame the
 * editor measured it into. The formula is laid out again whenever it is
 * drawn (`model/latex` reads the source, `canvas/math-layout` sets it), so
 * an equation costs its source and a few numbers, and is as sharp printed
 * as on screen.
 *
 * Like a graph it is drawn under the ink, stays upright and is moved,
 * resized, copied and deleted by the lasso with every other element. Its
 * own edits (new source, colour) are {@link EditEquation}, one undo step.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { type EquationElement, type InkDocument, pageById } from "./document";
import { LATEX_MAX_CHARS } from "./latex";
import { isHexColor } from "./text-style";
import { t } from "../i18n/translate";

/** The smallest and largest size an equation is set at, page px. */
export const EQUATION_MIN_SIZE = 6;
export const EQUATION_MAX_SIZE = 400;
/** The size a new equation is set at when the Text tool has none. */
export const EQUATION_DEFAULT_SIZE = 24;
/** A frame is never smaller than this a side, page px: something to grab. */
const MIN_SIDE = 4;
/** Nor larger: a page is at most a few thousand px (a board's tens of thousands). */
const MAX_SIDE = 100000;

/** What a new equation is made from. */
export interface NewEquation {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tex: string;
  color: string;
  size: number;
}

/** An equation ready to go on a page, its fields as the loader would keep them. */
export function makeEquation(spec: NewEquation): EquationElement {
  return {
    id: spec.id,
    x: finite(spec.x, 0),
    y: finite(spec.y, 0),
    w: side(spec.w, 40),
    h: side(spec.h, 24),
    tex: readTex(spec.tex),
    color: isHexColor(spec.color) ? spec.color : "#000000",
    size: sizeOf(spec.size, EQUATION_DEFAULT_SIZE),
  };
}

/** An equation id not yet used anywhere in `doc`: one above the highest `q<N>`. */
export function nextEquationId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const equation of page.equations ?? []) {
      const match = /^q(\d+)$/.exec(equation.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `q${max + 1}`;
}

/** Where an equation sits on its page, page px. */
export function equationBounds(e: Pick<EquationElement, "x" | "y" | "w" | "h">): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return { minX: e.x, minY: e.y, maxX: e.x + e.w, maxY: e.y + e.h };
}

/**
 * Scale an equation by `k` (a lasso resize) about (ax, ay): its place, its
 * frame and its size, so the formula is set larger, not stretched.
 */
export function scaleEquation(e: EquationElement, ax: number, ay: number, k: number): void {
  if (!(k > 0) || !Number.isFinite(k)) return;
  e.x = ax + (e.x - ax) * k;
  e.y = ay + (e.y - ay) * k;
  e.w = side(e.w * k, e.w);
  e.h = side(e.h * k, e.h);
  e.size = sizeOf(e.size * k, e.size);
}

/**
 * What an equation's drawing depends on: a cached layout is good while this
 * is unchanged. Its place is not in it.
 */
export function equationContentKey(e: EquationElement): string {
  return `${e.size}|${e.tex}`;
}

// --- Commands ------------------------------------------------------------------

/** Put an equation on a page, above the equations already there. */
export class AddEquation implements Command {
  readonly label = t("surface.command.addEquation");
  /** Whether the page had no `equations` list before, so undo leaves it without one. */
  private created = false;

  constructor(
    readonly pageId: string,
    private readonly equation: EquationElement,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.created = page.equations === undefined;
    (page.equations ??= []).push(this.equation);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    const list = page?.equations;
    if (!page || !list) return;
    const index = list.indexOf(this.equation);
    if (index >= 0) list.splice(index, 1);
    if (this.created && list.length === 0) delete page.equations;
  }
}

/** What an edit may change: the source with its new frame, the colour, the size. */
export interface EquationChanges {
  tex?: string;
  color?: string;
  size?: number;
  w?: number;
  h?: number;
}

/**
 * A change to one equation (the source the editor gave it, a colour),
 * undone by putting back the exact object it was, key order included. The
 * equation is held by identity, as every selection command holds its
 * elements.
 */
export class EditEquation implements Command {
  readonly label = t("surface.command.editEquation");
  private before: EquationElement | null = null;

  constructor(
    readonly pageId: string,
    private readonly equation: EquationElement,
    private readonly changes: EquationChanges,
  ) {}

  apply(doc: InkDocument): void {
    this.before = null;
    const page = pageById(doc, this.pageId);
    if (!page?.equations?.includes(this.equation)) return;
    this.before = structuredClone(this.equation);
    const c = this.changes;
    if (typeof c.tex === "string") this.equation.tex = readTex(c.tex);
    if (isHexColor(c.color)) this.equation.color = c.color;
    if (c.size !== undefined) this.equation.size = sizeOf(c.size, this.equation.size);
    if (c.w !== undefined) this.equation.w = side(c.w, this.equation.w);
    if (c.h !== undefined) this.equation.h = side(c.h, this.equation.h);
  }

  invert(doc: InkDocument): void {
    const before = this.before;
    const page = pageById(doc, this.pageId);
    if (!before || !page?.equations?.includes(this.equation)) return;
    const target = this.equation as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(this.equation, structuredClone(before));
    this.before = null;
  }
}

// --- Reading from disk ----------------------------------------------------------

/**
 * A stored equation as the model keeps it, or `null` when it is not one (no
 * source, or a blank one). A frame or size out of range is brought inside
 * it, since what it shows is the user's; a colour that is not hex reads as
 * black.
 */
export function normalizeEquation(raw: unknown, mintId: () => string): EquationElement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tex !== "string" || r.tex.trim() === "") return null;
  return makeEquation({
    id: typeof r.id === "string" && r.id.length > 0 ? r.id : mintId(),
    x: r.x as number,
    y: r.y as number,
    w: r.w as number,
    h: r.h as number,
    tex: r.tex,
    color: r.color as string,
    size: r.size as number,
  });
}

function readTex(tex: unknown): string {
  return typeof tex === "string" ? tex.slice(0, LATEX_MAX_CHARS) : "";
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function side(value: unknown, fallback: number): number {
  const n = finite(value, fallback);
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, n));
}

function sizeOf(value: unknown, fallback: number): number {
  const n = finite(value, fallback);
  return Math.round(Math.min(EQUATION_MAX_SIZE, Math.max(EQUATION_MIN_SIZE, n)) * 100) / 100;
}
