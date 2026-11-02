import { describe, expect, it } from "vitest";
import { INBOX_MEMORY_MS, InboxRuns, isInboxPdf, pdfKey } from "../../src/model/inbox";

describe("isInboxPdf", () => {
  it("takes a PDF lying directly in the inbox", () => {
    expect(isInboxPdf("FineNotes inbox/Lecture 7.pdf")).toBe(true);
    expect(isInboxPdf("FineNotes inbox/Scan.PDF")).toBe(true);
  });

  it("leaves everything else alone", () => {
    expect(isInboxPdf("FineNotes inbox/notes.md")).toBe(false);
    expect(isInboxPdf("FineNotes inbox/Old/Lecture.pdf")).toBe(false);
    expect(isInboxPdf("FineNotes inbox")).toBe(false);
    expect(isInboxPdf("FineNotes inbox/")).toBe(false);
    expect(isInboxPdf("School/FineNotes inbox/Lecture.pdf")).toBe(false);
    expect(isInboxPdf("FineNotes inboxes/Lecture.pdf")).toBe(false);
  });
});

describe("pdfKey", () => {
  it("gives every way a shortcut names one file the same key", () => {
    const key = pdfKey("Lecture 7");
    expect(pdfKey("Lecture 7.pdf")).toBe(key);
    expect(pdfKey("lecture 7.PDF")).toBe(key);
    expect(pdfKey("FineNotes inbox/Lecture 7.pdf")).toBe(key);
    expect(pdfKey("School/Lecture 7/Images/Lecture 7.pdf")).toBe(key);
    expect(pdfKey("Lecture 8.pdf")).not.toBe(key);
  });
});

describe("InboxRuns", () => {
  it("starts one run per PDF however often it is seen", async () => {
    const runs = new InboxRuns<string>();
    let started = 0;
    const start = () => Promise.resolve(`notebook ${++started}`);
    const first = runs.run("FineNotes inbox/Lecture.pdf", start);
    const second = runs.run("Lecture", start);
    expect(second).toBe(first);
    expect(await first).toBe("notebook 1");
    expect(started).toBe(1);
  });

  it("hands a link the run the watcher started, and remembers the link asked", async () => {
    const runs = new InboxRuns<string>();
    const run = runs.run("FineNotes inbox/Lecture.pdf", () =>
      Promise.resolve("Lecture.notebook.md"),
    );
    expect(runs.claimed("Lecture.pdf")).toBe(false);
    expect(runs.claim("Lecture")).toBe(run);
    expect(runs.claimed("FineNotes inbox/Lecture.pdf")).toBe(true);
    expect(runs.claim("Other")).toBeNull();
  });

  it("forgets a PDF after a while, so a new one of the same name is read again", () => {
    let now = 0;
    const runs = new InboxRuns<string>(() => now);
    const first = runs.run("Lecture.pdf", () => Promise.resolve("a"));
    now = INBOX_MEMORY_MS + 1;
    expect(runs.claim("Lecture.pdf")).toBeNull();
    expect(runs.run("Lecture.pdf", () => Promise.resolve("b"))).not.toBe(first);
  });
});
