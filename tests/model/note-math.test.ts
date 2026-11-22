import { describe, expect, it } from "vitest";
import { answerOfLine, answerSuffix, noteAnswers } from "../../src/model/note-math";
import { textBlock, type NoteBlock, type TextKind } from "../../src/model/text-note";
import {
  GRAPH_OPEN,
  decodeNote,
  encodeNote,
  parseNoteFile,
  buildNoteFile,
} from "../../src/model/text-note-file";
import { makeGraph } from "../../src/model/graph-element";

let n = 0;
const line = (text: string, kind: TextKind = "body"): NoteBlock =>
  textBlock(`l${++n}`, kind, text ? [{ text, marks: 0 }] : []);

function ids(): () => string {
  let i = 0;
  return () => `b${++i}`;
}

describe("typed maths", () => {
  it("answers a line that ends in =", () => {
    expect(answerOfLine("2*(3+4) =", new Map())).toEqual({ text: "14", shown: "14" });
    expect(answerOfLine("12x4=", new Map())?.text).toBe("48");
    expect(answerOfLine("Total: 3 + 4 =  ", new Map())?.text).toBe("7");
    expect(answerOfLine("2^10 =", new Map())?.text).toBe("1024");
    expect(answerOfLine("sqrt(16) =", new Map())?.text).toBe("4");
  });

  it("shows a minus sign, and ≈ for a rounded answer", () => {
    expect(answerOfLine("3 - 10 =", new Map())).toEqual({ text: "-7", shown: "−7" });
    expect(answerOfLine("1/4 =", new Map())?.shown).toBe("0.25");
    expect(answerOfLine("1/3 =", new Map())?.shown).toBe("≈ 0.33333333");
    expect(answerOfLine("sqrt(2) =", new Map())?.shown.startsWith("≈ ")).toBe(true);
  });

  it("leaves prose, a lone number and an unfinished line alone", () => {
    expect(answerOfLine("The meeting is =", new Map())).toBeNull();
    expect(answerOfLine("12 =", new Map())).toBeNull();
    expect(answerOfLine("2 + 3", new Map())).toBeNull();
    expect(answerOfLine("2 + 3 = 5", new Map())).toBeNull();
    expect(answerOfLine("1/0 =", new Map())).toBeNull();
    expect(answerOfLine(`${"1+".repeat(200)}1 =`, new Map())).toBeNull();
  });

  it("lets a line set a letter for the lines below, and only those", () => {
    const blocks = [
      line("cost * 2 ="),
      line("cost = 12"),
      line("cost * 3 ="),
      line("rate = cost / 4"),
      line("rate + 1 ="),
    ];
    const answers = noteAnswers(blocks);
    expect(answers.has(blocks[0].id)).toBe(false);
    expect(answers.get(blocks[2].id)?.text).toBe("36");
    expect(answers.get(blocks[4].id)?.text).toBe("4");
    expect(answers.size).toBe(2);
  });

  it("reads list items and quotes but not code", () => {
    const blocks = [line("1+1 =", "bullet"), line("2+2 =", "mono"), line("3+3 =", "quote")];
    const answers = noteAnswers(blocks);
    expect([...answers.keys()]).toEqual([blocks[0].id, blocks[2].id]);
  });

  it("puts the answer in after the =", () => {
    const answer = { text: "14", shown: "14" };
    expect(answerSuffix("2*(3+4) =", answer)).toBe(" 14");
    expect(answerSuffix("2*(3+4) = ", answer)).toBe("14");
    expect(answerOfLine(`2*(3+4) =${answerSuffix("2*(3+4) =", answer)}`, new Map())).toBeNull();
  });
});

describe("graphs in a text note", () => {
  const spec = makeGraph({
    id: "g",
    x: 0,
    y: 0,
    spec: { expressions: ["y = x^2", "y = 50% * x"], xMin: -5, xMax: 5, yMin: -2, yMax: 8 },
  }).spec;
  const graph: NoteBlock = { type: "graph", id: "g1", spec };

  it("round-trips as a comment with one line of JSON", () => {
    const blocks = [line("Parabola"), graph, line("after")];
    const text = encodeNote({ blocks });
    const lines = text.split("\n");
    expect(lines[1]).toBe(GRAPH_OPEN);
    expect(lines[3]).toBe("%%");
    // Two % in a row would end Obsidian's comment early.
    expect(lines[2]).not.toContain("%");
    const read = decodeNote(text, ids()).blocks;
    expect(read.map((b) => b.type)).toEqual(["text", "graph", "text"]);
    const back = read[1];
    expect(back.type === "graph" && back.spec).toEqual(spec);
    // Written again, it is the same file.
    expect(encodeNote({ blocks: read })).toBe(text);
  });

  it("survives a whole file and keeps fields it does not know", () => {
    const own = { type: "graph" as const, id: "g2", spec: { ...spec, future: { a: 1 } } };
    const file = buildNoteFile("---\nfinenotes-note: 1\n---\n", { blocks: [own] });
    const read = parseNoteFile(file, ids()).note.blocks[0];
    expect(read.type).toBe("graph");
    expect(read.type === "graph" && read.spec.future).toEqual({ a: 1 });
  });

  it("keeps a graph it cannot read as it is", () => {
    for (const body of [
      `${GRAPH_OPEN}\nnot json\n%%`,
      `${GRAPH_OPEN}\n{"expressions":[]}\n%%`,
      `${GRAPH_OPEN}\n[1,2]\n%%`,
      `${GRAPH_OPEN}\n{"expressions":["y=x"]}`,
    ]) {
      const blocks = decodeNote(body, ids()).blocks;
      expect(blocks[0].type).toBe("raw");
      expect(encodeNote({ blocks })).toBe(body);
    }
  });

  it("escapes body text that would read as a graph", () => {
    const blocks = [line(`${GRAPH_OPEN} is how a graph starts`)];
    const text = encodeNote({ blocks });
    expect(text.startsWith("\\")).toBe(true);
    const read = decodeNote(text, ids()).blocks[0];
    expect(read.type === "text" && read.runs[0].text).toBe(`${GRAPH_OPEN} is how a graph starts`);
  });

  it("leaves an old note without graphs exactly as it was", () => {
    const old = "# Title\nSome text = \n%%finenotes-ink\nnot a page\n%%\n* item";
    const blocks = decodeNote(old, ids()).blocks;
    expect(blocks.some((b) => b.type === "graph")).toBe(false);
    expect(encodeNote({ blocks })).toBe(old);
  });
});
