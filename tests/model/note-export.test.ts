import { describe, expect, it } from "vitest";
import {
  type MarkdownAssets,
  graphPictureName,
  inkPictureName,
  markdownLink,
  markdownTarget,
  noteMarkdown,
  notePlainText,
  relativePath,
} from "../../src/model/note-export";
import {
  BOLD,
  HIGHLIGHT,
  textBlock,
  type NoteBlock,
  type TextKind,
  type TextNote,
} from "../../src/model/text-note";
import type { Stroke } from "../../src/model/document";

let ids = 0;
const line = (kind: TextKind, text: string, extra: object = {}): NoteBlock =>
  textBlock(`b${++ids}`, kind, text ? [{ text, marks: 0 }] : [], extra);
const stroke: Stroke = {
  id: "s1",
  color: "#000000",
  size: 3,
  tool: "pen",
  pts: [0, 0, 0.5, 9, 9, 0.5],
};

const assets: MarkdownAssets = {
  ink: (_block, n) => `My note files/${inkPictureName(n)}`,
  graph: (_block, n) => `My note files/${graphPictureName(n)}`,
  image: (block) => `My note files/${block.path.split("/").pop() ?? ""}`,
  audio: (block) => `../${block.path}`,
};

describe("noteMarkdown", () => {
  it("writes paragraphs apart and keeps lists, quotes and code together", () => {
    const note: TextNote = {
      blocks: [
        line("title", "Trip"),
        textBlock("p", "body", [
          { text: "Leave ", marks: 0 },
          { text: "early", marks: BOLD },
          { text: " and ", marks: 0 },
          { text: "rest", marks: HIGHLIGHT },
        ]),
        line("body", ""),
        line("body", "Second paragraph"),
        line("check", "Boots", { checked: true }),
        line("check", "Map"),
        line("number", "One"),
        line("number", "Two"),
        line("quote", "Quoted"),
        line("quote", "Still quoted"),
        line("mono", "a = 1"),
        line("mono", "b = 2"),
        {
          type: "table",
          id: "t",
          rows: [
            ["A", "B"],
            ["1", "2"],
          ],
        },
      ],
    };
    expect(noteMarkdown(note, assets)).toBe(
      [
        "# Trip",
        "",
        "Leave **early** and ==rest==",
        "",
        "Second paragraph",
        "",
        "- [x] Boots\n- [ ] Map\n1. One\n2. Two",
        "",
        "> Quoted\n> Still quoted",
        "",
        "```\na = 1\nb = 2\n```",
        "",
        "| A | B |\n| --- | --- |\n| 1 | 2 |",
        "",
      ].join("\n"),
    );
  });

  it("shows handwriting, graphs and pictures as linked pictures, recordings as links", () => {
    const note: TextNote = {
      blocks: [
        { type: "ink", id: "i0", height: 100, strokes: [] },
        { type: "ink", id: "i1", height: 100, strokes: [stroke] },
        {
          type: "graph",
          id: "g",
          spec: { expressions: ["y=x^2"], xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
        },
        { type: "image", id: "p", path: "Trips/view (1).jpg", width: 300 },
        { type: "audio", id: "a", path: "Recordings/Talk.m4a" },
        { type: "raw", id: "r", text: "kept as it was" },
        { type: "raw", id: "r2", text: "  " },
      ],
    };
    expect(noteMarkdown(note, assets).split("\n\n")).toEqual([
      "![Handwriting 1](My%20note%20files/Handwriting%201.png)",
      "![y=x^2](My%20note%20files/Graph%201.png)",
      "![view (1)](My%20note%20files/view%20%281%29.jpg)",
      "[Talk.m4a](../Recordings/Talk.m4a)",
      "kept as it was\n",
    ]);
  });

  it("leaves out what has no file, naming a recording that has none", () => {
    const none: MarkdownAssets = {
      ink: () => null,
      graph: () => null,
      image: () => null,
      audio: () => null,
    };
    const note: TextNote = {
      blocks: [
        { type: "ink", id: "i1", height: 100, strokes: [stroke] },
        {
          type: "graph",
          id: "g",
          spec: { expressions: [], xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
        },
        { type: "image", id: "p", path: "gone.png" },
        { type: "audio", id: "a", path: "Recordings/Talk.m4a" },
      ],
    };
    expect(noteMarkdown(note, none)).toBe("Talk.m4a\n");
  });

  it("names an unnamed graph by its number", () => {
    const note: TextNote = {
      blocks: [
        {
          type: "graph",
          id: "g",
          spec: { expressions: [], xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
        },
      ],
    };
    expect(noteMarkdown(note, assets)).toBe("![Graph 1](My%20note%20files/Graph%201.png)\n");
  });

  it("is empty for an empty note", () => {
    expect(noteMarkdown({ blocks: [line("body", "")] }, assets)).toBe("");
  });
});

describe("markdownLink", () => {
  it("percent-encodes each part of a path", () => {
    expect(markdownLink("a b/c#d (2).png")).toBe("a%20b/c%23d%20%282%29.png");
  });
});

describe("relativePath", () => {
  it("walks up to what the folders share", () => {
    expect(relativePath("Notes/Trip/Exports", "Notes/Trip/Exports/x files/a.png")).toBe(
      "x files/a.png",
    );
    expect(relativePath("Notes/Trip/Exports", "Recordings/a.m4a")).toBe(
      "../../../Recordings/a.m4a",
    );
    expect(relativePath("", "a/b.png")).toBe("a/b.png");
    expect(relativePath("a", "a")).toBe("../a");
  });
});

describe("notePlainText", () => {
  it("writes the note as plain lines, with list marks and handwriting as read", () => {
    const note: TextNote = {
      blocks: [
        line("title", "Trip"),
        line("check", "Boots", { checked: true }),
        line("check", "Map"),
        line("bullet", "Snacks"),
        line("bullet", "Nuts", { indent: 1 }),
        line("dash", "Bus"),
        line("number", "First"),
        line("quote", "Quoted"),
        {
          type: "table",
          id: "t",
          rows: [
            ["A", "B"],
            ["1", "2"],
          ],
        },
        {
          type: "ink",
          id: "i",
          height: 100,
          strokes: [stroke],
          reading: { text: "hello\nworld", of: "h" },
        },
        { type: "ink", id: "i2", height: 100, strokes: [stroke] },
        {
          type: "graph",
          id: "g",
          spec: { expressions: ["y=x"], xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
        },
        { type: "image", id: "p", path: "a.png" },
        { type: "raw", id: "r", text: "raw line" },
        line("body", ""),
        line("body", ""),
        line("body", ""),
        line("body", "End"),
      ],
    };
    expect(notePlainText(note)).toBe(
      [
        "Trip",
        "☑ Boots",
        "☐ Map",
        "• Snacks",
        "\t• Nuts",
        "- Bus",
        "1. First",
        "> Quoted",
        "A\tB",
        "1\t2",
        "hello",
        "world",
        "y=x",
        "raw line",
        "",
        "End",
      ].join("\n"),
    );
  });
});

describe("markdownTarget", () => {
  it("takes the first name free for both the copy and its folder, without case", () => {
    expect(markdownTarget("Trip", new Set())).toEqual({ file: "Trip.md", assets: "Trip files" });
    expect(markdownTarget("Trip", new Set(["trip.md"]))).toEqual({
      file: "Trip 1.md",
      assets: "Trip 1 files",
    });
    expect(markdownTarget("Trip", new Set(["Trip files", "Trip 1.md"]))).toEqual({
      file: "Trip 2.md",
      assets: "Trip 2 files",
    });
    expect(markdownTarget("  ", new Set()).file).toBe("Note.md");
  });
});
