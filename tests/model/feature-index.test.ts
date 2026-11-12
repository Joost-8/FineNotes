import { describe, expect, it } from "vitest";
import { EN } from "../../src/i18n/en";
import type { TextKey } from "../../src/i18n/translate";
import {
  FEATURES,
  featureById,
  featureLink,
  searchFeatures,
  searchWords,
  settingKeyOf,
} from "../../src/model/feature-index";
import { parseFinenotesLink } from "../../src/model/finenotes-link";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
import { TIP_COLLECTIONS } from "../../src/model/tips";

const english: Record<string, string> = EN;
const text = (key: TextKey): string => english[key] ?? "";
const ids = (query: string, limit = 3): string[] =>
  searchFeatures(query, text, limit).map((f) => f.id);

describe("the feature index", () => {
  it("holds every tip once, and the switches that have no tip", () => {
    const tips = TIP_COLLECTIONS.flatMap((c) => c.tips.map((tip) => tip.id));
    for (const id of tips) expect(featureById(id)?.tip?.id).toBe(id);
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    expect(featureById("textDragSize")?.tip).toBeNull();
  });

  it("names texts that exist in English", () => {
    for (const feature of FEATURES) {
      expect(english[feature.title], feature.id).toBeTruthy();
      expect(english[feature.body], feature.id).toBeTruthy();
    }
  });

  it("points every switch at a real on/off setting", () => {
    const settings = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const feature of FEATURES) {
      const key = settingKeyOf(feature);
      if (key !== null) expect(typeof settings[key], feature.id).toBe("boolean");
    }
  });

  it("finds a feature by id whatever its case", () => {
    expect(featureById("TEXTDRAGSIZE")?.id).toBe("textDragSize");
    expect(featureById("nothing-like-this")).toBeNull();
  });
});

describe("searchWords", () => {
  it("lowers, splits and folds accents", () => {
    expect(searchWords("Café-Boxes, 2 pages")).toEqual(["cafe", "boxes", "2", "pages"]);
  });
});

describe("searchFeatures", () => {
  it("answers the requests people made for things that existed", () => {
    // D#107 and #164: click and drag to size a text box.
    expect(ids("drag text box")).toContain("textDragSize");
    // D#52: an infinite canvas.
    expect(ids("infinite canvas")).toContain("newBoard");
    // D#43: pages across.
    expect(ids("pages across")).toContain("joinedPages");
    // #187: the side panels went.
    expect(ids("side panels")).toContain("simpleLook");
    // #211 item 5: choose the tools on the bar.
    expect(ids("remove tools toolbar")).toContain("customizeBar");
  });

  it("puts a title match before a body match", () => {
    expect(ids("scribble")[0]).toBe("scribble");
  });

  it("wants every word, and takes a plural for its word", () => {
    expect(ids("scribble zebra")).toEqual([]);
    expect(ids("text boxes drag")).toContain("textDragSize");
  });

  it("waits for two characters and keeps to the limit", () => {
    expect(ids("s")).toEqual([]);
    expect(ids("")).toEqual([]);
    expect(ids("page", 2)).toHaveLength(2);
  });

  it("finds nothing for words no feature holds", () => {
    expect(ids("teleport hologram")).toEqual([]);
  });
});

describe("feature links", () => {
  it("round-trip through the link parser", () => {
    const link = featureLink("textDragSize");
    expect(link).toBe("obsidian://finenotes?do=show&feature=textDragSize");
    const params = Object.fromEntries(new URL(link).searchParams);
    expect(parseFinenotesLink(params)).toEqual({ do: "show", feature: "textDragSize" });
  });

  it("refuses a link that names no feature", () => {
    expect(parseFinenotesLink({ do: "show" })).toEqual({
      do: "unknown",
      what: "show without a feature",
    });
  });
});
