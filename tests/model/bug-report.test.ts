import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUG_FORM_DEVICES,
  bugFormDevice,
  bugReportUrl,
  guideAnswers,
  versionsLine,
} from "../../src/model/bug-report";
import { type GuideEntry, guideEntry } from "../../src/model/finenotes-guide";
import { guideEntryUrl, headingAnchor } from "../../src/model/guide-markdown";
import { featureById, settingKeyOf } from "../../src/model/feature-index";

const form = readFileSync(".github/ISSUE_TEMPLATE/bug_report.yml", "utf8");

const device = {
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isMacOS: false,
  isWin: false,
  isLinux: false,
};

describe("the bug form's link", () => {
  it("uses the form's own field ids and Device options", () => {
    for (const id of ["versions", "device"]) expect(form).toContain(`id: ${id}\n`);
    for (const option of BUG_FORM_DEVICES) expect(form).toContain(`- ${option}\n`);
    expect(
      form.split("\n").filter((line) => /^ {8}- (iPad|iPhone|Android|Desktop)/.test(line)),
    ).toHaveLength(BUG_FORM_DEVICES.length);
  });

  it("names the device only when it is certain", () => {
    expect(bugFormDevice({ ...device, isWin: true })).toBe("Desktop (Windows)");
    expect(bugFormDevice({ ...device, isMacOS: true })).toBe("Desktop (macOS)");
    expect(bugFormDevice({ ...device, isLinux: true })).toBe("Desktop (Linux)");
    expect(bugFormDevice({ ...device, isAndroidApp: true, isLinux: true })).toBe(
      "Android tablet or phone",
    );
    expect(bugFormDevice({ ...device, isIosApp: true, isPhone: true, isMacOS: true })).toBe(
      "iPhone",
    );
    // An iPad, with or without a Pencil: the reporter picks.
    expect(bugFormDevice({ ...device, isIosApp: true, isMacOS: true })).toBeNull();
    expect(bugFormDevice(device)).toBeNull();
  });

  it("fills in the title, versions and device, and nothing else", () => {
    const url = new URL(
      bugReportUrl({
        title: "  Left panel\n disappears ",
        plugin: "2.10.0",
        obsidian: "1.15.1",
        device: "Desktop (Windows)",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/Joost-8/FineNotes/issues/new");
    expect([...url.searchParams.entries()]).toEqual([
      ["template", "bug_report.yml"],
      ["title", "Left panel disappears"],
      ["versions", "FineNotes 2.10.0, Obsidian 1.15.1"],
      ["device", "Desktop (Windows)"],
    ]);
  });

  it("leaves out an empty title and an unknown device", () => {
    const url = new URL(
      bugReportUrl({ title: " ", plugin: "2.10.0", obsidian: "1.15.1", device: null }),
    );
    expect(url.searchParams.has("title")).toBe(false);
    expect(url.searchParams.has("device")).toBe(false);
    expect(versionsLine({ plugin: "1", obsidian: "2" })).toBe("FineNotes 1, Obsidian 2");
  });

  it("keeps a long title to 200 characters", () => {
    const url = new URL(
      bugReportUrl({ title: "a".repeat(500), plugin: "1", obsidian: "1", device: null }),
    );
    expect(url.searchParams.get("title")).toHaveLength(200);
  });
});

describe("what the guide says about a problem", () => {
  const lookup = (id: string): { setting: string | null } | null => {
    const feature = featureById(id);
    return feature ? { setting: settingKeyOf(feature) } : null;
  };

  it("answers #297 with the Simple look switch", () => {
    const answers = guideAnswers("left panel disappears", new Set(), lookup);
    expect(answers.features).toContain("simpleLook");
  });

  it("leaves out a feature the search already shows, and the entry on where to report", () => {
    const entry = (id: string): GuideEntry => guideEntry(id) as GuideEntry;
    const search = (): GuideEntry[] => [
      entry("reportBug"),
      entry("settingSimpleLook"),
      entry("platforms"),
    ];
    const answers = guideAnswers("x", new Set(["simpleLook"]), lookup, 3, search);
    expect(answers.features).toEqual([]);
    expect(answers.entries.map((found) => found.id)).toEqual(["platforms"]);
  });

  it("answers #297 once: the switch, not also the page about it", () => {
    const answers = guideAnswers(
      "Left Panel compeltely dissapers on latest release",
      new Set(),
      lookup,
    );
    expect(answers.features).toEqual(["simpleLook"]);
    expect(answers.entries.map((entry) => entry.id)).not.toContain("simpleLook");
  });

  it("shows at most `limit`", () => {
    const answers = guideAnswers("pen", new Set(), lookup, 2);
    expect(answers.features.length + answers.entries.length).toBeLessThanOrEqual(2);
  });
});

describe("a guide entry's page on GitHub", () => {
  it("is its page, at GitHub's anchor for its heading", () => {
    expect(headingAnchor("Simple look (hide Obsidian's bars)")).toBe(
      "simple-look-hide-obsidians-bars",
    );
    expect(headingAnchor("Pen settings: Highlighter opacity, Straighten lines")).toBe(
      "pen-settings-highlighter-opacity-straighten-lines",
    );
    expect(guideEntryUrl({ area: "settings", title: "Simple look (hide Obsidian's bars)" })).toBe(
      "https://github.com/Joost-8/FineNotes/blob/main/guide/02-settings.md#simple-look-hide-obsidians-bars",
    );
  });
});
