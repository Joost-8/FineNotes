import { describe, expect, it } from "vitest";
import { vaultPathFromDrop } from "../../src/model/file-drop";

describe("vault file drag data", () => {
  it.each([
    ["![[photo.png|Photo]]", "photo.png"],
    ["note.md", "note.md"],
    ["Lectures/Week 1.pdf", "Lectures/Week 1.pdf"],
    ["[[Lectures/Week 1.pdf#page=3|Lecture]]", "Lectures/Week 1.pdf"],
    ["![[Worksheet.PDF]]", "Worksheet.PDF"],
    ["[Lecture](Lectures/Week%201.pdf)", "Lectures/Week 1.pdf"],
    ["[Lecture](<Lectures/Week 1.pdf>)", "Lectures/Week 1.pdf"],
    ["obsidian://open?vault=School&file=Lectures%2FWeek%201.pdf", "Lectures/Week 1.pdf"],
  ])("resolves %s", (text, expected) => expect(vaultPathFromDrop(text)).toBe(expected));
  it.each([
    "",
    "one.pdf\ntwo.pdf",
    "https://example.com/file.pdf",
    "file:///tmp/file.pdf",
    "[Bad](%FF.pdf)",
    "obsidian://open?vault=School",
  ])("ignores %s", (text) => expect(vaultPathFromDrop(text)).toBeNull());
});
