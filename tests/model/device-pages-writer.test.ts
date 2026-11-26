import { describe, expect, it } from "vitest";
import {
  DevicePagesWriter,
  legacyPayload,
  movedNotebook,
  pageFileName,
  randomId,
} from "../../src/model/device-pages-writer";
import { notebookIdOf, readDevicePagesNotebook, readPageFile } from "../../src/model/device-pages";
import { DotClock, attachDotClock, mintedId } from "../../src/model/dot-ids";
import {
  type BesidePdf,
  type InkDocument,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { attachPdf, besidePage, isTabId } from "../../src/model/beside-pdfs";
import { nextRecordingId } from "../../src/audio/recording";
import { nextPageId } from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { readDot } from "../../src/model/provenance";

/** A stroke with a fresh id from the notebook's clock. */
function stroke(doc: InkDocument, x = 10): Stroke {
  return {
    id: mintedId(doc) ?? "no-clock",
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pts: [x, 20, 0.5, x + 20, 40, 0.5],
  } as Stroke;
}

/** A legacy notebook: two pages, a stroke `s1` on the first. */
function legacyDoc(): InkDocument {
  const doc = emptyDocument(1024);
  doc.pages = [blankPage("p1"), blankPage("p2")];
  doc.pages[0].strokes.push({
    id: "s1",
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pts: [1, 2, 0.5, 3, 4, 0.5],
  } as Stroke);
  return doc;
}

/**
 * One device: its own copy of the notebook's page folder, a notebook open
 * from it, and its writer. A sync tool copies files between copies whole.
 */
class Device {
  folder = new Map<string, string>();
  doc!: InkDocument;
  writer!: DevicePagesWriter;
  syncing = false;
  private readonly clock: DotClock;

  constructor(
    readonly id: string,
    readonly payload: string,
  ) {
    this.clock = new DotClock(id);
  }

  /** Open (or reopen) the notebook from this device's copy. */
  open(): this {
    const load = readDevicePagesNotebook(this.payload, this.folder);
    this.doc = load.doc;
    this.syncing = load.syncing;
    attachDotClock(this.doc, this.clock);
    this.writer = DevicePagesWriter.fromRead(
      this.id,
      this.clock,
      this.doc,
      load.sources,
      load.union,
    );
    return this;
  }

  /** Save: the writes land in this device's copy. Returns the names written. */
  save(): string[] {
    const writes = this.writer.save(this.doc);
    for (const write of writes) this.folder.set(write.name, write.text);
    return writes.map((write) => write.name);
  }

  /** Every file of `other`'s copy comes here (a sync), or only `names`. */
  pull(other: Device, names?: readonly string[]): this {
    for (const [name, text] of other.folder) {
      if (!names || names.includes(name)) this.folder.set(name, text);
    }
    return this;
  }

  ids(page = 0): string[] {
    return this.doc.pages[page].strokes.map((s) => s.id);
  }
}

const A = "aaaa1111";
const B = "bbbb2222";

/** Two devices on one notebook just moved to the layout, both open. */
function twoDevices(): [Device, Device] {
  const payload = legacyPayload(legacyDoc(), "n7k2q9ab");
  return [new Device(A, payload).open(), new Device(B, payload).open()];
}

describe("two devices moving one notebook at once (#274)", () => {
  it("make the same edit, which reads the same even when Sync applies it twice", () => {
    const loaded = encodeDocument(legacyDoc());
    const path = "Uni/Lecture.notebook.md";
    // Each device made its own edit before its first save: the move is still the same.
    const onLaptop = movedNotebook(path, loaded) as NonNullable<ReturnType<typeof movedNotebook>>;
    expect(movedNotebook(path, loaded)).toEqual(onLaptop);
    expect(onLaptop.id).toMatch(/^[a-z0-9]{8}$/);
    // Another notebook (another path or content) gets another id.
    expect(movedNotebook("Uni/Other.notebook.md", loaded)?.id).not.toBe(onLaptop.id);
    // Only the label changes: the data is the loaded one, and reads back as it was.
    expect(onLaptop.payload).toBe(loaded.replace(/^v2:/, `v2+device-pages=${onLaptop.id}:`));
    const back = readDevicePagesNotebook(onLaptop.payload, new Map()).doc;
    expect(encodeDocument(back)).toBe(loaded);
    expect(notebookIdOf(onLaptop.payload)).toBe(onLaptop.id);
    // Sync's merge applying the same insertion twice: the same notebook, the same id.
    const twice = onLaptop.payload.replace(":", `+device-pages=${onLaptop.id}:`);
    expect(notebookIdOf(twice)).toBe(onLaptop.id);
    expect(encodeDocument(readDevicePagesNotebook(twice, new Map()).doc)).toBe(loaded);
  });

  it("keep a label's other features when relabelling", () => {
    const doc = legacyDoc();
    doc.pages[1].board = true;
    const moved = movedNotebook("a.notebook.md", encodeDocument(doc));
    expect(moved?.payload.startsWith(`v2+boards+device-pages=${moved.id}:`)).toBe(true);
  });
});

describe("moving a notebook to the layout (#274)", () => {
  it("keeps the notebook whole as its legacy payload, and writes nothing until it changes", () => {
    const doc = legacyDoc();
    const payload = legacyPayload(doc, "n7k2q9ab");
    expect(payload.startsWith("v2+device-pages=n7k2q9ab:")).toBe(true);
    expect(notebookIdOf(payload)).toBe("n7k2q9ab");
    const back = readDevicePagesNotebook(payload, new Map());
    expect(back.doc.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    const clock = new DotClock(A);
    attachDotClock(back.doc, clock);
    const fresh = DevicePagesWriter.fresh(A, clock, back.doc);
    expect(fresh.save(back.doc)).toEqual([]);
    const read = DevicePagesWriter.fromRead(A, clock, back.doc, back.sources, back.union);
    expect(read.save(back.doc)).toEqual([]);
    expect(randomId()).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("writing one file per page per device (#274)", () => {
  it("writes only the changed page's file and the meta, with ids that are dots", () => {
    const [a] = twoDevices();
    a.doc.pages[0].strokes.push(stroke(a.doc));
    expect(a.save()).toEqual([`p1.${A}.md`, `_meta.${A}.md`]);
    expect(readDot(a.ids()[1])?.device).toBe(A);
    // Nothing more changed: nothing more is written.
    expect(a.save()).toEqual([]);
    // Read back from the files: the same notebook, and still nothing to write.
    a.open();
    expect(a.ids()).toEqual(["s1", `${A}.1`]);
    expect(a.save()).toEqual([]);
  });

  it("keeps both devices' ink written at once on one page", () => {
    const [a, b] = twoDevices();
    a.doc.pages[0].strokes.push(stroke(a.doc, 100));
    b.doc.pages[0].strokes.push(stroke(b.doc, 200));
    a.save();
    b.save();
    a.pull(b).open();
    b.pull(a).open();
    expect(a.ids()).toEqual(["s1", `${A}.1`, `${B}.1`]);
    expect(b.ids()).toEqual(a.ids());
  });

  it("erases the legacy notebook's ink and another device's with a tombstone, its own without", () => {
    const [a, b] = twoDevices();
    a.doc.pages[0].strokes.push(stroke(a.doc), stroke(a.doc, 50));
    a.save();
    b.pull(a).open();
    // B erases the legacy stroke and one of A's.
    b.doc.pages[0].strokes = b.doc.pages[0].strokes.filter((s) => s.id === `${A}.2`);
    b.save();
    a.pull(b).open();
    expect(a.ids()).toEqual([`${A}.2`]);
    // A erases its own: it just leaves A's file.
    a.doc.pages[0].strokes = [];
    a.save();
    const file = a.folder.get(`p1.${A}.md`) ?? "";
    b.pull(a).open();
    expect(b.ids()).toEqual([]);
    expect(file.length).toBeGreaterThan(0);
  });

  it("lets an edit made elsewhere beat an erase made at once", () => {
    const [a, b] = twoDevices();
    a.doc.pages[0].strokes.push(stroke(a.doc));
    a.save();
    b.pull(a).open();
    // A erases its stroke while B moves it.
    a.doc.pages[0].strokes = a.doc.pages[0].strokes.filter((s) => s.id === "s1");
    a.save();
    b.doc.pages[0].strokes[1].pts = [500, 500, 0.5, 520, 520, 0.5];
    b.save();
    a.pull(b).open();
    b.pull(a).open();
    expect(a.ids()).toEqual(["s1", `${A}.1`]);
    expect(a.doc.pages[0].strokes[1].pts[0]).toBe(500);
    expect(b.ids()).toEqual(a.ids());
  });

  it("takes the newer of two edits of one element, the one made after seeing the other", () => {
    const [a, b] = twoDevices();
    a.doc.pages[0].strokes.push(stroke(a.doc));
    a.save();
    b.pull(a).open();
    b.doc.pages[0].strokes[1].color = "#ff0000";
    b.save();
    a.pull(b).open();
    expect(a.doc.pages[0].strokes[1].color).toBe("#ff0000");
    a.doc.pages[0].strokes[1].color = "#00ff00";
    a.save();
    b.pull(a).open();
    expect(b.doc.pages[0].strokes[1].color).toBe("#00ff00");
  });

  it("keeps pages two devices add at once, and drops one deleted", () => {
    const [a, b] = twoDevices();
    a.doc.pages.push(blankPage(nextPageId(a.doc)));
    b.doc.pages.splice(1, 0, blankPage(nextPageId(b.doc)));
    a.save();
    b.save();
    a.pull(b).open();
    expect(a.doc.pages.map((p) => p.id)).toEqual(["p1", `${B}.1`, "p2", `${A}.1`]);
    // A deletes p2: gone on B too.
    a.doc.pages = a.doc.pages.filter((p) => p.id !== "p2");
    a.save();
    b.pull(a).open();
    expect(b.doc.pages.map((p) => p.id)).toEqual(["p1", `${B}.1`, `${A}.1`]);
  });

  it("moves a page with a new key for it alone", () => {
    const [a, b] = twoDevices();
    a.doc.pages.push(blankPage(nextPageId(a.doc)));
    a.save();
    a.open();
    const last = a.doc.pages.pop() as InkDocument["pages"][number];
    a.doc.pages.unshift(last);
    a.save();
    b.pull(a).open();
    expect(b.doc.pages.map((p) => p.id)).toEqual([`${A}.1`, "p1", "p2"]);
  });

  it("carries a page's fields and the notebook's settings", () => {
    const [a, b] = twoDevices();
    a.doc.pages[1].title = "Waves";
    a.doc.joined = true;
    a.save();
    b.pull(a).open();
    expect(b.doc.pages[1].title).toBe("Waves");
    expect(b.doc.joined).toBe(true);
    // Scrolling alone is this device's: it moves no clock.
    const before = b.writer.settingsClock;
    b.doc.view.scrollY = 900;
    b.save();
    expect(b.writer.settingsClock).toBe(before);
  });

  it("marks a copy behind its meta as still syncing, and never loses ink from it", () => {
    const [a, b] = twoDevices();
    a.doc.pages[0].strokes.push(stroke(a.doc));
    a.save();
    b.pull(a);
    const old = a.folder.get(`p1.${A}.md`) ?? "";
    a.doc.pages[0].strokes.push(stroke(a.doc, 60));
    a.save();
    // B gets A's new meta, but its page file is the old one.
    b.pull(a, [`_meta.${A}.md`]);
    b.folder.set(`p1.${A}.md`, old);
    b.open();
    expect(b.syncing).toBe(true);
    expect(b.ids()).toEqual(["s1", `${A}.1`]);
    b.pull(a).open();
    expect(b.syncing).toBe(false);
    expect(b.ids()).toEqual(a.ids());
    expect(b.ids()).toHaveLength(3);
  });

  it("looks only at the pages named as changed, unless none are named", () => {
    const [a] = twoDevices();
    a.doc.pages[1].strokes.push(stroke(a.doc));
    // A change not named is not seen...
    expect(a.writer.save(a.doc, new Set(["p1"]))).toEqual([]);
    // ...until it is named, or a save looks at everything.
    expect(a.writer.save(a.doc, new Set(["p2"])).map((w) => w.name)).toEqual([
      `p2.${A}.md`,
      `_meta.${A}.md`,
    ]);
    a.doc.pages[0].strokes.push(stroke(a.doc));
    expect(a.writer.save(a.doc, null).map((w) => w.name)).toEqual([`p1.${A}.md`, `_meta.${A}.md`]);
    // A page moved is placed again even when not named.
    a.doc.pages.reverse();
    const writes = a.writer.save(a.doc, new Set());
    expect(writes.map((w) => w.name)).toEqual([`_meta.${A}.md`]);
  });

  it("repairs its meta after a crash between a page file and the meta", () => {
    const [a] = twoDevices();
    a.doc.pages[0].strokes.push(stroke(a.doc));
    a.save();
    const metaBefore = a.folder.get(`_meta.${A}.md`) ?? "";
    a.doc.pages[1].strokes.push(stroke(a.doc));
    // The page file is written, then the app dies before the meta.
    const writes = a.writer.save(a.doc);
    for (const w of writes) if (!w.name.startsWith("_meta")) a.folder.set(w.name, w.text);
    expect(a.folder.get(`_meta.${A}.md`)).toBe(metaBefore);
    // Reopened: nothing lost, and the next save writes the meta that matches the files.
    a.open();
    expect(a.ids(1)).toHaveLength(1);
    expect(a.save()).toEqual([`_meta.${A}.md`]);
    const b = new Device(B, a.payload).pull(a).open();
    expect(b.syncing).toBe(false);
    expect(b.ids(1)).toEqual(a.ids(1));
    expect(a.save()).toEqual([]);
  });

  it("drops an erase record once no other copy holds what it erased", () => {
    const [a, b] = twoDevices();
    a.doc.pages[0].strokes.push(stroke(a.doc), stroke(a.doc, 60));
    a.save();
    b.pull(a).open();
    // B erases one of A's strokes, and the legacy stroke: two records.
    b.doc.pages[0].strokes = b.doc.pages[0].strokes.filter((s) => s.id === `${A}.2`);
    b.save();
    const records = (d: Device) => {
      const text = d.folder.get(`p1.${d.id}.md`) ?? "";
      const page = readPageFile(text, d.id);
      return typeof page === "string" ? [] : page.tomb.map((t) => t.id).sort();
    };
    expect(records(b)).toEqual([`${A}.1`, "s1"]);
    // A sees the erase and writes the page again: its file no longer holds the stroke.
    a.pull(b).open();
    a.doc.pages[0].strokes.push(stroke(a.doc, 90));
    a.save();
    // B, reading that, keeps only the record the legacy notebook still needs.
    b.pull(a).open();
    b.doc.pages[0].strokes.push(stroke(b.doc, 120));
    b.save();
    expect(records(b)).toEqual(["s1"]);
    // Nothing came back.
    b.open();
    expect(b.ids()).not.toContain(`${A}.1`);
    expect(b.ids()).not.toContain("s1");
    a.pull(b).open();
    expect(a.ids()).toEqual(b.ids());
  });

  it("names a page file by its id when safe, else by a hash of it", () => {
    expect(pageFileName("p1", A)).toBe(`p1.${A}.md`);
    expect(pageFileName(`${A}.3`, B)).toBe(`${A}.3.${B}.md`);
    expect(pageFileName("P1", A)).toMatch(new RegExp(`^page-[0-9a-f]{16}\\.${A}\\.md$`));
    expect(pageFileName("../x", A)).not.toBe(pageFileName("../y", A));
    expect(pageFileName("_meta", A)).not.toBe(`_meta.${A}.md`);
  });

  it("counts on from its own dots after reopening, so ids never repeat", () => {
    const payload = legacyPayload(legacyDoc(), "n7k2q9ab");
    const a = new Device(A, payload).open();
    a.doc.pages[0].strokes.push(stroke(a.doc), stroke(a.doc));
    a.save();
    // A new install of the same device id (local storage kept, clock lost).
    const again = new Device(A, payload);
    again.folder = new Map(a.folder);
    again.open();
    const next = stroke(again.doc);
    expect(a.ids()).not.toContain(next.id);
    expect(readDot(next.id)?.counter).toBeGreaterThan(2);
  });

  it("keeps the legacy payload a whole notebook any reader of the old label could decode", () => {
    const doc = decodeDocument(
      legacyPayload(legacyDoc(), "n7k2q9ab").replace("+device-pages=n7k2q9ab", ""),
    );
    expect(doc.pages).toHaveLength(2);
  });
});

describe("PDF tabs and recordings on two devices (#274)", () => {
  /** A notebook with a PDF tab "b1" whose first PDF page has a stroke, and one recording. */
  function withTab(): InkDocument {
    const doc = legacyDoc();
    const tab: BesidePdf = { id: "b1", path: "Slides.pdf", sizes: [[600, 800, 3]], marks: [] };
    const page = besidePage(tab, 0, { width: 600, height: 800 });
    page.strokes.push({
      id: "s9",
      tool: "pen",
      color: "#111",
      size: 3,
      pts: [1, 2, 0.5, 3, 4, 0.5],
    } as Stroke);
    tab.marks.push(page);
    doc.beside = [tab];
    doc.recordings = [{ id: "r1", path: "a.webm", start: 1_700_000_000_000, duration: 1000 }];
    return doc;
  }

  function devices(): [Device, Device] {
    const payload = legacyPayload(withTab(), "n7k2q9ab");
    return [new Device(A, payload).open(), new Device(B, payload).open()];
  }

  const tabInk = (d: Device, tab = 0, page = 0) =>
    (d.doc.beside?.[tab]?.marks[page]?.strokes ?? []).map((s) => s.id);

  it("reads a notebook's PDF tabs, their ink and its recordings back as they were", () => {
    const [a] = devices();
    expect(a.doc.beside?.map((t) => t.id)).toEqual(["b1"]);
    expect(tabInk(a)).toEqual(["s9"]);
    expect(a.doc.recordings?.map((r) => r.id)).toEqual(["r1"]);
    expect(a.save()).toEqual([]);
  });

  it("keeps both devices' ink written at once on one PDF page", () => {
    const [a, b] = devices();
    const on = (d: Device) => d.doc.beside?.[0]?.marks[0] as Page;
    on(a).strokes.push(stroke(a.doc));
    on(b).strokes.push(stroke(b.doc));
    a.save();
    b.save();
    a.pull(b).open();
    b.pull(a).open();
    expect(tabInk(a)).toEqual(["s9", `${A}.1`, `${B}.1`]);
    expect(tabInk(b)).toEqual(tabInk(a));
    // An erase on the tab reaches the other device.
    on(b).strokes = on(b).strokes.filter((s) => s.id !== "s9");
    b.save();
    a.pull(b).open();
    expect(tabInk(a)).toEqual([`${A}.1`, `${B}.1`]);
  });

  it("keeps PDF tabs and recordings two devices add at once, with ids that never collide", () => {
    const [a, b] = devices();
    const tabA = attachPdf(a.doc, "A.pdf", [[600, 800, 2]]);
    const tabB = attachPdf(b.doc, "B.pdf", [[600, 800, 2]]);
    expect(tabA.id).not.toBe(tabB.id);
    expect(isTabId(tabA.id) && isTabId(tabB.id)).toBe(true);
    (a.doc.recordings ??= []).push({
      id: nextRecordingId(a.doc.recordings, a.doc),
      path: "x.webm",
      start: 1_700_000_000_001,
      duration: 5,
    });
    (b.doc.recordings ??= []).push({
      id: nextRecordingId(b.doc.recordings, b.doc),
      path: "y.webm",
      start: 1_700_000_000_002,
      duration: 5,
    });
    a.save();
    b.save();
    a.pull(b).open();
    b.pull(a).open();
    expect(a.doc.beside?.map((t) => t.path).sort()).toEqual(["A.pdf", "B.pdf", "Slides.pdf"]);
    expect(a.doc.recordings?.map((r) => r.path).sort()).toEqual(["a.webm", "x.webm", "y.webm"]);
    expect(b.doc.beside?.map((t) => t.id)).toEqual(a.doc.beside?.map((t) => t.id));
  });
});
