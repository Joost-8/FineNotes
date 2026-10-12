import { describe, expect, it } from "vitest";
import {
  isNotability,
  NotabilityError,
  readNotability,
  sampleCurve,
} from "../../src/import/notability";
import { PAGE_SIZES } from "../../src/model/templates";
import { f32bytes, i32bytes, keyedArchive } from "./builders";

const LETTER = PAGE_SIZES.find((s) => s.id === "letter")!;
const WIDTH = 574; // Notability units across the page
const K = LETTER.width / WIDTH;

interface Curve {
  points: Array<[number, number]>;
  width: number;
  rgba: [number, number, number, number];
  fractions?: number[];
}

function session(curves: Curve[] | null, extra: Record<string, unknown> = {}): Uint8Array {
  const anchors = (n: number): number => Math.max(Math.floor(n / 3) + 1, 2);
  const hash = curves && {
    $class: "InkedSpatialHash",
    numcurves: curves.length,
    curvesnumpoints: i32bytes(curves.map((c) => c.points.length)),
    curvespoints: f32bytes(curves.flatMap((c) => c.points.flat())),
    curveswidth: f32bytes(curves.map((c) => c.width)),
    curvescolors: new Uint8Array(curves.flatMap((c) => c.rgba)),
    curvesfractionalwidths: f32bytes(
      curves.flatMap(
        (c) => c.fractions ?? Array.from({ length: anchors(c.points.length) }, () => 1),
      ),
    ),
  };
  return keyedArchive({
    $class: "NoteTakingSession",
    name: "Lecture 3",
    richText: {
      $class: "FormattedString",
      reflowState: {
        $class: "NBReflowStateLocked",
        pageWidthInDocumentCoordsKey: WIDTH + 0.5 - 0.5,
      },
      ...(hash
        ? { "Handwriting Overlay": { $class: "HandwritingObject", SpatialHash: hash } }
        : {}),
      mediaObjects: [],
      pdfFiles: [],
      ...extra,
    },
  });
}

const note = (plist: Uint8Array, more: Record<string, Uint8Array> = {}): Map<string, Uint8Array> =>
  new Map(
    Object.entries({
      "Lecture 3/Session.plist": plist,
      "Lecture 3/metadata.plist": new Uint8Array(),
      ...more,
    }),
  );

describe("readNotability", () => {
  it("converts strokes: Béziers, width, colour, highlighter", () => {
    const result = readNotability(
      note(
        session([
          // A straight cubic: anchor, two controls on the line, anchor.
          {
            points: [
              [10, 20],
              [40, 20],
              [70, 20],
              [100, 20],
            ],
            width: 2,
            rgba: [255, 0, 0, 255],
            fractions: [1, 2],
          },
          {
            points: [
              [10, 50],
              [60, 50],
            ],
            width: 10,
            rgba: [255, 255, 0, 100],
          },
        ]),
      ),
      "fallback",
    );
    expect(result.source).toBe("notability");
    expect(result.title).toBe("Lecture 3");
    expect(result.doc.pages.length).toBe(1);
    expect(result.doc.pages[0].geometry).toEqual({ width: LETTER.width, height: LETTER.height });
    const [pen, marker] = result.doc.pages[0].strokes;
    expect(pen).toMatchObject({ id: "s1", color: "#ff0000", tool: "pen" });
    expect(marker).toMatchObject({ id: "s2", color: "#ffff00", tool: "highlighter" });
    // Sampled along the curve, starting and ending on its anchors.
    expect(pen.pts.length / 3).toBeGreaterThan(10);
    expect(pen.pts[0]).toBeCloseTo(10 * K, 1);
    expect(pen.pts[pen.pts.length - 3]).toBeCloseTo(100 * K, 1);
    expect(pen.pts[1]).toBeCloseTo(20 * K, 1);
    // The width grows from 1× to 2× the stroke's along it.
    const widthAt = (p: number): number => pen.size * (0.4 + 1.2 * p);
    expect(widthAt(pen.pts[2])).toBeCloseTo(2 * K, 0);
    expect(widthAt(pen.pts[pen.pts.length - 1])).toBeCloseTo(4 * K, 0);
    expect(marker.size).toBeCloseTo(10 * K, 1);
    expect(result.warnings).toEqual([]);
  });

  it("cuts the column of pages into FineNotes pages", () => {
    const pageHeight = LETTER.height / K;
    const result = readNotability(
      note(
        session([
          {
            points: [
              [10, 10],
              [20, 10],
            ],
            width: 1,
            rgba: [0, 0, 0, 255],
          },
          {
            points: [
              [10, pageHeight * 2 + 30],
              [20, pageHeight * 2 + 30],
            ],
            width: 1,
            rgba: [0, 0, 0, 255],
          },
        ]),
      ),
      "x",
    );
    expect(result.doc.pages.length).toBe(3);
    expect(result.doc.pages.map((p) => p.strokes.length)).toEqual([1, 0, 1]);
    expect(result.doc.pages[2].strokes[0].pts[1]).toBeCloseTo(30 * K, 1);
    expect(result.doc.pages[2].strokes[0].id).toBe("s2");
  });

  it("ignores fractional widths that do not line up with the strokes", () => {
    const result = readNotability(
      note(
        session([
          {
            points: [
              [0, 0],
              [10, 0],
              [20, 0],
              [30, 0],
            ],
            width: 4,
            rgba: [0, 0, 0, 255],
            fractions: [1, 2, 3],
          },
        ]),
      ),
      "x",
    );
    const s = result.doc.pages[0].strokes[0];
    expect(s.size).toBeCloseTo(4 * K, 1);
    for (const p of s.pts.filter((_, i) => i % 3 === 2)) expect(p).toBeCloseTo(0.5, 2);
  });

  it("reports pictures, PDFs, recordings and typed text it does not bring over", () => {
    const result = readNotability(
      note(
        session([], {
          mediaObjects: [{ $class: "MediaObject" }, { $class: "MediaObject" }],
          pdfFiles: [{ $class: "PDFFile" }],
          attributedString: { $class: "NSObject", stringKey: "Some typed notes" },
        }),
        {
          "Lecture 3/Recordings/rec1.m4a": new Uint8Array([1]),
          "Lecture 3/Recordings/library.plist": new Uint8Array(),
        },
      ),
      "x",
    );
    expect(result.warnings).toEqual([
      "2 pictures could not be brought over yet.",
      "1 PDF could not be brought over yet.",
      "1 recording could not be brought over yet.",
      "Typed text could not be brought over yet.",
    ]);
  });

  it("gives an empty page for a note with no handwriting", () => {
    const result = readNotability(new Map([["Session.plist", session(null)]]), "Empty");
    expect(result.doc.pages.length).toBe(1);
    expect(result.doc.pages[0].strokes).toEqual([]);
    expect(result.warnings).toEqual(["No handwriting was found in this note."]);
  });

  it("refuses what is not a note", () => {
    expect(isNotability(new Map([["index.events.pb", new Uint8Array()]]))).toBe(false);
    expect(() => readNotability(new Map(), "x")).toThrow(NotabilityError);
    expect(() => readNotability(new Map([["Session.plist", new Uint8Array(4)]]), "x")).toThrow(
      NotabilityError,
    );
  });
});

describe("sampleCurve", () => {
  it("reads point counts that are not 3m + 1 as a polyline", () => {
    const xy = new Float32Array([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const out = sampleCurve(xy, 5, null, 2);
    expect(out.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [2, 2],
      [4, 4],
      [6, 6],
      [8, 8],
    ]);
    expect(out.every((s) => s.frac === 1)).toBe(true);
  });

  it("drops non-finite points and bad width multipliers", () => {
    const xy = new Float32Array([0, 0, NaN, 1]);
    const out = sampleCurve(xy, 2, new Float32Array([-1, 2]), 1);
    expect(out).toEqual([{ x: 0, y: 0, frac: 1 }]);
  });
});
