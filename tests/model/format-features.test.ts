/**
 * The payload label (`v2:`, `v2+sticky:`): what a notebook needs of its
 * reader, so an older FineNotes refuses rather than drops what it cannot keep.
 */

import { describe, expect, it } from "vitest";
import {
  FORMAT_FEATURES,
  featuresOfHead,
  isLabelProblem,
  needsNewerReader,
  payloadLabel,
  readPayloadLabel,
} from "../../src/model/format-features";

/** How every reader since 2.0 checked a label: the part after `v` must be a number. */
function olderReaderAccepts(label: string): boolean {
  return label.startsWith("v") && Number.isFinite(Number(label.slice(1)));
}

describe("payloadLabel", () => {
  it("is the plain `v2` with no feature, so older builds still read the notebook", () => {
    expect(payloadLabel()).toBe("v2");
    expect(payloadLabel([])).toBe("v2");
    expect(olderReaderAccepts(payloadLabel())).toBe(true);
  });

  it("names each feature once, in the fixed order, and drops unknown names", () => {
    expect(payloadLabel(["sticky", "sticky", "nonsense"])).toBe("v2+sticky");
  });

  it("is a label no older reader accepts once it names a feature", () => {
    for (const feature of FORMAT_FEATURES) {
      expect(olderReaderAccepts(payloadLabel([feature]))).toBe(false);
    }
  });
});

describe("readPayloadLabel", () => {
  it("reads the version and the features", () => {
    expect(readPayloadLabel("v2")).toEqual({ version: 2, features: [] });
    expect(readPayloadLabel("v2+sticky")).toEqual({ version: 2, features: ["sticky"] });
    // Any number, as before: the reader goes by the data's shape.
    expect(readPayloadLabel("v9")).toEqual({ version: 9, features: [] });
    // An empty version is 0 to every reader since 2.0, and still is.
    expect(readPayloadLabel("v")).toEqual({ version: 0, features: [] });
  });

  it("refuses a feature this build does not know", () => {
    const read = readPayloadLabel("v2+sticky+holograms");
    expect(isLabelProblem(read)).toBe(true);
    expect(read).toEqual({ kind: "unknown-feature", feature: "holograms" });
  });

  it("refuses a label that is not `v<number>`", () => {
    for (const label of ["2", "vx", "v 2x", "w2", "v2x+sticky"]) {
      expect(readPayloadLabel(label)).toEqual({ kind: "malformed" });
    }
  });

  it("reads back what payloadLabel writes", () => {
    const read = readPayloadLabel(payloadLabel(["sticky"]));
    expect(isLabelProblem(read)).toBe(false);
    expect(read).toEqual({ version: 2, features: ["sticky"] });
  });
});

describe("featuresOfHead", () => {
  it("reads `requires` from the stored JSON up to its pages", () => {
    expect(featuresOfHead('{"version":2,"requires":["sticky"],"view":{},"pages":[')).toEqual([
      "sticky",
    ]);
  });

  it("names none without `requires`, for junk, and keeps only known names", () => {
    expect(featuresOfHead('{"version":2,"view":{},"pages":[')).toEqual([]);
    expect(featuresOfHead("not json")).toEqual([]);
    expect(featuresOfHead('"text",[')).toEqual([]);
    expect(featuresOfHead('{"requires":"sticky","pages":[')).toEqual([]);
    expect(featuresOfHead('{"requires":["x",3,"sticky"],"pages":[')).toEqual(["sticky"]);
  });
});

describe("needsNewerReader", () => {
  it("is true only for a payload naming a feature this build lacks", () => {
    expect(needsNewerReader(" v2+sticky+holograms:abc ")).toBe(true);
    expect(needsNewerReader("v2+sticky:abc")).toBe(false);
    expect(needsNewerReader("v2:abc")).toBe(false);
    expect(needsNewerReader("vx:abc")).toBe(false);
    expect(needsNewerReader("no colon")).toBe(false);
  });
});
