import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/model/document";
import {
  BOLD,
  HIGHLIGHT,
  HIGHLIGHT_BLUE,
  HIGHLIGHT_GREEN,
  HIGHLIGHT_PINK,
  withMarkOn,
  ITALIC,
  STRIKE,
  UNDERLINE,
  textBlock,
  type NoteBlock,
  type TextKind,
  type TextNote,
  type TextRun,
} from "../../src/model/text-note";
import {
  INK_OPEN,
  buildNoteFile,
  decodeInline,
  decodeNote,
  encodeInline,
  encodeNote,
  freeNoteName,
  hasDefaultName,
  isTextNoteName,
  newNoteFile,
  parseNoteFile,
  splitNoteFile,
  stripTextNoteSuffix,
  titleFileName,
} from "../../src/model/text-note-file";

function ids(): () => string {
  let n = 0;
  return () => `b${++n}`;
}

/** A note without its ids, for comparing two readings. */
function shape(note: TextNote): unknown[] {
  return note.blocks.map((block) => {
    const { id: _id, ...rest } = block;
    return rest;
  });
}

function roundTrip(blocks: NoteBlock[]): unknown[] {
  return shape(decodeNote(encodeNote({ blocks }), ids()));
}

const run = (text: string, marks = 0): TextRun => ({ text, marks });
const body = (text: string, kind: TextKind = "body"): NoteBlock =>
  textBlock("x", kind, text ? [run(text)] : []);

/** A small seeded generator, so a failure repeats. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const stroke = (id: string, pts: number[]): Stroke => ({
  id,
  color: "#1f1f1f",
  size: 3,
  tool: "pen",
  pts,
});

describe("inline marks", () => {
  it("writes each mark as Markdown", () => {
    expect(encodeInline([run("a "), run("b", BOLD), run(" c")])).toBe("a **b** c");
    expect(encodeInline([run("i", ITALIC)])).toBe("*i*");
    expect(encodeInline([run("s", STRIKE)])).toBe("~~s~~");
    expect(encodeInline([run("u", UNDERLINE)])).toBe("<u>u</u>");
  });

  it("keeps the spaces at a marked run's edges outside the marks", () => {
    expect(encodeInline([run("a"), run(" b ", BOLD), run("c")])).toBe("a **b** c");
    expect(encodeInline([run("   ", BOLD)])).toBe("   ");
  });

  it("escapes what would read as a mark", () => {
    const text = "2 * 3 ~ 4 ~~ <u>x</u> \\* \\d end\\";
    expect(decodeInline(encodeInline([run(text)]))).toEqual([run(text)]);
  });

  it("reads marks that cross and nest", () => {
    const cases: TextRun[][] = [
      [run("a", ITALIC), run("b", BOLD | ITALIC)],
      [run("a", BOLD | ITALIC), run("b", ITALIC)],
      [run("a", BOLD), run("b", BOLD | ITALIC)],
      [run("a", BOLD | ITALIC), run("b", BOLD)],
      [run("a", BOLD | ITALIC | STRIKE | UNDERLINE)],
      [run("a", UNDERLINE), run("b", BOLD | UNDERLINE), run("c", STRIKE)],
    ];
    for (const runs of cases) expect(decodeInline(encodeInline(runs))).toEqual(runs);
  });

  it("leaves a lone marker as text", () => {
    expect(decodeInline("2 * 3")).toEqual([run("2 * 3")]);
    expect(decodeInline("a ** b")).toEqual([run("a ** b")]);
    expect(decodeInline("a ~~ b")).toEqual([run("a ~~ b")]);
    expect(decodeInline("<u>open")).toEqual([run("<u>open")]);
    expect(decodeInline("close</u>")).toEqual([run("close</u>")]);
    expect(decodeInline("*not closed")).toEqual([run("*not closed")]);
  });

  it("round-trips random runs", () => {
    const next = random(7);
    const alphabet = ["a", "b", " ", "*", "~", "\\", "<u>", "</u>", "_", "#", "é", "1.", "-"];
    for (let round = 0; round < 400; round++) {
      const runs: TextRun[] = [];
      const count = 1 + Math.floor(next() * 5);
      for (let i = 0; i < count; i++) {
        let text = "";
        const length = 1 + Math.floor(next() * 6);
        for (let c = 0; c < length; c++) text += alphabet[Math.floor(next() * alphabet.length)];
        runs.push(run(text, Math.floor(next() * 16)));
      }
      // What a file can hold: marks only on stretches that start and end on a non-space.
      const stored = decodeInline(encodeInline(runs));
      expect(decodeInline(encodeInline(stored)), JSON.stringify(runs)).toEqual(stored);
      expect(stored.map((r) => r.text).join("")).toBe(runs.map((r) => r.text).join(""));
    }
  });
});

describe("blocks as lines", () => {
  it("writes each kind the Markdown way", () => {
    const note: TextNote = {
      blocks: [
        body("Shopping", "title"),
        body("Today", "heading"),
        body("Later", "subheading"),
        body("plain"),
        body("milk", "bullet"),
        textBlock("x", "bullet", [run("oat")], { indent: 1 }),
        body("one", "number"),
        body("two", "number"),
        textBlock("x", "check", [run("done")], { checked: true }),
        body("todo", "check"),
        body("said", "quote"),
        body("code", "mono"),
        body("more", "mono"),
        { type: "image", id: "x", path: "Pictures/a b.png", width: 360 },
        { type: "image", id: "x", path: "c.jpg" },
      ],
    };
    expect(encodeNote(note).split("\n")).toEqual([
      "# Shopping",
      "## Today",
      "### Later",
      "plain",
      "* milk",
      "\t* oat",
      "1. one",
      "2. two",
      "- [x] done",
      "- [ ] todo",
      "> said",
      "```",
      "code",
      "more",
      "```",
      "![[Pictures/a b.png|360]]",
      "![[c.jpg]]",
    ]);
    expect(roundTrip(note.blocks.slice())).toEqual(shape(note));
  });

  it("keeps empty paragraphs, and empty blocks of every kind", () => {
    const kinds: TextKind[] = [
      "title",
      "heading",
      "subheading",
      "bullet",
      "number",
      "check",
      "quote",
    ];
    for (const kind of kinds) {
      const blocks = [body("a"), body(""), body("", kind), body(""), body("b")];
      expect(roundTrip(blocks), kind).toEqual(shape({ blocks }));
    }
    const blocks = [body("", "mono"), body("x", "mono"), body("", "mono"), body("")];
    expect(roundTrip(blocks)).toEqual(shape({ blocks }));
  });

  it("separates body text from the list or quote above it", () => {
    const blocks = [
      body("item", "bullet"),
      body("text"),
      body("q", "quote"),
      body(""),
      body("end"),
    ];
    expect(encodeNote({ blocks }).split("\n")).toEqual([
      "* item",
      "",
      "text",
      "> q",
      "",
      "",
      "end",
    ]);
    expect(roundTrip(blocks)).toEqual(shape({ blocks }));
    const picture: NoteBlock[] = [
      body("item", "bullet"),
      { type: "image", id: "x", path: "a.png" },
      body("q", "quote"),
      { type: "image", id: "x", path: "b.png", width: 200 },
      body("item", "bullet"),
    ];
    expect(encodeNote({ blocks: picture }).split("\n")).toEqual([
      "* item",
      "",
      "![[a.png]]",
      "> q",
      "",
      "![[b.png|200]]",
      "* item",
    ]);
    expect(roundTrip(picture)).toEqual(shape({ blocks: picture }));
    const last = [body("item", "check"), body("")];
    expect(roundTrip(last)).toEqual(shape({ blocks: last }));
  });

  it("escapes body text that would read as another kind of line", () => {
    const lines = [
      "# not a title",
      "#",
      "- not a bullet",
      "-",
      "* star",
      "1. not a number",
      "12) nor this",
      "> not a quote",
      ">",
      "```",
      "---",
      "***",
      "_ _ _",
      INK_OPEN,
      "![[picture.png|20]]",
      "\t- indented",
      "  2. spaced",
      "%%comment%%",
      "![[Some note]]",
      "[[link]] and #tag stay",
    ];
    const blocks = lines.map((line) => body(line));
    expect(roundTrip(blocks)).toEqual(shape({ blocks }));
    // Lines Obsidian owns are written as they are.
    const text = encodeNote({ blocks });
    expect(text).toContain("\n%%comment%%\n");
    expect(text).toContain("\n![[Some note]]\n");
    expect(text).toContain("[[link]] and #tag stay");
  });

  it("keeps list text that looks like a rule or a marker", () => {
    const blocks = [body("- -", "bullet"), body("[ ] box", "bullet"), body("```", "mono")];
    const read = roundTrip(blocks) as Array<{ kind: string; runs: TextRun[] }>;
    expect(read[0]).toMatchObject({ kind: "bullet", runs: [run("- -")] });
    expect(read[2]).toMatchObject({ kind: "mono", runs: [run("```")] });
  });

  it("numbers a list by depth and starts again after other text", () => {
    const item = (indent: number): NoteBlock => textBlock("x", "number", [run("n")], { indent });
    const text = encodeNote({
      blocks: [item(0), item(1), item(1), item(0), body("stop"), item(0)],
    });
    expect(text.split("\n")).toEqual(["1. n", "\t1. n", "\t2. n", "2. n", "", "stop", "1. n"]);
  });

  it("reads Markdown written by hand", () => {
    const note = decodeNote(
      "#### Deep\n* star\n+ plus\n    - four spaces\n3) three\n- [X] big x\n>tight",
      ids(),
    );
    expect(shape(note)).toEqual(
      shape({
        blocks: [
          body("Deep", "subheading"),
          body("star", "bullet"),
          body("plus", "bullet"),
          textBlock("x", "dash", [run("four spaces")], { indent: 2 }),
          body("three", "number"),
          textBlock("x", "check", [run("big x")], { checked: true }),
          body("tight", "quote"),
        ],
      }),
    );
    expect(decodeNote("", ids()).blocks).toHaveLength(1);
  });

  it("reads an unclosed fence to the end", () => {
    expect(shape(decodeNote("```js\na\nb", ids()))).toEqual(
      shape({ blocks: [body("a", "mono"), body("b", "mono")] }),
    );
  });

  it("round-trips random notes", () => {
    const next = random(99);
    const kinds: TextKind[] = [
      "title",
      "heading",
      "subheading",
      "body",
      "mono",
      "bullet",
      "number",
      "check",
      "quote",
    ];
    const words = [
      "",
      "a",
      "- b",
      "# c",
      "> d",
      "1. e",
      "x*y",
      "~~",
      " lead",
      "trail ",
      "`",
      "```",
      "%%",
    ];
    for (let round = 0; round < 300; round++) {
      const blocks: NoteBlock[] = [];
      const count = 1 + Math.floor(next() * 8);
      for (let i = 0; i < count; i++) {
        const kind = kinds[Math.floor(next() * kinds.length)];
        const text = words[Math.floor(next() * words.length)];
        const marks = kind === "mono" ? 0 : Math.floor(next() * 16);
        const runs = decodeInline(encodeInline(text ? [run(text, marks)] : []));
        blocks.push(
          textBlock("x", kind, kind === "mono" ? [run(text)] : runs, {
            indent: Math.floor(next() * 4),
            checked: next() < 0.5,
          }),
        );
      }
      expect(roundTrip(blocks), encodeNote({ blocks })).toEqual(shape({ blocks }));
    }
  });
});

describe("handwriting sections", () => {
  it("round-trips strokes and the section's height", () => {
    const blocks: NoteBlock[] = [
      body("Title", "title"),
      {
        type: "ink",
        id: "x",
        height: 340,
        strokes: [stroke("s1", [10, 20, 0.5, 30.25, 40.5, 0.5]), stroke("s2", [5, 5, 0.5])],
      },
      body("after"),
    ];
    const text = encodeNote({ blocks });
    const lines = text.split("\n");
    expect(lines[1]).toBe(INK_OPEN);
    expect(lines[2]).toMatch(/^v\d[^:]*:[A-Za-z0-9+/=]+$/);
    expect(lines[3]).toBe("%%");
    const read = decodeNote(text, ids()).blocks[1];
    expect(read.type).toBe("ink");
    if (read.type !== "ink") return;
    expect(read.height).toBe(340);
    expect(read.strokes.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(read.strokes[0].pts[3]).toBeCloseTo(30.25, 2);
    expect(read.strokes[0].color).toBe("#1f1f1f");
  });

  it("keeps a section it cannot read exactly as it is", () => {
    const text = `a\n${INK_OPEN}\nv2:not base64 at all!\n%%\nb`;
    const note = decodeNote(text, ids());
    expect(note.blocks[1]).toMatchObject({
      type: "raw",
      text: `${INK_OPEN}\nv2:not base64 at all!\n%%`,
    });
    expect(encodeNote(note)).toBe(text);
    const open = `a\n${INK_OPEN}\nv2:AAAA`;
    expect(encodeNote(decodeNote(open, ids()))).toBe(open);
  });
});

describe("the file", () => {
  it("splits frontmatter from the note", () => {
    expect(splitNoteFile("---\na: 1\n---\n# T\n")).toEqual({
      frontmatter: "---\na: 1\n---\n",
      body: "# T\n",
    });
    expect(splitNoteFile("---\n---\nx")).toEqual({ frontmatter: "---\n---\n", body: "x" });
    expect(splitNoteFile("# T")).toEqual({ frontmatter: "", body: "# T" });
    expect(splitNoteFile("---\nnever closed")).toEqual({
      frontmatter: "",
      body: "---\nnever closed",
    });
    expect(splitNoteFile("---\r\na: 1\r\n---")).toEqual({
      frontmatter: "---\na: 1\n---\n",
      body: "",
    });
  });

  it("writes a file that reads back the same, frontmatter untouched", () => {
    const text = "---\ntags: [x]\n---\n# Title\nbody **bold**\n- [ ] task\n";
    const parsed = parseNoteFile(text, ids());
    expect(parsed.note.blocks).toHaveLength(3);
    expect(buildNoteFile(parsed.frontmatter, parsed.note)).toBe(text);
  });

  it("starts a new note with a flag and an empty title", () => {
    const text = newNoteFile("2026-11-09T20:00:00.000Z", ids());
    expect(text).toBe("---\nfinenotes-note: 1\ncreated: 2026-11-09T20:00:00.000Z\n---\n#\n");
    const parsed = parseNoteFile(text, ids());
    expect(shape(parsed.note)).toEqual(shape({ blocks: [body("", "title")] }));
  });

  it("turns a title into a file name", () => {
    expect(titleFileName("  Trip: to the *Dolomites*?  ")).toBe("Trip to the Dolomites");
    expect(titleFileName("a/b\\c [[link]] #tag ^x")).toBe("a b c link tag x");
    expect(titleFileName("..hidden.")).toBe("hidden");
    expect(titleFileName("???")).toBe("");
    expect(titleFileName("x".repeat(200))).toHaveLength(80);
  });

  it("knows a name nobody chose, and finds a free one", () => {
    expect(hasDefaultName("Untitled.note.md", "Untitled")).toBe(true);
    expect(hasDefaultName("Untitled 12.note.md", "Untitled")).toBe(true);
    expect(hasDefaultName("Untitled plans.note.md", "Untitled")).toBe(false);
    expect(hasDefaultName("Plans.note.md", "Untitled")).toBe(false);
    const taken = new Set(["Plans.note.md", "Plans 2.note.md"]);
    expect(freeNoteName("Plans", (name) => taken.has(name))).toBe("Plans 3.note.md");
    expect(freeNoteName("New", () => false)).toBe("New.note.md");
  });

  it("knows its file names", () => {
    expect(isTextNoteName("Ideas.note.md")).toBe(true);
    expect(isTextNoteName("Ideas.NOTE.MD")).toBe(true);
    expect(isTextNoteName("Ideas.notebook.md")).toBe(false);
    expect(stripTextNoteSuffix("Ideas.note.md")).toBe("Ideas");
    expect(stripTextNoteSuffix("Ideas.md")).toBe("Ideas.md");
  });
});

describe("Apple Notes lists, highlights and paper", () => {
  it("writes and reads dashed, bulleted and lettered lists, counting each kind apart", () => {
    const blocks: NoteBlock[] = [
      body("dash", "dash"),
      body("dot", "bullet"),
      body("one", "upper"),
      body("two", "upper"),
      textBlock("x", "lower", [run("inner")], { indent: 1 }),
      textBlock("x", "lower", [run("inner two")], { indent: 1 }),
      body("three", "upper"),
      body("first", "number"),
    ];
    expect(encodeNote({ blocks }).split("\n")).toEqual([
      "- dash",
      "* dot",
      "A. one",
      "B. two",
      "\ta. inner",
      "\tb. inner two",
      "C. three",
      "1. first",
    ]);
    expect(roundTrip(blocks)).toEqual(shape({ blocks }));
  });

  it("keeps body text that starts like a lettered item as body text", () => {
    const blocks = [body("A. Smith wrote this"), body("e.g. not a list")];
    expect(roundTrip(blocks)).toEqual(shape({ blocks }));
  });

  it("writes a highlight as ==text== and reads it back", () => {
    const runs = [run("a "), run("marked", HIGHLIGHT), run(" b")];
    expect(encodeInline(runs)).toBe("a ==marked== b");
    expect(decodeInline("a ==marked== b")).toEqual(runs);
    expect(decodeInline(encodeInline([run("x == y")]))).toEqual([run("x == y")]);
  });

  it("keeps a handwriting section's paper", () => {
    for (const paper of ["lined", "squared", "dotted"] as const) {
      const blocks: NoteBlock[] = [
        { type: "ink", id: "x", height: 300, strokes: [], paper },
        body(""),
      ];
      expect(roundTrip(blocks)).toEqual(shape({ blocks }));
    }
    const blank: NoteBlock[] = [{ type: "ink", id: "x", height: 300, strokes: [] }, body("")];
    expect(roundTrip(blank)).toEqual(shape({ blocks: blank }));
  });
});

describe("highlight colours", () => {
  it("writes yellow as ==text== and the other colours as Obsidian-readable <mark>", () => {
    const runs = [
      run("a", HIGHLIGHT),
      run(" "),
      run("b", HIGHLIGHT_PINK),
      run(" "),
      run("c", HIGHLIGHT_BLUE | BOLD),
    ];
    const text = encodeInline(runs);
    expect(text).toBe('==a== <mark class="fn-pink">b</mark> **<mark class="fn-blue">c</mark>**');
    expect(decodeInline(text)).toEqual(runs);
  });

  it("reads a plain <mark> as yellow and keeps a literal <mark> typed as text", () => {
    expect(decodeInline("<mark>x</mark>")).toEqual([run("x", HIGHLIGHT)]);
    const typed = [run("type <mark> here")];
    expect(decodeInline(encodeInline(typed))).toEqual(typed);
  });

  it("gives a run one colour: a new colour replaces the old", () => {
    expect(withMarkOn(HIGHLIGHT | BOLD, HIGHLIGHT_GREEN)).toBe(HIGHLIGHT_GREEN | BOLD);
    expect(withMarkOn(HIGHLIGHT_GREEN, ITALIC)).toBe(HIGHLIGHT_GREEN | ITALIC);
  });
});

describe("indented paragraphs", () => {
  it("keeps body text and quotes indented, as no-break spaces Markdown leaves alone", () => {
    const blocks: NoteBlock[] = [
      textBlock("a", "body", [run("in one")], { indent: 1 }),
      textBlock("b", "body", [run("in two")], { indent: 2 }),
      textBlock("c", "quote", [run("said")], { indent: 1 }),
      body("flush"),
    ];
    const lines = encodeNote({ blocks }).split("\n");
    expect(lines[0].startsWith(" ")).toBe(false);
    expect(lines[0].charCodeAt(0)).toBe(0xa0);
    expect(roundTrip(blocks)).toEqual(shape({ blocks }));
  });

  it("does not indent headings", () => {
    expect(textBlock("x", "heading", [run("h")], { indent: 2 }).indent).toBeUndefined();
  });
});
