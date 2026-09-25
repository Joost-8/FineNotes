/**
 * `src/model/notebook-commands.ts` — converting a single page to a notebook,
 * and changing a cover with its title kept legible. Every command must undo
 * to a `JSON.stringify`-identical document (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import { AddPage } from "../../src/model/commands";
import { coverPalette, coverTitleFrame } from "../../src/model/cover";
import { type InkDocument, emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { DEFAULT_NOTEBOOK_CHOICES, buildNewDocument } from "../../src/model/new-notebook";
import { RestyleCoverTitles, SetSingle, changeCover } from "../../src/model/notebook-commands";
import { pageToInsertAfter } from "../../src/model/page-commands";
import { coverBackdrop } from "../../src/model/templates";

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

describe("SetSingle", () => {
  it("Convert to notebook clears the flag, deleting the key, and undo puts it back", () => {
    const doc = buildNewDocument({ ...DEFAULT_NOTEBOOK_CHOICES, type: "single" }, "x");
    const before = snapshot(doc);
    const command = new SetSingle(false);
    expect(command.label).toBe("Convert to notebook");
    command.apply(doc);
    expect("single" in doc).toBe(false);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("on a notebook it changes nothing and undoes to nothing, key still absent", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = new SetSingle(false);
    command.apply(doc);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
    expect("single" in doc).toBe(false);
  });

  it("making a single page stores only true, and undo removes the key again", () => {
    const doc = emptyDocument();
    const command = new SetSingle(true);
    command.apply(doc);
    expect(doc.single).toBe(true);
    command.invert(doc);
    expect("single" in doc).toBe(false);
  });

  it("redoes after an undo through the history", () => {
    const doc = buildNewDocument({ ...DEFAULT_NOTEBOOK_CHOICES, type: "single" }, "x");
    const history = new History();
    history.push(doc, new SetSingle(false));
    // Converted: a page can now be added, and undoing both restores the single page.
    const insert = pageToInsertAfter(doc, 0);
    if (!insert) throw new Error("no page to insert");
    history.push(doc, new AddPage(insert.index, insert.page));
    expect(doc.pages).toHaveLength(2);
    history.undo(doc);
    history.undo(doc);
    expect(doc.single).toBe(true);
    expect(doc.pages).toHaveLength(1);
    history.redo(doc);
    expect("single" in doc).toBe(false);
  });
});

describe("changeCover", () => {
  const notebook = (cover = coverBackdrop("cover-label", "navy")) => {
    const doc = buildNewDocument(
      { ...DEFAULT_NOTEBOOK_CHOICES, cover: cover.kind as "cover-label", coverColor: "navy" },
      "Analysis",
    );
    return doc;
  };

  it("changes design and colour and recolours the untouched title for contrast", () => {
    const doc = notebook();
    const cover = doc.pages[0];
    const before = snapshot(doc);
    const command = changeCover(cover, coverBackdrop("cover-plain", "mustard"));
    expect(command).not.toBeNull();
    command?.apply(doc);
    expect(cover.backdrop).toEqual({ kind: "cover-plain", paperColor: "#d9a93a" });
    const title = cover.textBoxes[0];
    expect(title.color).toBe(coverPalette("#d9a93a").title);
    command?.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("moves an untouched title to where the new design puts it", () => {
    const doc = notebook();
    const cover = doc.pages[0];
    const title = cover.textBoxes[0];
    changeCover(cover, coverBackdrop("cover-band", "navy"))?.apply(doc);
    const expected = coverTitleFrame("cover-band", cover.geometry, title.fontSize);
    expect({ x: title.x, y: title.y, w: title.w }).toEqual(expected);
  });

  it("leaves a title the user recoloured or moved alone", () => {
    const doc = notebook();
    const cover = doc.pages[0];
    const title = cover.textBoxes[0];
    title.color = "#e03131";
    title.x += 40;
    const moved = { x: title.x, y: title.y, w: title.w };
    changeCover(cover, coverBackdrop("cover-band", "sky"))?.apply(doc);
    expect(title.color).toBe("#e03131");
    expect({ x: title.x, y: title.y, w: title.w }).toEqual(moved);
  });

  it("recolours a moved title that is still in the old ink, without moving it", () => {
    const doc = notebook();
    const cover = doc.pages[0];
    const title = cover.textBoxes[0];
    title.y += 300;
    const at = { x: title.x, y: title.y, w: title.w };
    changeCover(cover, coverBackdrop("cover-label", "sage"))?.apply(doc);
    expect(title.color).toBe(coverPalette("#9db59a").labelTitle);
    expect({ x: title.x, y: title.y, w: title.w }).toEqual(at);
  });

  it("is one undo step, and redo gives the same result again", () => {
    const doc = notebook();
    const history = new History();
    const before = snapshot(doc);
    const command = changeCover(doc.pages[0], coverBackdrop("cover-linen", "forest"));
    if (!command) throw new Error("no command");
    history.push(doc, command);
    const after = snapshot(doc);
    history.undo(doc);
    expect(snapshot(doc)).toBe(before);
    history.redo(doc);
    expect(snapshot(doc)).toBe(after);
  });

  it("refuses to turn paper into a cover or a cover into paper", () => {
    const doc = notebook();
    expect(changeCover(doc.pages[1], coverBackdrop("cover-plain", "navy"))).toBeNull();
    expect(changeCover(doc.pages[0], { kind: "ruled-wide" })).toBeNull();
    const pdf = emptyDocument();
    pdf.pages[0].backdrop = { kind: "pdf", path: "a.pdf", page: 0 };
    expect(changeCover(pdf.pages[0], coverBackdrop("cover-plain", "navy"))).toBeNull();
  });

  it("the restyle is a no-op for a page no longer in the document", () => {
    const doc = notebook();
    const [cover] = doc.pages;
    const other = emptyDocument();
    const before = snapshot(doc);
    const command = new RestyleCoverTitles(
      cover,
      cover.backdrop as never,
      coverBackdrop("cover-plain", "sky"),
    );
    command.apply(other);
    command.invert(other);
    expect(snapshot(doc)).toBe(before);
  });
});

describe("adding pages next to a cover", () => {
  it("a page after the cover repeats the paper, not the cover", () => {
    const doc = buildNewDocument(
      { ...DEFAULT_NOTEBOOK_CHOICES, ruling: "squared", paper: "yellow" },
      "x",
    );
    const insert = pageToInsertAfter(doc, 0);
    expect(insert?.page.backdrop).toEqual(doc.pages[1].backdrop);
    expect(insert?.page.backdrop).not.toBe(doc.pages[1].backdrop);
  });

  it("a notebook that is only a cover gets blank paper", () => {
    const doc = buildNewDocument(DEFAULT_NOTEBOOK_CHOICES, "x");
    doc.pages.splice(1, 1);
    expect(pageToInsertAfter(doc, 0)?.page.backdrop).toEqual({ kind: "blank" });
  });
});
