/**
 * The file-format goldens: what the serializer made of a few hundred inputs
 * at 4d194c3, before it was rewritten. Every note in every vault was written
 * by that code, so the rewrite has to reproduce it byte for byte: the same
 * payload for the same document, the same document (down to key order) for
 * the same payload, the same note file around it, and the same errors.
 *
 * The inputs live in `goldens/cases.ts` (rebuilt from a seed) and in the JSON
 * files themselves; `goldens/generate.ts` says how the files were made. A
 * failure lists the names of every case that no longer matches.
 */

import { readFileSync } from "node:fs";
import { deflateSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_INFLATED_BYTES, deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { type InkDocument, emptyDocument } from "../../src/model/document";
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
} from "./goldens/cases";

function load<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./goldens/${name}`, import.meta.url), "utf8")) as T;
}

const encodeGoldens = load<EncodeGoldens>("encode.json");
const decodeGoldens = load<DecodeGoldens>("decode.json");
const fileGoldens = load<FileGoldens>("file.json");
const compressGoldens = load<CompressGoldens>("compress.json");

function decodeOutcome(payload: string, fallbackWidth: number | null): Outcome {
  try {
    const doc =
      fallbackWidth === null ? decodeDocument(payload) : decodeDocument(payload, fallbackWidth);
    return { doc: stringifyTagged(doc), reencoded: encodeDocument(doc) };
  } catch (error) {
    if (error instanceof SerializeError) return { error: "SerializeError" };
    return { error: error instanceof Error ? error.constructor.name : typeof error };
  }
}

/** Names of the cases where `actual` differs from `expected`, so one failure shows them all. */
function mismatches<T extends { name: string }>(
  cases: readonly T[],
  check: (c: T) => boolean,
): string[] {
  return cases.filter((c) => !check(c)).map((c) => c.name);
}

describe("the goldens were made from the code before the rewrite", () => {
  it("names the commit they came from", () => {
    for (const golden of [encodeGoldens, decodeGoldens, fileGoldens, compressGoldens]) {
      expect(golden.commit).toBe("4d194c3");
    }
  });
});

describe("encoding", () => {
  const built = goldenDocuments();

  it("rebuilds exactly the documents the goldens were made from", () => {
    expect(built.map((b) => b.name)).toEqual(encodeGoldens.documents.map((d) => d.name));
    const drifted = built.filter(
      (b, i) => sha256(stringifyTagged(b.doc)) !== encodeGoldens.documents[i].inputSha256,
    );
    expect(drifted.map((b) => b.name)).toEqual([]);
  });

  it("writes every document to the same bytes", () => {
    const docs = new Map(built.map((b) => [b.name, b.doc]));
    const bad = mismatches(
      encodeGoldens.documents,
      (g) => encodeDocument(docs.get(g.name) as InkDocument) === g.payload,
    );
    expect(bad).toEqual([]);
  });

  it("reads each of those payloads back to the same document", () => {
    const bad = mismatches(
      encodeGoldens.documents,
      (g) => sha256(stringifyTagged(decodeDocument(g.payload))) === g.decodedSha256,
    );
    expect(bad).toEqual([]);
  });

  it("creates the same empty document, and saves it the same", () => {
    for (const golden of encodeGoldens.emptyDocuments) {
      const doc = golden.width === null ? emptyDocument() : emptyDocument(golden.width);
      expect(stringifyTagged(doc)).toBe(golden.json);
      expect(encodeDocument(doc)).toBe(golden.payload);
    }
  });

  it("quantizes and restores points the same way", () => {
    const bad = mismatches(encodeGoldens.points, (g) => {
      const input = parseTagged(g.input) as number[];
      if (g.name.startsWith("q-")) {
        return (
          stringifyTagged(dequantizePts(input)) === g.restored &&
          stringifyTagged(quantizePts(dequantizePts(input))) === g.quantized
        );
      }
      return (
        stringifyTagged(quantizePts(input)) === g.quantized &&
        stringifyTagged(dequantizePts(quantizePts(input))) === g.restored
      );
    });
    expect(bad).toEqual([]);
  });
});

describe("decoding", () => {
  it("decodes every stored payload to the same document and re-encodes it the same", () => {
    const bad = mismatches(decodeGoldens.cases, (g) => {
      const actual = decodeOutcome(g.payload, g.fallbackWidth);
      const expected: Outcome =
        "error" in g ? { error: g.error } : { doc: g.doc, reencoded: g.reencoded };
      return JSON.stringify(actual) === JSON.stringify(expected);
    });
    expect(bad).toEqual([]);
  });

  it("covers the adversarial inputs it claims to", () => {
    const names = new Set(decodeGoldens.cases.map((c) => c.name));
    for (const name of [
      "env-version-9",
      "env-base64-bad-chars",
      "env-json-number",
      "pts-ragged-4",
      "pts-nulls",
      "stroke-t0",
      "backdrop-toString",
      "pdf-no-path",
      "page-ids-missing",
      "image-ids",
      "doc-pages-and-regions",
      "v1-regions",
      "fixture-doc-v1-legacy",
    ]) {
      expect(names.has(name), name).toBe(true);
    }
    expect(decodeGoldens.cases.filter((c) => "error" in c).length).toBeGreaterThanOrEqual(20);
  });

  it("refuses a payload that inflates past 64 MB, and only because of its size", () => {
    expect(MAX_INFLATED_BYTES).toBe(64 * 1024 * 1024);
    const shaped = (size: number): string => {
      const head = strToU8('{"pages":[],"pad":"');
      const tail = strToU8('"}');
      const bytes = new Uint8Array(size).fill(0x78);
      bytes.set(head);
      bytes.set(tail, size - tail.length);
      return `v2:${Buffer.from(deflateSync(bytes)).toString("base64")}`;
    };
    expect(decodeDocument(shaped(4096)).pages).toHaveLength(1);
    expect(() => decodeDocument(shaped(MAX_INFLATED_BYTES + 1))).toThrow(SerializeError);
  });
});

describe("the note file", () => {
  it("builds every body and document into the same file", () => {
    const bad = mismatches(
      fileGoldens.build,
      (g) => buildInkFile(g.body, parseTagged(g.doc) as InkDocument) === g.file,
    );
    expect(bad).toEqual([]);
  });

  it("splits every note into the same body and document", () => {
    const bad = mismatches(fileGoldens.parse, (g) => {
      const parsed =
        g.fallbackWidth === null
          ? parseInkFile(g.markdown)
          : parseInkFile(g.markdown, g.fallbackWidth);
      const doc = parsed.doc === null ? null : stringifyTagged(parsed.doc);
      return parsed.body === g.body && doc === g.doc;
    });
    expect(bad).toEqual([]);
  });

  it("finds the same frontmatter in every body", () => {
    for (const golden of fileGoldens.split) {
      expect(splitFrontmatter(golden.body), JSON.stringify(golden.body)).toEqual({
        frontmatter: golden.frontmatter,
        prose: golden.prose,
      });
    }
  });
});

describe("compression", () => {
  it("deflates every text to the same base64", () => {
    const texts = new Map(compressTexts().map((t) => [t.name, t.text]));
    expect([...texts.keys()]).toEqual(compressGoldens.deflate.map((g) => g.name));
    const bad = mismatches(
      compressGoldens.deflate,
      (g) => deflateToBase64(texts.get(g.name) as string) === g.base64,
    );
    expect(bad).toEqual([]);
  });

  it("inflates every stored input to the same text, or refuses the same ones", () => {
    const bad = mismatches(compressGoldens.inflate, (g) => {
      let actual: InflateOutcome;
      try {
        const text =
          g.maxBytes === null
            ? inflateFromBase64(g.base64)
            : inflateFromBase64(g.base64, g.maxBytes);
        actual = { text };
      } catch {
        actual = { throws: true };
      }
      const expected: InflateOutcome = "throws" in g ? { throws: true } : { text: g.text };
      return JSON.stringify(actual) === JSON.stringify(expected);
    });
    expect(bad).toEqual([]);
  });

  it("round-trips every text it deflates", () => {
    for (const { name, text } of compressTexts()) {
      if (name === "lone-surrogate" || name === "bom-first") continue; // not lossless: see the goldens
      expect(inflateFromBase64(deflateToBase64(text)), name).toBe(text);
    }
  });
});
