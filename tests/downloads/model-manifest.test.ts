import { describe, expect, it } from "vitest";
import {
  type AssetState,
  type ModelAsset,
  compareVersions,
  failureText,
  formatSize,
  isBusy,
  nextRange,
  percent,
  stateText,
  storedVersions,
  toHex,
  totalBytes,
  transition,
  usableFile,
  versionOf,
} from "../../src/downloads/model-manifest";

const file = (name: string, bytes: number) => ({
  name,
  url: `https://example.test/${name}`,
  bytes,
  sha256: "0".repeat(64),
});

const MODEL: ModelAsset = {
  id: "test",
  label: "Test model",
  purpose: "It tests.",
  version: "1.0",
  format: 1,
  folder: "models",
  files: [file("test-1.0.bin", 3_500_236)],
  prefix: "test-",
  suffix: ".bin",
};

const PAIR: ModelAsset = {
  ...MODEL,
  id: "pair",
  files: [file("enc-1.0.bin", 2_000_000), file("dec-1.0.bin", 1_000_000)],
  prefix: "enc-",
};

describe("a model's files", () => {
  it("adds up its sizes", () => {
    expect(totalBytes(MODEL)).toBe(3_500_236);
    expect(totalBytes(PAIR)).toBe(3_000_000);
  });

  it("names other versions only with a prefix and suffix", () => {
    expect(versionOf(MODEL, "test-2.0.bin")).toBe("2.0");
    expect(versionOf(MODEL, "test-1.0.bin.download")).toBeNull();
    expect(versionOf(MODEL, "personal.bin")).toBeNull();
    expect(versionOf(MODEL, "test-.bin")).toBeNull();
    expect(versionOf({ ...MODEL, prefix: undefined }, "test-2.0.bin")).toBeNull();
  });
});

describe("transition", () => {
  const older = { version: "0.9", file: "test-0.9.bin", usable: true };

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
    expect(usableFile(MODEL, s)).toBe("test-1.0.bin");
    expect(usableFile(PAIR, s)).toBe("enc-1.0.bin");
  });

  it("finds a verified model as ready", () => {
    expect(transition({ kind: "unknown" }, { type: "found", found: "current" })).toEqual({
      kind: "ready",
    });
  });

  it("carries an older readable file through a download and a failure", () => {
    let s: AssetState = transition({ kind: "unknown" }, { type: "found", found: older });
    expect(s).toEqual({ kind: "outdated", older });
    expect(usableFile(MODEL, s)).toBe("test-0.9.bin");
    s = transition(s, { type: "start" });
    expect(usableFile(MODEL, s)).toBe("test-0.9.bin");
    s = transition(s, { type: "failed", reason: "offline", detail: "no connection" });
    expect(s).toEqual({ kind: "failed", reason: "offline", detail: "no connection", older });
    expect(usableFile(MODEL, s)).toBe("test-0.9.bin");
    s = transition(s, { type: "start" });
    s = transition(s, { type: "received" });
    expect(s).toEqual({ kind: "verifying", older });
    s = transition(s, { type: "failed", reason: "damaged", detail: "x" });
    expect(s.kind).toBe("failed");
  });

  it("does not use an older file in a format this build cannot read", () => {
    const stale = { ...older, usable: false };
    const s = transition({ kind: "unknown" }, { type: "found", found: stale });
    expect(usableFile(MODEL, s)).toBeNull();
    expect(usableFile(MODEL, { kind: "missing" })).toBeNull();
    expect(usableFile({ ...MODEL, files: [] }, { kind: "ready" })).toBeNull();
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
    const found = storedVersions(MODEL, [
      "test-0.9.bin",
      "personal.bin",
      "test-1.0.bin",
      "test-0.10.bin",
      "words.txt",
    ]);
    expect(found.current).toBe(true);
    expect(found.others.map((o) => o.version)).toEqual(["0.10", "0.9"]);
    expect(storedVersions(MODEL, []).current).toBe(false);
  });

  it("is current only with every file of the model", () => {
    expect(storedVersions(PAIR, ["enc-1.0.bin"]).current).toBe(false);
    expect(storedVersions(PAIR, ["enc-1.0.bin", "dec-1.0.bin"]).current).toBe(true);
    expect(storedVersions({ ...PAIR, files: [] }, []).current).toBe(false);
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
    expect(formatSize(3_500_236)).toBe("3.5 MB");
    expect(formatSize(221_681)).toBe("222 KB");
    expect(formatSize(10)).toBe("1 KB");
  });

  it("each state", () => {
    const older = { version: "0.9", file: "test-0.9.bin", usable: true };
    expect(stateText(MODEL, { kind: "unknown" })).toBe("Checking…");
    expect(stateText(MODEL, { kind: "missing" })).toBe("Not downloaded yet (3.5 MB).");
    expect(stateText(MODEL, { kind: "ready" })).toBe("Version 1.0, 3.5 MB, on this device.");
    expect(stateText(MODEL, { kind: "verifying" })).toBe("Checking the download…");
    expect(stateText(MODEL, { kind: "downloading", received: 1_750_118, total: 3_500_236 })).toBe(
      "Downloading… 50% of 3.5 MB",
    );
    expect(stateText(MODEL, { kind: "downloading", received: 0, total: 0 })).toBe(
      "Downloading… 0% of 3.5 MB",
    );
    expect(stateText(MODEL, { kind: "outdated", older })).toContain("ready to download");
    expect(stateText(MODEL, { kind: "outdated", older: { ...older, usable: false } })).toContain(
      "no longer works",
    );
    expect(stateText(MODEL, { kind: "failed", reason: "offline", detail: "" })).toBe(
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
