import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLE_FORMAT_INPUT, bundleFormatOf } from "../../src/recognition/hwr/bundle";
import { GRAPE_MODEL } from "../../src/recognition/hwr/grape-model";
import { versionOf } from "../../src/downloads/model-manifest";

describe("Grape as this build pins it", () => {
  const main = GRAPE_MODEL.files[0];

  it("is the published file in the repo, byte for byte, in the format this build reads", () => {
    const bytes = readFileSync(`models/${main.name}`);
    expect(bytes.byteLength).toBe(main.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(main.sha256);
    expect(bundleFormatOf(bytes)).toBe(GRAPE_MODEL.format);
    expect(GRAPE_MODEL.format).toBe(BUNDLE_FORMAT_INPUT);
  });

  it("downloads from the Grape release over https, named after its version", () => {
    expect(main.name).toBe(`grape-${GRAPE_MODEL.version}.bin`);
    expect(main.url).toBe(
      `https://github.com/Joost-8/Grape/releases/download/v${GRAPE_MODEL.version}/${main.name}`,
    );
    expect(GRAPE_MODEL.folder).toBe("handwriting/grape-2");
  });

  it("does not take the user's own models or the word list for older versions", () => {
    expect(versionOf(GRAPE_MODEL, "personal.bin")).toBeNull();
    expect(versionOf(GRAPE_MODEL, "nightly.bin")).toBeNull();
    expect(versionOf(GRAPE_MODEL, "words.txt")).toBeNull();
    expect(versionOf(GRAPE_MODEL, "grape-0.9.bin")).toBe("0.9");
  });
});

describe("bundleFormatOf", () => {
  it("is null for a file that is not a model", () => {
    expect(bundleFormatOf(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(bundleFormatOf(new TextEncoder().encode("# words\nthe\n"))).toBeNull();
  });

  it("reads the version from a header", () => {
    const header = new Uint8Array(12);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x57484e46, true);
    view.setUint32(4, 7, true);
    expect(bundleFormatOf(header.buffer)).toBe(7);
    expect(bundleFormatOf(header.subarray(0, 8))).toBe(7);
  });
});
