import { describe, expect, it } from "vitest";
import { english } from "../../src/i18n/translate";
import { parseToolCall, toolStatus } from "../../src/recognition/ask-tools";
import {
  MAX_HELP_ENTRIES,
  askAbilitiesPrompt,
  helpEntries,
  helpText,
} from "../../src/recognition/finenotes-help";
import { FEATURES, featureLink } from "../../src/model/feature-index";

describe("FineNotes' handbook for Ask AI", () => {
  it("finds features from a question asked in a sentence", () => {
    const found = helpEntries("how do I erase by scribbling over words?", english);
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((f) => f.id)).toContain("scribbleErase");
  });

  it("finds a calculation by the word people use, and says where it is switched", () => {
    const found = helpEntries("how do I make a calculation?", english);
    const calc = found.find((f) => f.id === "settingCalcNotes");
    expect(calc).toBeDefined();
    const text = helpText("calculation", calc ? [calc] : []);
    expect(text).toContain("Where: Settings › Reading and voice › Calculate lines that end in =");
    expect(text).toContain(featureLink("calc"));
  });

  it("names settings by their place and commands by their name, never by key", () => {
    const [entry] = helpEntries("Pencil tilt shading", english, 1);
    expect(entry.id).toBe("settingPencilTilt");
    const [stylus] = helpEntries("stylus only mode palm", english, 1);
    const text = helpText("stylus", [stylus]);
    expect(text).toContain('"FineNotes: Turn Stylus-only mode on or off"');
    expect(text).not.toMatch(/onlyStylusMode|toggle-only-stylus-mode/);
  });

  it("still finds a tip the guide does not cover, by its own link", () => {
    const tip = FEATURES.find((f) => f.id === "redoThree");
    expect(tip).toBeDefined();
    const found = helpEntries("redo three fingers", english, 6, [], FEATURES);
    expect(found[0].link).toBe(featureLink(found[0].id));
  });

  it("caps what it hands over, and says when it knows nothing", () => {
    expect(helpEntries("page", english).length).toBeLessThanOrEqual(MAX_HELP_ENTRIES);
    expect(helpEntries("the a of", english)).toEqual([]);
    expect(helpEntries("zzqxv", english)).toEqual([]);
    const none = helpText("zzqxv", []);
    expect(none).toMatch(/nothing on “zzqxv”/);
    expect(none).toContain("https://github.com/Joost-8/FineNotes/issues");
  });

  it("reads every feature in English", () => {
    for (const feature of FEATURES) {
      expect(english(feature.title)).not.toBe(feature.title);
      expect(english(feature.body)).not.toBe(feature.body);
    }
  });

  it("tells the AI its reach and the settings that change it", () => {
    const folder = askAbilitiesPrompt("folder", false);
    expect(folder).toContain("this notebook's folder and its subfolders");
    expect(folder).toContain("Settings › AI › Ask AI can read");
    expect(folder).toContain("Show what each answer cost (off now)");
    expect(askAbilitiesPrompt("vault", true)).toContain("the whole vault");
    expect(askAbilitiesPrompt("off", true)).toContain("only this notebook");
    expect(askAbilitiesPrompt("folder", false)).toBe(folder);
  });

  it("is a tool like the others", () => {
    expect(parseToolCall("finenotes_help", { query: " lasso " }, 3)).toEqual({
      tool: "finenotes_help",
      query: "lasso",
    });
    expect(parseToolCall("finenotes_help", {}, 3)).toEqual({ error: '"query" is empty.' });
    expect(toolStatus({ tool: "finenotes_help", query: "lasso" })).toBe(
      "Looking up “lasso” in FineNotes' handbook…",
    );
  });
});
