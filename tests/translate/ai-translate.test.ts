import { describe, expect, it } from "vitest";
import {
  SENTENCE_CHARS,
  buildAiTranslatePrompt,
  isShort,
  parseAiTranslation,
  sentenceAround,
} from "../../src/translate/ai-translate";

describe("isShort", () => {
  it("is a word or a few", () => {
    expect(isShort("leefbaarheid")).toBe(true);
    expect(isShort("op tijd komen")).toBe(true);
    expect(isShort("Ik kom morgen op tijd")).toBe(false);
    expect(isShort("  ")).toBe(false);
  });
});

describe("buildAiTranslatePrompt", () => {
  it("asks for dictionary notes on a word, with its sentence", () => {
    const { system, question } = buildAiTranslatePrompt({
      text: "taken",
      to: "en",
      toName: "English",
      fromName: "Dutch",
      sentence: "Verdeel de taken in je groep.",
    });
    expect(system).toContain("from Dutch into English");
    expect(system).toContain("dictionary notes");
    expect(system).toContain("JSON");
    expect(question).toContain("taken");
    expect(question).toContain("Verdeel de taken in je groep.");
  });

  it("sends a longer text alone, with no notes and no source when unknown", () => {
    const text = "Onderteken de brief en stuur hem terug in de bijgevoegde envelop.";
    const { system, question } = buildAiTranslatePrompt({
      text,
      to: "en",
      toName: "English",
      fromName: null,
      sentence: "something else",
    });
    expect(system).toContain("into English");
    expect(system).not.toContain("from ");
    expect(system).not.toContain("dictionary notes");
    expect(question).toBe(text);
  });
});

describe("parseAiTranslation", () => {
  it("reads the JSON answer, fenced or not", () => {
    expect(
      parseAiTranslation('```json\n{"translation": "tasks", "notes": ["de taak, de taken"]}\n```'),
    ).toEqual({ translation: "tasks", notes: ["de taak, de taken"] });
    expect(parseAiTranslation('{"translation":"Hello"}')).toEqual({
      translation: "Hello",
      notes: [],
    });
  });

  it("takes a plain reply as the translation", () => {
    expect(parseAiTranslation("Good morning")).toEqual({ translation: "Good morning", notes: [] });
    expect(parseAiTranslation("{broken")).toEqual({ translation: "{broken", notes: [] });
  });

  it("drops notes that are not text, and keeps at most six", () => {
    const notes = ["a", 1, "", "b", "c", "d", "e", "f", "g"];
    const out = parseAiTranslation(JSON.stringify({ translation: "x", notes }));
    expect(out.notes).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});

describe("sentenceAround", () => {
  const page = "Lees de tekst. Verdeel de taken in je groep! Bespreek daarna de vragen.";

  it("finds the sentence a word stands in", () => {
    expect(sentenceAround(page, "taken")).toBe("Verdeel de taken in je groep!");
  });

  it("is null without a page, a match, or when the text is the sentence", () => {
    expect(sentenceAround(undefined, "taken")).toBeNull();
    expect(sentenceAround(page, "fiets")).toBeNull();
    expect(sentenceAround("taken", "taken")).toBeNull();
  });

  it("cuts a long sentence around the word", () => {
    const long = `${"woord ".repeat(100)}taken ${"woord ".repeat(100)}.`;
    const out = sentenceAround(long, "taken");
    expect(out).toContain("taken");
    expect(out?.length).toBeLessThanOrEqual(SENTENCE_CHARS + 2);
  });
});
