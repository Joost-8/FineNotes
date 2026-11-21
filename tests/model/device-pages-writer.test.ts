import { describe, expect, it } from "vitest";
import {
  DevicePagesWriter,
  legacyPayload,
  movedNotebook,
  pageFileName,
  randomId,
  withNotebookId,
} from "../../src/model/device-pages-writer";
import { notebookIdOf, readDevicePagesNotebook } from "../../src/model/device-pages";
import { DotClock, attachDotClock, mintedId } from "../../src/model/dot-ids";
import { blankPage, emptyDocument, type InkDocument, type Stroke } from "../../src/model/document";
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
  const payload = legacyPayload(legacyDoc());
  return [new Device(A, payload).open(), new Device(B, payload).open()];
}

describe("two devices moving one notebook at once (#274)", () => {
  it("make the same notebook file, so Sync has nothing to merge", () => {
    const body = "---\ntags: [x]\n---\n# Lecture";
    const loaded = encodeDocument(legacyDoc());
    const path = "Uni/Lecture.notebook.md";
    // Each device made its own edit before its first save: the move is still the same.
    const onLaptop = movedNotebook(path, body, loaded) as NonNullable<
      ReturnType<typeof movedNotebook>
    >;
    const onIpad = movedNotebook(path, body, loaded);
    expect(onIpad).toEqual(onLaptop);
    expect(onLaptop.id).toMatch(/^[a-z0-9]{8}$/);
    // Another notebook (another path or content) gets another id.
    expect(movedNotebook("Uni/Other.notebook.md", body, loaded)?.id).not.toBe(onLaptop.id);
    // The legacy payload is the loaded one, relabelled: it reads back as it was.
    expect(onLaptop.payload.startsWith("v2+device-pages:")).toBe(true);
    const back = readDevicePagesNotebook(onLaptop.payload, new Map()).doc;
    expect(encodeDocument(back)).toBe(loaded);
    expect(notebookIdOf(onLaptop.body)).toBe(onLaptop.id);
  });

  it("keep a label's other features when relabelling", () => {
    const doc = legacyDoc();
    doc.pages[1].board = true;
    const moved = movedNotebook("a.notebook.md", "", encodeDocument(doc));
    expect(moved?.payload.startsWith("v2+boards+device-pages:")).toBe(true);
  });
});

describe("moving a notebook to the layout (#274)", () => {
  it("keeps the notebook whole as its legacy payload, and writes nothing until it changes", () => {
    const doc = legacyDoc();
    const payload = legacyPayload(doc);
    expect(payload.startsWith("v2+device-pages:")).toBe(true);
    const back = readDevicePagesNotebook(payload, new Map());
    expect(back.doc.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    const clock = new DotClock(A);
    attachDotClock(back.doc, clock);
    const fresh = DevicePagesWriter.fresh(A, clock, back.doc);
    expect(fresh.save(back.doc)).toEqual([]);
    const read = DevicePagesWriter.fromRead(A, clock, back.doc, back.sources, back.union);
    expect(read.save(back.doc)).toEqual([]);
  });

  it("puts the id in the frontmatter, made if need be", () => {
    expect(withNotebookId("# Hi", "n1")).toBe("---\nfinenotes-id: n1\n---\n# Hi");
    expect(withNotebookId("---\ntags: [a]\n---\n# Hi", "n1")).toBe(
      "---\ntags: [a]\nfinenotes-id: n1\n---\n# Hi",
    );
    expect(withNotebookId("---\nfinenotes-id: old\n---\n", "n1")).toBe(
      "---\nfinenotes-id: n1\n---\n",
    );
    expect(notebookIdOf(withNotebookId("---\na: 1\n---\nx", "ab12cd34"))).toBe("ab12cd34");
    const id = randomId();
    expect(id).toMatch(/^[a-z0-9]{8}$/);
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

  it("names a page file by its id when safe, else by a hash of it", () => {
    expect(pageFileName("p1", A)).toBe(`p1.${A}.md`);
    expect(pageFileName(`${A}.3`, B)).toBe(`${A}.3.${B}.md`);
    expect(pageFileName("P1", A)).toMatch(new RegExp(`^page-[0-9a-f]{16}\\.${A}\\.md$`));
    expect(pageFileName("../x", A)).not.toBe(pageFileName("../y", A));
    expect(pageFileName("_meta", A)).not.toBe(`_meta.${A}.md`);
  });

  it("counts on from its own dots after reopening, so ids never repeat", () => {
    const payload = legacyPayload(legacyDoc());
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
    const doc = decodeDocument(legacyPayload(legacyDoc()).replace("+device-pages", ""));
    expect(doc.pages).toHaveLength(2);
  });
});
