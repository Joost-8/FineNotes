import { describe, expect, it } from "vitest";
import { pageScale } from "../../src/import/import-types";
import { crc32, encodePng } from "../../src/import/png-encode";
import {
  SUPERNOTE_BITMAP_WARNING,
  SupernoteError,
  decodeRattaRle,
  isSupernote,
  readSupernote,
  rleGrey,
} from "../../src/import/supernote";
import {
  SN_HEIGHT,
  SN_WIDTH,
  asaPicture,
  blankCodes,
  buildSupernote,
  decodePng,
} from "./supernote-builders";

/** A page of codes with a black line on row 10 (x 100-199) and a grey dot at (5, 20). */
function sampleCodes(width = SN_WIDTH, height = SN_HEIGHT): Uint8Array {
  const codes = blankCodes(width, height);
  codes.fill(0x61, 10 * width + 100, 10 * width + 200);
  codes[20 * width + 5] = 0x64;
  return codes;
}

/** Grey and alpha of one pixel of a decoded grey + alpha PNG. */
function pixel(png: ReturnType<typeof decodePng>, x: number, y: number): [number, number] {
  const at = (y * png.width + x) * 2;
  return [png.pixels[at], png.pixels[at + 1]];
}

describe("isSupernote", () => {
  it("knows an X-series note and an original one", () => {
    expect(isSupernote(buildSupernote({ pages: [{}] }))).toBe(true);
    expect(isSupernote(new TextEncoder().encode("SN_FILE_ASA_20190529...."))).toBe(true);
  });

  it("refuses a zip, garbage and a short file", () => {
    expect(
      isSupernote(new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBe(false);
    expect(isSupernote(new TextEncoder().encode("hello world, this is not a note"))).toBe(false);
    expect(isSupernote(new TextEncoder().encode("12\u0001SN_FILE_VER_20230015"))).toBe(false);
    expect(isSupernote(new Uint8Array(3))).toBe(false);
  });
});

describe("readSupernote", () => {
  it("brings a page's ink over as a picture covering the page", () => {
    const bytes = buildSupernote({ pages: [{ layers: { MAINLAYER: { codes: sampleCodes() } } }] });
    const result = readSupernote(bytes, "Lecture");

    expect(result.source).toBe("supernote");
    expect(result.title).toBe("Lecture");
    expect(result.warnings).toEqual([SUPERNOTE_BITMAP_WARNING]);
    expect(result.doc.pages).toHaveLength(1);
    const page = result.doc.pages[0];
    const k = pageScale(1404, 157.8);
    expect(page.geometry).toEqual({ width: Math.round(1404 * k), height: Math.round(1872 * k) });
    expect(page.backdrop).toEqual({ kind: "blank" });
    expect(page.title).toBeUndefined();
    expect(page.images).toEqual([
      {
        id: "i1",
        path: "Lecture - page 1.png",
        x: 0,
        y: 0,
        w: page.geometry.width,
        h: page.geometry.height,
      },
    ]);
    expect(result.doc.view.width).toBe(page.geometry.width);

    expect(result.attachments).toHaveLength(1);
    const attachment = result.attachments[0];
    expect(attachment.name).toBe("Lecture - page 1.png");
    expect(attachment.mime).toBe("image/png");
    const png = decodePng(attachment.bytes);
    expect([png.width, png.height, png.colourType]).toEqual([1404, 1872, 4]);
    expect(pixel(png, 0, 0)).toEqual([0, 0]);
    expect(pixel(png, 100, 10)).toEqual([0, 255]);
    expect(pixel(png, 199, 10)).toEqual([0, 255]);
    expect(pixel(png, 200, 10)).toEqual([0, 0]);
    expect(pixel(png, 5, 20)).toEqual([0x50, 255]); // X2 file: 0x64 is the compatible grey
  });

  it("reads several pages in order and skips empty ones", () => {
    const bytes = buildSupernote({
      start: "noteSN_FILE_VER_20220013",
      pages: [
        { layers: { MAINLAYER: { codes: blankCodes() } } },
        { layers: { MAINLAYER: { codes: sampleCodes() } } },
      ],
    });
    const result = readSupernote(bytes, "Two");
    expect(result.doc.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.doc.pages[0].images).toEqual([]);
    expect(result.attachments.map((a) => a.name)).toEqual(["Two - page 2.png"]);
    const png = decodePng(result.attachments[0].bytes);
    expect(pixel(png, 5, 20)).toEqual([0xc9, 255]); // X file: 0x64 is grey
  });

  it("sizes a Manta page and a Nomad page from the equipment", () => {
    const manta = readSupernote(
      buildSupernote({
        equipment: "N5",
        pages: [{ layers: { MAINLAYER: { codes: sampleCodes(1920, 2560) } } }],
      }),
      "M",
    );
    const k = pageScale(1920, 162.6);
    expect(manta.doc.pages[0].geometry).toEqual({
      width: Math.round(1920 * k),
      height: Math.round(2560 * k),
    });
    const png = decodePng(manta.attachments[0].bytes);
    expect([png.width, png.height]).toEqual([1920, 2560]);
    expect(pixel(png, 150, 10)).toEqual([0, 255]);

    const nomad = readSupernote(buildSupernote({ equipment: "N6", pages: [{}] }), "N");
    const kn = pageScale(1404, 118.9);
    expect(nomad.doc.pages[0].geometry.width).toBe(Math.round(1404 * kn));
  });

  it("turns a landscape page", () => {
    const codes = blankCodes(SN_HEIGHT, SN_WIDTH);
    codes[3 * SN_HEIGHT + 1800] = 0x61;
    const result = readSupernote(
      buildSupernote({
        pages: [{ layers: { MAINLAYER: { codes } }, tags: [["ORIENTATION", "1090"]] }],
      }),
      "L",
    );
    const page = result.doc.pages[0];
    expect(page.geometry.width).toBeGreaterThan(page.geometry.height);
    const png = decodePng(result.attachments[0].bytes);
    expect([png.width, png.height]).toEqual([SN_HEIGHT, SN_WIDTH]);
    expect(pixel(png, 1800, 3)).toEqual([0, 255]);
  });

  it("stacks visible layers in LAYERSEQ order and leaves out hidden ones and the template", () => {
    const main = sampleCodes();
    const over = blankCodes();
    over[10 * SN_WIDTH + 150] = 0x65; // white on top of the black line
    const hidden = blankCodes();
    hidden[50 * SN_WIDTH + 50] = 0x61;
    const template = blankCodes();
    template[60 * SN_WIDTH + 60] = 0x61;
    const info = JSON.stringify([
      { layerId: 0, isBackgroundLayer: false, isVisible: true },
      { layerId: 1, isBackgroundLayer: false, isVisible: true },
      { layerId: 2, isBackgroundLayer: false, isVisible: false },
      { layerId: 0, isBackgroundLayer: true, isVisible: true },
      "junk",
    ]).replace(/:/g, "#");
    const result = readSupernote(
      buildSupernote({
        pages: [
          {
            layers: {
              MAINLAYER: { codes: main },
              LAYER1: { codes: over },
              LAYER2: { codes: hidden },
              BGLAYER: { codes: template },
            },
            tags: [
              ["LAYERSEQ", "LAYER2,LAYER1,MAINLAYER,BGLAYER"],
              ["LAYERINFO", info],
              ["PAGESTYLE", "style_8mm_ruled_line"],
            ],
          },
        ],
      }),
      "Layers",
    );
    const png = decodePng(result.attachments[0].bytes);
    expect(pixel(png, 150, 10)).toEqual([0xfe, 255]);
    expect(pixel(png, 149, 10)).toEqual([0, 255]);
    expect(pixel(png, 50, 50)).toEqual([0, 0]);
    expect(pixel(png, 60, 60)).toEqual([0, 0]);
    expect(result.warnings).toContain("1 page had a template, which comes over as blank paper.");
  });

  it("draws the layer LAYERSEQ lists first on top", () => {
    const main = sampleCodes();
    const over = blankCodes();
    over[10 * SN_WIDTH + 150] = 0x65;
    const result = readSupernote(
      buildSupernote({
        pages: [
          {
            layers: { MAINLAYER: { codes: main }, LAYER1: { codes: over } },
            // MAINLAYER on top this time.
            tags: [["LAYERSEQ", "MAINLAYER,LAYER1"]],
          },
        ],
      }),
      "Order",
    );
    expect(pixel(decodePng(result.attachments[0].bytes), 150, 10)).toEqual([0, 255]);
  });

  it("reads LAYERINFO in base64, and shows every layer when it is unreadable", () => {
    const hidden = sampleCodes();
    const base64 = btoa(
      JSON.stringify([{ layerId: 0, isBackgroundLayer: false, isVisible: false }]),
    );
    const hiddenResult = readSupernote(
      buildSupernote({
        pages: [{ layers: { MAINLAYER: { codes: hidden } }, tags: [["LAYERINFO", base64]] }],
      }),
      "B",
    );
    expect(hiddenResult.attachments).toEqual([]);

    for (const info of ["%%%", "none", '{"layerId"#0}']) {
      const shown = readSupernote(
        buildSupernote({
          pages: [{ layers: { MAINLAYER: { codes: hidden } }, tags: [["LAYERINFO", info]] }],
        }),
        "S",
      );
      expect(shown.attachments).toHaveLength(1);
    }
  });

  it("reports layers it cannot read, and skips layers with no picture", () => {
    const short = new Uint8Array([0x61, 0x10]);
    const result = readSupernote(
      buildSupernote({
        pages: [
          {
            layers: {
              MAINLAYER: { codes: sampleCodes() },
              LAYER1: { raw: short },
              LAYER2: { raw: short, protocol: "SOMETHING_NEW" },
              LAYER3: { noBitmap: true },
            },
          },
          { layers: { MAINLAYER: { address: 99_999_999 } } },
          { layers: { MAINLAYER: { raw: short } } },
        ],
      }),
      "Bad",
    );
    expect(result.doc.pages).toHaveLength(3);
    expect(result.attachments.map((a) => a.name)).toEqual(["Bad - page 1.png"]);
    expect(result.warnings).toContain("3 layers of handwriting could not be read.");

    const one = readSupernote(
      buildSupernote({ pages: [{ layers: { MAINLAYER: { raw: short } } }] }),
      "One",
    );
    expect(one.warnings).toContain("1 layer of handwriting could not be read.");
  });

  it("reads a page of the original format", () => {
    const data = asaPicture((x, y) =>
      y === 7 && x >= 30 && x < 40
        ? 0x0000
        : x === 2 && y === 3
          ? 0x2104
          : y === 4
            ? 0xe1e2
            : 0xffff,
    );
    const result = readSupernote(
      buildSupernote({
        start: "SN_FILE_ASA_20190529",
        pages: [{ data: { bytes: data, protocol: "SN_ASA_COMPRESS" } }, {}],
      }),
      "Old",
    );
    expect(result.doc.pages).toHaveLength(2);
    const png = decodePng(result.attachments[0].bytes);
    expect([png.width, png.height]).toEqual([1404, 1872]);
    expect(pixel(png, 30, 7)).toEqual([0, 255]);
    expect(pixel(png, 39, 7)).toEqual([0, 255]);
    expect(pixel(png, 40, 7)).toEqual([0, 0]);
    expect(pixel(png, 2, 3)).toEqual([0x9d, 255]);
    expect(pixel(png, 1000, 4)).toEqual([0xc9, 255]);
  });

  it("refuses an original-format picture of the wrong size", () => {
    const result = readSupernote(
      buildSupernote({
        start: "SN_FILE_ASA_20190529",
        pages: [
          {
            data: {
              bytes: new Uint8Array([0x78, 0x9c, 3, 0, 0, 0, 0, 1]),
              protocol: "SN_ASA_COMPRESS",
            },
          },
        ],
      }),
      "Old",
    );
    expect(result.warnings).toContain("1 layer of handwriting could not be read.");
  });

  it("lists titled pages in the contents, named by a keyword on the page", () => {
    const result = readSupernote(
      buildSupernote({
        pages: [{}, {}, {}, {}],
        titles: [{ page: 2 }, { page: 2 }, { page: 3 }, { page: 4, broken: true }, { page: 9 }],
        keywords: [
          { page: 2, text: "  Fourier series \n" },
          { page: 2, text: "Second keyword" },
          { page: 4, text: "Unused" },
        ],
        links: 2,
      }),
      "Titles",
    );
    expect(result.doc.pages.map((p) => p.title)).toEqual([
      undefined,
      "Fourier series",
      "Title 2",
      undefined,
    ]);
    expect(result.warnings).toContain(
      "Supernote titles are handwriting: they are listed in the contents by page, not by their words.",
    );
    expect(result.warnings).toContain("2 links could not be brought over.");
  });

  it("skips a keyword it cannot read", () => {
    const bytes = buildSupernote({
      pages: [{}],
      titles: [{ page: 1 }],
      keywords: [{ page: 1, text: "K" }],
    });
    // Point the keyword's text past the end of the file.
    const text = new TextDecoder("latin1").decode(bytes);
    const at = text.indexOf("<KEYWORDSITE:") + "<KEYWORDSITE:".length;
    const corrupted = bytes.slice();
    corrupted.fill("9".charCodeAt(0), at, text.indexOf(">", at));
    const result = readSupernote(corrupted, "K");
    expect(result.doc.pages[0].title).toBe("Title 1");
  });

  it("refuses what it cannot read", () => {
    expect(() => readSupernote(new TextEncoder().encode("PK\u0003\u0004 not a note"), "x")).toThrow(
      SupernoteError,
    );
    const good = buildSupernote({ pages: [{}] });
    expect(() =>
      readSupernote(buildSupernote({ pages: [{}], footerAddress: 9_999_999 }), "x"),
    ).toThrow(/index could not be read/);
    expect(() => readSupernote(buildSupernote({ pages: [] }), "x")).toThrow(/no pages/);
    const truncated = good.slice(0, 40);
    truncated.set(good.subarray(good.length - 4), 36);
    expect(() => readSupernote(truncated, "x")).toThrow(SupernoteError);
    expect(() =>
      readSupernote(
        new TextEncoder().encode("noteSN_FILE_VER_20230015\u0000\u0000\u0000\u0000"),
        "x",
      ),
    ).toThrow(/no pages/);
  });
});

describe("decodeRattaRle", () => {
  it("reads short, long, held and 0xff runs", () => {
    // 0x61 × 3; held 0x62 (n = 0x81) joined to the next 0x62 pair (5): 1 + 5 + 256;
    // held 0x63 (n = 0x80) followed by another code: 128 of 0x63, then 0x61 × 2.
    const data = new Uint8Array([0x61, 2, 0x62, 0x81, 0x62, 5, 0x63, 0x80, 0x61, 1, 0x64, 0xff]);
    const total = 3 + 262 + 128 + 2 + 0x4000;
    expect(decodeRattaRle(data, total)).toEqual([
      0x61, 3, 0x62, 262, 0x63, 128, 0x61, 2, 0x64, 0x4000,
    ]);
  });

  it("fits a pair held at the end to what is left", () => {
    // Held (n = 0x83): (3 + 1) << i for the largest i that fits 40 → 32.
    expect(decodeRattaRle(new Uint8Array([0x61, 7, 0x62, 0x83]), 8 + 32)).toEqual([
      0x61, 8, 0x62, 32,
    ]);
    expect(() => decodeRattaRle(new Uint8Array([0x61, 7, 0x62, 0x83]), 10)).toThrow(SupernoteError);
  });

  it("refuses a picture of the wrong size", () => {
    expect(() => decodeRattaRle(new Uint8Array([0x61, 9, 0x62]), 5)).toThrow(/10 pixels/);
  });
});

describe("rleGrey", () => {
  it("maps X and X2 colour codes", () => {
    expect(rleGrey(0x62, false)).toBeNull();
    expect([0x61, 0x66, 0x65].map((c) => rleGrey(c, false))).toEqual([0, 0, 0xfe]);
    expect([0x63, 0x64].map((c) => rleGrey(c, false))).toEqual([0x9d, 0xc9]);
    expect([0x63, 0x64].map((c) => rleGrey(c, true))).toEqual([0x30, 0x50]);
    expect([0x67, 0x9e, 0x68, 0xca].map((c) => rleGrey(c, true))).toEqual([0x9d, 0x9d, 0xc9, 0xc9]);
    expect(rleGrey(0x9d, true)).toBe(0x9d);
    expect(rleGrey(0x80, true)).toBe(0x80);
  });
});

describe("encodePng", () => {
  it("writes every channel count and round-trips the pixels", () => {
    for (const channels of [1, 2, 3, 4] as const) {
      const pixels = Uint8Array.from({ length: 3 * 2 * channels }, (_, i) => (i * 37) & 0xff);
      const png = encodePng(3, 2, pixels, channels);
      expect(Array.from(png.subarray(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const back = decodePng(png);
      expect([back.width, back.height]).toEqual([3, 2]);
      expect(back.colourType).toBe({ 1: 0, 2: 4, 3: 2, 4: 6 }[channels]);
      expect(Array.from(back.pixels)).toEqual(Array.from(pixels));
    }
  });

  it("checks each chunk's CRC", () => {
    const png = encodePng(1, 1, new Uint8Array([7]), 1);
    const view = new DataView(png.buffer);
    const length = view.getUint32(8);
    expect(view.getUint32(16 + length)).toBe(crc32(png.subarray(12, 16 + length)));
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("refuses pixels that do not fit the size", () => {
    expect(() => encodePng(2, 2, new Uint8Array(3), 1)).toThrow();
    expect(() => encodePng(0, 2, new Uint8Array(0), 1)).toThrow();
  });
});
