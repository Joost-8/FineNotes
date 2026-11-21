/**
 * Writing a notebook kept as one file per page per device (FineNotes#274,
 * layout (c3) of the sync research note; the reader is `device-pages`).
 *
 * A device writes only files that end in its own id: its file for each page
 * it changed, and its meta. What it writes for a page:
 * - every element whose last change (`d`) was made here: new ones, and
 *   those it changed, whoever made them (same id, newer dot: the version a
 *   device has not seen wins, `provenance`);
 * - a tombstone `{id, d, l}` for an element it erased that another source
 *   (the legacy notebook, another device's file) still holds. An element
 *   only its own file held simply leaves that file.
 *
 * Its meta holds a page entry for each page whose place or fields it set
 * (a last-writer-wins register with a Lamport clock), its settings when it
 * changed them, the rev and hash of each page file it wrote, and its
 * version vector.
 *
 * The writer keeps what it last knew of every element (`known`): the stored
 * JSON and dot of each. An element whose stored JSON changed since gets a
 * fresh dot from the notebook's {@link DotClock}; one that did not keeps its
 * dot. So the document model needs no field for dots: they live here.
 *
 * Pure: no DOM, no Obsidian. The view reads and writes the files.
 */

import type { InkDocument } from "./document";
import { type DotClock } from "./dot-ids";
import {
  type DevicePagesSources,
  type DevicePagesUnion,
  type Tombstone,
  ELEMENT_LISTS,
  PAGE_FIELDS,
  elementKey,
  explodeStored,
  orderKeyAt,
} from "./device-pages-union";
import { metaFileText, pageFileText, payloadHash } from "./device-pages";
import { type FormatFeature, payloadLabel } from "./format-features";
import { orderKeys } from "./order-keys";
import { type VersionVector, joinVersionVectors, readDot } from "./provenance";
import {
  encodeDocumentWith,
  inkFileText,
  labelledPayload,
  pageFeatures,
  payloadFeatures,
  storedHead,
  storedPage,
} from "./serialize";

/** What the writer last knew of one element. */
interface Known {
  readonly d: string | undefined;
  readonly json: string;
}

/** What the writer knows of one page. */
interface PageState {
  /** Every element on the page, by `elementKey`. */
  known: Map<string, Known>;
  /** Elements another source holds (legacy, another device), by `elementKey`. */
  elsewhere: Set<string>;
  /** This device's tombstones on the page, by `elementKey`. */
  tomb: Map<string, Tombstone>;
  /** The page's register as shown: order key, clock, and its fields as JSON. */
  key: string;
  c: number;
  fields: string;
  /** The whole stored page as JSON when last looked at (undefined: not yet). */
  pageJson?: string;
  /** This device's file for the page: its rev, and its content (rev and vector left out). */
  rev: number;
  body: string;
}

/** A page entry as this device's meta holds it. */
interface MetaEntry {
  id: string;
  key: string;
  c: number;
  gone?: true;
  [field: string]: unknown;
}

/** One file to write in the notebook's page folder: its name and text. */
export interface DeviceFileWrite {
  readonly name: string;
  readonly text: string;
}

/** A page file's content holding nothing: no element, no tombstone. */
const EMPTY_BODY = JSON.stringify({ tomb: [] });

/** The fields of a stored page that are its register, as JSON. */
function fieldsJson(page: Record<string, unknown>): string {
  const fields: Record<string, unknown> = {};
  for (const name of PAGE_FIELDS) if (page[name] !== undefined) fields[name] = page[name];
  return JSON.stringify(fields);
}

/** The stored head as the settings register compares it: without the view, which is per device. */
function headJson(head: Record<string, unknown>): string {
  const { view: _view, ...rest } = head;
  return JSON.stringify(rest);
}

/** Each element of a stored page, with its list, id and JSON. */
function* elementsOf(
  page: Record<string, unknown>,
): Generator<{ list: string; id: string; element: Record<string, unknown>; json: string }> {
  for (const list of ELEMENT_LISTS) {
    const entries = page[list];
    if (!Array.isArray(entries)) continue;
    for (const element of entries) {
      if (typeof element !== "object" || element === null) continue;
      const id = (element as { id?: unknown }).id;
      if (typeof id !== "string" || !id) continue;
      const record = element as Record<string, unknown>;
      yield { list, id, element: record, json: JSON.stringify(record) };
    }
  }
}

/** One page the writer writes: a page of the notebook, or a made-up one (`explodeStored`). */
interface WriterPage {
  readonly id: string;
  /** A page of the notebook (placed by order keys), not a made-up one. */
  readonly real: boolean;
  /** The page as stored: made only when the page is looked at. */
  readonly stored: () => Record<string, unknown>;
  readonly features: () => FormatFeature[];
}

/**
 * The pages the writer writes for `doc`, and the settings it keeps as a
 * register: the notebook's pages, then its own page (PDF tabs, recordings)
 * and each PDF tab's page of marks (`explodeStored`), which the union joins
 * by id as it joins pages.
 */
function writerPages(doc: InkDocument): { head: Record<string, unknown>; pages: WriterPage[] } {
  const exploded = explodeStored({ ...storedHead(doc), pages: [] });
  const requires = exploded.head.requires;
  const headFeatures = Array.isArray(requires) ? (requires as FormatFeature[]) : [];
  return {
    head: exploded.head,
    pages: [
      ...doc.pages.map((page) => ({
        id: page.id,
        real: true,
        stored: () => storedPage(page),
        features: () => pageFeatures(doc, page),
      })),
      ...exploded.pages.map((page) => ({
        id: String(page.id),
        real: false,
        stored: () => page,
        features: () => headFeatures,
      })),
    ],
  };
}

/**
 * The name of this device's file for `pageId`: the id itself when it is safe
 * as a file name on every file system (lower case, so two ids never differ
 * only in case), else a hash of it. The reader takes the id from the file.
 */
export function pageFileName(pageId: string, device: string): string {
  const safe = /^[a-z0-9_.-]{1,96}$/.test(pageId) && !pageId.startsWith("_");
  return `${safe ? pageId : `page-${payloadHash(pageId)}`}.${device}.md`;
}

/** The name of this device's meta. */
export function metaFileName(device: string): string {
  return `_meta.${device}.md`;
}

/**
 * The writer of one device for one notebook. Made from what the reader
 * read and the notebook it made ({@link DevicePagesWriter.fromRead}), or
 * for a notebook just moved to the layout ({@link DevicePagesWriter.fresh}).
 */
export class DevicePagesWriter {
  private readonly pages = new Map<string, PageState>();
  /** This device's meta entries, by page id: every one it ever wrote. */
  private readonly entries = new Map<string, MetaEntry>();
  /** The settings as this device last wrote them, with their clock. */
  private settings: { c: number; head: Record<string, unknown> } | undefined;
  /** The settings as shown, without the view, and their clock. */
  private head: string;
  private headC: number;
  /** The highest Lamport clock seen or set. */
  private clock: number;
  /** The rev and hash of each page file this device wrote, by page id. */
  private readonly files = new Map<string, { rev: number; hash: string }>();
  /** What the notebook includes of every device. */
  private vv: VersionVector;
  /** The meta must be written at the next save, changed or not (after a failed write). */
  private forceMeta = false;

  private constructor(
    readonly device: string,
    private readonly dots: DotClock,
    doc: InkDocument,
    union: Pick<DevicePagesUnion, "detail" | "vv" | "settingsClock" | "clock"> | null,
    sources: DevicePagesSources | null,
  ) {
    this.vv = union?.vv ?? {};
    this.clock = union?.clock ?? 0;
    this.headC = union?.settingsClock ?? 0;
    const mine = sources?.metas.find((meta) => meta.device === device);
    if (mine) {
      for (const entry of mine.pages) {
        this.entries.set(entry.id, {
          id: entry.id,
          key: entry.key,
          c: entry.c,
          ...(entry.gone ? { gone: true as const } : {}),
          ...entry.fields,
        });
      }
      for (const [page, file] of Object.entries(mine.files)) this.files.set(page, file);
      if (mine.settings) this.settings = { c: mine.settings.c, head: { ...mine.settings.head } };
      dots.raiseTo(mine.vv[device] ?? 0);
    }
    dots.raiseTo(this.vv[device] ?? 0);
    const myFiles = new Map(
      (sources?.pages ?? []).filter((file) => file.device === device).map((f) => [f.page, f]),
    );
    const parts = writerPages(doc);
    this.head = headJson(parts.head);
    parts.pages.forEach((page) => {
      const stored = page.stored();
      const detail = union?.detail.get(page.id);
      const known = new Map<string, Known>();
      const elsewhere = new Set<string>();
      for (const { list, id, json } of elementsOf(stored)) {
        const key = elementKey(list, id);
        const d = detail ? detail.dots.get(key) : undefined;
        known.set(key, { d, json });
        dots.raise([id, d]);
        const holders = detail?.holders.get(key);
        // Without a union (a notebook just moved here) every element is the legacy notebook's.
        if (!detail || [...(holders ?? [])].some((holder) => holder !== device)) {
          elsewhere.add(key);
        }
      }
      dots.raise([page.id]);
      const file = myFiles.get(page.id);
      // A page file this device wrote that its meta does not describe (the app
      // stopped between the two): the meta is put right at the next save.
      const said = this.files.get(page.id);
      if (file && (said?.rev !== file.rev || said.hash !== file.hash)) {
        this.files.set(page.id, { rev: file.rev, hash: file.hash });
        this.forceMeta = true;
      }
      // This device's erase records, but only those still needed: one whose
      // element no other copy holds any more (its device saw the erase and
      // let it go) hides nothing and goes at the page's next write. A record
      // of the legacy notebook's ink stays, since that copy never changes.
      const tomb = new Map<string, Tombstone>();
      for (const entry of file?.tomb ?? []) {
        const key = elementKey(entry.l ?? "", entry.id);
        const held = detail?.holders.get(key);
        const needed =
          entry.l === undefined || !detail || [...(held ?? [])].some((holder) => holder !== device);
        if (needed) tomb.set(key, entry);
      }
      const state: PageState = {
        known,
        elsewhere,
        tomb,
        key: detail?.key ?? "",
        c: detail?.c ?? 0,
        fields: fieldsJson(stored),
        rev: file?.rev ?? this.files.get(page.id)?.rev ?? 0,
        body: "",
      };
      state.body = this.bodyOf(state, stored);
      this.pages.set(page.id, state);
    });
  }

  /** The writer for a notebook the reader read: `doc` is what it made of `sources`. */
  static fromRead(
    device: string,
    dots: DotClock,
    doc: InkDocument,
    sources: DevicePagesSources,
    union: DevicePagesUnion,
  ): DevicePagesWriter {
    return new DevicePagesWriter(device, dots, doc, union, sources);
  }

  /**
   * The writer for a notebook just moved to the layout: `doc` is all legacy,
   * its pages in the legacy order (`orderKeyAt`), and no device has written.
   */
  static fresh(device: string, dots: DotClock, doc: InkDocument): DevicePagesWriter {
    const writer = new DevicePagesWriter(device, dots, doc, null, null);
    // The legacy keys, as the reader gives them.
    doc.pages.forEach((page, i) => {
      const state = writer.pages.get(page.id);
      if (state) state.key = orderKeyAt(i);
    });
    return writer;
  }

  /** This device's file content for a page: its elements and tombstones, as JSON. */
  private bodyOf(state: PageState, stored: Record<string, unknown>): string {
    const lists: Record<string, Record<string, unknown>[]> = {};
    for (const { list, id, element } of elementsOf(stored)) {
      const d = state.known.get(elementKey(list, id))?.d;
      if (readDot(d)?.device !== this.device) continue;
      (lists[list] ??= []).push({ ...element, d });
    }
    return JSON.stringify({ ...lists, tomb: [...state.tomb.values()] });
  }

  /**
   * What to write for `doc` as it is now: this device's file for each page
   * that changed, and its meta when anything did. Empty when nothing did.
   * `changed` names the pages that may have changed (`null`: any), so a big
   * notebook is not stored whole at every save; a page not named is taken
   * as it was. The writer takes it as written: call only when the writes
   * will be made.
   */
  save(doc: InkDocument, changed: ReadonlySet<string> | null = null): DeviceFileWrite[] {
    const parts = writerPages(doc);
    const head = parts.head;
    const writes: DeviceFileWrite[] = [];
    let metaChanged = false;
    const vvNow = (): VersionVector =>
      joinVersionVectors(this.vv, { [this.device]: this.dots.last });

    // Where each page of the notebook stands: as many keys kept as possible.
    const real = parts.pages.filter((page) => page.real);
    const placed = orderKeys(real.map((page) => this.pages.get(page.id)?.key || null));
    const keyOf = new Map(real.map((page, i) => [page.id, placed[i]]));

    const pagesNow = new Set<string>();
    const bodies: { id: string; state: PageState; body: string; page: WriterPage }[] = [];
    parts.pages.forEach((page) => {
      pagesNow.add(page.id);
      let state = this.pages.get(page.id);
      // Made-up pages carry no place.
      const key = keyOf.get(page.id) ?? state?.key ?? "";
      // Made-up pages are looked at every time; the notebook's, when named.
      const named = !page.real || changed === null || changed.has(page.id) || !state;
      if (state && !named) {
        // Not named as changed: only its place may have moved.
        if (key !== state.key) {
          state.key = key;
          this.setEntry(page.id, state);
          metaChanged = true;
        }
        return;
      }
      const stored = page.stored();
      // The page as stored, whole: when it is as it was, nothing on it changed.
      const pageJson = JSON.stringify(stored);
      if (state?.pageJson === pageJson && key === state.key) return;
      if (!state) {
        state = {
          known: new Map(),
          elsewhere: new Set(),
          tomb: new Map(),
          key: "",
          c: 0,
          fields: "",
          rev: this.files.get(page.id)?.rev ?? 0,
          body: "",
        };
        this.pages.set(page.id, state);
      }
      state.pageJson = pageJson;
      // The page's register: its place and fields.
      const fields = fieldsJson(stored);
      if (fields !== state.fields || key !== state.key) {
        state.fields = fields;
        state.key = key;
        this.setEntry(page.id, state);
        metaChanged = true;
      }
      // Its elements: changed ones get a fresh dot; erased ones a tombstone where needed.
      const seen = new Set<string>();
      for (const { list, id, json } of elementsOf(stored)) {
        const key = elementKey(list, id);
        seen.add(key);
        const known = state.known.get(key);
        if (known && known.json === json) continue;
        state.known.set(key, { d: this.dots.next(), json });
        // Back after an erase here: the tombstone goes.
        state.tomb.delete(key);
      }
      for (const [key, known] of [...state.known]) {
        if (seen.has(key)) continue;
        state.known.delete(key);
        if (!state.elsewhere.has(key)) continue;
        const [list, id] = key.split("\u0000");
        state.tomb.set(key, { id, l: list, ...(known.d !== undefined ? { d: known.d } : {}) });
      }
      const body = this.bodyOf(state, stored);
      // A page with nothing of this device's and no file of it yet needs none.
      if (body === EMPTY_BODY && state.rev === 0) state.body = body;
      else if (body !== state.body) bodies.push({ id: page.id, state, body, page });
    });

    // Pages gone from the notebook: a page tombstone in the meta.
    for (const [id, state] of [...this.pages]) {
      if (pagesNow.has(id)) continue;
      this.clock += 1;
      this.entries.set(id, { id, key: state.key, c: this.clock, gone: true });
      this.pages.delete(id);
      metaChanged = true;
    }

    // Settings.
    const settings = headJson(head);
    if (settings !== this.head) {
      this.clock += 1;
      this.head = settings;
      this.headC = this.clock;
      this.settings = { c: this.clock, head };
      metaChanged = true;
    } else if (this.settings) {
      // The view is this device's own: kept up to date, without a new clock.
      this.settings = { c: this.settings.c, head: { ...this.settings.head, view: head.view } };
    }

    const vv = vvNow();
    for (const { id, state, body, page } of bodies) {
      state.rev += 1;
      state.body = body;
      const content = JSON.parse(body) as Record<string, unknown>;
      const json = { dev: this.device, page: id, rev: state.rev, vv, ...content };
      const features: FormatFeature[] = page.features();
      const payload = labelledPayload(json, features);
      this.files.set(id, { rev: state.rev, hash: payloadHash(payload) });
      writes.push({ name: pageFileName(id, this.device), text: pageFileText(payload) });
      metaChanged = true;
    }
    if (metaChanged || this.forceMeta) writes.push(this.metaWrite(vv));
    this.forceMeta = false;
    return writes;
  }

  /** This device's entry for a page: its place and fields as `state` has them, at a new clock. */
  private setEntry(id: string, state: PageState): void {
    this.clock += 1;
    state.c = this.clock;
    this.entries.set(id, {
      id,
      key: state.key,
      c: state.c,
      ...(JSON.parse(state.fields || "{}") as Record<string, unknown>),
    });
  }

  /** This device's meta as it stands. */
  private metaWrite(vv: VersionVector): DeviceFileWrite {
    const requires = this.settings?.head.requires;
    const features = Array.isArray(requires) ? (requires as FormatFeature[]) : [];
    const json = {
      dev: this.device,
      vv,
      clock: this.clock,
      ...(this.settings ? { settings: { c: this.settings.c, ...this.settings.head } } : {}),
      pages: [...this.entries.values()],
      files: Object.fromEntries(this.files),
    };
    return { name: metaFileName(this.device), text: metaFileText(labelledPayload(json, features)) };
  }

  /**
   * A write failed: every page file and the meta are written again whole at
   * the next save, so nothing this device holds stays off the disk.
   */
  unwritten(): void {
    // Only pages with a file of this device: the others hold nothing of it.
    for (const state of this.pages.values()) if (state.rev > 0) state.body = "";
    this.forceMeta = true;
  }

  /** The settings' clock as shown (for tests). */
  get settingsClock(): number {
    return this.headC;
  }
}

// --- Moving a notebook to the layout ------------------------------------------------

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A random id of 8 lower-case letters and digits: a notebook's, or a device's. */
export function randomId(random: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 8; i++) id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length) % 36];
  return id;
}

/**
 * The notebook file's payload when it moves to the layout: the notebook as
 * it is, kept as legacy, its label naming the notebook's id.
 */
export function legacyPayload(doc: InkDocument, id: string): string {
  return withPagesId(encodeDocumentWith(doc, ["device-pages"]), id);
}

/** `payload` labelled `device-pages=<id>`, beside the features it names; `null` without a label. */
function withPagesIdOrNull(payload: string, id: string): string | null {
  const text = payload.trim();
  const colon = text.indexOf(":");
  const features = payloadFeatures(text);
  if (colon < 0 || features === null) return null;
  return `${payloadLabel([...features, "device-pages"], id)}${text.slice(colon)}`;
}

function withPagesId(payload: string, id: string): string {
  return withPagesIdOrNull(payload, id) ?? payload;
}

/**
 * A one-file notebook moved to the layout, from the file as it was read:
 * its payload kept as it is, labelled `device-pages=<id>` (no re-encoding,
 * so a big notebook moves at once), the id made from its path and that
 * payload. Only the label changes, and two devices moving the same file at
 * once make the same change: should Sync's merge apply it twice, the label
 * holds the id twice, which reads the same. What each device changed since
 * goes to its own page files. `null` when the payload has no readable label.
 */
export function movedNotebook(
  path: string,
  loaded: string,
): { id: string; payload: string } | null {
  const text = loaded.trim();
  const id = payloadHash(`${path}\n${text}`).slice(0, 8);
  const payload = withPagesIdOrNull(text, id);
  return payload === null ? null : { id, payload };
}

/**
 * A new notebook's file, made in the layout from the start: the note, and
 * `doc` as its legacy notebook, labelled with a new id.
 */
export function devicePagesNotebookText(
  body: string,
  doc: InkDocument,
  id: string = randomId(),
): string {
  return inkFileText(body, legacyPayload(doc, id));
}
