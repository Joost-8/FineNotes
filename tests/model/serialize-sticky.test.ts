/**
 * Sticky notes on disk: the ink lives inside its note, in the note's own
 * space; the notebook is labelled `v2+sticky:` so an older FineNotes refuses
 * it (and holds it read-only) instead of saving it back without the ink.
 */

import { describe, expect, it } from "vitest";
import { inflateFromBase64 } from "../../src/model/compress";
import { type ImageElement, type InkDocument, emptyDocument } from "../../src/model/document";
import { FragmentStore } from "../../src/model/fragment-store";
import {
  DocumentEncoder,
  SerializeError,
  buildInkFile,
  decodeDocument,
  encodeDocument,
  parseInkFile,
} from "../../src/model/serialize";
import { applyAffine, newStickyNote, noteToPage } from "../../src/model/sticky-notes";
import { distrust } from "../../src/view/load-guard";
import { deflateToBase64 } from "../../src/model/compress";

function withNote(extra: Partial<ImageElement> = {}): InkDocument {
  const doc = emptyDocument(1024);
  const note = { ...newStickyNote("i3", { x: 100, y: 200, w: 240, h: 200 }, "#fde68a"), ...extra };
  doc.pages[0].images.push({ id: "i1", path: "cell.png", x: 0, y: 0, w: 50, h: 50 }, note);
  const m = noteToPage(note);
  const a = applyAffine(m, 20, 30);
  const b = applyAffine(m, 120, 60);
  doc.pages[0].strokes.push(
    { id: "s1", color: "#1a1a1a", size: 3, tool: "pen", pts: [5, 5, 0.5, 9, 9, 0.5] },
    {
      id: "s2",
      color: "#c0392b",
      size: 2,
      tool: "pen",
      pts: [a.x, a.y, 0.5, b.x, b.y, 0.6],
      t0: 120,
      onSticky: "i3",
    },
    {
      id: "s3",
      color: "#fde047",
      size: 12,
      tool: "highlighter",
      pts: [a.x, b.y, 0.5, b.x, b.y, 0.5],
      onSticky: "i3",
    },
  );
  return doc;
}

/** The stored JSON of a payload. */
function stored(payload: string): Record<string, unknown> {
  return JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as Record<
    string,
    unknown
  >;
}

/** How every reader since 2.0 checked a payload's label. */
function olderReaderAccepts(payload: string): boolean {
  const colon = payload.indexOf(":");
  return payload.startsWith("v") && Number.isFinite(Number(payload.slice(1, colon)));
}

describe("a notebook with a sticky note, saved", () => {
  it("is labelled v2+sticky, which no older reader accepts", () => {
    const payload = encodeDocument(withNote());
    expect(payload.startsWith("v2+sticky:")).toBe(true);
    expect(olderReaderAccepts(payload)).toBe(false);
    expect(stored(payload).requires).toEqual(["sticky"]);
  });

  it("keeps the plain v2 label, and no `requires`, without notes", () => {
    const doc = withNote();
    doc.pages[0].images.pop();
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2:")).toBe(true);
    expect(olderReaderAccepts(payload)).toBe(true);
    expect("requires" in stored(payload)).toBe(false);
  });

  it("is labelled so even when its note carries no ink", () => {
    const doc = withNote();
    doc.pages[0].strokes = doc.pages[0].strokes.filter((s) => !s.onSticky);
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2+sticky:")).toBe(true);
    const page = (stored(payload).pages as Array<{ images: Array<Record<string, unknown>> }>)[0];
    expect(page.images[1].sticky).toEqual({ color: "#fde68a" });
  });

  it("stores the note's ink inside it, in the note's own space, and not as page ink", () => {
    const doc = withNote({ rotation: 0.6, flipY: true });
    const page = (stored(encodeDocument(doc)).pages as Array<Record<string, unknown>>)[0];
    const strokes = page.strokes as Array<{ id: string }>;
    expect(strokes.map((s) => s.id)).toEqual(["s1"]);
    const images = page.images as Array<Record<string, unknown>>;
    expect(images[0]).toEqual({ id: "i1", path: "cell.png", x: 0, y: 0, w: 50, h: 50 });
    const sticky = images[1].sticky as { color: string; ink: Array<Record<string, unknown>> };
    expect(sticky.color).toBe("#fde68a");
    expect(sticky.ink.map((s) => s.id)).toEqual(["s2", "s3"]);
    // Hundredths of a note px from the note's top-left, before its turn and flip.
    expect((sticky.ink[0].pts as number[]).slice(0, 2)).toEqual([2000, 3000]);
    expect(sticky.ink[0].t0).toBe(120);
    expect("onSticky" in sticky.ink[0]).toBe(false);
  });

  it("opens with the ink back on the page, on its note, where it was", () => {
    const doc = withNote({ rotation: -1.1, flipX: true });
    const page = decodeDocument(encodeDocument(doc)).pages[0];
    const byId = new Map(page.strokes.map((s) => [s.id, s]));
    expect(page.strokes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(byId.get("s1")?.onSticky).toBeUndefined();
    for (const id of ["s2", "s3"]) {
      const was = doc.pages[0].strokes.find((s) => s.id === id);
      const now = byId.get(id);
      expect(now?.onSticky).toBe("i3");
      expect(now?.tool).toBe(was?.tool);
      now?.pts.forEach((v, i) => expect(v).toBeCloseTo(was?.pts[i] ?? NaN, 2));
    }
    expect(page.images[1]).toEqual({
      id: "i3",
      path: "",
      x: 100,
      y: 200,
      w: 240,
      h: 200,
      rotation: -1.1,
      flipX: true,
      front: true,
      sticky: { color: "#fde68a" },
    });
  });

  it("saves back to the same bytes once read (a turned note's ink does not drift)", () => {
    // The first save follows this test's own key order; from the first read on, the loader's.
    const read = encodeDocument(
      decodeDocument(encodeDocument(withNote({ rotation: 0.3729, flipX: true }))),
    );
    let again = read;
    for (let i = 0; i < 3; i++) again = encodeDocument(decodeDocument(again));
    expect(again).toBe(read);
  });

  it("writes ink naming a note that is not on its page as plain page ink", () => {
    const doc = withNote();
    doc.pages[0].strokes[1].onSticky = "i99";
    const page = decodeDocument(encodeDocument(doc)).pages[0];
    expect(page.strokes.find((s) => s.id === "s2")?.onSticky).toBeUndefined();
    expect(page.strokes.find((s) => s.id === "s3")?.onSticky).toBe("i3");
  });

  it("saves the same through the view's encoder and the save worker", () => {
    const doc = withNote({ rotation: 0.2 });
    const encoder = new DocumentEncoder();
    const payload = encoder.encode(doc);
    expect(payload.startsWith("v2+sticky:")).toBe(true);
    expect(decodeDocument(payload)).toEqual(decodeDocument(encodeDocument(doc)));
    const snapshot = encoder.snapshot(doc);
    const store = new FragmentStore();
    store.put(
      snapshot.pages.map((p) => p.slot),
      snapshot.pages.map((p) => p.json),
    );
    const fromWorker = store.compress(
      snapshot.head,
      snapshot.pages.map((p) => p.slot),
    );
    expect(fromWorker.startsWith("v2+sticky:")).toBe(true);
    expect(stored(fromWorker)).toEqual(stored(payload));
  });

  it("is handed back unchanged by the encoder while nothing changes", () => {
    const onDisk = encodeDocument(withNote());
    const encoder = new DocumentEncoder();
    encoder.remember(onDisk);
    expect(encoder.encode(decodeDocument(onDisk))).toBe(onDisk);
    expect(encoder.reused).toBe(true);
  });
});

describe("reading a sticky note", () => {
  function payload(json: unknown, label = "v2+sticky"): string {
    return `${label}:${deflateToBase64(JSON.stringify(json))}`;
  }
  const view = { scrollY: 0, width: 1024, scale: 1 };

  it("needs no path, and drops a crop it has no use for", () => {
    const doc = decodeDocument(
      payload({
        version: 2,
        view,
        pages: [
          {
            id: "p1",
            images: [
              { id: "i1", path: "x.png", x: 0, y: 0, w: 9, h: 9, sticky: { color: "#bbf7d0" } },
              {
                id: "i2",
                x: 0,
                y: 0,
                w: 9,
                h: 9,
                crop: { x: 0.1, y: 0, w: 0.5, h: 1 },
                sticky: { color: "#bbf7d0" },
              },
            ],
            strokes: [],
          },
        ],
      }),
    );
    const [a, b] = doc.pages[0].images;
    expect(a.path).toBe("");
    expect(b.path).toBe("");
    expect("crop" in b).toBe(false);
  });

  it("drops a pathless image whose paper cannot be read, as any pathless picture", () => {
    const doc = decodeDocument(
      payload({
        version: 2,
        view,
        pages: [{ id: "p1", images: [{ id: "i1", x: 0, y: 0, w: 9, h: 9, sticky: {} }] }],
      }),
    );
    expect(doc.pages[0].images).toEqual([]);
  });

  it("gives ink to the first of two notes sharing an id only, and skips junk ink", () => {
    const ink = [{ id: "s1", color: "#000000", size: 2, tool: "pen", pts: [100, 200, 128] }, 7];
    const doc = decodeDocument(
      payload({
        version: 2,
        view,
        pages: [
          {
            id: "p1",
            images: [
              { id: "i1", x: 10, y: 20, w: 9, h: 9, sticky: { color: "#bbf7d0", ink } },
              { id: "i1", x: 50, y: 60, w: 9, h: 9, sticky: { color: "#bbf7d0", ink } },
              { id: "i2", x: 0, y: 0, w: 9, h: 9, sticky: { color: "#bbf7d0", ink: "no" } },
            ],
            strokes: [],
          },
        ],
      }),
    );
    const strokes = doc.pages[0].strokes;
    expect(strokes).toHaveLength(1);
    expect(strokes[0].pts).toEqual([11, 22, 128 / 255]);
    expect(strokes[0].onSticky).toBe("i1");
  });

  it("refuses a payload needing a feature this build lacks, which the view holds read-only", () => {
    const text = buildInkFile("", emptyDocument()).replace("v2:", "v2+sticky+holograms:");
    expect(() => decodeDocument(text.split("\n")[1])).toThrow(SerializeError);
    expect(() => decodeDocument(text.split("\n")[1])).toThrow(/needs a newer FineNotes/);
    const parsed = parseInkFile(text);
    expect(parsed.doc).toBeNull();
    expect(distrust({ text, bytesOnDisk: text.length, decoded: parsed.doc !== null })).toBe(
      "unreadable-ink",
    );
  });

  it("is what an older build sees as unreadable ink: refused, and held", () => {
    const text = buildInkFile("Prose.", withNote());
    // The old check, applied to the label this build writes.
    const block = text.split("\n").find((line) => line.startsWith("v2"));
    expect(block && olderReaderAccepts(block)).toBe(false);
    expect(distrust({ text, bytesOnDisk: text.length, decoded: false })).toBe("unreadable-ink");
    // This build reads it.
    expect(parseInkFile(text).doc?.pages[0].images[1].sticky).toEqual({ color: "#fde68a" });
  });
});
