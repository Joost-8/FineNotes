import { describe, expect, it } from "vitest";
import {
  graphOfLine,
  noteAnswers,
  noteGraphs,
  solutionOfLine,
  withBlockAfter,
} from "../../src/model/note-math";
import { textBlock, type NoteBlock } from "../../src/model/text-note";

let n = 0;
const line = (text: string): NoteBlock =>
  textBlock(`s${++n}`, "body", text ? [{ text, marks: 0 }] : []);

describe("typed equations", () => {
  it("solves a line that asks for its letter", () => {
    expect(solutionOfLine("2x+3=7, x =")).toEqual({ text: "2", shown: "2" });
    expect(solutionOfLine("Ex 2: 3y - 4 = 11, y =")?.text).toBe("5");
  });

  it("gives every solution, joined by or", () => {
    const answer = solutionOfLine("x^2 = 9, x =");
    expect(answer?.text).toBe("-3 or 3");
    expect(answer?.shown).toBe("−3 or 3");
  });

  it("finds the equation on a line above a bare ask", () => {
    expect(solutionOfLine("x =", ["5x - 1 = 9"])?.text).toBe("2");
    expect(solutionOfLine("x =", ["x + 1 = 2", "unrelated = 4", "2x = 10"])?.text).toBe("5");
    expect(solutionOfLine("x =", [])).toBeNull();
    expect(solutionOfLine("x =", ["y + 1 = 2"])).toBeNull();
  });

  it("asks for nothing on a plain line or a rule", () => {
    expect(solutionOfLine("2x + 3 = 7")).toBeNull();
    expect(solutionOfLine("y = 2x + 1, y =")).toBeNull();
  });

  it("answers in a note, with sums first", () => {
    const blocks = [line("3x = 12"), line("x ="), line("1 + 1 ="), line("x + 4 = 6, x =")];
    const answers = noteAnswers(blocks);
    expect(answers.get(blocks[1].id)?.text).toBe("4");
    expect(answers.get(blocks[2].id)?.text).toBe("2");
    expect(answers.get(blocks[3].id)?.text).toBe("2");
  });
});

describe("typed functions", () => {
  it("offers the graph of a function line", () => {
    expect(graphOfLine("f(x) = x^2 - 1")?.expressions).toEqual(["f(x) = x^2-1"]);
    expect(graphOfLine("y = 2x + 1")?.expressions).toEqual(["y = 2x+1"]);
    expect(graphOfLine("- g(x) = sin(x)")?.expressions).toEqual(["g(x) = sin(x)"]);
  });

  it("offers nothing for a value, an empty right side or prose", () => {
    expect(graphOfLine("y = 5")).toBeNull();
    expect(graphOfLine("f(x) =")).toBeNull();
    expect(graphOfLine("The answer = good")).toBeNull();
  });

  it("finds them in a note, skipping lines that show an answer", () => {
    const blocks = [line("f(x) = x^2"), line("2 + 2 ="), line("plain")];
    const graphs = noteGraphs(blocks, noteAnswers(blocks));
    expect([...graphs.keys()]).toEqual([blocks[0].id]);
  });

  it("offers no second graph once one is under the line", () => {
    const spec = graphOfLine("y = 2x")!;
    const blocks: NoteBlock[] = [line("y = 2x"), { type: "graph", id: "g", spec }];
    expect(noteGraphs(blocks).size).toBe(0);
  });

  it("puts a block right under a line", () => {
    const blocks = [line("a"), line("b")];
    const extra = line("c");
    expect(withBlockAfter({ blocks }, 0, extra).blocks.map((b) => b.id)).toEqual([
      blocks[0].id,
      extra.id,
      blocks[1].id,
    ]);
    expect(withBlockAfter({ blocks }, 9, extra).blocks[2]).toBe(extra);
  });
});
