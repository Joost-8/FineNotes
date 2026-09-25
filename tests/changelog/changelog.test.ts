/**
 * The "What's new" text is cut out of the bundled CHANGELOG.md. A release is a
 * `## [x.y.z]` heading and everything under it up to the next `## ` heading;
 * the preamble, `[Unreleased]` and any other level-two section are left out.
 */

import { describe, expect, it } from "vitest";
import {
  changelogSince,
  compareVersions,
  parseChangelogSections,
  releasedChangelog,
} from "../../src/changelog";

const LOG = [
  "# Changelog",
  "",
  "Intro text nobody needs after an update.",
  "",
  "## [Unreleased]",
  "",
  "- Work in progress.",
  "",
  "## [0.9.0] - 2026-09-24",
  "",
  "The restyle.",
  "",
  "### Changed",
  "",
  "- New toolbar.",
  "",
  "## [0.8.1] - 2026-09-20",
  "",
  "- A fix.",
  "",
  "## [0.8.0] - 2026-09-18",
  "",
  "- Lasso.",
  "",
].join("\n");

const V090 = "## [0.9.0] - 2026-09-24\n\nThe restyle.\n\n### Changed\n\n- New toolbar.";
const V081 = "## [0.8.1] - 2026-09-20\n\n- A fix.";
const V080 = "## [0.8.0] - 2026-09-18\n\n- Lasso.";

describe("parseChangelogSections", () => {
  it("returns each release with its heading and body, trimmed, in file order", () => {
    expect(parseChangelogSections(LOG)).toEqual([
      { version: "0.9.0", markdown: V090 },
      { version: "0.8.1", markdown: V081 },
      { version: "0.8.0", markdown: V080 },
    ]);
  });

  it("keeps file order even when it is not newest first", () => {
    const md = "## [1.0.0]\na\n## [2.0.0]\nb\n## [1.5.0]\nc";
    expect(parseChangelogSections(md).map((s) => s.version)).toEqual(["1.0.0", "2.0.0", "1.5.0"]);
  });

  it("ends a release at any level-two heading and drops what follows until the next release", () => {
    const md =
      "## [1.0.0]\nkept\n## Notes\ndropped\n## [Unreleased]\nalso dropped\n## [0.9.0]\nold";
    expect(parseChangelogSections(md)).toEqual([
      { version: "1.0.0", markdown: "## [1.0.0]\nkept" },
      { version: "0.9.0", markdown: "## [0.9.0]\nold" },
    ]);
  });

  it("only takes three-part versions closed by a bracket as releases", () => {
    const md = "## [1.2]\nx\n## [1.2.3-beta]\ny\n## [10.20.30] - later\nz";
    expect(parseChangelogSections(md)).toEqual([
      { version: "10.20.30", markdown: "## [10.20.30] - later\nz" },
    ]);
  });

  it("treats a heading without its space, or indented, as ordinary text", () => {
    const md = "## [1.0.0]\n##[0.9.0]\n  ## [0.8.0]\n### [0.7.0]";
    expect(parseChangelogSections(md)).toEqual([
      { version: "1.0.0", markdown: "## [1.0.0]\n##[0.9.0]\n  ## [0.8.0]\n### [0.7.0]" },
    ]);
  });

  it("keeps a repeated version twice", () => {
    expect(parseChangelogSections("## [1.0.0]\na\n## [1.0.0]\nb")).toEqual([
      { version: "1.0.0", markdown: "## [1.0.0]\na" },
      { version: "1.0.0", markdown: "## [1.0.0]\nb" },
    ]);
  });

  it("reads a file with Windows line endings, keeping them inside a release", () => {
    const md = "# Changelog\r\n\r\n## [1.0.0] - x\r\n\r\n- a\r\n\r\n## [0.9.0]\r\n- b\r\n";
    expect(parseChangelogSections(md)).toEqual([
      { version: "1.0.0", markdown: "## [1.0.0] - x\r\n\r\n- a" },
      { version: "0.9.0", markdown: "## [0.9.0]\r\n- b" },
    ]);
  });

  it("finds nothing in an empty or release-free file", () => {
    expect(parseChangelogSections("")).toEqual([]);
    expect(parseChangelogSections("# Changelog\n\n## [Unreleased]\n- soon")).toEqual([]);
  });
});

describe("compareVersions", () => {
  it("compares major, then minor, then patch, as numbers", () => {
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.9.10", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.8.1", "0.9.0")).toBeLessThan(0);
    expect(compareVersions("2.3.4", "2.3.4")).toBe(0);
  });

  it("counts a missing part as zero and ignores a fourth", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.3.9", "1.2.3")).toBe(0);
    expect(compareVersions("1", "0.9.9")).toBeGreaterThan(0);
  });
});

describe("changelogSince", () => {
  it("returns every release newer than the one last seen, newest first", () => {
    expect(changelogSince(LOG, "0.8.0")).toBe(`${V090}\n\n${V081}`);
    expect(changelogSince(LOG, "0.8.1")).toBe(V090);
  });

  it("works from a version the file does not list", () => {
    expect(changelogSince(LOG, "0.7.5")).toBe(`${V090}\n\n${V081}\n\n${V080}`);
    expect(changelogSince(LOG, "0.8.5")).toBe(V090);
  });

  it("returns nothing when the user is up to date, or ahead of the file", () => {
    expect(changelogSince(LOG, "0.9.0")).toBe("");
    expect(changelogSince(LOG, "1.0.0")).toBe("");
  });

  it("shows only the newest release when nothing usable was seen before", () => {
    for (const since of [null, "", "garbage", "0.8", "v0.8.0", " 0.8.0", "0.8.0-beta"]) {
      expect(changelogSince(LOG, since)).toBe(V090);
    }
  });

  it("returns nothing for a file without releases", () => {
    expect(changelogSince("# Changelog", null)).toBe("");
    expect(changelogSince("# Changelog", "0.1.0")).toBe("");
  });
});

describe("releasedChangelog", () => {
  it("is every release, blank-line separated, without preamble or Unreleased", () => {
    expect(releasedChangelog(LOG)).toBe(`${V090}\n\n${V081}\n\n${V080}`);
    expect(releasedChangelog("# Changelog\n## [Unreleased]\n- x")).toBe("");
  });
});
