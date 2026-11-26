import { describe, expect, it } from "vitest";
import {
  type Correction,
  type ReadWord,
  flagWords,
  ignoredWords,
  parseCorrections,
} from "../../src/recognition/hwr/corrections";
import {
  answeredWord,
  personalWords,
  withPersonal,
} from "../../src/recognition/hwr/personal-words";

function correction(over: Partial<Correction> = {}): Correction {
  return {
    kind: "misread",
    read: "coptime",
    text: "coprime",
    note: "Maths/Maths.notebook.md",
    page: "p3",
    strokes: [{ id: "s1", pts: [0, 0, 0.5, 4, 2, 0.5], t0: 10 }],
    at: 1_700_000_000_000,
    ...over,
  };
}

describe("answeredWord", () => {
  it("takes a misread's typed word, as the list holds it", () => {
    expect(answeredWord(correction({ text: "Coprime," }))).toBe("coprime");
  });

  it("takes the reading of an It says and of an ignore", () => {
    expect(answeredWord(correction({ kind: "mistake", read: "Resit", text: "Resit" }))).toBe(
      "resit",
    );
    expect(answeredWord(correction({ kind: "ignore", read: "Acks", text: "Acks" }))).toBe("acks");
  });

  it("takes the meant word of a slip, never the misspelling", () => {
    expect(
      answeredWord(
        correction({ kind: "mistake", read: "recieve", text: "recieve", meant: "receive" }),
      ),
    ).toBe("receive");
  });

  it("leaves out notation and pieces of a sum", () => {
    expect(answeredWord(correction({ text: "71 mod 7 =" }))).toBeNull();
    expect(answeredWord(correction({ text: "QNR", source: "calc" }))).toBeNull();
    expect(answeredWord(correction({ text: "u" }))).toBeNull();
  });
});

describe("personalWords", () => {
  it("reads the answers already in a corrections file, written before the list existed", () => {
    // The file as 2.10 writes it: nothing to move, every old answer counts at once.
    const raw = JSON.stringify({
      version: 1,
      corrections: [
        correction(),
        correction({ kind: "mistake", read: "lifeline", text: "lifeline" }),
        correction({ kind: "ignore", read: "Carmichael", text: "Carmichael" }),
        correction({ kind: "misread", read: "77", text: "71" }),
      ],
    });
    expect([...personalWords(parseCorrections(raw))].sort()).toEqual([
      "carmichael",
      "coprime",
      "lifeline",
    ]);
  });

  it("holds every word ignoredWords did, and the corrected misreads too", () => {
    const file = {
      version: 1 as const,
      corrections: [
        correction(),
        correction({ kind: "ignore", read: "Acks", text: "Acks" }),
        correction({ kind: "mistake", read: "Resit", text: "Resit" }),
      ],
    };
    const personal = personalWords(file);
    for (const w of ignoredWords(file)) expect(personal.has(w)).toBe(true);
    expect(personal.has("coprime")).toBe(true);
  });

  it("stops a corrected misread from being underlined when it is read right later", () => {
    const file = { version: 1 as const, corrections: [correction()] };
    const read: ReadWord[] = [{ text: "coprime", strokeIds: ["t9"] }];
    const list = new Set(["the"]);
    // Before: answered misreads were not among the words left alone.
    expect(flagWords(read, list, ignoredWords(file))).toHaveLength(1);
    expect(flagWords(read, withPersonal(list, personalWords(file)), ignoredWords(file))).toEqual(
      [],
    );
  });
});

describe("withPersonal", () => {
  it("is the list itself when the answers add nothing", () => {
    const list = new Set(["coprime", "the"]);
    expect(withPersonal(list, new Set(["coprime"]))).toBe(list);
  });

  it("adds the writer's words without changing the list", () => {
    const list = new Set(["the"]);
    const both = withPersonal(list, new Set(["coprime"]));
    expect([...both].sort()).toEqual(["coprime", "the"]);
    expect(list.has("coprime")).toBe(false);
  });
});
