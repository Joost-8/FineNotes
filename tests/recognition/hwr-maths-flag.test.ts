/**
 * The model file's `maths` flag (bundle.ts), which calculation notes wait
 * for: Grape 2.0 does not set it, a file that does is read as setting it,
 * and a model learned from such a file keeps it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle, readsMaths } from "../../src/recognition/hwr/bundle";
import { writeBundle } from "../../src/recognition/hwr/bundle-write";

const grape = new Uint8Array(readFileSync("models/grape-2.0.bin"));

describe("the maths flag", () => {
  it("is not set on Grape 2.0", () => {
    const bundle = parseBundle(grape);
    expect(bundle.meta.maths).toBeUndefined();
    expect(readsMaths(bundle.meta)).toBe(false);
  });

  it("is read when a file sets it, and only when it is true", () => {
    const bundle = parseBundle(grape);
    const flagged = writeBundle(grape, bundle.net, { maths: true });
    expect(readsMaths(parseBundle(flagged).meta)).toBe(true);
    expect(readsMaths({ maths: false })).toBe(false);
    expect(readsMaths({ maths: "yes" as unknown as boolean })).toBe(false);
  });

  it("survives learning: a tuned network written into a flagged file keeps it", () => {
    const flagged = writeBundle(grape, parseBundle(grape).net, { maths: true });
    const learned = writeBundle(flagged, parseBundle(flagged).net, { name: "grape-2.0, learned" });
    const meta = parseBundle(learned).meta;
    expect(meta.name).toBe("grape-2.0, learned");
    expect(readsMaths(meta)).toBe(true);
  });
});
