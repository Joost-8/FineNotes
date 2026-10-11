/**
 * The handwriting model built into the plugin (`models/grape-1.0.bin`,
 * Apache 2.0): it is the published file, byte for byte, the reader takes it,
 * and it reads a line of ink.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import { readLine } from "../../src/recognition/hwr/recognizer";

const FILE = "models/grape-1.0.bin";
const PUBLISHED_SHA256 = "87a9ddd56b6bcf01e66a027ff74f1b8ba9a58fe0d4b0077e6abb6455710d21f9";

describe("the bundled handwriting model", () => {
  const bytes = readFileSync(FILE);

  it("is the published model file", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(PUBLISHED_SHA256);
  });

  it("parses, says it is Apache 2.0, and has its language model", () => {
    const bundle = parseBundle(bytes);
    expect(bundle.meta.licence).toMatch(/^Apache-2\.0/);
    expect(bundle.meta.alphabet).toHaveLength(95);
    expect(bundle.meta.alphabet).toEqual(expect.arrayContaining(["[", "]", "#", "|"]));
    expect(bundle.lm).not.toBeNull();
  });

  it("reads a line of ink into text", () => {
    const bundle = parseBundle(bytes);
    // A short zig-zag line: what it says does not matter, only that a line
    // runs through the network and both decoders and comes back as text.
    const pts: number[] = [];
    for (let i = 0; i <= 60; i++) pts.push(10 + i * 3, 100 + (i % 2 === 0 ? 0 : 12), 0.5);
    const reading = readLine(bundle, [{ pts, t0: 0 }]);
    expect(typeof reading.text).toBe("string");
    expect(reading.frames).toBeGreaterThan(0);
    expect(reading.confidence).toBeGreaterThan(0);
  });
});
