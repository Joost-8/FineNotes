import { describe, expect, it } from "vitest";
import { deflateToBase64 } from "../../src/model/compress";
import {
  COVER_RULINGS,
  RULINGS,
  SHAPE_KINDS,
  TEXT_FONTS,
  TEXT_FONT_STACKS,
  emptyDocument,
  isCoverRuling,
} from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

/** Encode a raw (possibly malformed) stored document the way the plugin would. */
function payloadOf(raw: unknown): string {
  return `v3:${deflateToBase64(JSON.stringify(raw))}`;
}

function rawDoc(overrides: Record<string, unknown> = {}, page: Record<string, unknown> = {}) {
  return {
    version: 3,
    view: { scrollY: 0, width: 1024, scale: 1 },
    pages: [{ id: "p1", kind: "ink", strokes: [], images: [], textBoxes: [], ...page }],
    ...overrides,
  };
}

describe("text box style (0.5)", () => {
  const styled = {
    id: "t1",
    x: 10,
    y: 20,
    w: 300,
    text: "Heading",
    color: "#1a1a1a",
    fontSize: 24,
    font: "serif",
    bold: true,
    italic: true,
    underline: true,
    strike: true,
    align: "center",
    lineHeight: 1.5,
    fill: "#fff3b0",
  };

  it("round-trips every style field", () => {
    const doc = emptyDocument(1024);
    doc.pages[0].textBoxes.push({ ...styled } as never);
    const out = decodeDocument(encodeDocument(doc)).pages[0].textBoxes[0];
    expect(out).toEqual(styled);
  });

  it("loads a pre-0.5 box with no style fields unchanged", () => {
    const plain = { id: "t1", x: 0, y: 0, w: 300, text: "a", color: "#000", fontSize: 22 };
    const out = decodeDocument(payloadOf(rawDoc({}, { textBoxes: [plain] }))).pages[0].textBoxes[0];
    expect(out).toEqual(plain);
  });

  it("drops unknown or malformed style values instead of guessing", () => {
    const bad = {
      ...styled,
      font: "Comic Sans",
      bold: "yes",
      italic: false,
      align: "middle",
      lineHeight: 12,
      fill: "red; background:url(x)",
    };
    const out = decodeDocument(payloadOf(rawDoc({}, { textBoxes: [bad] }))).pages[0].textBoxes[0];
    expect(out.font).toBeUndefined();
    expect(out.bold).toBeUndefined();
    expect("italic" in out).toBe(false);
    expect(out.align).toBeUndefined();
    expect(out.lineHeight).toBeUndefined();
    expect(out.fill).toBeUndefined();
    expect(out.underline).toBe(true);
  });

  it("maps every font to a real family list, never a CSS variable", () => {
    for (const font of TEXT_FONTS) {
      expect(TEXT_FONT_STACKS[font]).toMatch(/\S/);
      expect(TEXT_FONT_STACKS[font]).not.toContain("var(");
    }
  });
});

describe("page epoch, single pages and recordings (0.5)", () => {
  it("round-trips a page epoch and drops a nonsense one", () => {
    const doc = emptyDocument(1024);
    doc.pages[0].epoch = 1_790_000_000_123.4;
    expect(decodeDocument(encodeDocument(doc)).pages[0].epoch).toBe(1_790_000_000_123);
    for (const epoch of [-1, 0, "now", Number.NaN]) {
      const out = decodeDocument(payloadOf(rawDoc({}, { epoch })));
      expect("epoch" in out.pages[0]).toBe(false);
    }
  });

  it("round-trips the single-page flag and stores it only when true", () => {
    const doc = emptyDocument(1024);
    doc.single = true;
    expect(decodeDocument(encodeDocument(doc)).single).toBe(true);
    doc.single = false;
    const out = decodeDocument(encodeDocument(doc));
    expect("single" in out).toBe(false);
  });

  it("keeps recognizedHash beside the single flag in meta", () => {
    const doc = emptyDocument(1024);
    doc.single = true;
    doc.recognizedHash = "abc";
    const out = decodeDocument(encodeDocument(doc));
    expect(out.single).toBe(true);
    expect(out.recognizedHash).toBe("abc");
  });

  it("round-trips recordings and drops ones without a path or start", () => {
    const good = {
      id: "r1",
      path: "Audio/lecture.m4a",
      start: 1_790_000_000_000,
      duration: 61_000,
      transcript: "Audio/lecture transcript.md",
    };
    const raw = rawDoc({
      recordings: [
        good,
        { id: "r2", start: 1_790_000_000_000, duration: 5 },
        { id: "r3", path: "x.m4a", start: -4, duration: 5 },
        { path: "y.m4a", start: 1_790_000_100_000, duration: -3 },
      ],
    });
    const out = decodeDocument(payloadOf(raw));
    expect(out.recordings).toEqual([
      good,
      { id: "r4", path: "y.m4a", start: 1_790_000_100_000, duration: 0 },
    ]);
    expect(decodeDocument(encodeDocument(out)).recordings).toEqual(out.recordings);
  });

  it("writes no recordings key when there are none", () => {
    const doc = emptyDocument(1024);
    doc.recordings = [];
    expect("recordings" in decodeDocument(encodeDocument(doc))).toBe(false);
  });
});

describe("image crop and lock (0.5)", () => {
  const image = { id: "i1", path: "a.png", x: 0, y: 0, w: 100, h: 100 };

  it("round-trips a crop and a lock", () => {
    const doc = emptyDocument(1024);
    doc.pages[0].images.push({ ...image, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, locked: true });
    const out = decodeDocument(encodeDocument(doc)).pages[0].images[0];
    expect(out.crop).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
    expect(out.locked).toBe(true);
  });

  it("drops a crop that is empty, malformed, outside the picture or the whole picture", () => {
    for (const crop of [
      { x: 0, y: 0, w: 0, h: 0.5 },
      { x: -0.1, y: 0, w: 0.5, h: 0.5 },
      { x: 0.6, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 1, h: 1 },
      { x: "0", y: 0, w: 0.5, h: 0.5 },
      "crop",
    ]) {
      const out = decodeDocument(payloadOf(rawDoc({}, { images: [{ ...image, crop }] })));
      expect("crop" in out.pages[0].images[0]).toBe(false);
    }
  });

  it("stores the lock only as true", () => {
    const out = decodeDocument(payloadOf(rawDoc({}, { images: [{ ...image, locked: "yes" }] })));
    expect("locked" in out.pages[0].images[0]).toBe(false);
  });
});

describe("ids for elements stored without one (0.5)", () => {
  it("mints image and text-box ids above the page's highest, never a taken one", () => {
    const raw = rawDoc(
      {},
      {
        images: [
          { path: "a.png", x: 0, y: 0, w: 10, h: 10 },
          { id: "i1", path: "b.png", x: 0, y: 0, w: 10, h: 10 },
          { id: "i7", path: "c.png", x: 0, y: 0, w: 10, h: 10 },
        ],
        textBoxes: [
          { text: "no id", x: 0, y: 0, w: 100, color: "#000", fontSize: 20 },
          { id: "t1", text: "has id", x: 0, y: 0, w: 100, color: "#000", fontSize: 20 },
        ],
      },
    );
    const page = decodeDocument(payloadOf(raw)).pages[0];
    expect(page.images.map((image) => image.id)).toEqual(["i8", "i1", "i7"]);
    expect(page.textBoxes.map((box) => box.id)).toEqual(["t2", "t1"]);
  });
});

describe("new kinds (0.5)", () => {
  it("accepts the star shape and the title-date and cover rulings", () => {
    expect(SHAPE_KINDS).toContain("star");
    expect(RULINGS).toContain("title-date");
    for (const cover of COVER_RULINGS) {
      expect(RULINGS).toContain(cover);
      expect(isCoverRuling(cover)).toBe(true);
    }
    expect(isCoverRuling("ruled-wide")).toBe(false);
  });

  it("round-trips a cover backdrop with its colour", () => {
    const doc = emptyDocument(1024);
    doc.pages[0].backdrop = { kind: "cover-label", paperColor: "#2f4d7a" };
    expect(decodeDocument(encodeDocument(doc)).pages[0].backdrop).toEqual({
      kind: "cover-label",
      paperColor: "#2f4d7a",
    });
  });
});
