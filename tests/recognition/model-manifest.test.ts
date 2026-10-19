import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLE_FORMAT, bundleFormatOf } from "../../src/recognition/hwr/bundle";
import {
  type AssetState,
  ASSETS,
  GRAPE_MODEL,
  WORD_LIST,
  compareVersions,
  failureText,
  formatSize,
  isBusy,
  nextRange,
  percent,
  stateText,
  storedVersions,
  toHex,
  transition,
  usableFile,
  versionOf,
} from "../../src/recognition/hwr/model-manifest";

describe("the pinned files", () => {
  it("pins the published Grape file", () => {
    const bytes = readFileSync("models/grape-1.0.bin");
    expect(bytes.byteLength).toBe(GRAPE_MODEL.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(GRAPE_MODEL.sha256);
    expect(bundleFormatOf(bytes)).toBe(GRAPE_MODEL.format);
    expect(GRAPE_MODEL.format).toBe(BUNDLE_FORMAT);
  });

  it("names each file after its version, downloads it from GitHub over https", () => {
    for (const asset of ASSETS) {
      expect(asset.file).toBe(`${asset.prefix}${asset.version}${asset.suffix}`);
      expect(asset.url.startsWith("https://github.com/Joost-8/Grape/releases/download/")).toBe(
        true,
      );
      expect(asset.url.endsWith(`/${asset.file}`)).toBe(true);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.bytes).toBeGreaterThan(0);
    }
  });

  it("does not take the user's own words.txt or learned models for its files", () => {
    expect(versionOf(WORD_LIST, "words.txt")).toBeNull();
    expect(versionOf(GRAPE_MODEL, "personal.bin")).toBeNull();
    expect(versionOf(GRAPE_MODEL, "nightly.bin")).toBeNull();
    expect(versionOf(GRAPE_MODEL, "grape-1.0.bin.download")).toBeNull();
    expect(versionOf(GRAPE_MODEL, "grape-2.0.bin")).toBe("2.0");
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

describe("transition", () => {
  const older = { version: "0.9", file: "grape-0.9.bin", usable: true };

  it("goes missing → downloading → verifying → ready", () => {
    let s: AssetState = { kind: "unknown" };
    s = transition(s, { type: "found", found: "none" });
    expect(s).toEqual({ kind: "missing" });
    s = transition(s, { type: "start" });
    expect(s).toEqual({ kind: "downloading", received: 0, total: 0 });
    s = transition(s, { type: "progress", received: 10, total: 100 });
    expect(s).toEqual({ kind: "downloading", received: 10, total: 100 });
    expect(isBusy(s)).toBe(true);
    s = transition(s, { type: "received" });
    expect(s).toEqual({ kind: "verifying" });
    s = transition(s, { type: "verified" });
    expect(s).toEqual({ kind: "ready" });
    expect(usableFile(GRAPE_MODEL, s)).toBe("grape-1.0.bin");
  });

  it("finds a verified file as ready", () => {
    expect(transition({ kind: "unknown" }, { type: "found", found: "current" })).toEqual({
      kind: "ready",
    });
  });

  it("carries an older readable file through a download and a failure", () => {
    let s: AssetState = transition({ kind: "unknown" }, { type: "found", found: older });
    expect(s).toEqual({ kind: "outdated", older });
    expect(usableFile(GRAPE_MODEL, s)).toBe("grape-0.9.bin");
    s = transition(s, { type: "start" });
    expect(usableFile(GRAPE_MODEL, s)).toBe("grape-0.9.bin");
    s = transition(s, { type: "failed", reason: "offline", detail: "no connection" });
    expect(s).toEqual({ kind: "failed", reason: "offline", detail: "no connection", older });
    expect(usableFile(GRAPE_MODEL, s)).toBe("grape-0.9.bin");
    s = transition(s, { type: "start" });
    s = transition(s, { type: "received" });
    expect(s).toEqual({ kind: "verifying", older });
    s = transition(s, { type: "failed", reason: "damaged", detail: "x" });
    expect(s.kind).toBe("failed");
  });

  it("an older file in a format this build cannot read is not used", () => {
    const stale = { ...older, usable: false };
    const s = transition({ kind: "unknown" }, { type: "found", found: stale });
    expect(usableFile(GRAPE_MODEL, s)).toBeNull();
    expect(usableFile(GRAPE_MODEL, { kind: "missing" })).toBeNull();
  });

  it("ignores events that make no sense in a state", () => {
    const ready: AssetState = { kind: "ready" };
    expect(transition(ready, { type: "start" })).toBe(ready);
    expect(transition(ready, { type: "progress", received: 1, total: 2 })).toBe(ready);
    expect(transition(ready, { type: "received" })).toBe(ready);
    expect(transition(ready, { type: "verified" })).toBe(ready);
    expect(transition(ready, { type: "failed", reason: "http", detail: "" })).toBe(ready);
    const busy: AssetState = { kind: "downloading", received: 1, total: 2 };
    expect(transition(busy, { type: "start" })).toBe(busy);
    expect(transition(busy, { type: "found", found: "none" })).toBe(busy);
    expect(transition(busy, { type: "removed" })).toBe(busy);
    expect(transition({ kind: "verifying" }, { type: "progress", received: 1, total: 1 })).toEqual({
      kind: "verifying",
    });
    expect(transition(ready, { type: "removed" })).toEqual({ kind: "missing" });
  });
});

describe("storedVersions", () => {
  it("finds the current file and the others, newest first", () => {
    const found = storedVersions(GRAPE_MODEL, [
      "grape-0.9.bin",
      "personal.bin",
      "grape-1.0.bin",
      "grape-0.10.bin",
      "words.txt",
    ]);
    expect(found.current).toBe(true);
    expect(found.others.map((o) => o.version)).toEqual(["0.10", "0.9"]);
    expect(storedVersions(GRAPE_MODEL, []).current).toBe(false);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0")).toBe(0);
    expect(compareVersions("1", "1.0")).toBeLessThan(0);
    expect(compareVersions("1.0-b", "1.0-a")).toBeGreaterThan(0);
    expect(compareVersions("1.0-a", "1.0-b")).toBeLessThan(0);
  });
});

describe("what the user is told", () => {
  it("sizes", () => {
    expect(formatSize(GRAPE_MODEL.bytes)).toBe("3.5 MB");
    expect(formatSize(WORD_LIST.bytes)).toBe("222 KB");
    expect(formatSize(10)).toBe("1 KB");
  });

  it("each state", () => {
    const older = { version: "0.9", file: "grape-0.9.bin", usable: true };
    expect(stateText(GRAPE_MODEL, { kind: "unknown" })).toBe("Checking…");
    expect(stateText(GRAPE_MODEL, { kind: "missing" })).toBe("Not downloaded yet (3.5 MB).");
    expect(stateText(GRAPE_MODEL, { kind: "ready" })).toBe("Version 1.0, 3.5 MB, on this device.");
    expect(stateText(GRAPE_MODEL, { kind: "verifying" })).toBe("Checking the download…");
    expect(
      stateText(GRAPE_MODEL, { kind: "downloading", received: 1_750_118, total: 3_500_236 }),
    ).toBe("Downloading… 50% of 3.5 MB");
    expect(stateText(GRAPE_MODEL, { kind: "downloading", received: 0, total: 0 })).toBe(
      "Downloading… 0% of 3.5 MB",
    );
    expect(stateText(GRAPE_MODEL, { kind: "outdated", older })).toContain("ready to download");
    expect(
      stateText(GRAPE_MODEL, { kind: "outdated", older: { ...older, usable: false } }),
    ).toContain("no longer works");
    expect(stateText(GRAPE_MODEL, { kind: "failed", reason: "offline", detail: "" })).toBe(
      "Downloads when you're online.",
    );
  });

  it("each failure", () => {
    expect(failureText("http", "HTTP 404")).toContain("HTTP 404");
    expect(failureText("damaged", "")).toContain("damaged");
    expect(failureText("storage", "disk full")).toContain("disk full");
  });
});

describe("ranges and bytes", () => {
  it("asks for the next piece, and none when all is in", () => {
    expect(nextRange(0, 1000, 400)).toEqual({ start: 0, end: 399 });
    expect(nextRange(800, 1000, 400)).toEqual({ start: 800, end: 999 });
    expect(nextRange(1000, 1000, 400)).toBeNull();
  });

  it("percent stays within 0 and 100", () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(200, 100)).toBe(100);
    expect(percent(-1, 100)).toBe(0);
  });

  it("hex", () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
    expect(toHex(new Uint8Array([171]).buffer)).toBe("ab");
  });
});
