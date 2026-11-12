import { describe, expect, it } from "vitest";
import { EN } from "../../src/i18n/en";
import type { TextKey } from "../../src/i18n/translate";
import {
  FEATURES,
  featureById,
  featureLink,
  searchFeatures,
  searchWords,
  hiddenFeatureIds,
  searchableFeatures,
  settingKeyOf,
  switchValue,
  withHiddenFeature,
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

  it("points every switch at a real on/off setting, pen gestures included", () => {
    const settings = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const feature of FEATURES) {
      const key = settingKeyOf(feature);
      if (key !== null) expect(typeof switchValue(settings, key), feature.id).toBe("boolean");
    }
    expect(settingKeyOf(featureById("circleLasso")!)).toBe("penGestures.circleLasso");
  });

  it("gives the gestures on a page a Try it, with the event that marks it done", () => {
    expect(featureById("circleLasso")?.tryOn).toEqual({ done: "lasso.circle" });
    expect(featureById("scribble")?.tryOn).toEqual({ done: "erase.scribble" });
    expect(featureById("undo")?.tryOn).toEqual({ done: "undo.gesture" });
    expect(featureById("pullPage")?.tryOn).toEqual({ done: "page.pull" });
    expect(featureById("fillScreen")?.tryOn).toEqual({ done: null });
    // A command or a switch with no gesture is not tried on a page.
    expect(featureById("searchInk")?.tryOn).toBeNull();
    expect(featureById("textDragSize")?.tryOn).toBeNull();
    for (const feature of FEATURES) {
      if (feature.tryOn) expect(feature.tip, feature.id).not.toBeNull();
    }
  });

  it("finds a feature by id whatever its case", () => {
    expect(featureById("TEXTDRAGSIZE")?.id).toBe("textDragSize");
    expect(featureById("nothing-like-this")).toBeNull();
  });
});

describe("switchValue", () => {
  const defaults = { circleLasso: true, scribbleErase: true };

  it("reads a top-level switch, and nothing for a key that is not on/off", () => {
    expect(switchValue({ calcNotes: false }, "calcNotes")).toBe(false);
    expect(switchValue({ paperWidth: 900 }, "paperWidth")).toBeUndefined();
    expect(switchValue({}, "missing")).toBeUndefined();
  });

  it("reads a pen gesture, falling back to its default when it was never stored", () => {
    expect(
      switchValue({ penGestures: { circleLasso: false } }, "penGestures.circleLasso", defaults),
    ).toBe(false);
    expect(switchValue({}, "penGestures.circleLasso", defaults)).toBe(true);
    expect(switchValue({ penGestures: "junk" }, "penGestures.scribbleErase", defaults)).toBe(true);
    expect(switchValue({}, "penGestures.toString", defaults)).toBeUndefined();
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

describe("features taken out of search", () => {
  it("reads back known ids only, each once", () => {
    expect(hiddenFeatureIds(["circleLasso", "circleLasso", "nope", 3, null])).toEqual([
      "circleLasso",
    ]);
    expect(hiddenFeatureIds("circleLasso")).toEqual([]);
    expect(hiddenFeatureIds(undefined)).toEqual([]);
  });

  it("takes a feature out and puts it back", () => {
    const out = withHiddenFeature([], "circleLasso", true);
    expect(out).toEqual(["circleLasso"]);
    expect(withHiddenFeature(out, "circleLasso", true)).toEqual(["circleLasso"]);
    expect(withHiddenFeature(out, "circleLasso", false)).toEqual([]);
    expect(withHiddenFeature([], "nope", true)).toEqual([]);
  });

  it("leaves a hidden feature out of what search may find, and nothing else", () => {
    const all = searchableFeatures([]);
    const some = searchableFeatures(["circleLasso"]);
    expect(some.length).toBe(all.length - 1);
    expect(some.some((f) => f.id === "circleLasso")).toBe(false);
    expect(searchFeatures("circle select", text, 3, some).map((f) => f.id)).not.toContain(
      "circleLasso",
    );
    expect(searchFeatures("circle select", text, 3, all).map((f) => f.id)).toContain("circleLasso");
  });
});
