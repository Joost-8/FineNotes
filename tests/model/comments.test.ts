import { describe, expect, it } from "vitest";
import { type PageComment, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import {
  AddComment,
  MAX_COMMENT_LENGTH,
  RemoveComment,
  SetCommentResolved,
  SetCommentText,
  nextCommentId,
  normalizeComment,
} from "../../src/model/comments";

const comment = (over: Partial<PageComment> = {}): PageComment => ({
  id: "cm1",
  x: 120,
  y: 340,
  text: "Step 3: the sign flips here.",
  author: "ai",
  created: 1_760_000_000_000,
  ...over,
});

describe("comments", () => {
  it("reads only what a comment can be", () => {
    const mint = () => "cm9";
    expect(normalizeComment({ x: 1, y: 2, text: "  hi  ", junk: 1 }, mint)).toEqual({
      id: "cm9",
      x: 1,
      y: 2,
      text: "hi",
      author: "you",
      created: 0,
    });
    expect(normalizeComment({ ...comment(), resolved: true }, mint)).toEqual({
      ...comment(),
      resolved: true,
    });
    expect(normalizeComment({ ...comment(), resolved: false }, mint)).toEqual(comment());
    expect(normalizeComment({ ...comment(), author: "someone" }, mint)?.author).toBe("you");
    expect(normalizeComment({ x: 1, y: Number.NaN, text: "a" }, mint)).toBeNull();
    expect(normalizeComment({ x: 1, y: 2, text: "   " }, mint)).toBeNull();
    expect(normalizeComment([], mint)).toBeNull();
    const long = normalizeComment({ x: 1, y: 2, text: "x".repeat(5000) }, mint);
    expect(long?.text.length).toBe(MAX_COMMENT_LENGTH);
  });

  it("round-trips through a save, and a page without comments gains no key", () => {
    const doc = emptyDocument();
    doc.pages[0].comments = [comment(), comment({ id: "cm2", author: "you", resolved: true })];
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].comments).toEqual(doc.pages[0].comments);
    expect("comments" in decodeDocument(encodeDocument(emptyDocument())).pages[0]).toBe(false);
  });

  it("mints ids above the highest one, across pages", () => {
    const doc = emptyDocument();
    expect(nextCommentId(doc)).toBe("cm1");
    doc.pages[0].comments = [comment({ id: "cm7" })];
    expect(nextCommentId(doc)).toBe("cm8");
    const raw: Partial<PageComment> = comment();
    delete raw.id;
    doc.pages[0].comments = [comment({ id: "cm4" }), raw as PageComment];
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].comments!.map((c) => c.id)).toEqual(["cm4", "cm5"]);
  });

  it("adds, resolves, edits and removes, each undone exactly", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const c = comment();
    const add = new AddComment(page.id, c);
    add.apply(doc);
    expect(page.comments).toEqual([c]);

    const resolve = new SetCommentResolved(page.id, c, true);
    resolve.apply(doc);
    expect(c.resolved).toBe(true);
    resolve.invert(doc);
    expect("resolved" in c).toBe(false);

    const edit = new SetCommentText(page.id, c, "  Better wording  ");
    edit.apply(doc);
    expect(c.text).toBe("Better wording");
    edit.invert(doc);
    expect(c.text).toBe("Step 3: the sign flips here.");
    new SetCommentText(page.id, c, "   ").apply(doc);
    expect(c.text).toBe("Step 3: the sign flips here.");

    const other = comment({ id: "cm2" });
    new AddComment(page.id, other).apply(doc);
    const remove = new RemoveComment(page.id, c);
    remove.apply(doc);
    expect(page.comments).toEqual([other]);
    remove.invert(doc);
    expect(page.comments).toEqual([c, other]);

    new RemoveComment(page.id, other).apply(doc);
    add.invert(doc);
    expect("comments" in page).toBe(false);
  });

  it("does nothing to a comment no longer on its page", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const c = comment();
    const resolve = new SetCommentResolved(page.id, c, true);
    resolve.apply(doc);
    expect("resolved" in c).toBe(false);
    new RemoveComment(page.id, c).apply(doc);
    expect("comments" in page).toBe(false);
  });
});
