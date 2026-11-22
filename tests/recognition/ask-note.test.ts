import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/model/document";
import { textBlock, type TextNote } from "../../src/model/text-note";
import type { ChatTurn } from "../../src/recognition/ai-chat";
import {
  buildNoteAskSystemPrompt,
  inkSectionCount,
  noteAskFile,
  noteAskText,
  withNoteContext,
} from "../../src/recognition/ask-note";

const stroke: Stroke = {
  id: "s",
  color: "#000",
  size: 3,
  tool: "pen",
  pts: [0, 0, 0.5, 9, 9, 0.5],
};

const note: TextNote = {
  blocks: [
    textBlock("a", "title", [{ text: "Waves", marks: 0 }]),
    { type: "ink", id: "i1", height: 200, strokes: [stroke] },
    { type: "ink", id: "i2", height: 200, strokes: [] },
    textBlock("b", "bullet", [{ text: "frequency", marks: 0 }]),
    { type: "ink", id: "i3", height: 200, strokes: [stroke] },
    { type: "audio", id: "r", path: "Waves/Recordings/r.m4a", duration: 4000 },
  ],
};

describe("a note as the AI reads it", () => {
  it("is its Markdown, with each written section named by its image", () => {
    expect(inkSectionCount(note)).toBe(2);
    expect(noteAskText(note)).toBe(
      [
        "# Waves",
        "[Handwriting 1: image 1]",
        "* frequency",
        "[Handwriting 2: image 2]",
        "![[Waves/Recordings/r.m4a|0:04]]",
      ].join("\n"),
    );
  });

  it("goes as a text file", () => {
    const file = noteAskFile("Waves.note.md", note);
    expect(file.name).toBe("Waves.note.md");
    expect(file.mimeType).toBe("text/plain");
    expect(file.text).toContain("# Waves");
    expect(file.base64).toBeUndefined();
  });

  it("is attached to the last question only, first among its files", () => {
    const file = noteAskFile("Waves.note.md", note);
    const other = { name: "x.pdf", mimeType: "application/pdf", base64: "AA" };
    const turns: ChatTurn[] = [
      { role: "user", text: "one" },
      { role: "assistant", text: "answer" },
      { role: "user", text: "two", files: [other] },
    ];
    const sent = withNoteContext(turns, file);
    expect(sent[0]).toBe(turns[0]);
    expect(sent[2].files).toEqual([file, other]);
    expect(turns[2].files).toEqual([other]);
    expect(withNoteContext([], file)).toEqual([]);
    const answered = withNoteContext([turns[1]], file);
    expect(answered).toEqual([turns[1]]);
    expect(withNoteContext([turns[0]], file)[0].files).toEqual([file]);
  });

  it("is introduced by a prompt that says what comes with a question", () => {
    expect(buildNoteAskSystemPrompt()).toContain("handwriting section");
  });
});
