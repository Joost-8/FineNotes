/**
 * Decoding and encoding cases for the page model: the v1 migration, pages,
 * backdrops, images, text boxes, shapes and stroke timestamps. The general
 * wire rules are in `wire-format.test.ts`, the exact bytes in the goldens.
 */

import { describe, expect, it } from "vitest";
import { deflateToBase64 } from "../../src/model/compress";
import { type InkDocument, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

/** Wrap raw JSON the way a v1 (pre-page) note stored it. */
const v1Payload = (value: unknown): string => "v1:" + deflateToBase64(JSON.stringify(value));

describe("v1 -> v2 migration", () => {
  const legacy = {
    version: 1,
    view: { scrollY: 0, width: 1024, scale: 1 },
    regions: [
      {
        id: "r1",
        kind: "ink",
        strokes: [{ id: "s1", color: "#111111", size: 3, tool: "pen", pts: [1000, 2000, 128] }],
      },
    ],
  };

  it("turns each v1 region into a page with a blank backdrop and no images", () => {
    const doc = decodeDocument(v1Payload(legacy));
    expect(doc.version).toBe(2);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].backdrop).toEqual({ kind: "blank" });
    expect(doc.pages[0].images).toEqual([]);
  });

  it("preserves every v1 stroke exactly", () => {
    const doc = decodeDocument(v1Payload(legacy));
    const s = doc.pages[0].strokes[0];
    expect(s.id).toBe("s1");
    expect(s.color).toBe("#111111");
    expect(s.pts[0]).toBeCloseTo(10, 5);
    expect(s.pts[1]).toBeCloseTo(20, 5);
  });

  it("grows the migrated page so ink below the default height is not cropped", () => {
    // A stroke at y=1900 sits below DEFAULT_PAGE_HEIGHT (1448); the migrated
    // page must be tall enough to still contain it, or the user silently
    // loses the bottom of an old note.
    const deep = {
      ...legacy,
      regions: [
        {
          id: "r1",
          kind: "ink",
          strokes: [{ id: "s1", color: "#111", size: 3, tool: "pen", pts: [100, 190000, 128] }],
        },
      ],
    };
    const doc = decodeDocument(v1Payload(deep));
    expect(doc.pages[0].geometry.height).toBeGreaterThan(1900);
  });

  it("uses the default page height when the v1 ink is short", () => {
    expect(decodeDocument(v1Payload(legacy)).pages[0].geometry.height).toBe(1448);
  });
});

describe("v2 pages, backdrops, images and shapes", () => {
  function pageDoc(overrides: Record<string, unknown>): InkDocument {
    const doc = emptyDocument(1024);
    Object.assign(doc.pages[0], overrides);
    return doc;
  }

  it("round-trips a lined backdrop with spacing and colour", () => {
    const doc = pageDoc({ backdrop: { kind: "lined", spacing: 36, color: "#eeeeee" } });
    expect(decodeDocument(encodeDocument(doc)).pages[0].backdrop).toEqual({
      kind: "lined",
      spacing: 36,
      color: "#eeeeee",
    });
  });

  it("round-trips a PDF backdrop by path and page index", () => {
    const doc = pageDoc({ backdrop: { kind: "pdf", path: "Lectures/w3.pdf", page: 4 } });
    expect(decodeDocument(encodeDocument(doc)).pages[0].backdrop).toEqual({
      kind: "pdf",
      path: "Lectures/w3.pdf",
      page: 4,
    });
  });

  it("falls back to blank rather than dropping a page whose PDF path is missing", () => {
    const payload = `v2:${deflateToBase64(
      JSON.stringify({
        version: 2,
        view: { scrollY: 0, width: 1024, scale: 1 },
        pages: [
          { id: "p1", kind: "ink", backdrop: { kind: "pdf" }, strokes: [{ pts: [0, 0, 100] }] },
        ],
      }),
    )}`;
    const doc = decodeDocument(payload);
    expect(doc.pages[0].backdrop).toEqual({ kind: "blank" });
    expect(doc.pages[0].strokes).toHaveLength(1);
  });

  it("round-trips images including rotation, and drops pathless ones", () => {
    const doc = pageDoc({
      images: [
        { id: "i1", path: "a.png", x: 10, y: 20, w: 100, h: 50, rotation: 0.25 },
        { id: "i2", path: "b.png", x: 0, y: 0, w: 10, h: 10 },
      ],
    });
    const out = decodeDocument(encodeDocument(doc)).pages[0].images;
    expect(out).toHaveLength(2);
    expect(out[0].rotation).toBeCloseTo(0.25, 5);
    expect(out[1].rotation).toBeUndefined();
  });

  it("round-trips page text boxes and drops malformed entries", () => {
    const doc = pageDoc({
      textBoxes: [
        { id: "t1", x: 12, y: 30, w: 280, text: "Hello", color: "#1971c2", fontSize: 22 },
        { id: "bad", x: 0, y: 0 },
      ],
    });
    const out = decodeDocument(encodeDocument(doc)).pages[0].textBoxes;
    expect(out).toEqual([
      { id: "t1", x: 12, y: 30, w: 280, text: "Hello", color: "#1971c2", fontSize: 22 },
    ]);
  });

  it("keeps a dragged text-box height and drops a nonsense one", () => {
    const base = { x: 0, y: 0, w: 200, text: "", color: "#000", fontSize: 22 };
    const doc = pageDoc({
      textBoxes: [
        { id: "t1", ...base, h: 140 },
        { id: "t2", ...base, h: -5 },
        { id: "t3", ...base, h: "tall" },
      ],
    });
    const out = decodeDocument(encodeDocument(doc)).pages[0].textBoxes;
    expect(out[0].h).toBe(140);
    expect("h" in out[1]).toBe(false);
    expect("h" in out[2]).toBe(false);
  });

  it("round-trips a fitted text box at its narrow width, and only `fit: true`", () => {
    const base = { x: 0, y: 0, text: "Hi", color: "#000", fontSize: 22 };
    const doc = pageDoc({
      textBoxes: [
        { id: "t1", ...base, w: 40, fit: true },
        { id: "t2", ...base, w: 40, fit: "yes" },
        { id: "t3", ...base, w: 40, fit: false },
      ],
    });
    const out = decodeDocument(encodeDocument(doc)).pages[0].textBoxes;
    expect(out[0]).toMatchObject({ w: 40, fit: true });
    // Not fitted: the old floor applies, and no flag is invented.
    expect(out[1].w).toBe(80);
    expect("fit" in out[1]).toBe(false);
    expect("fit" in out[2]).toBe(false);
  });

  it("round-trips a snapped stroke's shape kind and ignores an unknown one", () => {
    const doc = pageDoc({
      strokes: [
        { id: "s1", color: "#000", size: 3, tool: "pen", pts: [0, 0, 128], shape: "circle" },
        { id: "s2", color: "#000", size: 3, tool: "pen", pts: [0, 0, 128], shape: "hexagon" },
      ],
    });
    const out = decodeDocument(encodeDocument(doc)).pages[0].strokes;
    expect(out[0].shape).toBe("circle");
    expect(out[1].shape).toBeUndefined();
  });

  it("round-trips several pages in order", () => {
    const doc = emptyDocument(1024);
    doc.pages.push({
      id: "p2",
      kind: "ink",
      geometry: { width: 1024, height: 1448 },
      backdrop: { kind: "grid", spacing: 32 },
      strokes: [],
      images: [],
      textBoxes: [],
    });
    const out = decodeDocument(encodeDocument(doc));
    expect(out.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(out.pages[1].backdrop).toEqual({ kind: "grid", spacing: 32 });
  });
});

describe("per-stroke t0 timestamp", () => {
  function pageDoc(strokes: unknown): InkDocument {
    const doc = emptyDocument(1024);
    Object.assign(doc.pages[0], { strokes });
    return doc;
  }

  it("round-trips t0 and rounds it to an integer", () => {
    const out = decodeDocument(
      encodeDocument(
        pageDoc([{ id: "s1", color: "#000", size: 3, tool: "pen", pts: [0, 0, 128], t0: 1234.7 }]),
      ),
    ).pages[0].strokes[0];
    expect(out.t0).toBe(1235);
  });

  it("omits t0 rather than writing 0 — absent means unknown, not 'at the start'", () => {
    const out = decodeDocument(
      encodeDocument(
        pageDoc([{ id: "s1", color: "#000", size: 3, tool: "pen", pts: [0, 0, 128] }]),
      ),
    ).pages[0].strokes[0];
    expect(out.t0).toBeUndefined();
    expect("t0" in out).toBe(false);
  });

  it("rejects a negative or non-finite t0", () => {
    const strokes = [
      { id: "s1", color: "#000", size: 3, tool: "pen", pts: [0, 0, 128], t0: -5 },
      { id: "s2", color: "#000", size: 3, tool: "pen", pts: [0, 0, 128], t0: "soon" },
    ];
    const out = decodeDocument(encodeDocument(pageDoc(strokes))).pages[0].strokes;
    expect(out[0].t0).toBeUndefined();
    expect(out[1].t0).toBeUndefined();
  });

  it("keeps t0 through a v1 document's migration", () => {
    const payload = `v1:${deflateToBase64(
      JSON.stringify({
        version: 1,
        view: { scrollY: 0, width: 1024, scale: 1 },
        regions: [{ id: "r1", strokes: [{ id: "s1", pts: [0, 0, 128], t0: 900 }] }],
      }),
    )}`;
    expect(decodeDocument(payload).pages[0].strokes[0].t0).toBe(900);
  });
});
