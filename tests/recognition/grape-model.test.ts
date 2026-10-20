import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  BUNDLE_FORMAT_INPUT,
  BUNDLE_FORMAT_POINTS,
  bundleFormatOf,
} from "../../src/recognition/hwr/bundle";
import { GRAPE2_MODEL, GRAPE_MODEL, grapeAsset } from "../../src/recognition/hwr/grape-model";
import { versionOf } from "../../src/downloads/model-manifest";

describe("Grape as this build pins it", () => {
  const main = GRAPE_MODEL.files[0];

  it("is the published file in the repo, byte for byte, in the format this build reads", () => {
    const bytes = readFileSync(`models/${main.name}`);
    expect(bytes.byteLength).toBe(main.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(main.sha256);
    expect(bundleFormatOf(bytes)).toBe(GRAPE_MODEL.format);
    expect(GRAPE_MODEL.format).toBe(BUNDLE_FORMAT_POINTS);
  });

  it("downloads from the Grape release over https, named after its version", () => {
    expect(main.name).toBe(`grape-${GRAPE_MODEL.version}.bin`);
    expect(main.url).toBe(
      `https://github.com/Joost-8/Grape/releases/download/v${GRAPE_MODEL.version}/${main.name}`,
    );
    expect(GRAPE_MODEL.folder).toBe("handwriting");
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

describe("Grape 2 (preview) as this build pins it", () => {
  const main = GRAPE2_MODEL.files[0];

  it("is a curve model in its own folder, so neither Grape takes the other's file", () => {
    expect(GRAPE2_MODEL.format).toBe(BUNDLE_FORMAT_INPUT);
    expect(GRAPE2_MODEL.folder).not.toBe(GRAPE_MODEL.folder);
    expect(main.name).toBe(`grape-${GRAPE2_MODEL.version}.bin`);
    expect(main.url).toBe(
      `https://github.com/Joost-8/Grape/releases/download/v${GRAPE2_MODEL.version}/${main.name}`,
    );
  });

  it("is chosen by name, and anything else is Grape 1.0", () => {
    expect(grapeAsset("grape-2")).toBe(GRAPE2_MODEL);
    expect(grapeAsset("grape")).toBe(GRAPE_MODEL);
    expect(grapeAsset(undefined)).toBe(GRAPE_MODEL);
  });

  // The file is not in this repository (it is published on its own); where
  // the rig's release folder is checked out, it must be the pinned file.
  const local = `research/handwriting-rig/release/grape-2.0-preview/${main.name}`;
  it.runIf(existsSync(local))("matches the release file byte for byte", () => {
    const bytes = readFileSync(local);
    expect(bytes.byteLength).toBe(main.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(main.sha256);
    expect(bundleFormatOf(bytes)).toBe(GRAPE2_MODEL.format);
  });
});
