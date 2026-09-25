/**
 * The rules of the on-disk format, one readable case each. The goldens pin
 * the exact bytes; these say why the bytes are what they are.
 */

import { describe, expect, it } from "vitest";
import { MAX_INFLATED_BYTES, deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import {
  SerializeError,
  buildInkFile,
  decodeDocument,
  dequantizePts,
  encodeDocument,
  parseInkFile,
  quantizePts,
  splitFrontmatter,
} from "../../src/model/serialize";

/** The JSON inside a payload, as it sits on disk. */
function onDisk(payload: string): Record<string, unknown> {
  return JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as Record<
    string,
    unknown
  >;
}

/** A payload around arbitrary JSON, the way a hand-edited or older file might hold it. */
function wrap(value: unknown, version = "v2"): string {
  return `${version}:${deflateToBase64(JSON.stringify(value))}`;
}

function withStrokes(strokes: unknown[]): InkDocument {
  const doc = emptyDocument(1024);
  doc.pages[0].strokes = strokes as Stroke[];
  return doc;
}

describe("points on the wire", () => {
  it("stores x and y in hundredths of a page px and pressure in 255ths, as integers", () => {
    expect(quantizePts([12.34, 56.78, 0.5, 0, 1024, 1])).toEqual([1234, 5678, 128, 0, 102400, 255]);
  });

  it("restores every value to within half a step", () => {
    const pts = [12.043, 5.51, 0.5, 100.001, 200.999, 0.78];
    const back = dequantizePts(quantizePts(pts));
    back.forEach((v, i) => {
      const step = i % 3 === 2 ? 1 / 255 : 1 / 100;
      expect(Math.abs(v - pts[i])).toBeLessThanOrEqual(step / 2 + 1e-12);
    });
  });

  it("clamps pressure into 0..255, but not coordinates", () => {
    expect(quantizePts([-5, 2000, 1.7, 3, 4, -0.2])).toEqual([-500, 200000, 255, 300, 400, 0]);
  });

  it("drops a trailing partial point instead of padding it", () => {
    expect(quantizePts([1, 2, 0.5, 3])).toEqual([100, 200, 128]);
    expect(dequantizePts([100, 200, 128, 300, 400])).toEqual([1, 2, 128 / 255]);
  });
});

describe("the payload envelope", () => {
  it("is `v2:` followed by base64", () => {
    expect(encodeDocument(emptyDocument())).toMatch(/^v2:[A-Za-z0-9+/]+=*$/);
  });

  it("ignores whitespace around the payload", () => {
    const payload = encodeDocument(emptyDocument());
    expect(decodeDocument(`\n  ${payload}\t\n`)).toEqual(decodeDocument(payload));
  });

  it("reads any numeric version as today's format", () => {
    const raw = { pages: [{ id: "only" }] };
    for (const version of ["v1", "v3", "v9"]) {
      expect(decodeDocument(wrap(raw, version)).pages[0].id).toBe("only");
    }
  });

  it.each([
    ["no prefix", "not-a-payload"],
    ["an empty string", ""],
    ["a version that is not a number", "vX:abcd"],
    ["base64 that is not base64", "v2:@@@@"],
    ["base64 that is not deflate", `v2:${btoa("hello there")}`],
    ["deflate that is not JSON", `v2:${deflateToBase64("this is not json")}`],
    ["JSON that is not an object", `v2:${deflateToBase64("123")}`],
    ["JSON null", `v2:${deflateToBase64("null")}`],
  ])("refuses %s with a SerializeError", (_what, payload) => {
    expect(() => decodeDocument(payload)).toThrow(SerializeError);
  });

  it("keeps the underlying error as the cause", () => {
    try {
      decodeDocument(`v2:${deflateToBase64("{")}`);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SerializeError);
      expect((error as SerializeError).name).toBe("SerializeError");
      expect((error as SerializeError).cause).toBeInstanceOf(SyntaxError);
    }
  });
});

describe("what a save writes", () => {
  it("writes the document, page and stroke keys in a fixed order", () => {
    const doc = withStrokes([
      { pts: [1, 2, 0.5], tool: "pen", size: 3, color: "#000", id: "s1", t0: 5, shape: "line" },
    ]);
    doc.recognizedHash = "h";
    doc.recordings = [{ id: "r1", path: "a.m4a", start: 1_790_000_000_000, duration: 5 }];
    doc.pages[0].epoch = 1_790_000_000_000;
    doc.pages[0].bookmarked = true;
    const disk = onDisk(encodeDocument(doc));
    expect(Object.keys(disk)).toEqual(["version", "view", "meta", "recordings", "pages"]);
    const page = (disk.pages as Array<Record<string, unknown>>)[0];
    expect(Object.keys(page)).toEqual([
      "id",
      "kind",
      "geometry",
      "backdrop",
      "epoch",
      "bookmarked",
      "images",
      "textBoxes",
      "strokes",
    ]);
    const stroke = (page.strokes as Array<Record<string, unknown>>)[0];
    expect(Object.keys(stroke)).toEqual(["id", "color", "size", "tool", "pts", "shape", "t0"]);
  });

  it("writes no meta, recordings, epoch or bookmark when there is nothing to say", () => {
    const doc = emptyDocument();
    doc.recognizedHash = "";
    doc.single = false;
    doc.recordings = [];
    const disk = onDisk(encodeDocument(doc));
    expect(Object.keys(disk)).toEqual(["version", "view", "pages"]);
    expect(Object.keys((disk.pages as object[])[0])).toEqual([
      "id",
      "kind",
      "geometry",
      "backdrop",
      "images",
      "textBoxes",
      "strokes",
    ]);
  });

  it("always writes the current schema version, whatever the document says", () => {
    const doc = { ...emptyDocument(), version: 1 };
    expect(onDisk(encodeDocument(doc)).version).toBe(2);
  });

  it("writes a stroke's t0 rounded, and only when it is a real time", () => {
    const doc = withStrokes(
      [1234.7, 0, -5, NaN, Infinity, undefined].map((t0, i) => ({
        id: `s${i + 1}`,
        color: "#000",
        size: 3,
        tool: "pen",
        pts: [],
        t0,
      })),
    );
    const strokes = (onDisk(encodeDocument(doc)).pages as Array<{ strokes: object[] }>)[0].strokes;
    expect(strokes.map((s) => (s as { t0?: number }).t0)).toEqual([
      1235,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("copies the view, backdrop, geometry, images and text boxes as they are", () => {
    const doc = emptyDocument();
    doc.view = { scale: 2, width: 800, scrollY: 1 };
    doc.pages[0].backdrop = { paperColor: "#fff", kind: "dotted" };
    const disk = onDisk(encodeDocument(doc));
    expect(JSON.stringify(disk.view)).toBe('{"scale":2,"width":800,"scrollY":1}');
    const page = (disk.pages as Array<Record<string, unknown>>)[0];
    expect(JSON.stringify(page.backdrop)).toBe('{"paperColor":"#fff","kind":"dotted"}');
  });
});

describe("what a load fills in", () => {
  it("gives a stroke without fields an id from its position, and the default ink", () => {
    const doc = decodeDocument(wrap({ pages: [{ strokes: [null, { pts: [100, 200, 255] }] }] }));
    expect(doc.pages[0].strokes).toEqual([
      { id: "s2", color: "#1a1a1a", size: 3, tool: "pen", pts: [1, 2, 1] },
    ]);
  });

  it("substitutes 0 for a bad number in a stroke, so the points stay aligned", () => {
    const doc = decodeDocument(
      wrap({ pages: [{ strokes: [{ pts: [1000, 2000, 255, null, 4000, 255, 5000, "x", 255] }] }] }),
    );
    expect(doc.pages[0].strokes[0].pts).toEqual([10, 20, 1, 0, 40, 1, 50, 0, 1]);
  });

  it("drops a trailing partial point", () => {
    const doc = decodeDocument(wrap({ pages: [{ strokes: [{ pts: [100, 200, 255, 9, 9] }] }] }));
    expect(doc.pages[0].strokes[0].pts).toEqual([1, 2, 1]);
  });

  it("keeps a stored t0 only when it is a finite time at or after the start", () => {
    const strokes = [900, 12.5, 0, -1, "12", null].map((t0) => ({ pts: [], t0 }));
    const out = decodeDocument(wrap({ pages: [{ strokes }] })).pages[0].strokes;
    expect(out.map((s) => ("t0" in s ? s.t0 : "absent"))).toEqual([
      900,
      13,
      0,
      "absent",
      "absent",
      "absent",
    ]);
  });

  it("accepts only the highlighter as another tool", () => {
    const strokes = ["highlighter", "eraser", undefined].map((tool) => ({ pts: [], tool }));
    const out = decodeDocument(wrap({ pages: [{ strokes }] })).pages[0].strokes;
    expect(out.map((s) => s.tool)).toEqual(["highlighter", "pen", "pen"]);
  });

  it("fills the view from the fallback width when the file has none", () => {
    expect(decodeDocument(wrap({}), 800).view).toEqual({ scrollY: 0, width: 800, scale: 1 });
    expect(decodeDocument(wrap({})).view.width).toBe(1024);
  });

  it("always yields at least one page", () => {
    for (const raw of [{}, { pages: [] }, { regions: [] }, []]) {
      expect(decodeDocument(wrap(raw)).pages).toHaveLength(1);
    }
  });

  it("prefers pages over regions when a file has both", () => {
    const doc = decodeDocument(wrap({ pages: [{ id: "page" }], regions: [{ id: "region" }] }));
    expect(doc.pages.map((p) => p.id)).toEqual(["page"]);
  });

  it("keeps the recognition hash as it was stored", () => {
    const doc = emptyDocument();
    doc.recognizedHash = "abc123";
    expect(decodeDocument(encodeDocument(doc)).recognizedHash).toBe("abc123");
    expect("recognizedHash" in decodeDocument(encodeDocument(emptyDocument()))).toBe(false);
  });
});

describe("the note file", () => {
  const body = "---\ngoodobsidian: true\n---\n\n# Notes\n\nTyped prose with [[a link]].";

  it("appends the data block after a blank line and reads the body back unchanged", () => {
    const doc = withStrokes([{ id: "s1", color: "#000", size: 3, tool: "pen", pts: [1, 2, 0.5] }]);
    const file = buildInkFile(body, doc);
    expect(file.startsWith(`${body}\n\n%%goodobsidian\nv2:`)).toBe(true);
    expect(file.endsWith("\n%%\n")).toBe(true);
    const parsed = parseInkFile(file);
    expect(parsed.body).toBe(body);
    expect(parsed.doc?.pages[0].strokes[0].id).toBe("s1");
  });

  it("trims trailing whitespace from the body, and writes no blank line for an empty one", () => {
    const doc = emptyDocument();
    const payload = encodeDocument(doc);
    expect(buildInkFile("# T \n\n\t", doc)).toBe(`# T\n\n%%goodobsidian\n${payload}\n%%\n`);
    expect(buildInkFile(" \n", doc)).toBe(`%%goodobsidian\n${payload}\n%%\n`);
  });

  it("returns the whole note and no document when there is no block", () => {
    expect(parseInkFile("# Just markdown")).toEqual({ body: "# Just markdown", doc: null });
  });

  it("keeps the body and drops a block it cannot read", () => {
    const parsed = parseInkFile("# Title\n\n%%goodobsidian\nv2:@@@garbage@@@\n%%\n");
    expect(parsed).toEqual({ body: "# Title", doc: null });
  });

  it("reads a note written before 0.2.0 and saves it under the current label", () => {
    const payload = encodeDocument(emptyDocument());
    const parsed = parseInkFile(`# Old\n\n%%inkedmark\n${payload}\n%%\n`);
    expect(parsed.body).toBe("# Old");
    expect(parsed.doc).not.toBeNull();
    expect(buildInkFile(parsed.body, parsed.doc as InkDocument)).toContain("%%goodobsidian\n");
  });

  it("splits leading frontmatter from the prose, with LF, CRLF or a BOM", () => {
    expect(splitFrontmatter("---\na: 1\n---\n# T")).toEqual({
      frontmatter: "---\na: 1\n---\n",
      prose: "# T",
    });
    expect(splitFrontmatter("---\r\na: 1\r\n---\r\nx")).toEqual({
      frontmatter: "---\r\na: 1\r\n---\r\n",
      prose: "x",
    });
    expect(splitFrontmatter("\ufeff---\na\n---\nx").frontmatter).toBe("\ufeff---\na\n---\n");
    expect(splitFrontmatter("# T\n---\na\n---\n")).toEqual({
      frontmatter: "",
      prose: "# T\n---\na\n---\n",
    });
  });
});

describe("compression", () => {
  it("round-trips text, including an empty string and non-ASCII", () => {
    for (const text of ["", "plain", "café — 漢字 — ✍️", JSON.stringify({ pts: [1, 2, 3] })]) {
      expect(inflateFromBase64(deflateToBase64(text))).toBe(text);
    }
  });

  it("writes plain base64: no whitespace, standard alphabet", () => {
    expect(deflateToBase64("payload ".repeat(500))).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("compresses repetitive ink data", () => {
    const text = JSON.stringify({ pts: Array.from({ length: 5000 }, (_, i) => i % 97) });
    expect(deflateToBase64(text).length).toBeLessThan(text.length / 4);
  });

  it("refuses to inflate past the cap, counting exactly", () => {
    const packed = deflateToBase64("x".repeat(1000));
    expect(inflateFromBase64(packed, 1000)).toHaveLength(1000);
    expect(() => inflateFromBase64(packed, 999)).toThrow();
    expect(MAX_INFLATED_BYTES).toBe(67_108_864);
  });

  it("counts the cap in bytes, not characters", () => {
    const packed = deflateToBase64("é".repeat(10)); // 20 bytes of UTF-8
    expect(inflateFromBase64(packed, 20)).toBe("é".repeat(10));
    expect(() => inflateFromBase64(packed, 19)).toThrow();
  });
});
