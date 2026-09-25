/**
 * Saving a note must not change it. Once a document has been through one
 * load, every later save/load cycle has to leave it exactly as it was:
 *
 * - decode → encode → decode gives the same document (down to key order);
 * - encode → decode → encode gives the same bytes.
 *
 * The first load may normalise (fill defaults, drop junk, mint ids); what it
 * produces must then be a fixed point. Checked over every golden document
 * and every golden payload that decodes.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { InkDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { type DecodeGoldens, goldenDocuments, stringifyTagged } from "./goldens/cases";

const decodeGoldens = JSON.parse(
  readFileSync(new URL("./goldens/decode.json", import.meta.url), "utf8"),
) as DecodeGoldens;

/** The payloads to start from: every golden document once encoded, and every golden payload that decodes. */
function startingPayloads(): Array<{ name: string; payload: string }> {
  return [
    ...goldenDocuments().map(({ name, doc }) => ({ name, payload: encodeDocument(doc) })),
    ...decodeGoldens.cases
      .filter((c) => !("error" in c))
      .map((c) => ({ name: c.name, payload: c.payload })),
  ];
}

/**
 * Hand-made payloads that the format at 4d194c3 does not settle in one load.
 * Each is a value the decoder accepts but the encoder then writes
 * differently. None can come from the editor, only from a file edited by
 * hand; they are kept because changing them would change what those files
 * load as. The lists are exact: a new entry is a regression, and a missing
 * one is a behaviour change that needs deciding on purpose.
 */
const DOCUMENT_UNSTABLE: Record<string, string> = {
  "meta-hash-empty": 'recognizedHash "" is kept on load but not written on save',
  "backdrop-spacing-infinite":
    "spacing 1e400 loads as Infinity, which saves as null and is dropped",
  "pts-non-integers": "stored points that are not integers load as is and are rounded on save",
  "pts-pressure-out-of-range": "stored pressure outside 0..255 loads as is and is clamped on save",
  "stroke-fields-defaults-and-junk": "size 1e400 loads as Infinity, which saves as null, then 3",
};
const BYTES_UNSTABLE: Record<string, string> = {
  "backdrop-spacing-infinite": DOCUMENT_UNSTABLE["backdrop-spacing-infinite"],
  "stroke-fields-defaults-and-junk": DOCUMENT_UNSTABLE["stroke-fields-defaults-and-junk"],
};

interface Cycle {
  name: string;
  first: InkDocument;
  second: InkDocument;
  secondPayload: string;
}

function cycles(): Cycle[] {
  return startingPayloads().map(({ name, payload }) => {
    const first = decodeDocument(payload);
    const secondPayload = encodeDocument(first);
    const second = decodeDocument(secondPayload);
    return { name, first, second, secondPayload };
  });
}

describe("a loaded document is a fixed point of save and load", () => {
  const all = cycles();

  it("decode → encode → decode gives the same document", () => {
    const unstable = all
      .filter((c) => stringifyTagged(c.second) !== stringifyTagged(c.first))
      .map((c) => c.name);
    expect(unstable).toEqual(Object.keys(DOCUMENT_UNSTABLE));
  });

  it("encode → decode → encode gives the same bytes", () => {
    const unstable = all
      .filter((c) => encodeDocument(c.second) !== c.secondPayload)
      .map((c) => c.name);
    expect(unstable).toEqual(Object.keys(BYTES_UNSTABLE));
  });

  it("settles every known exception by the second load", () => {
    const known = all.filter((c) => c.name in DOCUMENT_UNSTABLE);
    expect(known).toHaveLength(Object.keys(DOCUMENT_UNSTABLE).length);
    for (const c of known) {
      const third = decodeDocument(encodeDocument(c.second));
      expect(stringifyTagged(third), c.name).toBe(stringifyTagged(c.second));
      expect(encodeDocument(third), c.name).toBe(encodeDocument(c.second));
    }
  });

  it("checks enough cases to mean something", () => {
    expect(all.length).toBeGreaterThan(300);
  });
});
