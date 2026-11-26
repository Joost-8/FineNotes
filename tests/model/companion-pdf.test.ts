/**
 * Companion PDFs, the pure part: the frontmatter keys (read, set, removed,
 * with every other line kept), paths and free names, this device's staging
 * names, the journal, and the state mark.
 */
import { describe, expect, it } from "vitest";
import { blankPage, emptyDocument } from "../../src/model/document";
import {
  CompanionError,
  companionErrorCode,
  companionFileName,
  companionFrontmatter,
  companionIdFromBody,
  companionMark,
  companionMetaFromBody,
  companionName,
  companionPath,
  companionResources,
  companionTransaction,
  followedCompanionPath,
  followsName,
  freeCompanionPath,
  isCompanionNotebookPath,
  isCompanionScratch,
  isTypedPdf,
  parseCompanionJournal,
  sameStat,
  withCompanionKeys,
  withoutCompanionKeys,
  type CompanionEntry,
} from "../../src/model/companion-pdf";

const ID = "a3f9211234567890";

const front = (...lines: string[]) => ["---", ...lines, "---", "Body text", ""].join("\n");

describe("the frontmatter keys", () => {
  it("reads the three keys from the leading frontmatter only", () => {
    const body = front(
      `finenotes-companion-id: ${ID}`,
      'finenotes-companion-pdf: "Exports/Cell biology.pdf"',
      "finenotes-companion-follow: false",
    );
    expect(companionMetaFromBody(body)).toEqual({
      id: ID,
      pdfPath: "Exports/Cell biology.pdf",
      followName: false,
    });
    expect(companionIdFromBody(`Text\n---\nfinenotes-companion-id: ${ID}\n---\n`)).toBeNull();
    expect(companionMetaFromBody(front("tags: [a]"))).toBeNull();
    // A path that cannot be a companion (hidden folder, not a PDF) is no path.
    expect(
      companionMetaFromBody(
        front(`finenotes-companion-id: ${ID}`, "finenotes-companion-pdf: .x/a.pdf"),
      ),
    ).toEqual({ id: ID });
    expect(
      companionMetaFromBody(
        front(`finenotes-companion-id: ${ID}`, "finenotes-companion-pdf: a.png"),
      ),
    ).toEqual({ id: ID });
    // Single quotes and plain scalars too.
    expect(
      companionMetaFromBody(
        front(`finenotes-companion-id: '${ID}'`, "finenotes-companion-pdf: 'It''s.pdf'"),
      )?.pdfPath,
    ).toBe("It's.pdf");
  });

  it("sets only its own lines and keeps everything else as it was", () => {
    const body = front("tags: [biology]", `finenotes-companion-id: ${ID}`, "aliases: [cells]");
    const set = withCompanionKeys(body, { pdfPath: "Exports/Cell biology.pdf", followName: true });
    expect(set).toBe(
      front(
        "tags: [biology]",
        "aliases: [cells]",
        `finenotes-companion-id: "${ID}"`,
        'finenotes-companion-pdf: "Exports/Cell biology.pdf"',
        "finenotes-companion-follow: true",
      ),
    );
    expect(companionMetaFromBody(set)).toEqual({
      id: ID,
      pdfPath: "Exports/Cell biology.pdf",
      followName: true,
    });
    // Turned off: the place goes, the id stays.
    expect(withCompanionKeys(set, { pdfPath: null, followName: null })).toBe(
      front("tags: [biology]", "aliases: [cells]", `finenotes-companion-id: "${ID}"`),
    );
  });

  it("adds a frontmatter where there is none, and removes one that held only its keys", () => {
    const added = withCompanionKeys("Body text\n", { id: ID, pdfPath: "a.pdf", followName: true });
    expect(added).toBe(
      `---\nfinenotes-companion-id: "${ID}"\nfinenotes-companion-pdf: "a.pdf"\nfinenotes-companion-follow: true\n---\nBody text\n`,
    );
    expect(withoutCompanionKeys(added)).toBe("Body text\n");
    expect(withCompanionKeys("Body text\n", { pdfPath: null })).toBe("Body text\n");
  });

  it("keeps Windows line ends and a byte-order mark", () => {
    const body = `\uFEFF---\r\ntags: [x]\r\n---\r\nText`;
    const set = withCompanionKeys(body, { id: ID });
    expect(set).toBe(`\uFEFF---\r\ntags: [x]\r\nfinenotes-companion-id: "${ID}"\r\n---\r\nText`);
    expect(companionFrontmatter(set)).toBe(`tags: [x]\r\nfinenotes-companion-id: "${ID}"`);
  });

  it("leaves a copy without a companion, and a note without keys untouched", () => {
    const body = front(
      "tags: [a]",
      `finenotes-companion-id: ${ID}`,
      'finenotes-companion-pdf: "a.pdf"',
    );
    expect(withoutCompanionKeys(body)).toBe(front("tags: [a]"));
    const plain = front("tags: [a]");
    expect(withoutCompanionKeys(plain)).toBe(plain);
  });
});

describe("paths and names", () => {
  it("cleans a path, and refuses one that cannot be a companion", () => {
    expect(companionPath(" Exports\\Cell.pdf ")).toBe("Exports/Cell.pdf");
    for (const bad of ["../a.pdf", ".hidden/a.pdf", "a:b.pdf", "a.png", ""]) {
      expect(() => companionPath(bad)).toThrow(CompanionError);
    }
    expect(companionErrorCode(new CompanionError("occupied"))).toBe("occupied");
    expect(companionErrorCode(new Error("boom"))).toBe("export");
  });

  it("names the PDF after the notebook, and finds a free name beside a file already there", () => {
    expect(companionName("School/Cell biology.notebook.md")).toBe("Cell biology.pdf");
    expect(isCompanionNotebookPath("School/Cell biology.notebook.md")).toBe(true);
    expect(isCompanionNotebookPath("School/Cell biology.md")).toBe(false);
    const taken = new Set(["exports/cell biology.pdf", "exports/cell biology 1.pdf"]);
    expect(
      freeCompanionPath("School/Cell biology.notebook.md", "Exports", (p) =>
        taken.has(p.toLowerCase()),
      ),
    ).toBe("Exports/Cell biology 2.pdf");
    expect(freeCompanionPath("Cell.notebook.md", "", () => false)).toBe("Cell.pdf");
  });

  it("follows a renamed notebook in the PDF's own folder; a name the user gave does not follow", () => {
    expect(followedCompanionPath("Exports/Old.pdf", "School/New.notebook.md")).toBe(
      "Exports/New.pdf",
    );
    expect(followsName("Exports/new.PDF", "School/New.notebook.md")).toBe(true);
    expect(followsName("Exports/Homework 3.pdf", "School/New.notebook.md")).toBe(false);
  });

  it("puts this device's id in its staging and backup names", () => {
    const a = companionTransaction("Exports/Cell.pdf", ID, "dev-A1", 35);
    const b = companionTransaction("Exports/Cell.pdf", ID, "devB2", 35);
    expect(a.stage).toBe(`Exports/Cell.pdf.fn-${ID}-devA1-z-pending.pdf`);
    expect(a.backup).toBe(`Exports/Cell.pdf.fn-${ID}-devA1-z-backup.pdf`);
    expect(a.stage).not.toBe(b.stage);
    // Each write has names of its own.
    expect(companionTransaction("Exports/Cell.pdf", ID, "dev-A1", 36).stage).not.toBe(a.stage);
    expect(isCompanionScratch(a.stage) && isCompanionScratch(b.backup)).toBe(true);
    expect(isCompanionScratch("Exports/Cell.pdf")).toBe(false);
  });

  it("lists the files a notebook's pages are drawn from", () => {
    const doc = emptyDocument();
    doc.pages[0].backdrop = { kind: "pdf", path: "Slides.pdf", page: 0 } as never;
    doc.pages.push(blankPage("p2"));
    doc.pages[1].images.push({ id: "i", path: "a.png", x: 0, y: 0, w: 1, h: 1 } as never);
    expect(companionResources(doc)).toEqual(["Slides.pdf", "a.png"]);
  });
});

describe("the journal (this device's local storage)", () => {
  const entry: CompanionEntry = {
    notebookPath: "School/Cell.notebook.md",
    pdfPath: "Exports/Cell.pdf",
    enabled: true,
    followName: true,
    dirty: false,
    written: { path: "Exports/Cell.pdf", mtime: 5, size: 9, id: ID, hash: "0123456789abcdef" },
    error: "missing",
    transaction: { ...companionTransaction("Exports/Cell.pdf", ID, "devA"), staged: true },
  };

  it("survives a round trip through JSON", () => {
    const journal = { version: 2 as const, entries: { [ID]: entry } };
    expect(parseCompanionJournal(JSON.stringify(journal))).toEqual(journal);
  });

  it("leaves out what is malformed or another notebook's scratch", () => {
    const foreign = {
      ...entry,
      transaction: companionTransaction("Exports/Cell.pdf", "bbbbbbbbbbbbbbbb", "devA"),
    };
    const parsed = parseCompanionJournal({
      version: 2,
      entries: {
        [ID]: { ...foreign, error: "a sentence, not a code" },
        nothex: entry,
        bbbbbbbbbbbbbbbb: { ...entry, pdfPath: "../x.pdf" },
      },
    });
    expect(Object.keys(parsed.entries)).toEqual([ID]);
    expect(parsed.entries[ID].transaction).toBeUndefined();
    expect(parsed.entries[ID].error).toBeUndefined();
    expect(parseCompanionJournal("{oops")).toEqual({ version: 2, entries: {} });
    expect(parseCompanionJournal({ version: 1, entries: { [ID]: entry } })).toEqual({
      version: 2,
      entries: {},
    });
  });
});

describe("the state mark", () => {
  const on = {
    notebookPath: "a.notebook.md",
    pdfPath: "a.pdf",
    enabled: true,
    followName: true,
    dirty: false,
  };
  it("is a dot when current, a ring when behind or updating, an error when it failed", () => {
    expect(companionMark(undefined, false, false)).toBe("off");
    expect(companionMark({ ...on, enabled: false }, false, true)).toBe("off");
    expect(companionMark(on, false, true)).toBe("current");
    expect(companionMark({ ...on, dirty: true }, false, true)).toBe("stale");
    expect(companionMark(on, false, false)).toBe("stale");
    expect(companionMark({ ...on, error: "write" }, false, true)).toBe("error");
    expect(companionMark({ ...on, error: "write" }, true, true)).toBe("busy");
  });

  it("knows this device's own write by its listing", () => {
    const written = { path: "a.pdf", mtime: 1, size: 2 };
    expect(sameStat(written, { path: "a.pdf", mtime: 1, size: 2 })).toBe(true);
    expect(sameStat(written, { path: "a.pdf", mtime: 1, size: 3 })).toBe(false);
    expect(sameStat(undefined, written)).toBe(false);
  });
});

describe("one name for an export and the companion (#318)", () => {
  it("is the typed export name when there is one, else the notebook's", () => {
    expect(companionFileName("School/Cell.notebook.md", "Hand-in 3")).toBe("Hand-in 3.pdf");
    expect(companionFileName("School/Cell.notebook.md")).toBe("Cell.pdf");
    expect(companionFileName("School/Cell.notebook.md", "")).toBe("Cell.pdf");
  });

  it("knows the typed name's file, in any case", () => {
    expect(isTypedPdf("Exports/hand-in 3.PDF", "Hand-in 3")).toBe(true);
    expect(isTypedPdf("Exports/Cell.pdf", "Hand-in 3")).toBe(false);
    expect(isTypedPdf("Exports/Cell.pdf", undefined)).toBe(false);
  });
});
