/**
 * Writes the file-format goldens from whatever `src/model/` is checked out.
 *
 * The goldens in this folder were generated at 4d194c3, the last commit before
 * the serializer was rewritten, and are meant to stay exactly as they are:
 * they are the record of what every existing note decodes to and re-saves as.
 * Regenerating them from newer code proves nothing, because the code would be
 * checked against itself. Run this only against a commit you trust, and read
 * the diff before committing it.
 *
 *     npx esbuild tests/model/goldens/generate.ts --bundle --platform=node \
 *       --format=esm --outfile=<tmp>/generate.mjs
 *     node <tmp>/generate.mjs tests/model/goldens <commit>
 *     npx prettier --write tests/model/goldens/*.json
 *
 * It is not a test (its name does not end in `.test.ts`), so Vitest never runs it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, gzipSync, strToU8, zlibSync } from "fflate";
import { deflateToBase64, inflateFromBase64 } from "../../../src/model/compress";
import { emptyDocument } from "../../../src/model/document";
import {
  SerializeError,
  buildInkFile,
  decodeDocument,
  dequantizePts,
  encodeDocument,
  parseInkFile,
  quantizePts,
  splitFrontmatter,
} from "../../../src/model/serialize";
import {
  type CompressGoldens,
  type DecodeGoldens,
  type EncodeGoldens,
  type FileGoldens,
  type InflateOutcome,
  type Outcome,
  compressTexts,
  goldenDocuments,
  parseTagged,
  sha256,
  stringifyTagged,
} from "./cases";

const [outDir, commit] = process.argv.slice(2);
if (!outDir || !commit) throw new Error("usage: generate.mjs <out-dir> <commit>");

function errorClass(error: unknown): string {
  if (error instanceof SerializeError) return "SerializeError";
  return error instanceof Error ? error.constructor.name : typeof error;
}

function outcome(payload: string, fallbackWidth: number | null): Outcome {
  try {
    const doc =
      fallbackWidth === null ? decodeDocument(payload) : decodeDocument(payload, fallbackWidth);
    return { doc: stringifyTagged(doc), reencoded: encodeDocument(doc) };
  } catch (error) {
    return { error: errorClass(error) };
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * A payload around JSON text. Placeholders stand for the numbers
 * `JSON.stringify` cannot write: `"@INF@"` becomes `1e400` (which parses as
 * Infinity), `"@-INF@"` becomes `-1e400` and `"@-0@"` becomes `-0`.
 */
function payloadOf(raw: unknown, version = "v2"): string {
  const text = JSON.stringify(raw)
    .split('"@INF@"')
    .join("1e400")
    .split('"@-INF@"')
    .join("-1e400")
    .split('"@-0@"')
    .join("-0");
  return `${version}:${deflateToBase64(text)}`;
}

function payloadOfText(text: string, version = "v2"): string {
  return `${version}:${deflateToBase64(text)}`;
}

const INF = "@INF@";
const NEG_INF = "@-INF@";
const NEG_ZERO = "@-0@";

// --- Encode -----------------------------------------------------------------

function encodeGoldens(): EncodeGoldens {
  const documents = goldenDocuments().map(({ name, doc }) => {
    const payload = encodeDocument(doc);
    return {
      name,
      inputSha256: sha256(stringifyTagged(doc)),
      payload,
      decodedSha256: sha256(stringifyTagged(decodeDocument(payload))),
    };
  });
  const emptyDocuments = [null, 1024, 640, 800.5].map((width) => {
    const doc = width === null ? emptyDocument() : emptyDocument(width);
    return { width, json: stringifyTagged(doc), payload: encodeDocument(doc) };
  });
  const pointInputs: Array<[string, number[]]> = [
    ["empty", []],
    ["one-point", [12.345, 67.891, 0.5]],
    ["rounding-edges", [1.005, 2.675, 127.5 / 255, -0.025, -1.005, 254.5 / 255]],
    ["pressure-out-of-range", [0, 0, 1.2, 0, 0, -0.1, 0, 0, 2]],
    ["ragged-by-one", [1, 2, 0.5, 3]],
    ["ragged-by-two", [1, 2, 0.5, 3, 4]],
    ["non-finite", [NaN, Infinity, NaN, -Infinity, 1, Infinity]],
    ["large", [1e6, -1e6, 1, 123456.789, 0.001, 0.0019]],
  ];
  const quantizedInputs: Array<[string, number[]]> = [
    ["q-empty", []],
    ["q-integers", [1234, 5678, 128, -5, 0, 255]],
    ["q-ragged", [100, 200, 128, 300]],
    ["q-non-integers", [1.5, 2.25, 127.5]],
    ["q-pressure-past-255", [0, 0, 300, 0, 0, -10]],
  ];
  const points = [
    ...pointInputs.map(([name, input]) => ({
      name,
      input: stringifyTagged(input),
      quantized: stringifyTagged(quantizePts(input)),
      restored: stringifyTagged(dequantizePts(quantizePts(input))),
    })),
    ...quantizedInputs.map(([name, input]) => ({
      name,
      input: stringifyTagged(input),
      quantized: stringifyTagged(quantizePts(dequantizePts(input))),
      restored: stringifyTagged(dequantizePts(input)),
    })),
  ];
  return { commit, documents, emptyDocuments, points };
}

// --- Decode -----------------------------------------------------------------

const VIEW = { scrollY: 0, width: 1024, scale: 1 };

function onePage(page: Record<string, unknown>): Record<string, unknown> {
  return { version: 2, view: VIEW, pages: [{ id: "p1", kind: "ink", ...page }] };
}

function strokesDoc(strokes: unknown): Record<string, unknown> {
  return onePage({ strokes });
}

function fixturePayload(name: string): string {
  const raw = JSON.parse(readFileSync(`contracts/fixtures/${name}.json`, "utf8")) as Record<
    string,
    unknown
  >;
  // Fixtures are decoded documents (world-space floats); the wire holds the
  // quantized form, so quantize on the way in (contracts/api.md §5).
  for (const key of ["pages", "regions"]) {
    for (const page of (raw[key] as Array<Record<string, unknown>> | undefined) ?? []) {
      for (const stroke of (page.strokes as Array<Record<string, unknown>> | undefined) ?? []) {
        stroke.pts = quantizePts(stroke.pts as number[]);
      }
    }
  }
  return payloadOf(raw, raw.regions ? "v1" : "v2");
}

function decodeGoldens(): DecodeGoldens {
  const valid = payloadOf(onePage({ strokes: [{ id: "s1", pts: [100, 200, 128] }] }));
  const validBase64 = valid.slice(3);
  const validJson = JSON.stringify(onePage({ strokes: [{ id: "s1", pts: [100, 200, 128] }] }));
  const deflated = deflateSync(strToU8(validJson));

  const cases: Array<[string, string, number | null]> = [];
  const add = (name: string, payload: string, fallbackWidth: number | null = null): void => {
    cases.push([name, payload, fallbackWidth]);
  };

  // The envelope: `v<n>:` + base64(raw deflate(UTF-8 JSON)).
  add("env-valid", valid);
  add("env-no-prefix", "not-a-payload");
  add("env-empty-string", "");
  add("env-uppercase-v", `V2:${validBase64}`);
  add("env-no-colon", `v2${validBase64}`);
  add("env-version-letters", `vX:${validBase64}`);
  add("env-version-empty", `v:${validBase64}`);
  add("env-version-9", `v9:${validBase64}`);
  add("env-version-0", `v0:${validBase64}`);
  add("env-version-negative", `v-1:${validBase64}`);
  add("env-version-fraction", `v2.5:${validBase64}`);
  add("env-version-hex", `v0x10:${validBase64}`);
  add("env-version-space", `v 2:${validBase64}`);
  add("env-version-infinity", `vInfinity:${validBase64}`);
  add("env-whitespace-around", `  \n v2:${validBase64} \t\n`);
  add("env-bom-before", `\ufeffv2:${validBase64}`);
  add("env-base64-wrapped", `v2:${validBase64.replace(/(.{20})/g, "$1\n")}`);
  add("env-base64-spaces", `v2:${validBase64.replace(/(.{7})/g, "$1 ")}`);
  add("env-base64-unpadded", `v2:${validBase64.replace(/=+$/, "")}`);
  add("env-base64-bad-chars", "v2:@@@@");
  add("env-base64-empty", "v2:");
  add("env-base64-length-mod-4-is-1", "v2:abcde");
  add("env-second-colon", `v2:${validBase64}:junk`);
  add("env-not-deflate", `v2:${base64(strToU8("hello world, not deflate"))}`);
  add("env-zlib-wrapped", `v2:${base64(zlibSync(strToU8(validJson)))}`);
  add("env-gzip-wrapped", `v2:${base64(gzipSync(strToU8(validJson), { mtime: 0 }))}`);
  add("env-stored-blocks", `v2:${base64(deflateSync(strToU8(validJson), { level: 0 }))}`);
  add("env-truncated", valid.slice(0, valid.length - 12));
  const trailing = new Uint8Array(deflated.length + 7);
  trailing.set(deflated);
  trailing.set(strToU8("garbage"), deflated.length);
  add("env-trailing-garbage", `v2:${base64(trailing)}`);
  const badUtf8 = new Uint8Array([
    ...strToU8('{"meta":{"recognizedHash":"a'),
    0xff,
    0xc3,
    ...strToU8('b"}}'),
  ]);
  add("env-invalid-utf8-in-string", `v2:${base64(deflateSync(badUtf8))}`);
  add("env-bom-in-json", payloadOfText(`\ufeff${validJson}`));
  add("env-not-json", payloadOfText("this is not json"));
  add("env-json-empty-text", payloadOfText(""));
  add("env-json-number", payloadOfText("123"));
  add("env-json-string", payloadOfText('"str"'));
  add("env-json-null", payloadOfText("null"));
  add("env-json-true", payloadOfText("true"));
  add("env-json-array", payloadOfText("[]"));
  add("env-json-array-of-pages", payloadOfText('[{"id":"p1"}]'));
  add("env-json-duplicate-keys", payloadOfText('{"pages":[{"id":"a"}],"pages":[{"id":"b"}]}'));

  // The document.
  add("doc-empty-object", payloadOf({}));
  add("doc-empty-object-fallback-800", payloadOf({}), 800);
  add("doc-empty-object-fallback-0", payloadOf({}), 0);
  add("doc-empty-object-fallback-negative", payloadOf({}), -5);
  add("doc-pages-empty", payloadOf({ pages: [] }));
  add("doc-pages-junk", payloadOf({ pages: [null, 7, "x", [], {}, true] }));
  add("doc-pages-not-array", payloadOf({ pages: { id: "p1" }, regions: [{ id: "r1" }] }));
  add(
    "doc-pages-and-regions",
    payloadOf({ pages: [{ id: "pA" }], regions: [{ id: "rB", strokes: [{ pts: [1, 2, 3] }] }] }),
  );
  add("doc-view-missing-fallback-700", payloadOf({ pages: [{ id: "p1" }] }), 700);
  add("doc-view-partial", payloadOf({ view: { width: "wide", scale: 2 }, pages: [] }));
  add("doc-view-number", payloadOf({ view: 5 }));
  add("doc-view-array", payloadOf({ view: [1, 2, 3] }));
  add("doc-view-negative-width", payloadOf({ view: { width: -10 }, pages: [{}] }));
  add("doc-view-zero-width", payloadOf({ view: { width: 0 }, pages: [{}] }));
  add("doc-view-infinite", payloadOf({ view: { scrollY: INF, width: INF, scale: NEG_INF } }));
  add("doc-view-extra-keys", payloadOf({ view: { zoom: 3, scale: 2, width: 900, scrollY: 12 } }));
  add("doc-version-field-ignored", payloadOf({ version: "banana", pages: [{ id: "p1" }] }));
  add("doc-extra-top-level-keys", payloadOf({ pages: [{ id: "p1", extra: 1 }], extra: true }));
  add("doc-key-order-reversed", payloadOf({ pages: [{ id: "p1" }], view: VIEW, version: 2 }));

  // v1: one unbounded region per page.
  add(
    "v1-regions",
    payloadOf(
      {
        version: 1,
        view: VIEW,
        regions: [{ id: "r1", kind: "ink", strokes: [{ id: "s1", pts: [1000, 2000, 128] }] }],
      },
      "v1",
    ),
  );
  add(
    "v1-deep-ink",
    payloadOf(
      { view: VIEW, regions: [{ id: "r1", strokes: [{ pts: [100, 190000, 128] }] }] },
      "v1",
    ),
  );
  add(
    "v1-ink-just-past-default",
    payloadOf({ view: VIEW, regions: [{ strokes: [{ pts: [0, 84812, 0, 0, 84900, 9] }] }] }, "v1"),
  );
  add(
    "v1-width-from-view",
    payloadOf({ view: { width: 800 }, regions: [{ strokes: [{ pts: [1, 2, 3] }] }] }, "v1"),
  );
  add("v1-no-view-fallback-640", payloadOf({ regions: [{ id: "r1" }] }, "v1"), 640);
  add("v1-regions-empty", payloadOf({ view: VIEW, regions: [] }, "v1"));
  add(
    "v1-regions-junk",
    payloadOf({ view: VIEW, regions: [null, { strokes: "x" }, { id: 5 }, []] }, "v1"),
  );
  add(
    "v1-region-extras-dropped",
    payloadOf(
      {
        view: VIEW,
        regions: [
          {
            id: "r1",
            backdrop: { kind: "lined" },
            images: [{ path: "a.png" }],
            geometry: { width: 5, height: 5 },
            strokes: [{ id: "s1", pts: [1, 2, 3], t0: 900, shape: "line" }],
          },
        ],
      },
      "v1",
    ),
  );
  add(
    "v1-negative-ink",
    payloadOf(
      { view: VIEW, regions: [{ strokes: [{ pts: [-100, -200, 1] }, { pts: [] }] }] },
      "v1",
    ),
  );

  // Meta and recordings.
  for (const [name, meta] of [
    ["meta-hash", { recognizedHash: "abc" }],
    ["meta-hash-empty", { recognizedHash: "" }],
    ["meta-hash-number", { recognizedHash: 5 }],
    ["meta-single-true", { single: true }],
    ["meta-single-string", { single: "true" }],
    ["meta-single-one", { single: 1 }],
    ["meta-folders", { folders: { images: "A", audio: "Audio/2026", exports: "E" } }],
    ["meta-folders-bad", { folders: { images: "", audio: ".x", exports: 5, other: "O" } }],
    ["meta-folders-array", { folders: ["A"] }],
    ["meta-folders-spaced", { folders: { images: " A/b/ ", audio: "/Audio/" } }],
    ["meta-scroll-horizontal", { scroll: "horizontal" }],
    ["meta-scroll-vertical", { scroll: "vertical" }],
    ["meta-scroll-true", { scroll: true }],
    [
      "meta-everything-reversed",
      { scroll: "horizontal", folders: { images: "I" }, single: true, recognizedHash: "h" },
    ],
  ] as const) {
    add(name, payloadOf({ view: VIEW, pages: [{ id: "p1" }], meta }));
  }
  add("meta-string", payloadOf({ pages: [], meta: "string" }));
  add("meta-array", payloadOf({ pages: [], meta: [] }));
  add(
    "recordings-mixed",
    payloadOf({
      pages: [],
      recordings: [
        null,
        { path: "a.m4a", start: 1 },
        { path: "", start: 5 },
        { path: "b.m4a", start: 0 },
        { path: "c.m4a", start: 1.5e12, duration: -3 },
        { path: "d.m4a", start: 1790000000000.6, duration: 1500.5, transcript: "" },
        { id: "rx", path: "e.m4a", start: 2e12, transcript: "T.md", extra: 1 },
        { path: "f.m4a", start: "1" },
        { path: "g.m4a", start: INF },
        { transcript: "x.md", duration: 5, start: 3e12, path: "h.m4a", id: 7 },
      ],
    }),
  );
  add("recordings-not-array", payloadOf({ pages: [], recordings: { path: "a", start: 1 } }));
  add("recordings-all-invalid", payloadOf({ pages: [], recordings: [{ path: "a" }] }));

  // Pages.
  add("page-ids-missing", payloadOf({ view: VIEW, pages: [{}, { id: "p1" }, {}] }));
  add("page-ids-duplicate", payloadOf({ view: VIEW, pages: [{ id: "p1" }, { id: "p1" }] }));
  add("page-id-number", payloadOf({ view: VIEW, pages: [{ id: 5 }] }));
  add("page-kind-other", payloadOf({ view: VIEW, pages: [{ id: "p1", kind: "pdf" }] }));
  for (const [name, geometry] of [
    ["geometry-missing", undefined],
    ["geometry-zero-negative", { width: 0, height: -5 }],
    ["geometry-strings", { width: "1024", height: "1448" }],
    ["geometry-infinite", { width: INF, height: NEG_INF }],
    ["geometry-fractional", { width: 800.5, height: 1200.25 }],
    ["geometry-array", [1024, 1448]],
    ["geometry-null", null],
    ["geometry-reversed-extra", { depth: 3, height: 900, width: 700 }],
  ] as const) {
    add(name, payloadOf(onePage({ geometry })));
  }
  for (const [name, epoch] of [
    ["epoch-zero", 0],
    ["epoch-negative", -1],
    ["epoch-small", 1.5],
    ["epoch-string", "1"],
    ["epoch-fraction", 1790000000123.4],
    ["epoch-half", 1790000000123.5],
    ["epoch-infinite", INF],
    ["epoch-true", true],
  ] as const) {
    add(name, payloadOf(onePage({ epoch })));
  }
  for (const [name, bookmarked] of [
    ["bookmarked-true", true],
    ["bookmarked-string", "true"],
    ["bookmarked-one", 1],
    ["bookmarked-false", false],
  ] as const) {
    add(name, payloadOf(onePage({ bookmarked })));
  }
  add(
    "page-key-order-scrambled",
    payloadOf({
      view: VIEW,
      pages: [
        {
          bookmarked: true,
          strokes: [{ pts: [1, 2, 3] }],
          textBoxes: [{ text: "t" }],
          images: [{ path: "a.png" }],
          epoch: 1790000000123,
          backdrop: { kind: "dotted" },
          geometry: { height: 1000, width: 700 },
          kind: "ink",
          id: "p1",
        },
      ],
    }),
  );

  // Backdrops.
  for (const [name, backdrop] of [
    ["backdrop-missing", undefined],
    ["backdrop-null", null],
    ["backdrop-string", "lined"],
    ["backdrop-kind-number", { kind: 5 }],
    ["backdrop-unknown-ruling", { kind: "hexagon" }],
    ["backdrop-toString", { kind: "toString" }],
    ["backdrop-constructor", { kind: "constructor" }],
    ["backdrop-proto", { kind: "__proto__" }],
    ["backdrop-valueOf", { kind: "valueOf" }],
    ["backdrop-lined-full", { kind: "lined", spacing: 36, color: "#eee", paperColor: "#fdf6d8" }],
    ["backdrop-spacing-zero", { kind: "ruled-wide", spacing: 0 }],
    ["backdrop-spacing-negative", { kind: "ruled-wide", spacing: -1 }],
    ["backdrop-spacing-string", { kind: "ruled-wide", spacing: "40" }],
    ["backdrop-spacing-infinite", { kind: "squared", spacing: INF }],
    ["backdrop-spacing-fraction", { kind: "squared", spacing: 36.5 }],
    ["backdrop-color-number", { kind: "dotted", color: 5, paperColor: null }],
    [
      "backdrop-reversed-extra",
      { extra: 1, paperColor: "#c0643f", color: "#111", kind: "cover-band" },
    ],
    ["backdrop-every-ruling-cover", { kind: "cover-linen", paperColor: "#123456" }],
    ["pdf-no-path", { kind: "pdf" }],
    ["pdf-empty-path", { kind: "pdf", path: "" }],
    ["pdf-path-number", { kind: "pdf", path: 5 }],
    ["pdf-no-page", { kind: "pdf", path: "a.pdf" }],
    ["pdf-page-negative", { kind: "pdf", path: "a.pdf", page: -3 }],
    ["pdf-page-half", { kind: "pdf", path: "a.pdf", page: 2.5 }],
    ["pdf-page-just-under-half", { kind: "pdf", path: "a.pdf", page: 2.4999 }],
    ["pdf-page-string", { kind: "pdf", path: "a.pdf", page: "3" }],
    ["pdf-page-infinite", { kind: "pdf", path: "a.pdf", page: INF }],
    [
      "pdf-extras-dropped",
      { page: 4, path: "Lectures/w3.pdf", kind: "pdf", spacing: 3, color: "x" },
    ],
  ] as const) {
    add(name, payloadOf(onePage({ backdrop, strokes: [{ pts: [0, 0, 100] }] })));
  }

  // Strokes.
  add("strokes-not-array-string", payloadOf(strokesDoc("x")));
  add("strokes-not-array-object", payloadOf(strokesDoc({ pts: [1, 2, 3] })));
  add("strokes-null", payloadOf(strokesDoc(null)));
  add(
    "strokes-junk-entries",
    payloadOf(strokesDoc([null, 42, "s", [1, 2, 3], { pts: [0, 0, 0] }, true])),
  );
  for (const [name, pts] of [
    ["pts-ragged-1", [5]],
    ["pts-ragged-2", [5, 6]],
    ["pts-ragged-4", [1, 2, 3, 4]],
    ["pts-ragged-5", [1, 2, 3, 4, 5]],
    ["pts-ragged-7", [1, 2, 3, 4, 5, 6, 7]],
    ["pts-nulls", [10, null, 128, null, 40, 128, 50, 60, null]],
    ["pts-mixed-junk", ["3", true, [1], {}, 7, false, "x", 8, 9]],
    ["pts-infinite", [INF, NEG_INF, 128, 1e308, -1e308, 255]],
    ["pts-negative-zero", [NEG_ZERO, 5, NEG_ZERO]],
    ["pts-non-integers", [1.5, 2.25, 127.5, -0.5, -1.5, 0.5]],
    ["pts-pressure-out-of-range", [0, 0, 300, 0, 0, -5, 0, 0, 256]],
    ["pts-string", "1,2,3"],
    ["pts-object", { 0: 1, 1: 2, 2: 3, length: 3 }],
    ["pts-null", null],
    ["pts-empty", []],
  ] as const) {
    add(name, payloadOf(strokesDoc([{ id: "s1", pts }])));
  }
  add(
    "stroke-fields-defaults-and-junk",
    payloadOf(
      strokesDoc([
        { pts: [1, 2, 3] },
        { id: 5, color: 5, size: 0, tool: "eraser", pts: [1, 2, 3] },
        { id: "", color: "", size: -1, tool: null, pts: [1, 2, 3] },
        { id: "sX", color: "#123", size: "3", tool: "HIGHLIGHTER", pts: [1, 2, 3] },
        { size: INF, tool: "highlighter", pts: [1, 2, 3] },
        { size: 2.5, pts: [1, 2, 3], extra: "dropped" },
      ]),
    ),
  );
  add(
    "stroke-shapes",
    payloadOf(
      strokesDoc(
        ["line", "star", "polygon", "hexagon", "", 5, "toString", null, "Circle"].map((shape) => ({
          pts: [1, 2, 3],
          shape,
        })),
      ),
    ),
  );
  add(
    "stroke-t0",
    payloadOf(
      strokesDoc(
        [-5, NEG_ZERO, 0, 12.5, 12.4999, "12", null, INF, 2.5, -0.4, 3600000, true].map((t0) => ({
          pts: [1, 2, 3],
          t0,
        })),
      ),
    ),
  );
  add(
    "stroke-key-order-reversed",
    payloadOf(
      strokesDoc([
        {
          t0: 5,
          shape: "rect",
          pts: [1, 2, 3],
          tool: "highlighter",
          size: 8,
          color: "#f00",
          id: "s9",
        },
      ]),
    ),
  );
  add(
    "stroke-ids-duplicate",
    payloadOf(strokesDoc([{ id: "s1", pts: [] }, { id: "s1", pts: [] }, { pts: [] }])),
  );

  // Images.
  add("images-not-array", payloadOf(onePage({ images: { path: "a.png" } })));
  add(
    "images-mixed",
    payloadOf(
      onePage({
        images: [
          null,
          {},
          { path: "" },
          { path: 5 },
          { path: "a.png" },
          { path: "b.png", w: 0, h: -5 },
          { path: "c.png", w: 0.5, h: "9" },
          { path: "d.png", rotation: 0 },
          { path: "e.png", rotation: "1" },
          { path: "f.png", rotation: INF },
          { path: "g.png", locked: "yes" },
          { path: "h.png", locked: true },
          { path: "i.png", locked: 1 },
          {
            locked: true,
            rotation: -1.25,
            h: 20,
            w: 30,
            y: 2,
            x: 1,
            path: "j.png",
            id: "i7",
            z: 1,
          },
        ],
      }),
    ),
  );
  add(
    "image-ids",
    payloadOf(
      onePage({
        images: [
          { id: "i3", path: "a.png" },
          { path: "b.png" },
          { id: "i3", path: "c.png" },
          { id: "i01", path: "d.png" },
          { id: "img7", path: "e.png" },
          { id: "i9" },
          { path: "f.png" },
          { id: "i-4", path: "g.png" },
          { id: 12, path: "h.png" },
        ],
      }),
    ),
  );
  add(
    "image-ids-huge",
    payloadOf(onePage({ images: [{ id: "i99999999999999999999", path: "a" }, { path: "b" }] })),
  );
  for (const [name, crop] of [
    ["crop-valid", { x: 0.1, y: 0, w: 0.8, h: 1 }],
    ["crop-whole", { x: 0, y: 0, w: 1, h: 1 }],
    ["crop-whole-within-eps", { x: 0, y: 0, w: 1.0000000001, h: 1 }],
    ["crop-over-within-eps", { x: 0.5, y: 0.5, w: 0.5000000001, h: 0.5 }],
    ["crop-over-past-eps", { x: 0.5, y: 0.5, w: 0.500001, h: 0.5 }],
    ["crop-sliver", { x: 0, y: 0, w: 0.009, h: 1 }],
    ["crop-min", { x: 0, y: 0, w: 0.01, h: 0.01 }],
    ["crop-negative", { x: -0.1, y: 0, w: 0.5, h: 0.5 }],
    ["crop-out-of-range", { x: 0.6, y: 0, w: 0.5, h: 0.5 }],
    ["crop-missing-field", { x: 0.1, y: 0.1, w: 0.5 }],
    ["crop-string-field", { x: "0.1", y: 0.1, w: 0.5, h: 0.5 }],
    ["crop-array", [0.1, 0.1, 0.5, 0.5]],
    ["crop-null", null],
    ["crop-reversed-extra", { z: 1, h: 0.5, w: 0.25, y: 0.25, x: 0.5 }],
    ["crop-infinite", { x: 0, y: 0, w: INF, h: 0.5 }],
    ["crop-full-width-offset", { x: 0, y: 0.2, w: 1, h: 0.5 }],
  ] as const) {
    add(name, payloadOf(onePage({ images: [{ id: "i1", path: "a.png", crop }] })));
  }

  // Text boxes.
  add("textboxes-not-array", payloadOf(onePage({ textBoxes: "t" })));
  add(
    "textboxes-mixed",
    payloadOf(
      onePage({
        textBoxes: [
          null,
          {},
          { text: 5 },
          { text: "" },
          { text: "a", w: 40 },
          { text: "a", w: 40, fit: true },
          { text: "a", w: 4, fit: true },
          { text: "a", w: 40, fit: "yes" },
          { text: "a", h: 10 },
          { text: "a", h: 0 },
          { text: "a", h: -5 },
          { text: "a", h: "5" },
          { text: "a", h: INF },
          { text: "a", h: 30.5 },
          { text: "a", fontSize: 8 },
          { text: "a", fontSize: "20" },
          { text: "a", fontSize: 12.5 },
          { text: "a", color: 5 },
          { text: "a", w: "300", x: "1", y: null },
        ],
      }),
    ),
  );
  add(
    "textbox-styles",
    payloadOf(
      onePage({
        textBoxes: [
          { text: "a", font: "comic", bold: "true", italic: 1, underline: false, strike: null },
          { text: "b", font: "serif", bold: true, italic: true, underline: true, strike: true },
          { text: "c", align: "middle", lineHeight: 0.79, fill: "red" },
          { text: "d", align: "center", lineHeight: 0.8, fill: "#abc" },
          { text: "e", align: "justify", lineHeight: 3, fill: "#abcd" },
          { text: "f", lineHeight: 3.01, fill: "#aabbcc" },
          { text: "g", lineHeight: "1.5", fill: "#aabbccdd" },
          { text: "h", lineHeight: INF, fill: "#ABCDEF" },
          { text: "i", fill: "#GGG" },
          { text: "j", fill: "#aabbccd" },
          { text: "k", fill: 5, font: "toString", align: "constructor" },
        ],
      }),
    ),
  );
  add(
    "textbox-key-order-reversed",
    payloadOf(
      onePage({
        textBoxes: [
          {
            fill: "#fff3bf",
            lineHeight: 1.5,
            align: "right",
            strike: true,
            underline: true,
            italic: true,
            bold: true,
            font: "mono",
            fontSize: 30,
            color: "#e03131",
            text: "reversed",
            fit: true,
            h: 50,
            w: 200,
            y: 20,
            x: 10,
            id: "t4",
            extra: "dropped",
          },
        ],
      }),
    ),
  );
  add(
    "textbox-ids",
    payloadOf(
      onePage({
        textBoxes: [
          { id: "t2", text: "a" },
          { text: "b" },
          { id: "t10" },
          { text: "c" },
          { id: "i5", text: "d" },
        ],
      }),
    ),
  );
  add(
    "textbox-unicode-text",
    payloadOf(onePage({ textBoxes: [{ text: '漢字 🖊️ \u2028 "quoted" \\ %%\n%%goodobsidian' }] })),
  );

  // The six contract fixtures (decoded JSON, quantized on the way in).
  for (const name of [
    "doc-v1-legacy",
    "doc-v2-empty",
    "doc-v2-three-pages",
    "doc-v2-pdf-backdrop",
    "doc-v2-images",
    "doc-v2-shapes",
  ]) {
    add(`fixture-${name}`, fixturePayload(name));
  }

  return {
    commit,
    cases: cases.map(([name, payload, fallbackWidth]) => ({
      name,
      payload,
      fallbackWidth,
      ...outcome(payload, fallbackWidth),
    })),
  };
}

// --- The note file ----------------------------------------------------------

function fileGoldens(): FileGoldens {
  const small = {
    version: 2,
    view: { scrollY: 0, width: 1024, scale: 1 },
    pages: [
      {
        id: "p1",
        kind: "ink",
        geometry: { width: 1024, height: 1448 },
        backdrop: { kind: "ruled-wide" },
        strokes: [{ id: "s1", color: "#1971c2", size: 5, tool: "pen", pts: [12.04, 5.51, 0.5] }],
        images: [{ id: "i1", path: "a.png", x: 1, y: 2, w: 30, h: 40 }],
        textBoxes: [{ id: "t1", x: 5, y: 6, w: 200, text: "hi", color: "#1a1a1a", fontSize: 22 }],
      },
    ],
  };
  const docs: Record<string, unknown> = {
    empty: emptyDocument(1024),
    small,
  };

  const bodies: Array<[string, string]> = [
    ["empty", ""],
    ["whitespace-only", " \n\t \n"],
    ["heading", "# T"],
    ["trailing-newlines", "# T\n\n\n"],
    ["trailing-spaces-tabs", "# T  \t\n \t"],
    ["trailing-nbsp-and-bom", "# T\u00a0\ufeff"],
    ["only-bom", "\ufeff"],
    ["frontmatter", "---\ngoodobsidian: true\ngoodobsidian-version: 2\n---\n\n# Notes"],
    ["frontmatter-bom", "\ufeff---\ngoodobsidian: true\ngoodobsidian-version: 2\n---\n\n# Notes"],
    ["frontmatter-crlf", "---\r\ngoodobsidian: true\r\n---\r\n\r\n# Notes\r\n"],
    ["legacy-keys", "---\ninkedmark: true\ninkedmark-version: 2\ntags: [a]\n---\n\nBody"],
    ["legacy-keys-no-space", "---\ninkedmark:true\ninkedmark-version:3\n---\nBody"],
    ["legacy-keys-bom", "\ufeff---\ninkedmark: true\ninkedmark-version: 2\n---\n\nBody"],
    ["legacy-keys-crlf", "---\r\ninkedmark: true\r\ninkedmark-version: 2\r\n---\r\nBody"],
    ["legacy-keys-not-at-start", "# x\n---\ninkedmark: true\n---\n"],
    ["legacy-keys-in-prose", "---\ntags: [a]\n---\ninkedmark: true\ninkedmark-version: 2\n"],
    [
      "legacy-lookalike-keys",
      "---\ninkedmark-versionx: 3\n inkedmark: true\nnote: inkedmark: x\n---\n",
    ],
    ["legacy-unterminated", "---\ninkedmark: true\n"],
    [
      "text-layer",
      "# T\n\nProse.\n\n<!--goodobsidian-text-->\nrecognised\n<!--/goodobsidian-text-->\n",
    ],
    ["block-lookalike-in-prose", "Some %%goodobsidian text %% here"],
  ];

  const build: FileGoldens["build"] = [];
  for (const [bodyName, body] of bodies) {
    for (const [docName, doc] of Object.entries(docs)) {
      const docText = stringifyTagged(doc);
      build.push({
        name: `${bodyName}+${docName}`,
        body,
        doc: docText,
        file: buildInkFile(body, parseTagged(docText) as never),
      });
    }
  }

  const p = encodeDocument(small as never);
  const legacyPayload = encodeDocument(emptyDocument(1024));
  const wrapped = p.replace(/(.{40})/g, "$1\n");
  const markdowns: Array<[string, string, number | null]> = [
    ["block-at-end", `# T\n\n%%goodobsidian\n${p}\n%%\n`, null],
    ["block-only", `%%goodobsidian\n${p}\n%%\n`, null],
    ["block-no-final-newline", `# T\n\n%%goodobsidian\n${p}\n%%`, null],
    ["block-blank-lines-around", `# T\n\n\n\n%%goodobsidian\n${p}\n%%\n\nafter`, null],
    ["block-indented", `# T\n  \t%%goodobsidian \t\n${p}\n \t%% \t\n`, null],
    ["block-in-middle", `a\n%%goodobsidian\n${p}\n%%\nb`, null],
    ["block-no-blank-line-before", `text\n%%goodobsidian\n${p}\n%%\n`, null],
    ["block-at-very-start-after-newlines", `\n\n\n%%goodobsidian\n${p}\n%%\ntail`, null],
    ["block-crlf", `# T\r\n\r\n%%goodobsidian\r\n${p}\r\n%%\r\n`, null],
    ["block-crlf-payload-line", `# T\n%%goodobsidian\n${p}\r\n%%\n`, null],
    ["block-legacy-label", `# T\n\n%%inkedmark\n${legacyPayload}\n%%\n`, null],
    [
      "two-blocks-legacy-first",
      `%%inkedmark\n${legacyPayload}\n%%\nmid\n%%goodobsidian\n${p}\n%%\n`,
      null,
    ],
    [
      "two-blocks-current-first",
      `%%goodobsidian\n${p}\n%%\nmid\n%%inkedmark\n${legacyPayload}\n%%\n`,
      null,
    ],
    ["label-with-space", `%% goodobsidian\n${p}\n%%\n`, null],
    ["label-with-suffix", `%%goodobsidianx\n${p}\n%%\n`, null],
    ["label-uppercase", `%%GoodObsidian\n${p}\n%%\n`, null],
    ["block-empty-payload", "# T\n%%goodobsidian\n\n%%\n", null],
    ["block-unreadable", "# Title\n\n%%goodobsidian\nv2:@@@garbage@@@\n%%\n", null],
    ["block-wrapped-payload", `# T\n%%goodobsidian\n${wrapped}\n%%\n`, null],
    ["block-unclosed", `# T\n%%goodobsidian\n${p}\n`, null],
    ["block-closing-followed-by-text", `%%goodobsidian\n${p}\n%% trailing\nmore`, null],
    ["block-payload-padded", `%%goodobsidian\n  ${p}  \n%%\n`, null],
    ["block-closing-percent-in-payload-line", `%%goodobsidian\n${p} %%\n%%\n`, null],
    ["no-block", "# Just markdown\n\nNo ink here.", null],
    ["empty-string", "", null],
    ["percent-in-prose", `50%% off\n%%goodobsidian\n${p}\n%%\n`, null],
    ["block-default-width", `%%goodobsidian\n${payloadOf({ pages: [{}] })}\n%%\n`, null],
    ["block-fallback-width-700", `%%goodobsidian\n${payloadOf({ pages: [{}] })}\n%%\n`, 700],
    [
      "legacy-note",
      `---\ninkedmark: true\ninkedmark-version: 2\n---\n\n# Title\n\n<!--inkedmark-text-->\nx\n<!--/inkedmark-text-->\n\n%%inkedmark\n${legacyPayload}\n%%\n`,
      null,
    ],
  ];
  // Every built file must read back too.
  for (const entry of build) markdowns.push([`built:${entry.name}`, entry.file, null]);

  const parse = markdowns.map(([name, markdown, fallbackWidth]) => {
    const parsed =
      fallbackWidth === null ? parseInkFile(markdown) : parseInkFile(markdown, fallbackWidth);
    return {
      name,
      markdown,
      fallbackWidth,
      body: parsed.body,
      doc: parsed.doc === null ? null : stringifyTagged(parsed.doc),
    };
  });

  const splitBodies = [
    "",
    "# T",
    "---\na: 1\n---\n# T",
    "---\na: 1\n---",
    "---\na: 1\n---\n",
    "---\na: 1\n---\n\n\nprose",
    "\ufeff---\na: 1\n---\nx",
    "\ufeff\ufeff---\na: 1\n---\nx",
    "---\r\na: 1\r\n---\r\nx",
    "---\r\na: 1\n---\rx",
    "---\na: 1\r\n---\r\rx",
    "---\n---\nx",
    "---\n\n---\nx",
    "---\na\n----\nb",
    "---\na: 1\n---abc\nrest",
    "---\nunterminated",
    " ---\na\n---\n",
    "x\n---\na\n---\n",
    "---a\nb\n---\n",
    "---\na\n---\n---\nb\n---\n",
    "---\ra\n---\n",
    "---\n\r\n---\n",
    "---\r\r\na\n---\n",
    "---\na\n\r---\n",
    "---\ngoodobsidian: true\ntags: [a]\n---\n\n# Title\n\nProse.",
  ];
  const split = splitBodies.map((body) => ({ body, ...splitFrontmatter(body) }));

  return { commit, build, parse, split };
}

// --- Compress ---------------------------------------------------------------

function compressGoldens(): CompressGoldens {
  const deflate = compressTexts().map(({ name, text }) => ({
    name,
    base64: deflateToBase64(text),
  }));

  const inflateOutcome = (b64: string, maxBytes: number | null): InflateOutcome => {
    try {
      return {
        text: maxBytes === null ? inflateFromBase64(b64) : inflateFromBase64(b64, maxBytes),
      };
    } catch {
      return { throws: true };
    }
  };
  const good = deflateToBase64('{"a":1}');
  const goodBytes = deflateSync(strToU8('{"a":1}'));
  const withTrailing = new Uint8Array(goodBytes.length + 3);
  withTrailing.set(goodBytes);
  withTrailing.set([1, 2, 3], goodBytes.length);
  const thousand = deflateToBase64("x".repeat(1000));
  const inputs: Array<[string, string, number | null]> = [
    ["valid", good, null],
    ["bad-chars", "@@@not-deflate@@@", null],
    ["empty", "", null],
    ["whitespace-inside", good.replace(/(.{3})/g, "$1 \n"), null],
    ["unpadded", good.replace(/=+$/, ""), null],
    ["length-mod-4-is-1", "abcde", null],
    ["not-deflate", base64(strToU8("hello there")), null],
    ["zlib-wrapped", base64(zlibSync(strToU8('{"a":1}'))), null],
    ["gzip-wrapped", base64(gzipSync(strToU8('{"a":1}'), { mtime: 0 })), null],
    ["stored-blocks", base64(deflateSync(strToU8('{"a":1}'), { level: 0 })), null],
    ["max-level", base64(deflateSync(strToU8("abcabcabc".repeat(50)), { level: 9 })), null],
    ["truncated", thousand.slice(0, 6), null],
    ["trailing-bytes", base64(withTrailing), null],
    ["invalid-utf8", base64(deflateSync(new Uint8Array([0x61, 0xff, 0x62]))), null],
    ["truncated-utf8-at-end", base64(deflateSync(new Uint8Array([0x61, 0xe2, 0x82]))), null],
    ["bom-bytes", base64(deflateSync(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))), null],
    ["two-boms", base64(deflateSync(strToU8("\ufeff\ufeffx"))), null],
    ["cap-exact", thousand, 1000],
    ["cap-over-by-one", thousand, 999],
    ["cap-zero-empty-text", deflateToBase64(""), 0],
    ["cap-zero-one-byte", deflateToBase64("a"), 0],
    ["cap-negative", deflateToBase64(""), -1],
  ];
  const inflate = inputs.map(([name, b64, maxBytes]) => ({
    name,
    base64: b64,
    maxBytes,
    ...inflateOutcome(b64, maxBytes),
  }));
  return { commit, deflate, inflate };
}

function write(name: string, value: unknown): void {
  writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

write("encode.json", encodeGoldens());
write("decode.json", decodeGoldens());
write("file.json", fileGoldens());
write("compress.json", compressGoldens());
