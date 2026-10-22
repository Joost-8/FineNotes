/**
 * `src/model/update-check.ts`: when a newer FineNotes is announced.
 */

import { describe, expect, it } from "vitest";
import {
  UPDATE_CHECK_INTERVAL_MS,
  checkDue,
  compareVersions,
  newerVersion,
  updateRecordOf,
  versionOfManifest,
} from "../../src/model/update-check";

describe("compareVersions", () => {
  it("orders by major, minor and patch as numbers, not as text", () => {
    expect(compareVersions("2.4.10", "2.4.9")).toBeGreaterThan(0);
    expect(compareVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0", "2.99.99")).toBeGreaterThan(0);
    expect(compareVersions("2.4.1", "2.4.1")).toBe(0);
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("puts a pre-release before its release, and orders betas by number", () => {
    expect(compareVersions("2.5.0-beta.1", "2.5.0")).toBeLessThan(0);
    expect(compareVersions("2.5.0", "2.5.0-beta.3")).toBeGreaterThan(0);
    expect(compareVersions("2.5.0-beta.10", "2.5.0-beta.9")).toBeGreaterThan(0);
    expect(compareVersions("2.5.0-beta.1", "2.4.1")).toBeGreaterThan(0);
  });

  it("knows nothing of what is not a version", () => {
    expect(compareVersions("latest", "2.4.1")).toBeNull();
    expect(compareVersions("2.4", "2.4.1")).toBeNull();
    expect(compareVersions("v2.4.1", "2.4.1")).toBeNull();
  });
});

describe("versionOfManifest", () => {
  it("reads the version, and nothing from a page that is not a manifest", () => {
    expect(versionOfManifest({ id: "finenotes", version: "2.4.2" })).toBe("2.4.2");
    expect(versionOfManifest({ version: 242 })).toBeNull();
    expect(versionOfManifest({ version: "soon" })).toBeNull();
    expect(versionOfManifest("404: Not Found")).toBeNull();
    expect(versionOfManifest(null)).toBeNull();
  });
});

describe("the record and when to check", () => {
  const day = UPDATE_CHECK_INTERVAL_MS;

  it("reads anything stored oddly as never checked", () => {
    expect(updateRecordOf(undefined)).toEqual({ checkedAt: 0, latest: "" });
    expect(updateRecordOf({ checkedAt: "x", latest: "2.4.2" })).toEqual({
      checkedAt: 0,
      latest: "",
    });
    expect(updateRecordOf({ checkedAt: 5, latest: "2.4.2" })).toEqual({
      checkedAt: 5,
      latest: "2.4.2",
    });
  });

  it("checks once a day, and again when the clock went back", () => {
    const now = 10 * day;
    expect(checkDue({ checkedAt: 0, latest: "" }, now)).toBe(true);
    expect(checkDue({ checkedAt: now - day + 1, latest: "" }, now)).toBe(false);
    expect(checkDue({ checkedAt: now - day, latest: "" }, now)).toBe(true);
    expect(checkDue({ checkedAt: now + 60_000, latest: "" }, now)).toBe(true);
  });

  it("announces only a version newer than the one running", () => {
    expect(newerVersion({ checkedAt: 1, latest: "2.4.2" }, "2.4.1")).toBe("2.4.2");
    expect(newerVersion({ checkedAt: 1, latest: "2.4.1" }, "2.4.1")).toBeNull();
    // Updated since the check: nothing to say any more.
    expect(newerVersion({ checkedAt: 1, latest: "2.4.2" }, "2.5.0")).toBeNull();
    // A beta installed by hand is newer than main's release.
    expect(newerVersion({ checkedAt: 1, latest: "2.4.1" }, "2.5.0-beta.1")).toBeNull();
    expect(newerVersion({ checkedAt: 0, latest: "" }, "2.4.1")).toBeNull();
  });
});
