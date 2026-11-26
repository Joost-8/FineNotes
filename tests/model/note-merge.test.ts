/**
 * `src/model/note-merge.ts`: a text note changed on disk (another device)
 * merged with what this device has, by section, ink stroke by stroke.
 */

import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/model/document";
import { blockKey, mergeInk, mergeNotes, OwnTexts } from "../../src/model/note-merge";
import { textBlock, type InkBlock, type NoteBlock, type TextNote } from "../../src/model/text-note";

let n = 0;
const para = (text: string): NoteBlock =>
  textBlock(`b${++n}`, "body", text ? [{ text, marks: 0 }] : []);
const stroke = (id: string): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen",
  pts: [10, 10, 0.5, 40, 12, 0.5],
});
const ink = (ids: string[], height = 200): InkBlock => ({
  type: "ink",
  id: `i${++n}`,
  height,
  strokes: ids.map(stroke),
});
const note = (...blocks: NoteBlock[]): TextNote => ({ blocks });
/** The same blocks under new ids, as a read of the file gives them. */
const reread = (blocks: readonly NoteBlock[]): NoteBlock[] =>
  blocks.map((b) => ({ ...b, id: `r${++n}` }));
const texts = (merged: TextNote): string[] =>
  merged.blocks.map((b) =>
    b.type === "text" ? b.runs.map((r) => r.text).join("") : `[${b.type}]`,
  );
const inkIds = (merged: TextNote): string[][] =>
  merged.blocks
    .filter((b): b is InkBlock => b.type === "ink")
    .map((b) => b.strokes.map((s) => s.id));

describe("merging a text note changed on disk", () => {
  const a = para("Alpha");
  const b = para("Bravo");
  const c = para("Charlie");
  const base = note(a, b, c);

  it("takes theirs where only theirs changed", () => {
    const theirs = note(...reread([a]), para("Bravo, edited there"), ...reread([c]));
    const { note: merged, carried } = mergeNotes(base, base, theirs);
    expect(texts(merged)).toEqual(["Alpha", "Bravo, edited there", "Charlie"]);
    expect(carried).toBe(0);
  });

  it("keeps mine where only mine changed", () => {
    const mine = note(a, para("Bravo, edited here"), c);
    const { note: merged } = mergeNotes(base, mine, note(...reread(base.blocks)));
    expect(texts(merged)).toEqual(["Alpha", "Bravo, edited here", "Charlie"]);
  });

  it("keeps both where each side changed a different section", () => {
    const mine = note(para("Alpha here"), b, c);
    const theirs = note(...reread([a, b]), para("Charlie there"));
    expect(texts(mergeNotes(base, mine, theirs).note)).toEqual([
      "Alpha here",
      "Bravo",
      "Charlie there",
    ]);
  });

  it("keeps a paragraph added on each side", () => {
    const mine = note(a, b, para("Added here"), c);
    const theirs = note(...reread([a]), para("Added there"), ...reread([b, c]));
    expect(texts(mergeNotes(base, mine, theirs).note)).toEqual([
      "Alpha",
      "Added there",
      "Bravo",
      "Added here",
      "Charlie",
    ]);
  });

  it("keeps both versions of a paragraph both sides edited, nothing lost", () => {
    const mine = note(a, para("Bravo here"), c);
    const theirs = note(...reread([a]), para("Bravo there"), ...reread([c]));
    const { note: merged, carried } = mergeNotes(base, mine, theirs);
    expect(texts(merged)).toEqual(["Alpha", "Bravo here", "Bravo there", "Charlie"]);
    expect(carried).toBe(1);
  });

  it("drops a paragraph taken away there and left alone here", () => {
    const theirs = note(...reread([a, c]));
    expect(texts(mergeNotes(base, base, theirs).note)).toEqual(["Alpha", "Charlie"]);
  });

  it("drops a paragraph taken away here, even when the other side changed elsewhere", () => {
    const mine = note(a, c);
    const theirs = note(...reread([a, b]), para("Charlie there"));
    expect(texts(mergeNotes(base, mine, theirs).note)).toEqual(["Alpha", "Charlie there"]);
  });

  it("puts ink written on both sides of one section together", () => {
    const section = ink(["s1", "s2"]);
    const start = note(a, section, c);
    const mine = note(a, { ...section, strokes: [...section.strokes, stroke("here1")] }, c);
    const theirs = note(
      ...reread([a]),
      { ...section, id: "r-ink", strokes: [...section.strokes, stroke("there1")], height: 260 },
      ...reread([c]),
    );
    const { note: merged, carried } = mergeNotes(start, mine, theirs);
    expect(inkIds(merged)).toEqual([["s1", "s2", "there1", "here1"]]);
    expect(texts(merged)).toEqual(["Alpha", "[ink]", "Charlie"]);
    expect((merged.blocks[1] as InkBlock).height).toBe(260);
    expect(carried).toBe(1);
  });

  it("an erase here and a stroke there both hold", () => {
    const section = ink(["s1", "s2", "s3"]);
    const start = note(section);
    const mine = note({ ...section, strokes: section.strokes.filter((s) => s.id !== "s2") });
    const theirs = note({ ...section, id: "r", strokes: [...section.strokes, stroke("t")] });
    expect(inkIds(mergeNotes(start, mine, theirs).note)).toEqual([["s1", "s3", "t"]]);
  });

  it("ink both sides wrote in, with a paragraph added beside it here, still merges", () => {
    const section = ink(["s1"]);
    const start = note(a, section);
    const mine = note(a, para("New here"), { ...section, strokes: [stroke("s1"), stroke("m")] });
    const theirs = note(...reread([a]), {
      ...section,
      id: "r",
      strokes: [stroke("s1"), stroke("t")],
    });
    const merged = mergeNotes(start, mine, theirs).note;
    expect(texts(merged)).toEqual(["Alpha", "New here", "[ink]"]);
    expect(inkIds(merged)).toEqual([["s1", "t", "m"]]);
  });

  it("is theirs exactly when nothing changed here", () => {
    const theirs = note(...reread([b, a]), para("Delta"));
    const merged = mergeNotes(base, base, theirs).note;
    expect(merged.blocks.map(blockKey)).toEqual(theirs.blocks.map(blockKey));
  });
});

describe("mergeInk", () => {
  it("keeps the paper changed here, else theirs", () => {
    const base = { ...ink([]), paper: "lined" as const };
    const mine = { ...base, paper: "squared" as const };
    expect(mergeInk(base, mine, { ...base, strokes: [stroke("x")] }).paper).toBe("squared");
    expect(mergeInk(base, base, { ...base, paper: "dotted" as const }).paper).toBe("dotted");
  });

  it("drops a reading: the ink it was of has changed", () => {
    const base = ink(["a"]);
    const mine = { ...base, reading: { text: "hi", of: "x" }, strokes: [stroke("a"), stroke("b")] };
    expect(mergeInk(base, mine, base).reading).toBeUndefined();
  });
});

describe("OwnTexts", () => {
  it("remembers the last texts and forgets the oldest", () => {
    const own = new OwnTexts(2);
    own.note("a");
    own.note("b");
    own.note("c");
    expect(own.has("a")).toBe(false);
    expect(own.has("b") && own.has("c")).toBe(true);
    own.note("b");
    own.note("d");
    expect(own.has("c")).toBe(false);
    own.forget();
    expect(own.has("b")).toBe(false);
  });
});
