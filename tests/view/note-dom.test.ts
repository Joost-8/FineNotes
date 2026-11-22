import { describe, expect, it } from "vitest";
import { BOLD, ITALIC, STRIKE, UNDERLINE } from "../../src/model/text-note";
import {
  marksOf,
  offsetOf,
  positionAt,
  readRuns,
  textLength,
  type NodeLike,
} from "../../src/view/note-dom";

/** A text node. */
const text = (value: string): NodeLike => ({
  nodeType: 3,
  nodeName: "#text",
  nodeValue: value,
  childNodes: [],
});

/** An element, with an inline style when one is given. */
const el = (name: string, children: NodeLike[] = [], style?: NodeLike["style"]): NodeLike => ({
  nodeType: 1,
  nodeName: name,
  nodeValue: null,
  childNodes: children,
  ...(style ? { style } : {}),
});

const comment: NodeLike = { nodeType: 8, nodeName: "#comment", nodeValue: "x", childNodes: [] };

describe("reading a paragraph", () => {
  it("reads marks from tags, however they nest", () => {
    const line = el("DIV", [
      text("a "),
      el("B", [text("b"), el("I", [text("bi")])]),
      el("strong", [text("s")]),
      el("EM", [el("U", [text("eu")])]),
      el("S", [text("x")]),
      el("DEL", [text("y")]),
      comment,
    ]);
    expect(readRuns(line)).toEqual([
      { text: "a ", marks: 0 },
      { text: "b", marks: BOLD },
      { text: "bi", marks: BOLD | ITALIC },
      { text: "s", marks: BOLD },
      { text: "eu", marks: ITALIC | UNDERLINE },
      { text: "xy", marks: STRIKE },
    ]);
  });

  it("reads marks from inline styles", () => {
    expect(marksOf(el("SPAN", [], { fontWeight: "700" }))).toBe(BOLD);
    expect(marksOf(el("SPAN", [], { fontWeight: "bold", fontStyle: "italic" }))).toBe(
      BOLD | ITALIC,
    );
    expect(marksOf(el("SPAN", [], { fontWeight: "400", fontStyle: "normal" }))).toBe(0);
    expect(marksOf(el("SPAN", [], { textDecorationLine: "underline line-through" }))).toBe(
      UNDERLINE | STRIKE,
    );
    expect(marksOf(el("SPAN", [], { textDecoration: "underline" }))).toBe(UNDERLINE);
    expect(marksOf(el("SPAN"))).toBe(0);
  });

  it("gives the paragraph's own element no marks, and ignores a line break", () => {
    const heading = el("B", [text("Head"), el("BR")], { fontWeight: "700" });
    expect(readRuns(heading)).toEqual([{ text: "Head", marks: 0 }]);
    expect(readRuns(el("DIV", [el("BR")]))).toEqual([]);
  });

  it("keeps a typed line break as a space, so offsets still count", () => {
    const line = el("DIV", [text("a\nb")]);
    expect(readRuns(line)).toEqual([{ text: "a b", marks: 0 }]);
    expect(textLength(line)).toBe(3);
  });
});

describe("the caret", () => {
  const a = text("hello");
  const b = text("bold");
  const c = text("!");
  const strong = el("B", [b]);
  const line = el("DIV", [a, strong, c]);

  it("counts characters up to a position in a text node", () => {
    expect(offsetOf(line, a, 2)).toBe(2);
    expect(offsetOf(line, b, 1)).toBe(6);
    expect(offsetOf(line, c, 1)).toBe(10);
    expect(offsetOf(line, b, 99)).toBe(9);
  });

  it("counts characters up to a child index of an element", () => {
    expect(offsetOf(line, line, 0)).toBe(0);
    expect(offsetOf(line, line, 1)).toBe(5);
    expect(offsetOf(line, line, 2)).toBe(9);
    expect(offsetOf(line, line, 3)).toBe(10);
    expect(offsetOf(line, strong, 1)).toBe(9);
    expect(offsetOf(line, line, 99)).toBe(10);
  });

  it("counts a position outside the paragraph as its end", () => {
    expect(offsetOf(line, text("elsewhere"), 3)).toBe(10);
  });

  it("finds the node an offset falls in, ending a run rather than starting the next", () => {
    expect(positionAt(line, 0)).toEqual({ node: a, offset: 0 });
    expect(positionAt(line, 5)).toEqual({ node: a, offset: 5 });
    expect(positionAt(line, 6)).toEqual({ node: b, offset: 1 });
    expect(positionAt(line, 10)).toEqual({ node: c, offset: 1 });
    expect(positionAt(line, 99)).toEqual({ node: c, offset: 1 });
    expect(positionAt(line, -4)).toEqual({ node: a, offset: 0 });
  });

  it("answers the paragraph itself when it holds no text", () => {
    const empty = el("DIV", [el("BR"), text("")]);
    expect(positionAt(empty, 3)).toEqual({ node: empty, offset: 0 });
  });

  it("round-trips every offset", () => {
    for (let offset = 0; offset <= 10; offset++) {
      const at = positionAt(line, offset);
      expect(offsetOf(line, at.node, at.offset)).toBe(offset);
    }
  });
});
