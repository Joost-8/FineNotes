/**
 * The managed text section in a note's body: reading it, writing it, and
 * removing it. The whitespace written around the block is pinned exactly, so
 * that a rewrite cannot make every existing note change on its next save.
 * Everything outside the block is the user's and must come back untouched.
 */

import { describe, expect, it } from "vitest";
import {
  SECTION_CLOSE,
  SECTION_OPEN,
  readTextSection,
  writeTextSection,
} from "../../src/recognition/text-layer";

const OPEN = "<!--goodobsidian-text-->";
const CLOSE = "<!--/goodobsidian-text-->";
const block = (text: string) => `${OPEN}\n${text}\n${CLOSE}`;

describe("the markers", () => {
  it("are HTML comments, so they stay invisible in reading view", () => {
    expect(SECTION_OPEN).toBe(OPEN);
    expect(SECTION_CLOSE).toBe(CLOSE);
  });
});

describe("readTextSection", () => {
  it("is null for a body without a section", () => {
    expect(readTextSection("")).toBeNull();
    expect(readTextSection("# Title\n\nProse.")).toBeNull();
    expect(readTextSection(`${OPEN}\nunclosed`)).toBeNull();
  });

  it("returns what is between the markers, without the newlines next to them", () => {
    expect(readTextSection(`Prose.\n\n${block("one\n\ntwo")}\nMore.`)).toBe("one\n\ntwo");
    expect(readTextSection(`${OPEN}inline${CLOSE}`)).toBe("inline");
    expect(readTextSection(`${OPEN}\n\n${CLOSE}`)).toBe("");
  });

  it("reads a section written before 0.2.0 under the old name", () => {
    expect(readTextSection("x\n<!--inkedmark-text-->\nold\n<!--/inkedmark-text-->\n")).toBe("old");
  });

  it("reads the first section when there are two", () => {
    expect(readTextSection(`${block("a")}\n${block("b")}`)).toBe("a");
  });
});

describe("writeTextSection: adding a section", () => {
  it("appends it after the prose, one blank line apart, ending in a newline", () => {
    expect(writeTextSection("# Title\n\nProse.", "text")).toBe(
      `# Title\n\nProse.\n\n${block("text")}\n`,
    );
  });

  it("replaces any whitespace at the end of the body with that one blank line", () => {
    expect(writeTextSection("Prose.  \n\n\n \t\n", "text")).toBe(`Prose.\n\n${block("text")}\n`);
  });

  it("starts an empty body with the section itself", () => {
    expect(writeTextSection("", "text")).toBe(`${block("text")}\n`);
    expect(writeTextSection(" \n\n", "text")).toBe(`${block("text")}\n`);
  });

  it("writes the text as given", () => {
    expect(writeTextSection("P", "a\n\n\n\nb")).toBe(`P\n\n${block("a\n\n\n\nb")}\n`);
  });

  it("leaves the body alone when there is nothing to write", () => {
    const body = "# T\n\n\n\nProse.  \n\n";
    for (const blank of ["", " \n\t "]) expect(writeTextSection(body, blank)).toBe(body);
  });
});

describe("writeTextSection: replacing a section", () => {
  it("keeps the prose around it and one blank line before it", () => {
    const body = `Intro\n\n${block("old")}\nOutro`;
    expect(writeTextSection(body, "new")).toBe(`Intro\n\n${block("new")}\nOutro`);
  });

  it("closes up newlines before the block to one blank line", () => {
    expect(writeTextSection(`Intro\n${block("old")}\nOutro`, "new")).toBe(
      `Intro\n\n${block("new")}\nOutro`,
    );
    expect(writeTextSection(`Intro\n\n\n\n${block("old")}\nOutro`, "new")).toBe(
      `Intro\n\n${block("new")}\nOutro`,
    );
  });

  it("keeps a blank line after the block, but never more than one", () => {
    expect(writeTextSection(`I\n\n${block("old")}\n\nOutro`, "new")).toBe(
      `I\n\n${block("new")}\n\nOutro`,
    );
    expect(writeTextSection(`I\n\n${block("old")}\n\n\n\nOutro`, "new")).toBe(
      `I\n\n${block("new")}\n\nOutro`,
    );
    expect(writeTextSection(`I\n\n${block("old")}Outro`, "new")).toBe(
      `I\n\n${block("new")}\nOutro`,
    );
  });

  it("puts one blank line above a section at the top of the note", () => {
    expect(writeTextSection(`${block("old")}\n`, "new")).toBe(`\n\n${block("new")}\n`);
    expect(writeTextSection(`\n\n${block("old")}\n`, "new")).toBe(`\n\n${block("new")}\n`);
  });

  it("collapses runs of blank lines inside the section", () => {
    expect(writeTextSection(`I\n\n${block("old")}\n`, "a\n\n\n\nb")).toBe(
      `I\n\n${block("a\n\nb")}\n`,
    );
    expect(writeTextSection(`I\n\n${block("old")}\n`, "\n\na\n\n")).toBe(
      `I\n\n${OPEN}\n\na\n\n${CLOSE}\n`,
    );
  });

  it("rewrites an old-style section with today's markers", () => {
    const body = "Intro\n\n<!--inkedmark-text-->\nold\n<!--/inkedmark-text-->\nOutro";
    expect(writeTextSection(body, "new")).toBe(`Intro\n\n${block("new")}\nOutro`);
  });

  it("is stable: writing the same text again changes nothing", () => {
    for (const body of ["Intro", `Intro\n\n\n${block("x")}\n\n\nOutro\n`, `A\n${block("x")}B`]) {
      const once = writeTextSection(body, "same text");
      expect(writeTextSection(once, "same text"), JSON.stringify(body)).toBe(once);
    }
    // A section alone in the note gains its blank line above on the first
    // rewrite, and is stable from then on.
    const first = writeTextSection("", "same text");
    const second = writeTextSection(first, "same text");
    expect(second).toBe(`\n\n${first}`);
    expect(writeTextSection(second, "same text")).toBe(second);
  });
});

describe("writeTextSection: removing a section", () => {
  it("joins the prose on either side with one newline", () => {
    expect(writeTextSection(`Intro\n\n${block("x")}\nOutro`, "")).toBe("Intro\nOutro");
    expect(writeTextSection(`Intro  \n\n${block("x")}\n\n\n  Outro`, " ")).toBe("Intro\nOutro");
  });

  it("leaves a trailing newline after prose that ended at the section", () => {
    expect(writeTextSection(`Intro\n\n${block("x")}\n`, "")).toBe("Intro\n");
  });

  it("leaves no leading newline when the section opened the note", () => {
    expect(writeTextSection(`${block("x")}\n\nOutro`, "")).toBe("Outro");
    expect(writeTextSection(`\n\n${block("x")}\n`, "")).toBe("");
  });
});

// The prose outside the block belongs to the user (CLAUDE.md, "House rules").
// Before the 2026-09 rewrite these failed: blank-line runs anywhere in the
// note were squashed to one on every write, and removing the block also
// stripped the newlines at the very top of the note.
describe("the user's text outside the section", () => {
  const prose = "Title\n\n\n\nA paragraph after three blank lines.";
  const tail = "Tail\n\n\n\n\nafter four blank lines\n\n\n";

  it("survives replacing the section byte for byte, except at the seams", () => {
    const body = `${prose}\n\n${block("old")}\n${tail}`;
    expect(writeTextSection(body, "new")).toBe(`${prose}\n\n${block("new")}\n${tail}`);
  });

  it("survives removing the section, except at the seam", () => {
    const body = `${prose}\n\n${block("old")}\n${tail}`;
    expect(writeTextSection(body, "")).toBe(`${prose}\n${tail}`);
  });

  it("keeps newlines at the very top of the note when the section is removed", () => {
    expect(writeTextSection(`\n\nTitle\n\n${block("x")}\n`, "")).toBe("\n\nTitle\n");
  });

  /** A small seeded generator, so a failure names a body that can be replayed. */
  function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PIECES = [
    "word",
    "# Head",
    "- item",
    " ",
    "  ",
    "\t",
    "\n",
    "\n\n",
    "\n\n\n",
    "\n\n\n\n",
    "\r\n",
    "$x$",
  ];
  const SPACE = ["", "\n", "\n\n", "\n\n\n\n", " \n", "\n  ", "\t\n\n"];

  function pick<T>(next: () => number, items: readonly T[]): T {
    return items[Math.floor(next() * items.length)];
  }

  function someProse(next: () => number): string {
    const count = Math.floor(next() * 8);
    return Array.from({ length: count }, () => pick(next, PIECES)).join("");
  }

  /** `result` is `head` + only whitespace + `middle` + only whitespace + `tail`. */
  function expectFramed(result: string, head: string, middle: string, tail: string): void {
    expect(result.startsWith(head)).toBe(true);
    expect(result.endsWith(tail)).toBe(true);
    const inner = result.slice(head.length, result.length - tail.length);
    const at = inner.indexOf(middle);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(inner.slice(0, at).trim()).toBe("");
    expect(inner.slice(at + middle.length).trim()).toBe("");
  }

  it("is left alone on every write, for any prose around the block", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const next = random(seed);
      const before = someProse(next);
      const after = someProse(next);
      const body = `${before}${pick(next, SPACE)}${block("old")}${pick(next, SPACE)}${after}`;
      const head = before.replace(/\s+$/, "");
      const tail = after.replace(/^\s+/, "");
      const label = `seed ${seed}: ${JSON.stringify(body)}`;

      const replaced = writeTextSection(body, "new text");
      expect(readTextSection(replaced), label).toBe("new text");
      expectFramed(replaced, head, block("new text"), tail);

      const removed = writeTextSection(body, "");
      expect(readTextSection(removed), label).toBeNull();
      expectFramed(removed, head, "", tail);

      // Appending to a note that had no block never touches its prose either.
      const plain = `${before}${pick(next, SPACE)}${after}`;
      expectFramed(writeTextSection(plain, "added"), plain.replace(/\s+$/, ""), block("added"), "");
    }
  });
});
