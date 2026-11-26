/**
 * A notebook kept as one file per page per device (FineNotes#274, layout
 * (c3) of the sync research note), put together from what each device
 * wrote. Works on stored JSON: the result goes through the normal reader
 * (`readStoredDocument`), which makes every field safe.
 *
 * The sources:
 * - `legacy`: the whole notebook as it was when it moved to this layout,
 *   kept in the notebook file. Its pages, their order and its settings are
 *   the starting state, at clock 0.
 * - one **meta** per device: its version vector, its notebook settings and
 *   its entry for each page it touched (both last-writer-wins registers with
 *   a Lamport clock `c`), and the rev and hash of each page file it wrote.
 * - one **page file** per page per device: that device's elements on the
 *   page, and tombstones `{id, d}` for elements of others it erased.
 *
 * The rules (note, section 4 (c3) and "Provenance"):
 * - A page is the union of its sources' elements by id. Absence is never
 *   deletion: an element goes only through a tombstone whose file saw that
 *   version of it, or because its own device stopped writing it.
 * - The same id in two sources: the version the other did not see wins
 *   ({@link newerVersion}); edits made at once keep the element's own device's.
 * - Order on a page: legacy first, as it was, then each device's elements in
 *   its file's order, devices sorted by id.
 * - A register goes to the highest clock, a tie to the higher device id;
 *   legacy loses every tie.
 * - Pages are ordered by their order key (code-unit order, then id). A page
 *   whose winning entry says `gone` is left out.
 * - A page file older than its device's meta says (lower rev, or the same rev
 *   and another hash) is **stale**: shown as it is, marked "still syncing".
 *   A page file a meta names that is not there is **missing**. Neither ever
 *   causes a write.
 *
 * Pure: no DOM, no Obsidian.
 */

import {
  type VersionVector,
  covers,
  joinVersionVectors,
  newerVersion,
  readDot,
} from "./provenance";

/** The lists of a stored page whose entries are elements with ids, joined by id. */
export const ELEMENT_LISTS = [
  "images",
  "textBoxes",
  "tables",
  "graphs",
  "equations",
  "comments",
  "strokes",
  "sections",
  "regions",
  "chapters",
  "links",
  "tasks",
  "connectors",
  // Only on the notebook's own page (NOTEBOOK_PAGE): its PDF tabs and recordings.
  "beside",
  "recordings",
] as const;

/** The fields of a stored page that are its register (kept in the metas), not elements. */
export const PAGE_FIELDS = [
  "kind",
  "geometry",
  "backdrop",
  "board",
  "epoch",
  "bookmarked",
  "tab",
  "title",
  "titleLevel",
  // A PDF tab's page of marks: its own id (the page's id here is made of the tab's and its PDF page).
  "markId",
] as const;

/**
 * The notebook's own page: what the notebook holds beside its pages, kept
 * as elements so two devices adding at once both keep theirs: its PDF tabs
 * (without their ink) and its recordings.
 */
export const NOTEBOOK_PAGE = "~notebook";

/** Whether a page id is one of these made-up pages (the notebook's own, a PDF tab's page of marks). */
export function isVirtualPage(id: string): boolean {
  return id.startsWith("~");
}

/** The made-up page id of PDF tab `tab`'s page of marks on its PDF page `pdfPage`. */
export function markPageId(tab: string, pdfPage: number): string {
  return `~${tab}.${pdfPage}`;
}

/**
 * A stored notebook as the union and the writer see it: its head (without
 * its PDF tabs and recordings), its pages, and made-up pages for the rest,
 * which is joined by id as pages are (FineNotes#274):
 * - the notebook's own page (`NOTEBOOK_PAGE`): its PDF tabs, without their
 *   ink, and its recordings, as element lists;
 * - each PDF tab's page of marks, as a page of its own (`markPageId`), so
 *   ink written on a PDF on two devices at once is joined like any page's.
 */
export function explodeStored(stored: Readonly<Record<string, unknown>>): {
  head: Record<string, unknown>;
  pages: Record<string, unknown>[];
} {
  const head: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(stored)) {
    if (name !== "pages" && name !== "beside" && name !== "recordings") head[name] = value;
  }
  const pages = (Array.isArray(stored.pages) ? stored.pages : []).filter(isRecord);
  const tabs: Record<string, unknown>[] = [];
  const marks: Record<string, unknown>[] = [];
  for (const tab of (Array.isArray(stored.beside) ? stored.beside : []).filter(isRecord)) {
    const { marks: tabMarks, ...rest } = tab;
    tabs.push(rest);
    if (typeof tab.id !== "string") continue;
    for (const mark of (Array.isArray(tabMarks) ? tabMarks : []).filter(isRecord)) {
      const backdrop = mark.backdrop;
      const pdfPage =
        isRecord(backdrop) && typeof backdrop.page === "number" ? backdrop.page : null;
      if (pdfPage === null) continue;
      marks.push({
        ...mark,
        id: markPageId(tab.id, pdfPage),
        ...(typeof mark.id === "string" ? { markId: mark.id } : {}),
      });
    }
  }
  const recordings = Array.isArray(stored.recordings) ? stored.recordings : [];
  const own =
    tabs.length > 0 || recordings.length > 0
      ? [{ id: NOTEBOOK_PAGE, beside: tabs, recordings }]
      : [];
  return { head, pages: [...pages, ...own, ...marks] };
}

/** {@link explodeStored} the other way: the stored notebook made of its head and joined pages. */
export function implodeStored(
  head: Readonly<Record<string, unknown>>,
  pages: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(head)) {
    if (name !== "pages" && name !== "beside" && name !== "recordings") stored[name] = value;
  }
  const own = pages.find((page) => page.id === NOTEBOOK_PAGE);
  const marksOf = new Map<string, Record<string, unknown>[]>();
  for (const page of pages) {
    const id = page.id;
    if (typeof id !== "string" || !isVirtualPage(id) || id === NOTEBOOK_PAGE) continue;
    const dot = id.lastIndexOf(".");
    const tab = id.slice(1, dot);
    const { markId, ...mark } = page;
    const list = marksOf.get(tab) ?? [];
    list.push({ ...mark, id: typeof markId === "string" ? markId : id });
    marksOf.set(tab, list);
  }
  const tabs = own && Array.isArray(own.beside) ? own.beside.filter(isRecord) : [];
  if (tabs.length > 0) {
    stored.beside = tabs.map((tab) => ({
      ...tab,
      marks: typeof tab.id === "string" ? (marksOf.get(tab.id) ?? []) : [],
    }));
  }
  if (own && Array.isArray(own.recordings) && own.recordings.length > 0) {
    stored.recordings = own.recordings;
  }
  stored.pages = pages.filter((page) => typeof page.id !== "string" || !isVirtualPage(page.id));
  return stored;
}

/**
 * An erased element of another device (or of the legacy notebook): its id,
 * the dot of the version erased, and the list it was in (`l`; absent: any).
 */
export interface Tombstone {
  readonly id: string;
  readonly d?: string;
  readonly l?: string;
}

/** One device's page file, read. */
export interface PageFileRead {
  readonly device: string;
  readonly page: string;
  readonly rev: number;
  readonly vv: VersionVector;
  /** The hash of the file's payload ({@link payloadHash} in device-pages). */
  readonly hash: string;
  /** The stored page's element lists, as written. */
  readonly lists: Readonly<Record<string, readonly unknown[]>>;
  readonly tomb: readonly Tombstone[];
}

/** A device's entry for one page in its meta. */
export interface MetaPageEntry {
  readonly id: string;
  readonly key: string;
  readonly c: number;
  readonly gone: boolean;
  /** The page's {@link PAGE_FIELDS}, as written. */
  readonly fields: Readonly<Record<string, unknown>>;
}

/** One device's meta, read. */
export interface MetaRead {
  readonly device: string;
  readonly vv: VersionVector;
  /** The notebook's settings (the stored head without pages), with their clock; absent: none written. */
  readonly settings?: { readonly c: number; readonly head: Readonly<Record<string, unknown>> };
  readonly pages: readonly MetaPageEntry[];
  /** For each page file it wrote, by page id: its rev and hash. */
  readonly files: Readonly<Record<string, { readonly rev: number; readonly hash: string }>>;
}

export interface DevicePagesSources {
  /** The stored notebook kept from before (`{ view, meta, pages, … }`), or `null`. */
  readonly legacy: Readonly<Record<string, unknown>> | null;
  readonly metas: readonly MetaRead[];
  readonly pages: readonly PageFileRead[];
}

/** The notebook put together, and what of it is not up to date yet. */
export interface DevicePagesUnion {
  /** The stored notebook: the winning settings with the pages joined, for `readStoredDocument`. */
  readonly stored: Record<string, unknown>;
  /** Pages shown from a page file older than its device's meta says, by id. */
  readonly stale: string[];
  /** Pages a meta names a file for that is not there (yet), by id. */
  readonly missing: string[];
  /** Pages known only from a page file, their entry not synced yet, by id. */
  readonly unlisted: string[];
  /** What the union includes from every device. */
  readonly vv: VersionVector;
  /** For the writer: what each page's sources hold, by page id. */
  readonly detail: ReadonlyMap<string, PageDetail>;
  /** For the writer: the settings' clock, and the highest clock of any register. */
  readonly settingsClock: number;
  readonly clock: number;
}

/** What a page's sources hold, for the writer (`device-pages-writer`). */
export interface PageDetail {
  /** The register the page took: its order key, clock and device ("" for legacy). */
  readonly key: string;
  readonly c: number;
  /** For each element shown, by {@link elementKey}: the dot of its last change, if any. */
  readonly dots: ReadonlyMap<string, string | undefined>;
  /** For each element any source holds, by {@link elementKey}: the devices holding it ("" for legacy). */
  readonly holders: ReadonlyMap<string, ReadonlySet<string>>;
}

/** An element's key on its page: its list and its id. */
export function elementKey(list: string, id: string): string {
  return `${list}\u0000${id}`;
}

/**
 * The order key of the `index`th page of the legacy notebook: six base-36
 * digits and an `i`, so they sort in page order by code unit and a key
 * between two of them can always be made (`model/order-keys`).
 */
export function orderKeyAt(index: number): string {
  // Never ending in "0", so a key before the first can always be made too.
  return `${Math.max(0, Math.floor(index)).toString(36).padStart(6, "0")}i`;
}

/** A register's claim: its clock and the device that wrote it ("" for legacy). */
interface Claim {
  readonly c: number;
  readonly device: string;
}

/** Whether claim `a` beats claim `b`: the higher clock, then the higher device id. */
function beats(a: Claim, b: Claim): boolean {
  if (a.c !== b.c) return a.c > b.c;
  return a.device > b.device;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An element's id, when it has a usable one. */
function idOf(element: unknown): string | null {
  return isRecord(element) && typeof element.id === "string" && element.id ? element.id : null;
}

/** A page's register: where it stands, whether it is gone, and its fields. */
interface PageRegister extends Claim {
  readonly key: string;
  readonly gone: boolean;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** The fields of a stored page that are its register. */
function pageFieldsOf(page: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const name of PAGE_FIELDS) if (page[name] !== undefined) fields[name] = page[name];
  return fields;
}

/** One source of a page's elements: its lists and the vector of the copy they are in. */
interface ElementSource {
  readonly device: string;
  readonly vv: VersionVector;
  readonly lists: Readonly<Record<string, readonly unknown[]>>;
}

/** A tombstone and the vector of the file that holds it. */
interface HeldTombstone {
  readonly d?: string;
  readonly l?: string;
  readonly vv: VersionVector;
}

/**
 * Whether a tombstone erased this version (`d`) of its element: the version
 * it names, one its file had seen, or a version of unknown origin (legacy,
 * which every device starts from).
 */
function erases(tomb: HeldTombstone, d: unknown): boolean {
  if (d === undefined || tomb.d === d) return true;
  return covers(tomb.vv, d);
}

/** The element lists of one page, joined from its sources, and what the writer needs of them. */
function joinElements(
  sources: readonly ElementSource[],
  tombs: ReadonlyMap<string, readonly HeldTombstone[]>,
): {
  lists: Record<string, unknown[]>;
  dots: Map<string, string | undefined>;
  holders: Map<string, Set<string>>;
} {
  const out: Record<string, unknown[]> = {};
  const dots = new Map<string, string | undefined>();
  const holders = new Map<string, Set<string>>();
  for (const list of ELEMENT_LISTS) {
    const order: string[] = [];
    const chosen = new Map<string, { element: Record<string, unknown>; source: ElementSource }>();
    for (const source of sources) {
      const entries = source.lists[list];
      if (!Array.isArray(entries)) continue;
      for (const element of entries) {
        const id = idOf(element);
        if (id === null || !isRecord(element)) continue;
        const key = elementKey(list, id);
        const holding = holders.get(key) ?? new Set<string>();
        holding.add(source.device);
        holders.set(key, holding);
        const held = chosen.get(id);
        if (!held) {
          order.push(id);
          chosen.set(id, { element, source });
          continue;
        }
        const winner = newerVersion(
          { d: held.element.d, vv: held.source.vv },
          { d: element.d, vv: source.vv },
        );
        const ownDevice = readDot(id)?.device;
        // Made at once on two devices: the element's own device's edit stays.
        const takeNew =
          winner === "b" ||
          (winner === "concurrent" &&
            ownDevice !== held.source.device &&
            (ownDevice === source.device || ownDevice === undefined));
        if (takeNew) chosen.set(id, { element, source });
      }
    }
    const kept = order.flatMap((id) => {
      const { element } = chosen.get(id) as { element: Record<string, unknown> };
      const erased = (tombs.get(id) ?? []).some(
        (tomb) => (tomb.l === undefined || tomb.l === list) && erases(tomb, element.d),
      );
      if (erased) return [];
      dots.set(elementKey(list, id), typeof element.d === "string" ? element.d : undefined);
      return [element];
    });
    if (kept.length > 0) out[list] = kept;
  }
  return { lists: out, dots, holders };
}

/** Put a notebook together from its legacy payload, its metas and its page files. */
export function joinDevicePages(sources: DevicePagesSources): DevicePagesUnion {
  const exploded = explodeStored(sources.legacy ?? {});
  const legacy = exploded.head;
  const legacyPages = exploded.pages;
  const metas = [...sources.metas].sort((a, b) => (a.device < b.device ? -1 : 1));
  const metaOf = new Map(metas.map((meta) => [meta.device, meta]));

  // Settings: the stored head, a register.
  let head: Readonly<Record<string, unknown>> = legacy;
  let headClaim: Claim = { c: 0, device: "" };
  for (const meta of metas) {
    if (!meta.settings) continue;
    const claim = { c: meta.settings.c, device: meta.device };
    if (beats(claim, headClaim)) {
      head = meta.settings.head;
      headClaim = claim;
    }
  }

  // Pages: a register each.
  const registers = new Map<string, PageRegister>();
  const legacyById = new Map<string, Record<string, unknown>>();
  legacyPages.forEach((page, index) => {
    const id = idOf(page);
    if (id === null || registers.has(id)) return;
    legacyById.set(id, page);
    registers.set(id, {
      c: 0,
      device: "",
      key: orderKeyAt(index),
      gone: false,
      fields: pageFieldsOf(page),
    });
  });
  for (const meta of metas) {
    for (const entry of meta.pages) {
      const held = registers.get(entry.id);
      const claim: PageRegister = { ...entry, device: meta.device };
      if (!held || beats(claim, held)) registers.set(entry.id, claim);
    }
  }

  // Page files, by page, devices in id order.
  const filesOf = new Map<string, PageFileRead[]>();
  for (const file of [...sources.pages].sort((a, b) => (a.device < b.device ? -1 : 1))) {
    const list = filesOf.get(file.page) ?? [];
    // One file per page per device: a second one (a copy) is not read.
    if (list.some((other) => other.device === file.device)) continue;
    list.push(file);
    filesOf.set(file.page, list);
  }

  const listed = [...registers.entries()]
    .filter(([id, register]) => !register.gone && !isVirtualPage(id))
    .sort(([idA, a], [idB, b]) =>
      a.key !== b.key ? (a.key < b.key ? -1 : 1) : idA < idB ? -1 : idA > idB ? 1 : 0,
    )
    .map(([id]) => id);
  const unlisted = [...filesOf.keys()]
    .filter((id) => !registers.has(id) && !isVirtualPage(id))
    .sort();
  // The notebook's own page and PDF tabs' pages: in no order, and never "still syncing" alone.
  const virtual = [...new Set([...registers.keys(), ...filesOf.keys()])]
    .filter((id) => isVirtualPage(id) && !registers.get(id)?.gone)
    .sort();

  const stale: string[] = [];
  const missing: string[] = [];
  const detail = new Map<string, PageDetail>();
  const pages = [...listed, ...unlisted, ...virtual].map((id) => {
    const files = filesOf.get(id) ?? [];
    const legacyPage = legacyById.get(id);
    const elementSources: ElementSource[] = [
      ...(legacyPage ? [{ device: "", vv: {}, lists: listsOf(legacyPage) }] : []),
      ...files,
    ];
    const tombs = new Map<string, HeldTombstone[]>();
    for (const file of files) {
      for (const tomb of file.tomb) {
        const list = tombs.get(tomb.id) ?? [];
        list.push({ d: tomb.d, l: tomb.l, vv: file.vv });
        tombs.set(tomb.id, list);
      }
    }
    for (const file of files) {
      const said = metaOf.get(file.device)?.files[id];
      if (said && (file.rev < said.rev || (file.rev === said.rev && file.hash !== said.hash))) {
        if (!stale.includes(id)) stale.push(id);
      }
    }
    for (const meta of metas) {
      if (meta.files[id] && !files.some((file) => file.device === meta.device)) {
        if (!missing.includes(id)) missing.push(id);
      }
    }
    const joined = joinElements(elementSources, tombs);
    const register = registers.get(id);
    detail.set(id, {
      key: register?.key ?? "",
      c: register?.c ?? 0,
      dots: joined.dots,
      holders: joined.holders,
    });
    return { ...(register?.fields ?? {}), id, ...joined.lists };
  });

  const stored = implodeStored(head, pages);
  const vv = joinVersionVectors(...metas.map((meta) => meta.vv), ...sources.pages.map((p) => p.vv));
  let clock = headClaim.c;
  for (const register of registers.values()) clock = Math.max(clock, register.c);
  for (const meta of metas) {
    for (const entry of meta.pages) clock = Math.max(clock, entry.c);
    if (meta.settings) clock = Math.max(clock, meta.settings.c);
  }
  return {
    stored,
    stale,
    missing,
    unlisted,
    vv,
    detail,
    settingsClock: headClaim.c,
    clock,
  };
}

/** The element lists of a stored page. */
function listsOf(page: Record<string, unknown>): Record<string, readonly unknown[]> {
  const lists: Record<string, readonly unknown[]> = {};
  for (const list of ELEMENT_LISTS) {
    const entries = page[list];
    if (Array.isArray(entries)) lists[list] = entries;
  }
  return lists;
}
