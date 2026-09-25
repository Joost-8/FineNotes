/**
 * `src/model/serialize.ts` against the six documents in `contracts/fixtures/`,
 * plus the degradation paths a real vault will eventually produce: an unknown
 * ruling written by a newer build, a PDF backdrop that lost its path, a
 * corrupt payload, and a document that has been hand-edited into nonsense.
 *
 * The rule under all of it (contracts/api.md §4, generalised): **never lose a
 * user's ink because something else about the page failed to parse.**
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deflateToBase64 } from "../../src/model/compress";
import {
  type InkDocument,
  type Page,
  type Stroke,
  emptyDocument,
  strokeCount,
} from "../../src/model/document";
import {
  SerializeError,
  buildInkFile,
  decodeDocument,
  encodeDocument,
  parseInkFile,
  quantizePts,
} from "../../src/model/serialize";
import { DEFAULT_PAGE_HEIGHT, PAPER_GROWTH_MARGIN, SCHEMA_VERSION } from "../../src/constants";

const FIXTURES = [
  "doc-v1-legacy",
  "doc-v2-empty",
  "doc-v2-three-pages",
  "doc-v2-pdf-backdrop",
  "doc-v2-images",
  "doc-v2-shapes",
] as const;

function raw(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`contracts/fixtures/${name}.json`, "utf8")) as Record<
    string,
    unknown
  >;
}

/**
 * Wrap a fixture object in the on-disk `v<n>:<base64>` envelope.
 *
 * The fixtures are *decoded* documents — `Stroke.pts` holds world-space floats,
 * exactly as `contracts/api.md` types them. The payload inside a
 * `%%goodobsidian%%` block holds the same points **quantized** (x/y at 1/100 px,
 * pressure at 1/255), so a fixture has to be quantized on its way in or every
 * coordinate arrives 100x too small. Worth knowing: base64-ing a fixture
 * straight into a note produces ink at 1% scale with no error anywhere.
 */
function payloadOf(value: unknown): string {
  const clone = JSON.parse(JSON.stringify(value ?? null)) as Record<string, unknown> | null;
  if (!clone || typeof clone !== "object") {
    return `v${SCHEMA_VERSION}:${deflateToBase64(JSON.stringify(value))}`;
  }
  for (const key of ["pages", "regions"]) {
    const list = clone[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const strokes = (entry as Record<string, unknown>).strokes;
      if (!Array.isArray(strokes)) continue;
      for (const stroke of strokes) {
        if (!stroke || typeof stroke !== "object") continue;
        const s = stroke as Record<string, unknown>;
        if (Array.isArray(s.pts)) s.pts = quantizePts(s.pts as number[]);
      }
    }
  }
  return `v${SCHEMA_VERSION}:${deflateToBase64(JSON.stringify(clone))}`;
}

function load(name: string): InkDocument {
  return decodeDocument(payloadOf(raw(name)));
}

describe("every contract fixture loads", () => {
  it.each(FIXTURES)("%s decodes to a valid document", (name) => {
    const doc = load(name);
    expect(doc.version).toBe(SCHEMA_VERSION);
    expect(doc.pages.length).toBeGreaterThan(0);
    for (const page of doc.pages) {
      expect(page.kind).toBe("ink");
      expect(page.geometry.width).toBeGreaterThan(0);
      expect(page.geometry.height).toBeGreaterThan(0);
      expect(Array.isArray(page.strokes)).toBe(true);
      expect(Array.isArray(page.images)).toBe(true);
      for (const stroke of page.strokes) {
        expect(stroke.pts.length % 3).toBe(0);
        expect(stroke.pts.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it.each(FIXTURES)("%s survives encode -> decode -> encode byte-for-byte", (name) => {
    const once = encodeDocument(load(name));
    const twice = encodeDocument(decodeDocument(once));
    expect(twice).toBe(once);
  });

  it.each(FIXTURES)("%s keeps every stroke through a round-trip", (name) => {
    const doc = load(name);
    const again = decodeDocument(encodeDocument(doc));
    expect(strokeCount(again)).toBe(strokeCount(doc));
    expect(again.pages.map((p) => p.strokes.map((s) => s.id))).toEqual(
      doc.pages.map((p) => p.strokes.map((s) => s.id)),
    );
  });

  it.each(FIXTURES)("%s round-trips through a whole .ink.md file", (name) => {
    const doc = load(name);
    const file = buildInkFile("# Lecture 3\n\nSome prose the user wrote.", doc);
    const parsed = parseInkFile(file);
    expect(parsed.body.trim()).toBe("# Lecture 3\n\nSome prose the user wrote.");
    expect(encodeDocument(parsed.doc!)).toBe(encodeDocument(doc));
  });
});

describe("doc-v1-legacy: the v1 -> v2 migration", () => {
  const v1 = raw("doc-v1-legacy");
  const regions = v1.regions as Array<{
    id: string;
    strokes: Array<{ id: string; pts: number[] }>;
  }>;
  const migrated = load("doc-v1-legacy");

  it("turns each region into exactly one page, in order", () => {
    expect(migrated.pages).toHaveLength(regions.length);
    expect(migrated.pages.map((p) => p.id)).toEqual(regions.map((r) => r.id));
  });

  it("is lossless for strokes — every id, and every coordinate to 1/100 px", () => {
    const originals = regions.flatMap((r) => r.strokes);
    const loaded = migrated.pages.flatMap((p) => p.strokes);
    expect(loaded.map((s) => s.id)).toEqual(originals.map((s) => s.id));
    for (let i = 0; i < originals.length; i++) {
      expect(loaded[i].pts).toHaveLength(originals[i].pts.length);
      for (let k = 0; k < originals[i].pts.length; k += 3) {
        expect(loaded[i].pts[k]).toBeCloseTo(originals[i].pts[k], 2);
        expect(loaded[i].pts[k + 1]).toBeCloseTo(originals[i].pts[k + 1], 2);
        expect(loaded[i].pts[k + 2]).toBeCloseTo(originals[i].pts[k + 2], 2);
      }
    }
  });

  it("gives every migrated page a blank backdrop and no images", () => {
    for (const page of migrated.pages) {
      expect(page.backdrop).toEqual({ kind: "blank" });
      expect(page.images).toEqual([]);
    }
  });

  it("takes the page width from the v1 view, per contracts/api.md §1", () => {
    const view = v1.view as { width: number };
    for (const page of migrated.pages) expect(page.geometry.width).toBe(view.width);
  });

  it("grows the page so ink below the default height is never cropped", () => {
    for (const page of migrated.pages) {
      let lowest = 0;
      for (const s of page.strokes) {
        for (let i = 1; i < s.pts.length; i += 3) lowest = Math.max(lowest, s.pts[i]);
      }
      expect(page.geometry.height).toBeGreaterThanOrEqual(lowest + PAPER_GROWTH_MARGIN - 1);
      expect(page.geometry.height).toBeGreaterThanOrEqual(DEFAULT_PAGE_HEIGHT);
    }
  });

  it("re-saves as v2 — there is no downgrade path", () => {
    expect(encodeDocument(migrated).startsWith(`v${SCHEMA_VERSION}:`)).toBe(true);
    expect(SCHEMA_VERSION).toBe(2);
  });

  it("a second load of the migrated document is a no-op", () => {
    const again = decodeDocument(encodeDocument(migrated));
    expect(JSON.stringify(again)).toBe(JSON.stringify(migrated));
  });
});

describe("doc-v2-shapes: shape kinds and t0 survive", () => {
  it("keeps each stroke's shape kind", () => {
    const doc = load("doc-v2-shapes");
    expect(doc.pages[0].strokes.map((s) => s.shape)).toEqual(["line", "rect", "circle", "arrow"]);
  });

  it("omits `shape` entirely on a freehand stroke rather than writing undefined", () => {
    const doc = load("doc-v2-empty");
    doc.pages[0].strokes.push({ id: "s1", color: "#000", size: 3, tool: "pen", pts: [0, 0, 0.5] });
    const stored = JSON.parse(
      JSON.stringify(decodeDocument(encodeDocument(doc)).pages[0].strokes[0]),
    ) as Record<string, unknown>;
    expect(Object.keys(stored)).not.toContain("shape");
  });

  it("carries t0 alongside a shape without either disturbing the other", () => {
    const doc = load("doc-v2-shapes");
    doc.pages[0].strokes[0].t0 = 0;
    doc.pages[0].strokes[1].t0 = 4321.6;
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].strokes[0].t0).toBe(0);
    expect(back.pages[0].strokes[0].shape).toBe("line");
    expect(back.pages[0].strokes[1].t0).toBe(4322);
    expect(back.pages[0].strokes[1].shape).toBe("rect");
  });

  it("t0 = 0 means 'at the very start' and is not confused with absent", () => {
    const doc = emptyDocument();
    const zero: Stroke = { id: "a", color: "#000", size: 3, tool: "pen", pts: [0, 0, 0.5], t0: 0 };
    const absent: Stroke = { id: "b", color: "#000", size: 3, tool: "pen", pts: [0, 0, 0.5] };
    doc.pages[0].strokes.push(zero, absent);
    const back = decodeDocument(encodeDocument(doc));
    expect(Object.prototype.hasOwnProperty.call(back.pages[0].strokes[0], "t0")).toBe(true);
    expect(back.pages[0].strokes[0].t0).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(back.pages[0].strokes[1], "t0")).toBe(false);
  });
});

describe("doc-v2-images", () => {
  it("keeps positions, sizes and a rotation, and omits an absent rotation", () => {
    const doc = load("doc-v2-images");
    const [plain, rotated] = doc.pages[0].images;
    expect(Object.prototype.hasOwnProperty.call(plain, "rotation")).toBe(false);
    expect(rotated.rotation).toBeCloseTo(0.1309, 6);
    expect(plain).toMatchObject({ path: "Attachments/diagram.png", x: 96, y: 120, w: 420, h: 280 });
  });

  it("keeps image z-order through a round-trip", () => {
    const doc = load("doc-v2-images");
    const again = decodeDocument(encodeDocument(doc));
    expect(again.pages[0].images.map((i) => i.id)).toEqual(doc.pages[0].images.map((i) => i.id));
  });
});

describe("degradation: a newer document read by this build", () => {
  it("an unknown ruling becomes blank and the page KEEPS its strokes", () => {
    const doc = raw("doc-v2-three-pages");
    const pages = doc.pages as Array<Record<string, unknown>>;
    const before = (pages[1].strokes as unknown[]).length;
    expect(before).toBeGreaterThan(0);
    pages[1].backdrop = { kind: "planner-weekly", spacing: 33, paperColor: "#fdf6d8" };

    const loaded = decodeDocument(payloadOf(doc));
    expect(loaded.pages).toHaveLength(pages.length);
    expect(loaded.pages[1].backdrop).toEqual({ kind: "blank" });
    expect(loaded.pages[1].strokes).toHaveLength(before);
    expect(loaded.pages[1].images).toEqual([]);
    // Only the paper is lost; the page's geometry and id are intact.
    expect(loaded.pages[1].id).toBe(pages[1].id);
  });

  it("an unknown page `kind` still loads as an ink page with its strokes", () => {
    const doc = raw("doc-v2-three-pages");
    const pages = doc.pages as Array<Record<string, unknown>>;
    pages[0].kind = "audio";
    const loaded = decodeDocument(payloadOf(doc));
    expect(loaded.pages[0].kind).toBe("ink");
    expect(loaded.pages[0].strokes.length).toBeGreaterThan(0);
  });

  it("an unknown shape kind is dropped, the stroke is not", () => {
    const doc = raw("doc-v2-shapes");
    const strokes = (doc.pages as Array<Record<string, unknown>>)[0].strokes as Array<
      Record<string, unknown>
    >;
    strokes[0].shape = "hexagram";
    const loaded = decodeDocument(payloadOf(doc));
    expect(loaded.pages[0].strokes).toHaveLength(strokes.length);
    expect(Object.prototype.hasOwnProperty.call(loaded.pages[0].strokes[0], "shape")).toBe(false);
    expect(loaded.pages[0].strokes[0].pts.length).toBeGreaterThan(0);
  });

  it("an unknown top-level field is ignored rather than fatal", () => {
    const doc = raw("doc-v2-empty");
    doc.audioTrack = { path: "rec.m4a", offset: 12 };
    expect(() => decodeDocument(payloadOf(doc))).not.toThrow();
  });
});

describe("degradation: a broken PDF backdrop", () => {
  it("a PDF backdrop with no path becomes blank and keeps the page's ink", () => {
    const doc = raw("doc-v2-pdf-backdrop");
    const pages = doc.pages as Array<Record<string, unknown>>;
    const inkBefore = pages.map((p) => (p.strokes as unknown[]).length);
    expect(inkBefore.every((n) => n > 0)).toBe(true);
    pages[0].backdrop = { kind: "pdf", page: 0 };

    const loaded = decodeDocument(payloadOf(doc));
    expect(loaded.pages[0].backdrop).toEqual({ kind: "blank" });
    expect(loaded.pages.map((p) => p.strokes.length)).toEqual(inkBefore);
  });

  it("an empty-string path is treated as no path", () => {
    const doc = raw("doc-v2-pdf-backdrop");
    (doc.pages as Array<Record<string, unknown>>)[0].backdrop = { kind: "pdf", path: "", page: 3 };
    expect(decodeDocument(payloadOf(doc)).pages[0].backdrop).toEqual({ kind: "blank" });
  });

  it("a negative or fractional PDF page index is repaired, not dropped", () => {
    const doc = raw("doc-v2-pdf-backdrop");
    const pages = doc.pages as Array<Record<string, unknown>>;
    pages[0].backdrop = { kind: "pdf", path: "Slides/a.pdf", page: -4 };
    pages[1].backdrop = { kind: "pdf", path: "Slides/a.pdf", page: 2.7 };
    const loaded = decodeDocument(payloadOf(doc));
    expect(loaded.pages[0].backdrop).toEqual({ kind: "pdf", path: "Slides/a.pdf", page: 0 });
    expect(loaded.pages[1].backdrop).toEqual({ kind: "pdf", path: "Slides/a.pdf", page: 3 });
  });

  it("keeps the PDF path verbatim — it is a vault path, not a URL", () => {
    const doc = raw("doc-v2-pdf-backdrop");
    const path = "Courses/2IRR00/Week 3 — slides (final).pdf";
    (doc.pages as Array<Record<string, unknown>>)[0].backdrop = { kind: "pdf", path, page: 1 };
    const loaded = decodeDocument(payloadOf(doc));
    expect((loaded.pages[0].backdrop as { path: string }).path).toBe(path);
    expect(
      (decodeDocument(encodeDocument(loaded)).pages[0].backdrop as { path: string }).path,
    ).toBe(path);
  });
});

describe("edge probes", () => {
  it("a page with no strokes and no images round-trips unchanged", () => {
    const doc = load("doc-v2-empty");
    expect(doc.pages[0].strokes).toEqual([]);
    expect(JSON.stringify(decodeDocument(encodeDocument(doc)))).toBe(JSON.stringify(doc));
  });

  it("an explicitly empty pages array is repaired to one blank page", () => {
    // `InkDocument.pages` is documented as "always at least one page", and
    // every consumer relies on it.
    const loaded = decodeDocument(payloadOf({ version: 2, view: {}, pages: [] }));
    expect(loaded.pages).toHaveLength(1);
    expect(loaded.pages[0].strokes).toEqual([]);
    expect(loaded.pages[0].backdrop).toEqual({ kind: "blank" });
  });

  it("a pages entry that is not an object becomes a blank page rather than a hole", () => {
    const loaded = decodeDocument(payloadOf({ version: 2, view: {}, pages: [null, 7, "x"] }));
    expect(loaded.pages).toHaveLength(3);
    expect(loaded.pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("a stroke whose pts length is not a multiple of three loses only the partial point", () => {
    const loaded = decodeDocument(
      payloadOf({
        version: 2,
        view: {},
        pages: [
          {
            id: "p1",
            strokes: [
              { id: "a", pts: [10, 20, 0.5, 30] },
              { id: "b", pts: [10, 20] },
              { id: "c", pts: [10] },
              { id: "d", pts: [] },
            ],
          },
        ],
      }),
    );
    const strokes = loaded.pages[0].strokes;
    expect(strokes.map((s) => s.pts.length)).toEqual([3, 0, 0, 0]);
    expect(strokes[0].pts[0]).toBeCloseTo(10, 6);
    expect(strokes.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("a non-finite coordinate never survives into the loaded document", () => {
    // NOTE for the orchestrator: it does not survive, but it is not merely
    // dropped either — JSON turns it into `null`, `normalizeStroke` *filters*
    // the null out, and every later value shifts one slot left, so the rest of
    // the stroke is silently re-aligned (a pressure becomes an x). See the
    // report. What this test locks is the part that must never regress: no
    // NaN/Infinity reaches the document, and nothing throws.
    const doc = emptyDocument();
    doc.pages[0].strokes.push({
      id: "s1",
      color: "#000",
      size: 3,
      tool: "pen",
      pts: [10, 20, 0.5, NaN, 40, 0.5, Infinity, 60, 0.5],
    });
    const loaded = decodeDocument(encodeDocument(doc));
    expect(loaded.pages[0].strokes[0].pts.every(Number.isFinite)).toBe(true);
    expect(loaded.pages[0].strokes[0].pts.length % 3).toBe(0);
  });

  it("a non-finite view or geometry value falls back instead of poisoning the layout", () => {
    const doc = emptyDocument();
    doc.view = { scrollY: NaN, width: Infinity, scale: NaN };
    doc.pages[0].geometry = { width: NaN, height: NaN };
    const loaded = decodeDocument(encodeDocument(doc));
    expect(Number.isFinite(loaded.view.scrollY)).toBe(true);
    expect(Number.isFinite(loaded.view.width)).toBe(true);
    expect(Number.isFinite(loaded.view.scale)).toBe(true);
    expect(loaded.view.scale).toBe(1);
    expect(loaded.pages[0].geometry.width).toBeGreaterThan(0);
    expect(loaded.pages[0].geometry.height).toBe(DEFAULT_PAGE_HEIGHT);
  });

  it("an image with no path is dropped, but the page and its ink are not", () => {
    const doc = raw("doc-v2-images");
    const page = (doc.pages as Array<Record<string, unknown>>)[0];
    (page.images as unknown[]).push({ id: "i3", x: 0, y: 0, w: 10, h: 10 }, null, "nope");
    const loaded = decodeDocument(payloadOf(doc));
    expect(loaded.pages[0].images.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(loaded.pages[0].strokes.length).toBeGreaterThan(0);
  });

  it("a very large document round-trips without loss", () => {
    const doc = emptyDocument();
    const pages: Page[] = [];
    for (let p = 0; p < 20; p++) {
      const page = { ...doc.pages[0], id: `p${p + 1}`, strokes: [] as Stroke[], images: [] };
      for (let s = 0; s < 250; s++) {
        const pts: number[] = [];
        for (let i = 0; i < 12; i++) pts.push(i * 7.31, p * 3 + s * 0.5, 0.42);
        page.strokes.push({ id: `p${p}s${s}`, color: "#1a1a1a", size: 3, tool: "pen", pts });
      }
      pages.push(page);
    }
    doc.pages = pages;
    expect(strokeCount(doc)).toBe(5000);

    const payload = encodeDocument(doc);
    const back = decodeDocument(payload);
    expect(strokeCount(back)).toBe(5000);
    expect(encodeDocument(back)).toBe(payload);
    // Compression must actually be doing something on ink this repetitive.
    expect(payload.length).toBeLessThan(JSON.stringify(doc).length / 4);
  });

  it("a corrupt base64 payload throws SerializeError rather than returning junk", () => {
    for (const bad of ["v2:not base64 at all!!", "v2:", "v2:QUJD", "v2:" + "A".repeat(64)]) {
      expect(() => decodeDocument(bad)).toThrow(SerializeError);
    }
  });

  it("a truncated payload throws SerializeError", () => {
    const good = encodeDocument(load("doc-v2-three-pages"));
    expect(() => decodeDocument(good.slice(0, good.length - 30))).toThrow(SerializeError);
  });

  it("a corrupt block inside an .ink.md keeps the prose and reports no document", () => {
    // The user's writing outside the block is sacred; a bad block must never
    // cost them the note.
    const markdown =
      "---\ntitle: Week 3\n---\n\nMy own notes.\n\n%%goodobsidian\nv2:@@@garbage@@@\n%%\n";
    const parsed = parseInkFile(markdown);
    expect(parsed.doc).toBeNull();
    expect(parsed.body).toContain("My own notes.");
    expect(parsed.body).toContain("title: Week 3");
  });

  it("a payload that decodes to a non-object throws rather than half-loading", () => {
    for (const value of [42, "string", null, true, [1, 2, 3]]) {
      // An array is an object, so it normalizes to one blank page instead.
      if (Array.isArray(value)) {
        expect(decodeDocument(payloadOf(value)).pages).toHaveLength(1);
      } else {
        expect(() => decodeDocument(payloadOf(value))).toThrow(SerializeError);
      }
    }
  });
});
