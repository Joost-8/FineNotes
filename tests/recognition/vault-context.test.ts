import { describe, expect, it } from "vitest";
import { parseToolCall, toolStatus } from "../../src/recognition/ask-tools";
import {
  MAX_READ_CHARS,
  MAX_VAULT_HITS,
  type VaultDoc,
  askVaultScopeOf,
  docText,
  inScope,
  noteText,
  readSlice,
  resolveNotePath,
  scopeFolder,
  scopeText,
  vaultSearchText,
} from "../../src/recognition/vault-context";

const note = (path: string, text: string): VaultDoc => ({
  path,
  kind: "note",
  pages: [{ pageIndex: 0, sources: [{ kind: "text", text }] }],
  paged: false,
});

const notebook = (path: string, pages: string[]): VaultDoc => ({
  path,
  kind: "notebook",
  pages: pages.map((text, pageIndex) => ({
    pageIndex,
    sources: text ? [{ kind: "handwriting", text }] : [],
  })),
  paged: true,
});

describe("vault scope", () => {
  it("defaults to the notebook's folder", () => {
    expect(askVaultScopeOf(undefined)).toBe("folder");
    expect(askVaultScopeOf("everything")).toBe("folder");
    expect(askVaultScopeOf("vault")).toBe("vault");
    expect(askVaultScopeOf("off")).toBe("off");
  });

  it("looks from the folder holding a notebook, or above its own folder", () => {
    expect(scopeFolder("Signals/Week 4.notebook.md")).toBe("Signals");
    expect(scopeFolder("Signals/Week 4/Week 4.notebook.md")).toBe("Signals");
    expect(scopeFolder("Loose.notebook.md")).toBe("");
  });

  it("keeps to the folder, and never the notebook, hidden files or transcripts", () => {
    const nb = "Signals/Week 4.notebook.md";
    expect(inScope("Signals/LTI.md", nb, "folder")).toBe(true);
    expect(inScope("Signals/Old/Week 1.notebook.md", nb, "folder")).toBe(true);
    expect(inScope("Signalsx/LTI.md", nb, "folder")).toBe(false);
    expect(inScope("Journal/today.md", nb, "folder")).toBe(false);
    expect(inScope("Journal/today.md", nb, "vault")).toBe(true);
    expect(inScope("Journal/today.md", nb, "off")).toBe(false);
    expect(inScope(nb, nb, "vault")).toBe(false);
    expect(inScope(".obsidian/app.md", nb, "vault")).toBe(false);
    expect(inScope("Signals/.trash/x.md", nb, "vault")).toBe(false);
    expect(inScope("Signals/Week 3.transcript.md", nb, "vault")).toBe(false);
    expect(inScope("Signals/W3/_transcript.md", nb, "vault")).toBe(false);
  });

  it("tells the AI where it looked", () => {
    expect(scopeText("Signals/W.notebook.md", "folder")).toBe(
      "the folder Signals/ and its subfolders",
    );
    expect(scopeText("W.notebook.md", "folder")).toBe("the whole vault");
    expect(scopeText("Signals/W.notebook.md", "vault")).toBe("the whole vault");
  });
});

describe("note text", () => {
  it("drops a handwritten note's ink payload", () => {
    expect(noteText("# Title\n%%goodobsidian\nQUJD\n%%\nprose")).toBe("# Title\n\nprose");
  });
});

describe("vaultSearchText", () => {
  const docs = [
    note("Signals/LTI systems.md", "Convolution in time is multiplication in frequency."),
    notebook("Signals/Week 3.notebook.md", ["intro", "", "we did convolution of x and h"]),
    note("Signals/Convolution cheatsheet.md", "flip, shift, multiply, sum"),
    note("Signals/Other.md", "nothing here"),
  ];

  it("names files by name first, then pages with the words around them", () => {
    const text = vaultSearchText(docs, "convolution", "the folder Signals/");
    const lines = text.split("\n");
    expect(lines[0]).toBe("Found in the folder Signals/:");
    expect(lines[1]).toBe("- Signals/Convolution cheatsheet.md (note; its name matches)");
    expect(text).toContain("- Signals/LTI systems.md: Convolution in time");
    expect(text).toContain("- Signals/Week 3.notebook.md, page 3: we did convolution");
    expect(text).not.toContain("Other.md");
    expect(text).toContain("read_note");
  });

  it("says plainly when nothing matches, and refuses an empty query", () => {
    expect(vaultSearchText(docs, "laplace", "the whole vault")).toMatch(
      /^Nothing in the whole vault matches “laplace”/,
    );
    expect(vaultSearchText(docs, "   ", "x")).toBe('"query" is empty.');
  });

  it("caps the hits, and the pages of any one file", () => {
    const many = Array.from({ length: 30 }, (_, i) => note(`n${i}.md`, "fourier"));
    const lines = vaultSearchText(many, "fourier", "v")
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(MAX_VAULT_HITS);
    const big = notebook(
      "Big.notebook.md",
      Array.from({ length: 20 }, () => "fourier"),
    );
    const bigLines = vaultSearchText([big], "fourier", "v")
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(bigLines).toHaveLength(3);
  });
});

describe("reading a note", () => {
  it("reads a notebook page by page, skipping empty pages", () => {
    expect(docText(notebook("A.notebook.md", ["one", "", "three"]))).toBe(
      "## Page 1\none\n\n## Page 3\nthree",
    );
    expect(docText(note("a.md", " plain "))).toBe("plain");
  });

  it("hands over a short file whole", () => {
    expect(readSlice("a.md", "note", "hello")).toBe("a.md (note):\n\nhello");
  });

  it("hands over a long file in pieces, cut at a line break, and says how to read on", () => {
    const line = "x".repeat(99);
    const text = Array.from({ length: 200 }, () => line).join("\n");
    const first = readSlice("a.md", "note", text);
    const more = /"from": (\d+)/.exec(first);
    expect(more).not.toBeNull();
    const next = Number(more?.[1]);
    expect(next).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(text[next]).toBe("\n");
    expect(first).toContain(`characters 1 to ${next} of ${text.length}`);
    const second = readSlice("a.md", "note", text, next);
    expect(second).toContain(`characters ${next + 1} to`);
    expect(readSlice("a.md", "note", text, text.length + 5)).toMatch(/nothing after/);
  });

  it("says when a file has no text", () => {
    expect(readSlice("a.md", "note", " ")).toBe("a.md is empty.");
    expect(readSlice("A.notebook.md", "notebook", "")).toMatch(/never transcribed/);
  });
});

describe("resolveNotePath", () => {
  const paths = [
    "Signals/LTI systems.md",
    "Signals/Week 3.notebook.md",
    "Maths/Notes.md",
    "Signals/Notes.md",
    "Slides/Lecture 2.pdf",
  ];

  it("takes a path, a name, or a wikilink", () => {
    expect(resolveNotePath("Signals/LTI systems.md", paths)).toEqual({
      path: "Signals/LTI systems.md",
    });
    expect(resolveNotePath("Signals/LTI systems", paths)).toEqual({
      path: "Signals/LTI systems.md",
    });
    expect(resolveNotePath("lti SYSTEMS", paths)).toEqual({ path: "Signals/LTI systems.md" });
    expect(resolveNotePath("[[Week 3|last week#Page 2]]", paths)).toEqual({
      path: "Signals/Week 3.notebook.md",
    });
    expect(resolveNotePath("Lecture 2", paths)).toEqual({ path: "Slides/Lecture 2.pdf" });
  });

  it("asks for the whole path when a name is not unique, and refuses what is not there", () => {
    const twice = resolveNotePath("Notes", paths);
    expect("error" in twice && twice.error).toMatch(/Maths\/Notes\.md, Signals\/Notes\.md/);
    const none = resolveNotePath("Journal/today", paths);
    expect("error" in none && none.error).toMatch(/search_vault/);
    expect(resolveNotePath(" ", paths)).toEqual({ error: '"path" is empty.' });
  });
});

describe("the vault tools", () => {
  it("checks their input", () => {
    expect(parseToolCall("search_vault", { query: " fourier " }, 3)).toEqual({
      tool: "search_vault",
      query: "fourier",
    });
    expect(parseToolCall("search_vault", {}, 3)).toEqual({ error: '"query" is empty.' });
    expect(parseToolCall("read_note", { path: "a.md" }, 3)).toEqual({
      tool: "read_note",
      path: "a.md",
      from: 0,
    });
    expect(parseToolCall("read_note", { path: "a.md", from: 800 }, 3)).toEqual({
      tool: "read_note",
      path: "a.md",
      from: 800,
    });
    expect(parseToolCall("read_note", { path: "a.md", from: -1 }, 3)).toHaveProperty("error");
    expect(parseToolCall("read_note", { path: "a.md", from: 1.5 }, 3)).toHaveProperty("error");
    expect(parseToolCall("read_note", {}, 3)).toEqual({ error: '"path" is empty.' });
  });

  it("show the note's name in the chat, not its path", () => {
    expect(toolStatus({ tool: "search_vault", query: "fourier" })).toBe(
      "Searching your notes for “fourier”…",
    );
    expect(toolStatus({ tool: "read_note", path: "Signals/Week 3.notebook.md", from: 0 })).toBe(
      "Reading Week 3…",
    );
    expect(toolStatus({ tool: "read_note", path: "[[LTI systems|lti]]", from: 0 })).toBe(
      "Reading LTI systems…",
    );
  });
});
