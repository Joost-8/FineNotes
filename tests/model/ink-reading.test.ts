import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/model/document";
import {
  cleanReading,
  inkReadingHash,
  nextSectionStep,
  readingParagraphs,
  turnInkIntoText,
  withReading,
} from "../../src/model/ink-reading";
import { textBlock, type InkBlock, type TextNote } from "../../src/model/text-note";
import {
  INK_OPEN,
  decodeNote,
  encodeNote,
  inkOpener,
  parseNoteFile,
  readingOfOpener,
} from "../../src/model/text-note-file";

const stroke = (id: string, pts: number[], extra: Partial<Stroke> = {}): Stroke => ({
  id,
  color: "#1f1f1f",
  size: 3,
  tool: "pen",
  pts,
  ...extra,
});

const ink = (id: string, strokes: Stroke[], reading?: { text: string; of: string }): InkBlock => ({
  type: "ink",
  id,
  height: 200,
  strokes,
  ...(reading ? { reading } : {}),
});

function ids(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

describe("the ink a reading depends on", () => {
  it("hashes pen strokes only: highlights and shapes change no reading", () => {
    const pen = [stroke("a", [1, 2, 0.5, 3, 4, 0.5])];
    const base = inkReadingHash(pen);
    expect(inkReadingHash([...pen, stroke("h", [1, 1, 0.5], { tool: "highlighter" })])).toBe(base);
    expect(inkReadingHash([...pen, stroke("s", [0, 0, 0.5, 9, 9, 0.5], { shape: "line" })])).toBe(
      base,
    );
    expect(inkReadingHash([...pen, stroke("b", [5, 5, 0.5])])).not.toBe(base);
    expect(inkReadingHash([stroke("a", [1, 2, 0.5, 3, 4.5, 0.5])])).not.toBe(base);
  });
});

describe("which section is read next", () => {
  const a = [stroke("a", [1, 2, 0.5])];
  const b = [stroke("b", [7, 8, 0.5])];

  it("reads the first section whose reading is missing or out of date", () => {
    const note: TextNote = {
      blocks: [
        textBlock("t", "title"),
        ink("x", a, { text: "old", of: inkReadingHash(a) }),
        ink("y", b, { text: "stale", of: "nope" }),
      ],
    };
    const step = nextSectionStep({ note });
    expect(step).toMatchObject({ kind: "read", index: 2, hash: inkReadingHash(b) });
  });

  it("reads the section written in last first", () => {
    const note: TextNote = { blocks: [ink("x", a), ink("y", b)] };
    expect(nextSectionStep({ note, first: "y" })).toMatchObject({ kind: "read", index: 1 });
  });

  it("keeps a reading made this session instead of reading again (undo brings ink back)", () => {
    const note: TextNote = { blocks: [ink("x", a)] };
    const known = new Map([[inkReadingHash(a), "hello"]]);
    expect(nextSectionStep({ note, known })).toMatchObject({ kind: "keep", text: "hello" });
  });

  it("skips ink that failed, and clears the reading of a section left without ink", () => {
    const skip = new Set([inkReadingHash(a)]);
    expect(nextSectionStep({ note: { blocks: [ink("x", a)] }, skip })).toBeNull();
    const emptied = ink("x", [], { text: "gone", of: "h" });
    expect(nextSectionStep({ note: { blocks: [emptied] } })).toMatchObject({ kind: "clear" });
    expect(nextSectionStep({ note: { blocks: [ink("x", [])] } })).toBeNull();
  });
});

describe("a reading kept on its section", () => {
  it("is cleaned, and the same block comes back when nothing changes", () => {
    const block = ink("x", []);
    const read = withReading(block, { text: "  one \n\n two  three\n", of: "h" });
    expect(read.reading).toEqual({ text: "one\ntwo three", of: "h" });
    expect(withReading(read, { text: "one\ntwo three", of: "h" })).toBe(read);
    expect(withReading(read, null).reading).toBeUndefined();
    expect(withReading(block, null)).toBe(block);
    expect(cleanReading("\r\n a\r\n")).toBe("a");
  });

  it("round-trips through the file, % and quotes included, hidden in the comment", () => {
    const reading = { text: 'Rate: 50% "net"\nline 2 %% end', of: "abc" };
    const note: TextNote = {
      blocks: [ink("x", [stroke("a", [1, 2, 0.5])], reading), textBlock("t")],
    };
    const text = encodeNote(note);
    const opener = text.split("\n")[0];
    expect(opener.startsWith(`${INK_OPEN} {`)).toBe(true);
    // No `%` after the opener's own: Obsidian's comment would end there.
    expect(opener.slice(INK_OPEN.length).includes("%")).toBe(false);
    const read = decodeNote(text, ids()).blocks[0];
    expect(read.type === "ink" && read.reading).toEqual(reading);
    expect(read.type === "ink" && read.strokes.length).toBe(1);
  });

  it("is left off the opener when there is none, as before", () => {
    expect(inkOpener()).toBe(INK_OPEN);
    expect(inkOpener({ text: "", of: "" })).toBe(INK_OPEN);
  });

  it("keeps ink read as nothing by its hash alone, so it is not read at every open", () => {
    const opener = inkOpener({ text: "", of: "h1" });
    expect(opener).toBe(`${INK_OPEN} {"of":"h1"}`);
    expect(readingOfOpener(opener)).toEqual({ text: "", of: "h1" });
  });

  it("reads old sections, and ignores an opener it does not understand", () => {
    expect(readingOfOpener(INK_OPEN)).toBeNull();
    expect(readingOfOpener(`${INK_OPEN} {broken`)).toBeNull();
    expect(readingOfOpener(`${INK_OPEN} something else`)).toBeNull();
    expect(readingOfOpener(`${INK_OPEN} {"read":""}`)).toBeNull();
    expect(readingOfOpener(`${INK_OPEN} null`)).toBeNull();
    expect(readingOfOpener(`${INK_OPEN} {"read":"hi"}`)).toEqual({ text: "hi", of: "" });
    const old = encodeNote({ blocks: [ink("x", [stroke("a", [1, 2, 0.5])])] });
    const block = decodeNote(old, ids()).blocks[0];
    expect(block.type).toBe("ink");
    expect(block.type === "ink" && block.reading).toBeUndefined();
  });

  it("can be read without unpacking the strokes, for searching many notes", () => {
    const note: TextNote = {
      blocks: [
        textBlock("t", "title", [{ text: "Title", marks: 0 }]),
        ink("x", [stroke("a", [1, 2, 0.5])], { text: "hello", of: "h" }),
        textBlock("u"),
      ],
    };
    const file = `---\nfinenotes-note: 1\n---\n${encodeNote(note)}\n`;
    const quick = parseNoteFile(file, ids(), { readingsOnly: true }).note;
    const full = parseNoteFile(file, ids()).note;
    expect(quick.blocks.map((b) => b.type)).toEqual(full.blocks.map((b) => b.type));
    const section = quick.blocks[1];
    expect(section.type === "ink" && section.strokes.length).toBe(0);
    expect(section.type === "ink" && section.reading?.text).toBe("hello");
  });
});

describe("turning a section into typed text", () => {
  it("replaces the section with a paragraph a line, the caret after the last", () => {
    const note: TextNote = {
      blocks: [textBlock("t", "title"), ink("x", []), textBlock("u")],
    };
    const edit = turnInkIntoText(note, 1, "first line\n\n second ", ids());
    expect(edit).not.toBeNull();
    if (!edit) return;
    expect(edit.note.blocks.map((b) => b.type)).toEqual(["text", "text", "text", "text"]);
    expect(edit.note.blocks[2]).toMatchObject({ kind: "body", runs: [{ text: "second" }] });
    expect(edit.caret).toEqual({ block: 2, offset: 6 });
  });

  it("does nothing for a block that is not a section, or a reading with no words", () => {
    const note: TextNote = { blocks: [textBlock("t"), ink("x", [])] };
    expect(turnInkIntoText(note, 0, "a", ids())).toBeNull();
    expect(turnInkIntoText(note, 1, " \n ", ids())).toBeNull();
    expect(readingParagraphs("", ids())).toEqual([]);
  });
});
