/**
 * What one change to a notebook did, part by part, so that it can be taken
 * back later without touching anything else: Ask AI's actions, which the
 * user can undo from the chat after editing on (the normal undo only takes
 * back the newest step).
 *
 * A change set is worked out by comparing the notebook before and after the
 * change ({@link snapshotPages}, then {@link diffPages}), never from the
 * commands that made it, so every tool, now and later, is covered alike.
 * Its parts are as small as the notebook's own parts:
 *
 * - an element with an id (a stroke, text box, table, comment, heading, a
 *   page-less chapter…), added, removed or changed;
 * - any other field of a page (its title, its level, its bookmark);
 * - a page added, which must be left as the change left it;
 * - the page order, when pages were added, removed or moved.
 *
 * Taking it back ({@link revertChange}) puts each part back as it was, and
 * only when each part is still exactly as the change left it. When a later
 * edit touched one (the user wrote on a page the AI added, renamed a heading
 * it made, moved a page), nothing is changed, and the refusal names the
 * pages, so the user's own edits are never undone by mistake.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument, Page } from "./document";

/** One page as it was, shallowly: each field, and each id'd list as its elements by id. */
interface PageShot {
  fields: Map<string, unknown>;
  lists: Map<string, Map<string, { element: unknown; index: number }>>;
}

/** The notebook's pages before a change, cheaply: references only, no copies. */
export interface PagesSnapshot {
  order: Page[];
  pages: Map<Page, PageShot>;
}

/** One part of a page a change set touched; `undefined` is "not there". */
export type ChangePart =
  | { kind: "field"; page: Page; key: string; before: unknown; after: unknown }
  | {
      kind: "element";
      page: Page;
      key: string;
      id: string;
      before: unknown;
      after: unknown;
      beforeIndex: number;
      afterIndex: number;
    }
  /** A page the change added: it must still be as the change left it. */
  | { kind: "page"; page: Page; after: unknown };

export interface ChangeSet {
  parts: ChangePart[];
  /** The page order before and after, when the change altered it. */
  order?: { before: Page[]; after: Page[] };
}

/** Where a change set stands against the notebook now. */
export type ChangeState =
  /** Every part is as the change left it: it can be taken back. */
  | "applied"
  /** Every part is as it was before: it was taken back. */
  | "undone"
  /** Something touched it since: it cannot be taken back, or redone. */
  | "changed";

/** Take before a change: what {@link diffPages} compares against. */
export function snapshotPages(doc: InkDocument): PagesSnapshot {
  const pages = new Map<Page, PageShot>();
  for (const page of doc.pages) pages.set(page, shootPage(page));
  return { order: [...doc.pages], pages };
}

function shootPage(page: Page): PageShot {
  const fields = new Map<string, unknown>();
  const lists = new Map<string, Map<string, { element: unknown; index: number }>>();
  for (const [key, value] of Object.entries(page)) {
    const list = idList(value);
    if (list) lists.set(key, list);
    // A copy: a command may change an object field in place.
    else fields.set(key, copy(value));
  }
  return { fields, lists };
}

/** A list whose every element has a string id, by id; null for anything else. */
function idList(value: unknown): Map<string, { element: unknown; index: number }> | null {
  if (!Array.isArray(value)) return null;
  const out = new Map<string, { element: unknown; index: number }>();
  for (const [index, element] of (value as unknown[]).entries()) {
    const id = idOf(element);
    if (id === null || out.has(id)) return null;
    out.set(id, { element, index });
  }
  return out;
}

function idOf(element: unknown): string | null {
  if (typeof element !== "object" || element === null) return null;
  const id = (element as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/** Fields that are always lists of elements, even while empty or absent. */
const ELEMENT_LISTS = new Set([
  "strokes",
  "images",
  "textBoxes",
  "tables",
  "graphs",
  "equations",
  "comments",
  "sections",
  "chapters",
  "regions",
]);

/** What changed since `before`: an empty set when nothing did. */
export function diffPages(before: PagesSnapshot, doc: InkDocument): ChangeSet {
  const parts: ChangePart[] = [];
  for (const page of doc.pages) {
    const was = before.pages.get(page);
    if (!was) {
      parts.push({ kind: "page", page, after: copy(page) });
      continue;
    }
    const now = shootPage(page);
    const keys = new Set([
      ...was.fields.keys(),
      ...was.lists.keys(),
      ...now.fields.keys(),
      ...now.lists.keys(),
    ]);
    for (const key of keys) {
      const listed =
        ELEMENT_LISTS.has(key) || was.lists.has(key) || now.lists.has(key)
          ? listsOf(was, now, key)
          : null;
      if (listed) {
        diffList(page, key, listed.before, listed.after, parts);
        continue;
      }
      const a = was.fields.get(key);
      const b = now.fields.get(key);
      if (same(a, b)) continue;
      parts.push({ kind: "field", page, key, before: copy(a), after: copy(b) });
    }
  }
  const set: ChangeSet = { parts };
  if (!sameOrder(before.order, doc.pages))
    set.order = { before: before.order, after: [...doc.pages] };
  return set;
}

type IdMap = Map<string, { element: unknown; index: number }>;

/**
 * A field as element lists on both sides, or null when either side holds
 * something else there (then the field is compared whole).
 */
function listsOf(
  was: PageShot,
  now: PageShot,
  key: string,
): { before: IdMap; after: IdMap } | null {
  const side = (shot: PageShot): IdMap | null => {
    const list = shot.lists.get(key);
    if (list) return list;
    const value = shot.fields.get(key);
    return value === undefined || (Array.isArray(value) && value.length === 0) ? new Map() : null;
  };
  const before = side(was);
  const after = side(now);
  return before && after ? { before, after } : null;
}

function diffList(page: Page, key: string, before: IdMap, after: IdMap, parts: ChangePart[]): void {
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id);
    const b = after.get(id);
    if (a && b && (a.element === b.element || same(a.element, b.element))) continue;
    parts.push({
      kind: "element",
      page,
      key,
      id,
      before: copy(a?.element),
      after: copy(b?.element),
      beforeIndex: a?.index ?? -1,
      afterIndex: b?.index ?? -1,
    });
  }
}

/** Whether the change did nothing. */
export function isEmptyChange(set: ChangeSet): boolean {
  return set.parts.length === 0 && set.order === undefined;
}

/** Only the parts `keep` picks, and the order only when `keepOrder`. */
export function filterChange(
  set: ChangeSet,
  keep: (part: ChangePart) => boolean,
  keepOrder = false,
): ChangeSet {
  const parts = set.parts.filter(keep);
  return keepOrder && set.order ? { parts, order: set.order } : { parts };
}

/** The pages a change set touched, 1-based as they stand in `doc` now (gone ones left out). */
export function pagesOf(set: ChangeSet, doc: InkDocument): number[] {
  const pages = new Set<Page>(set.parts.map((part) => part.page));
  return [...pages]
    .map((page) => doc.pages.indexOf(page) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
}

// --- Where it stands, and taking it back ------------------------------------------

/**
 * The notebook as a check reads it: as it is, or as the change sets taken
 * back earlier in the same step would leave it (`written`), without
 * changing anything to find out.
 */
class Reading {
  private readonly written = new Map<string, unknown>();
  private order: readonly Page[] | null = null;
  private readonly ids = new Map<Page, number>();

  constructor(private readonly doc: InkDocument) {}

  pages(): readonly Page[] {
    return this.order ?? this.doc.pages;
  }

  /** A part's value now; for a page the change added, the page or `undefined`. */
  value(part: ChangePart): unknown {
    if (part.kind === "page") return this.pages().includes(part.page) ? part.page : undefined;
    const key = this.key(part);
    if (this.written.has(key)) return this.written.get(key);
    const page = part.page as unknown as Record<string, unknown>;
    if (part.kind === "field") return page[part.key];
    const list = page[part.key];
    if (!Array.isArray(list)) return undefined;
    return (list as unknown[]).find((element) => idOf(element) === part.id);
  }

  /** Whether `part` reads as its `side` now. */
  is(part: ChangePart, side: "before" | "after"): boolean {
    const here = this.pages().includes(part.page);
    if (part.kind === "page")
      return side === "before" ? !here : here && same(part.page, part.after);
    // A page the change did not add must still be in the notebook to be put back.
    return here && same(this.value(part), part[side]);
  }

  orderIs(set: ChangeSet, side: "before" | "after"): boolean {
    return set.order === undefined || sameOrder(set.order[side], this.pages());
  }

  state(set: ChangeSet): ChangeState {
    if (isEmptyChange(set)) return "undone";
    if (this.orderIs(set, "after") && set.parts.every((part) => this.is(part, "after"))) {
      return "applied";
    }
    if (this.orderIs(set, "before") && set.parts.every((part) => this.is(part, "before"))) {
      return "undone";
    }
    return "changed";
  }

  /** Read on as if `set` had been written to its `side`. */
  write(set: ChangeSet, side: "before" | "after"): void {
    if (set.order) this.order = set.order[side];
    for (const part of set.parts) {
      if (part.kind !== "page") this.written.set(this.key(part), part[side]);
    }
  }

  private key(part: Exclude<ChangePart, { kind: "page" }>): string {
    let id = this.ids.get(part.page);
    if (id === undefined) {
      id = this.ids.size + 1;
      this.ids.set(part.page, id);
    }
    return part.kind === "field" ? `${id} ${part.key}` : `${id} ${part.key} ${part.id}`;
  }
}

/** Where `set` stands against `doc`. */
export function changeState(doc: InkDocument, set: ChangeSet): ChangeState {
  return new Reading(doc).state(set);
}

/**
 * The 1-based pages (as they stand now) whose parts of `set` are no longer
 * on the `from` side; empty when only the page order changed, or nothing.
 */
export function pagesChangedSince(
  doc: InkDocument,
  set: ChangeSet,
  from: "before" | "after",
): number[] {
  return changedPages(new Reading(doc), doc, set, from);
}

function changedPages(
  reading: Reading,
  doc: InkDocument,
  set: ChangeSet,
  from: "before" | "after",
): number[] {
  const pages = new Set<number>();
  for (const part of set.parts) {
    if (reading.is(part, from)) continue;
    const at = doc.pages.indexOf(part.page);
    if (at >= 0) pages.add(at + 1);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Why a change set cannot be taken back (or made again). */
export type RevertRefusal =
  /** It already is: nothing to do. */
  | { reason: "already" }
  /** A later edit touched these pages (1-based; empty when it was the page order or a page gone). */
  | { reason: "changed"; pages: number[] };

/**
 * A command that takes `sets` back (`undo`, newest first) or makes them
 * again (`redo`, oldest first), as one step that undo can take back in its
 * turn; or why it cannot. All or nothing: each set is checked against the
 * notebook as the ones before it in the step would leave it, and if any is
 * not exactly as it should be, nothing is changed. Sets already on the
 * wanted side are passed over.
 */
export function revertChange(
  doc: InkDocument,
  sets: readonly ChangeSet[],
  direction: "undo" | "redo",
  label: string,
): Command | RevertRefusal {
  const from = direction === "undo" ? "after" : "before";
  const to = direction === "undo" ? "before" : "after";
  const done: ChangeState = direction === "undo" ? "undone" : "applied";
  const ordered = (direction === "undo" ? [...sets].reverse() : [...sets]).filter(
    (set) => !isEmptyChange(set),
  );
  const reading = new Reading(doc);
  const steps: RevertStep[] = [];
  for (const set of ordered) {
    const state = reading.state(set);
    if (state === done) continue;
    if (state === "changed") {
      return { reason: "changed", pages: changedPages(reading, doc, set, from) };
    }
    reading.write(set, to);
    steps.push(new RevertStep(set, direction));
  }
  if (steps.length === 0) return { reason: "already" };
  return new RevertSteps(label, steps);
}

/** Several {@link RevertStep}s as one undo step. */
class RevertSteps implements Command {
  constructor(
    readonly label: string,
    private readonly steps: readonly RevertStep[],
  ) {}

  get keepsReading(): boolean {
    return this.steps.some((step) => step.keepsReading);
  }

  apply(doc: InkDocument): void {
    for (const step of this.steps) step.apply(doc);
  }

  invert(doc: InkDocument): void {
    for (let i = this.steps.length - 1; i >= 0; i--) this.steps[i].invert(doc);
  }
}

/** One change set put to one side: `undo` writes its `before`, `redo` its `after`. */
class RevertStep implements Command {
  readonly label = "";
  readonly keepsReading: boolean;

  constructor(
    private readonly set: ChangeSet,
    private readonly direction: "undo" | "redo",
  ) {
    this.keepsReading = set.order !== undefined;
  }

  apply(doc: InkDocument): void {
    this.write(doc, this.direction === "undo" ? "before" : "after");
  }

  invert(doc: InkDocument): void {
    this.write(doc, this.direction === "undo" ? "after" : "before");
  }

  private write(doc: InkDocument, side: "before" | "after"): void {
    const order = this.set.order?.[side];
    if (order) doc.pages.splice(0, doc.pages.length, ...order);
    for (const part of this.set.parts) {
      if (part.kind === "page") continue;
      const page = part.page as unknown as Record<string, unknown>;
      const value = part[side];
      if (part.kind === "field") {
        if (value === undefined) delete page[part.key];
        else page[part.key] = copy(value);
        continue;
      }
      const list = Array.isArray(page[part.key]) ? [...(page[part.key] as unknown[])] : [];
      const at = list.findIndex((element) => idOf(element) === part.id);
      if (at >= 0) list.splice(at, 1);
      if (value !== undefined) {
        const index = side === "before" ? part.beforeIndex : part.afterIndex;
        list.splice(Math.max(0, Math.min(index, list.length)), 0, copy(value));
      }
      // A list the page held only optionally goes when it empties, as the commands leave it.
      if (
        list.length === 0 &&
        part.key !== "strokes" &&
        part.key !== "images" &&
        part.key !== "textBoxes"
      ) {
        delete page[part.key];
      } else {
        page[part.key] = list;
      }
    }
  }
}

// --- Plain values ----------------------------------------------------------------

/** A deep copy that keeps typed arrays as they are. */
function copy<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return structuredClone(value);
}

/** Deep equality over plain data: objects, arrays, typed arrays and primitives. */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(ra[k], rb[k]));
}

function sameOrder(a: readonly Page[], b: readonly Page[]): boolean {
  return a.length === b.length && a.every((page, i) => page === b[i]);
}
