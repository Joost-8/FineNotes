import { describe, expect, it } from "vitest";
import {
  isNotability,
  NotabilityError,
  readNotability,
  sampleCurve,
} from "../../src/import/notability";
import { PAGE_SIZES } from "../../src/model/templates";
import { f32bytes, i32bytes, keyedArchive, PDF } from "./builders";

const LETTER = PAGE_SIZES.find((s) => s.id === "letter")!;
const WIDTH = 574; // Notability units across the page
const K = LETTER.width / WIDTH;

interface Curve {
  points: Array<[number, number]>;
  width: number;
  rgba: [number, number, number, number];
  fractions?: number[];
  /** `curvesstyles`: 6 is the highlighter. */
  style?: number;
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
    curvesstyles: new Uint8Array(curves.map((c) => c.style ?? 3)),
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
      "",
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

  it("reports what it does not bring over", () => {
    const at = { documentOrigin: "{10, 20}", unscaledContentSize: "{100, 100}" };
    const result = readNotability(
      note(
        session([], {
          mediaObjects: [
            { $class: "MediaObject", ...at },
            { $class: "MediaObject" },
            { $class: "CanvasMediaObject", ...at },
            {
              $class: "ImageMediaObject",
              ...at,
              figure: {
                $class: "Figure",
                FigureBackgroundObjectKey: {
                  $class: "ImageObject",
                  kImageObjectSnapshotKey: {
                    $class: "GLSnapshot",
                    relativePath: "Images/gone.png",
                  },
                },
              },
            },
          ],
        }),
        {
          "Lecture 3/Recordings/rec1.m4a": new Uint8Array([1]),
          "Lecture 3/Recordings/library.plist": new Uint8Array(),
          "Lecture 3/Assets/A1/media.gif": new Uint8Array([1]),
        },
      ),
      "x",
    );
    expect(result.warnings).toEqual([
      "1 picture could not be found in the file (page 1).",
      "1 sticky canvas came over as a coloured box with its lines and ink (page 1).",
      "2 other items could not be brought over yet (page 1).",
      "1 recording's length could not be read.",
      "1 sticker or GIF could not be placed.",
    ]);
    // The recording came over all the same, its length unknown.
    expect(result.doc.recordings).toEqual([
      { id: "r1", path: "x - recording 1.bin", start: 0, duration: 0 },
    ]);
  });

  it("takes the highlighter by its style, though it is stored opaque", () => {
    const result = readNotability(
      note(
        session([
          {
            points: [
              [10, 10],
              [50, 10],
            ],
            width: 27,
            rgba: [229, 245, 255, 255],
            style: 6,
          },
        ]),
      ),
      "x",
    );
    expect(result.doc.pages[0].strokes[0]).toMatchObject({ tool: "highlighter", color: "#e5f5ff" });
  });

  it("lays a PDF's pages out as the note does: measured, with pages put between them", () => {
    const layout = [
      {
        kPageLayoutPDFFileNameKey: "a.pdf",
        kPageLayoutPDFPageNumberKey: 1,
        kPageLayoutDocumentPageNumberKey: 1,
      },
      { kPageLayoutPDFPageNumberKey: 2 ** 40, kPageLayoutDocumentPageNumberKey: 2 },
      {
        kPageLayoutPDFFileNameKey: "a.pdf",
        kPageLayoutPDFPageNumberKey: 2,
        kPageLayoutDocumentPageNumberKey: 3,
        kPageLayoutPageIsBookmarkedKey: true,
      },
    ];
    const slide = (WIDTH * 540) / 960;
    const letterUnits = LETTER.height / K;
    const plist = keyedArchive({
      $class: "NoteTakingSession",
      NBNoteTakingSessionDocumentPaperLayoutModelKey: {
        $class: "NoteDocumentPaperLayoutModel",
        pageLayoutArray: layout,
      },
      richText: {
        $class: "FormattedString",
        reflowState: { $class: "NBReflowStateLocked", pageWidthInDocumentCoordsKey: WIDTH },
        "Handwriting Overlay": {
          $class: "HandwritingObject",
          SpatialHash: {
            $class: "InkedSpatialHash",
            curvesnumpoints: i32bytes([2, 2, 2]),
            curvespoints: f32bytes([
              10,
              100,
              20,
              100,
              10,
              slide + 50,
              20,
              slide + 50,
              10,
              slide + letterUnits + 40,
              20,
              slide + letterUnits + 40,
            ]),
            curveswidth: f32bytes([1, 1, 1]),
            curvescolors: new Uint8Array(12),
          },
        },
        mediaObjects: [],
      },
    });
    const files = note(plist, { "Lecture 3/PDFs/a.pdf": PDF });
    const sizes = new Map([
      [
        "a.pdf",
        [
          { width: 960, height: 540 },
          { width: 960, height: 540 },
        ],
      ],
    ]);
    const result = readNotability(files, "Networks", sizes);
    const pages = result.doc.pages;
    expect(pages.map((p) => p.backdrop)).toEqual([
      { kind: "pdf", path: "Networks - PDF 1.pdf", page: 0 },
      { kind: "blank" },
      { kind: "pdf", path: "Networks - PDF 1.pdf", page: 1 },
    ]);
    expect(pages.map((p) => p.geometry.height)).toEqual([
      Math.round(slide * K),
      LETTER.height,
      Math.round(slide * K),
    ]);
    expect(pages.map((p) => p.bookmarked)).toEqual([undefined, undefined, true]);
    expect(pages.map((p) => p.strokes.length)).toEqual([1, 1, 1]);
    expect(pages[2].strokes[0].pts[1]).toBeCloseTo(40 * K, 1);
    expect(result.attachments.map((a) => a.name)).toEqual(["Networks - PDF 1.pdf"]);
    expect(result.warnings).toEqual([]);

    // Unmeasured, a PDF page is taken for Letter, and the user is told.
    const unmeasured = readNotability(files, "Networks");
    expect(unmeasured.doc.pages[0].geometry.height).toBe(LETTER.height);
    expect(unmeasured.warnings).toEqual([
      "The PDF's page sizes could not be read, so its pages may be out of place.",
    ]);
    // A PDF missing from the file leaves its pages blank.
    const missing = readNotability(note(plist), "Networks", sizes);
    expect(missing.doc.pages[0].backdrop).toEqual({ kind: "blank" });
    expect(missing.warnings).toEqual([
      "A PDF the note uses is missing from the file; its pages are blank.",
    ]);
  });

  it("brings the note's typed text and its text boxes over", () => {
    const run = (from: number, length: number, size: number, font: string, rgba: string) => ({
      $class: "NSObject",
      subRangeRangeKey: `{${from}, ${length}}`,
      subRangeFontKey: { $class: "NSObject", NSFontSizeAttribute: size, NSFontNameAttribute: font },
      subRangeColorCrossPlatformKey: rgba,
    });
    const body = "\n\nHello\nWorld\n\nBye\n\n";
    const result = readNotability(
      note(
        session(null, {
          attributedString: {
            $class: "NSObject",
            stringKey: body,
            subRangesKey: [
              run(0, 14, 12, "HelveticaNeue", "0,0,0,1"),
              run(14, 5, 24, "Courier", "0,0,1,1"),
            ],
          },
          mediaObjects: [
            {
              $class: "TextBlockMediaObject",
              documentOrigin: "{100, 200}",
              unscaledContentSize: "{200, 30}",
              textStore: {
                $class: "FormattedString",
                attributedString: {
                  $class: "NSObject",
                  stringKey: "Box \n",
                  subRangesKey: [run(0, 5, 16, "Times New Roman", "1,0,0,1")],
                },
              },
            },
            {
              $class: "TextBlockMediaObject",
              documentOrigin: "{100, 300}",
              unscaledContentSize: "{200, 30}",
              textStore: {
                $class: "FormattedString",
                attributedString: { $class: "NSObject", stringKey: " " },
              },
            },
          ],
        }),
      ),
      "x",
    );
    const boxes = result.doc.pages[0].textBoxes;
    expect(boxes.map((b) => b.text)).toEqual(["Hello\nWorld", "Bye", "Box"]);
    expect(result.warnings).toEqual([]);
    const [first, second, box] = boxes;
    expect(first).toMatchObject({ id: "t1", color: "#000000" });
    expect(first.y).toBeCloseTo(2 * 12 * 1.2 * K, 1);
    expect(first.x).toBeCloseTo(15 * K, 1);
    expect(first.w).toBeCloseTo((WIDTH - 30) * K, 1);
    expect(second).toMatchObject({ color: "#0000ff", font: "mono" });
    // Four 12-point lines, then an empty one in the 24-point run.
    expect(second.y).toBeCloseTo((4 * 12 + 24) * 1.2 * K, 1);
    expect(second.fontSize).toBeCloseTo(24 * K, 1);
    expect(box).toMatchObject({ color: "#ff0000", font: "times" });
    expect(box.x).toBeCloseTo(120 * K, 1);
    expect(box.y).toBeCloseTo(205 * K, 1);
    expect(box.w).toBeCloseTo(160 * K, 1);
    expect(box.fontSize).toBeCloseTo(Math.max(12, 16 * K), 1);
  });

  it("places pictures with their rotation and crop, on the page they are on", () => {
    // A PNG header saying 100 × 40 pixels.
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 100);
    new DataView(png.buffer).setUint32(20, 40);
    const picture = (y: number, crop: string, rotation: number) => ({
      $class: "ImageMediaObject",
      documentOrigin: `{10, ${y}}`,
      unscaledContentSize: "{100, 50}",
      rotationDegrees: rotation,
      figure: {
        $class: "Figure",
        FigureCropRectKey: crop,
        FigureBackgroundObjectKey: {
          $class: "ImageObject",
          kImageObjectSnapshotKey: { $class: "GLSnapshot", relativePath: "Images/a.png" },
        },
      },
    });
    const letterUnits = LETTER.height / K;
    const result = readNotability(
      note(
        session(null, {
          mediaObjects: [
            picture(30, "{{0, 0}, {100, 40}}", 0),
            picture(letterUnits + 20, "{{25, 10}, {50, 20}}", 90),
          ],
        }),
        { "Lecture 3/Images/a.png": png },
      ),
      "Pics",
    );
    expect(result.doc.pages.length).toBe(2);
    const [whole] = result.doc.pages[0].images;
    const [cropped] = result.doc.pages[1].images;
    expect(whole).toMatchObject({ id: "i1", path: "Pics - picture 1.png" });
    expect(whole.crop).toBeUndefined();
    expect(whole.rotation).toBeUndefined();
    expect(whole.y).toBeCloseTo(30 * K, 1);
    expect(whole.w).toBeCloseTo(100 * K, 1);
    expect(cropped.y).toBeCloseTo(20 * K, 1);
    expect(cropped.crop).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(cropped.rotation).toBeCloseTo(Math.PI / 2, 2);
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

describe("readNotability: what FineNotes cannot hold, approximated", () => {
  it("keeps list and checklist markers in the typed text", () => {
    const run = (from: number, length: number, other: Record<string, unknown> = {}) => ({
      $class: "NSObject",
      subRangeRangeKey: `{${from}, ${length}}`,
      subRangeFontKey: { $class: "NSObject", NSFontSizeAttribute: 12 },
      subRangeOtherAttributesKey: { $class: "NSObject", ...other },
    });
    const text = "Todo\nMilk\nEggs\n\nOne\nTwo\nDot\n";
    const check = (checked: number) => ({
      "indent-decoration-style": 3,
      "checklist-checked": checked,
      "indent-level": 0,
    });
    const result = readNotability(
      note(
        session(null, {
          attributedString: {
            $class: "NSObject",
            stringKey: text,
            subRangesKey: [
              run(0, 5, { "checklist-checked": 0 }),
              run(5, 5, check(0)),
              run(10, 5, check(1)),
              run(15, 1),
              run(16, 4, { "indent-decoration-style": 2, "indent-decoration-number": 1 }),
              run(20, 4, {
                "indent-decoration-style": 2,
                "indent-decoration-number": 2,
                "indent-level": 1,
              }),
              run(24, 4, { "indent-decoration-style": 1 }),
            ],
          },
        }),
      ),
      "x",
    );
    expect(result.doc.pages[0].textBoxes.map((b) => b.text)).toEqual([
      "Todo\n☐ Milk\n☑ Eggs",
      "1. One\n  2. Two\n• Dot",
    ]);
  });

  it("shows an animated picture's original, and a sticky canvas as its paper, ruling and ink", () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 10, 0]);
    const id = "2116E375-4D92-4153-B466-31DE5CA45378";
    const result = readNotability(
      note(
        session(null, {
          mediaObjects: [
            {
              $class: "ImageMediaObject",
              documentOrigin: "{10, 20}",
              unscaledContentSize: "{100, 100}",
              isFlippedHorizontal: true,
              assetsIdKey: new TextEncoder().encode(id),
              figure: {
                $class: "Figure",
                FigureCropRectKey: "{{0, 0}, {5, 5}}",
                FigureBackgroundObjectKey: {
                  $class: "ImageObject",
                  kImageObjectSnapshotKey: {
                    $class: "GLSnapshot",
                    relativePath: "Images/still.png",
                  },
                },
              },
            },
            {
              $class: "CanvasMediaObject",
              documentOrigin: "{30, 300}",
              unscaledContentSize: "{240, 100}",
              kCanvasMediaObjectPaperAttributes: {
                $class: "GLModel.PaperAttributes",
                paperIdentifier: "Color:#1749B3",
                lineStyle2: "Lines:false:false:0.5",
              },
              paperStyleObject: {
                $class: "GLModel.NBPaperStyle",
                paperColor: { $class: "UIColor", UIRed: 1, UIGreen: 0, UIBlue: 0 },
              },
              inner: {
                $class: "InkedSpatialHash",
                curvesnumpoints: i32bytes([2]),
                curvespoints: f32bytes([1, 2, 3, 4]),
                curveswidth: f32bytes([1]),
                curvescolors: new Uint8Array([0, 0, 0, 255]),
              },
            },
          ],
        }),
        {
          [`Lecture 3/Assets/${id}/media.gif`]: gif,
          "Lecture 3/Images/still.png": PDF,
        },
      ),
      "x",
    );
    const page = result.doc.pages[0];
    expect(page.images.map((i) => [i.path, i.crop])).toEqual([["x - picture 1.gif", undefined]]);
    const [paper] = page.textBoxes;
    expect(paper).toMatchObject({ text: "", fill: "#ff000066" });
    expect(paper.h).toBeCloseTo(100 * K, 1);
    // Half-inch ruling: 574 / 8.5 × 0.5 ≈ 33.8 units apart, inside 100 units: two lines.
    const lines = page.strokes.filter((s) => s.shape === "line");
    expect(lines.length).toBe(2);
    expect(lines[0].pts[1]).toBeCloseTo((300 + (WIDTH / 8.5) * 0.5) * K, 0);
    expect(lines[0].color).toBe("#cc0000");
    const ink = page.strokes.find((s) => s.shape === undefined)!;
    expect(ink.pts[0]).toBeCloseTo((30 + 1) * K, 1);
    expect(ink.pts[1]).toBeCloseTo((300 + 2) * K, 1);
    expect(result.warnings).toEqual([
      "1 flipped picture came over unflipped (page 1).",
      "1 sticky canvas came over as a coloured box with its lines and ink (page 1).",
    ]);
  });

  it("brings recordings over with their length", () => {
    // An M4A with only a movie header: version 0, created 2026-01-01, 3.5 s at 1000 per second.
    const created = Date.UTC(2026, 0, 1) / 1000 + 2082844800;
    const mvhd = new Uint8Array(8 + 20);
    const view = new DataView(mvhd.buffer);
    view.setUint32(0, mvhd.length);
    mvhd.set([0x6d, 0x76, 0x68, 0x64], 4);
    view.setUint32(12, created);
    view.setUint32(20, 1000);
    view.setUint32(24, 3500);
    const moov = new Uint8Array(8 + mvhd.length);
    new DataView(moov.buffer).setUint32(0, moov.length);
    moov.set([0x6d, 0x6f, 0x6f, 0x76], 4);
    moov.set(mvhd, 8);
    const ftyp = new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
    const m4a = new Uint8Array([...ftyp, ...moov]);
    const result = readNotability(
      note(session(null), {
        "Lecture 3/Recordings/a.m4a": m4a,
        "Lecture 3/Recordings/library.plist": new Uint8Array([1]),
      }),
      "Talk",
    );
    expect(result.doc.recordings).toEqual([
      { id: "r1", path: "Talk - recording 1.m4a", start: Date.UTC(2026, 0, 1), duration: 3500 },
    ]);
    expect(result.attachments.map((a) => a.mime)).toEqual(["audio/mp4"]);
    expect(result.warnings).toEqual([]);
  });
});
