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
    expect(found.map((f) => f.id)).toContain("scribble");
  });

  it("finds a settings switch, and says how to reach it", () => {
    const found = helpEntries("write a sum and get the answer", english);
    const calc = found.find((f) => f.id === "calc");
    expect(calc).toBeDefined();
    const text = helpText("sum", calc ? [calc] : [], english);
    expect(text).toContain('A switch in settings: "');
    expect(text).toContain(featureLink("calc"));
  });

  it("caps what it hands over, and says when it knows nothing", () => {
    expect(helpEntries("page", english).length).toBeLessThanOrEqual(MAX_HELP_ENTRIES);
    expect(helpEntries("the a of", english)).toEqual([]);
    expect(helpEntries("zzqxv", english)).toEqual([]);
    expect(helpText("zzqxv", [], english)).toMatch(/nothing on “zzqxv”/);
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
