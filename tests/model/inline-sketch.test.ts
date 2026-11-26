import { describe, expect, it } from "vitest";
import {
  INLINE_DEFAULT_HEIGHT,
  INLINE_GROW_STEP,
  INLINE_MAX_HEIGHT,
  INLINE_MIN_HEIGHT,
  INLINE_TOP_PAD,
  createInlineSketchPage,
  findLinkedNotebookInMarkdown,
  finishInlineSketchPage,
  highestInlineContentY,
  initialInlineManualHeight,
  inlineClampedResizeHeight,
  inlineGrowHeight,
  inlineGrowHeightForPoint,
  inlineTrimHeight,
  isInlineSketchPage,
  lowestInlineContentY,
  mergeInlinePageEdits,
  trimInlinePageTop,
} from "../../src/model/inline-sketch";
import { DotClock, attachDotClock, dotClockOf } from "../../src/model/dot-ids";
import { IdSequence, strokeIdsOf } from "../../src/view/id-sequence";
import { embedPageLink, embedTarget, pageIndexById } from "../../src/view/page-embed-model";

describe("inline-sketch pure model", () => {
  it("creates transparent expandable sketch pages identified by hw- prefix", () => {
    const page = createInlineSketchPage("hw-a1b2c3d4");
    expect(isInlineSketchPage(page)).toBe(true);
    expect(page.geometry).toEqual({ width: 1024, height: INLINE_DEFAULT_HEIGHT });
    expect(page.backdrop).toEqual({ kind: "blank", paperColor: "transparent" });

    const paper = createInlineSketchPage("hw-paper", { transparent: false });
    expect(paper.backdrop).toEqual({ kind: "blank" });

    const remembered = createInlineSketchPage("hw-legal", {
      backdrop: { kind: "legal", paperColor: "#ffffff" },
    });
    expect(remembered.backdrop).toEqual({ kind: "legal", paperColor: "#ffffff" });
  });

  it("grows smoothly on pen-up near the bottom without shrinking while writing", () => {
    const page = createInlineSketchPage("hw-1");
    expect(inlineGrowHeight(page)).toBe(INLINE_DEFAULT_HEIGHT);

    page.strokes.push({
      id: "s1",
      tool: "pen",
      color: "#000",
      size: 4,
      pts: [100, 210, 0.5, 200, 220, 0.5],
    });
    expect(lowestInlineContentY(page)).toBe(222);
    expect(inlineGrowHeight(page)).toBe(INLINE_DEFAULT_HEIGHT + INLINE_GROW_STEP);
    expect(inlineGrowHeightForPoint(page, 230, 64)).toBe(INLINE_DEFAULT_HEIGHT + INLINE_GROW_STEP);
  });

  it("trims excess bottom whitespace on finish while respecting manual height and min floor", () => {
    const page = createInlineSketchPage("hw-2", { height: 600 });
    expect(inlineTrimHeight(page)).toBe(INLINE_DEFAULT_HEIGHT);

    page.strokes.push({
      id: "s1",
      tool: "pen",
      color: "#000",
      size: 4,
      pts: [50, 140, 0.5],
    });
    expect(inlineTrimHeight(page)).toBe(142 + 28);
    expect(inlineTrimHeight(page, 400)).toBe(400);
    expect(inlineTrimHeight(page, 100)).toBe(170);
  });

  it("crops excess blank top whitespace on finish while keeping ruled lines aligned", () => {
    const blank = createInlineSketchPage("hw-top-1", { height: 400 });
    expect(highestInlineContentY(blank)).toBe(Infinity);
    expect(trimInlinePageTop(blank)).toBe(0);

    blank.strokes.push({
      id: "s1",
      tool: "pen",
      color: "#000",
      size: 4,
      pts: [50, 120, 0.5, 100, 220, 0.5],
    });
    // Highest point with stroke radius 2 is 118; shifts up to INLINE_TOP_PAD (28) -> shift 90
    const shifted = trimInlinePageTop(blank);
    expect(shifted).toBe(118 - INLINE_TOP_PAD);
    expect(highestInlineContentY(blank)).toBe(INLINE_TOP_PAD);
    expect(inlineTrimHeight(blank)).toBe(222 - shifted + 28);

    // On ruled paper (spacing 40), shift snaps to a multiple of 40 so ink stays on its lines
    const ruled = createInlineSketchPage("hw-top-2", {
      height: 400,
      backdrop: { kind: "legal", spacing: 40, paperColor: "#ffffff" },
    });
    ruled.strokes.push({ id: "s1", tool: "pen", color: "#000", size: 4, pts: [50, 130, 0.5] });
    expect(trimInlinePageTop(ruled)).toBe(80);
  });

  it("uses the rendered template pitch when cropping default Narrow paper", () => {
    const page = createInlineSketchPage("hw-narrow", {
      height: 400,
      backdrop: { kind: "ruled-narrow" },
    });
    page.strokes.push({ id: "s1", tool: "pen", color: "#000", size: 4, pts: [50, 130, 0.5] });
    expect(trimInlinePageTop(page)).toBe(84);
  });

  it("crops the merged page after preserving a remote move and erasure", () => {
    const base = createInlineSketchPage("hw-merged", { height: 400 });
    base.strokes.push(
      { id: "moved", tool: "pen", color: "#000", size: 4, pts: [50, 120, 0.5] },
      { id: "erased", tool: "pen", color: "#000", size: 4, pts: [50, 100, 0.5] },
    );
    const latest = structuredClone(base);
    latest.strokes.pop();
    latest.strokes[0].pts[1] = 180;
    const local = structuredClone(base);
    local.strokes.push({ id: "added", tool: "pen", color: "#000", size: 4, pts: [50, 160, 0.5] });

    const merged = mergeInlinePageEdits(base, latest, local);
    finishInlineSketchPage(merged, null);

    expect(merged.strokes.map(({ id, pts }) => [id, pts[1]])).toEqual([
      ["moved", 50],
      ["added", 30],
    ]);
    expect(local.strokes.map(({ id, pts }) => [id, pts[1]])).toEqual([
      ["moved", 120],
      ["erased", 100],
      ["added", 160],
    ]);
  });

  it("clamps manual bottom resize so content is never clipped", () => {
    const page = createInlineSketchPage("hw-3");
    page.strokes.push({
      id: "s1",
      tool: "pen",
      color: "#000",
      size: 4,
      pts: [50, 200, 0.5],
    });
    expect(inlineClampedResizeHeight(page, 50)).toBe(214);
    expect(inlineClampedResizeHeight(page, 500)).toBe(500);
    expect(inlineClampedResizeHeight(page, 99999)).toBe(INLINE_MAX_HEIGHT);

    const empty = createInlineSketchPage("hw-4");
    expect(inlineClampedResizeHeight(empty, 40)).toBe(INLINE_MIN_HEIGHT);
  });

  it("finds existing linked backing notebook from wiki and Markdown embeds", () => {
    const md = "Some text\n\n![[School/Lecture 5.notebook#id=hw-8f2a1c09]]\n\nMore text";
    expect(findLinkedNotebookInMarkdown(md)).toBe("School/Lecture 5.notebook");
    expect(findLinkedNotebookInMarkdown("![](School/Lecture%205.notebook.md#id=hw-8f2a1c09)")).toBe(
      "School/Lecture 5.notebook.md",
    );
    expect(findLinkedNotebookInMarkdown("![](<School/Lecture 5.notebook.md#id=hw-8f2a1c09>)")).toBe(
      "School/Lecture 5.notebook.md",
    );
    expect(findLinkedNotebookInMarkdown("![](<School/Lecture 5.notebook.md>#id=hw-8f2a1c09)")).toBe(
      "School/Lecture 5.notebook.md",
    );
    expect(findLinkedNotebookInMarkdown("![[Lecture 5.notebook#page=2]]")).toBeNull();
    expect(findLinkedNotebookInMarkdown("Just text")).toBeNull();
  });

  it("preserves explicit manual height across reopened sessions", () => {
    const defaultEmpty = createInlineSketchPage("hw-e1");
    expect(initialInlineManualHeight(defaultEmpty)).toBeNull();

    const resizedEmpty = createInlineSketchPage("hw-e2", { height: 420 });
    expect(initialInlineManualHeight(resizedEmpty)).toBe(420);

    const tight = createInlineSketchPage("hw-e3", { height: 170 });
    tight.strokes.push({ id: "s1", tool: "pen", color: "#000", size: 4, pts: [50, 140, 0.5] });
    expect(initialInlineManualHeight(tight)).toBeNull();

    const tall = createInlineSketchPage("hw-e4", { height: 480 });
    tall.strokes.push({ id: "s1", tool: "pen", color: "#000", size: 4, pts: [50, 140, 0.5] });
    expect(initialInlineManualHeight(tall)).toBe(480);
  });

  it("three-way merges local inline edits while preserving remote additions, edits, and erasures", () => {
    const base = createInlineSketchPage("hw-m1");
    base.strokes.push(
      { id: "s-local-del", tool: "pen", color: "#000", size: 4, pts: [10, 10, 0.5] },
      { id: "s-remote-del", tool: "pen", color: "#000", size: 4, pts: [15, 15, 0.5] },
      { id: "s-remote-edit", tool: "pen", color: "#000", size: 4, pts: [20, 20, 0.5] },
      { id: "s-local-edit", tool: "pen", color: "#000", size: 4, pts: [25, 25, 0.5] },
    );

    const latest = structuredClone(base);
    latest.strokes = latest.strokes.filter((s) => s.id !== "s-remote-del");
    latest.strokes.find((s) => s.id === "s-remote-edit")!.color = "#00ff00";
    latest.strokes.push({
      id: "s-remote-add",
      tool: "pen",
      color: "#f00",
      size: 4,
      pts: [30, 30, 0.5],
    });

    const local = structuredClone(base);
    local.strokes = local.strokes.filter((s) => s.id !== "s-local-del");
    local.strokes.find((s) => s.id === "s-local-edit")!.color = "#0000ff";
    local.strokes.push({
      id: "s-local-add",
      tool: "pen",
      color: "#00f",
      size: 4,
      pts: [40, 40, 0.5],
    });

    const merged = mergeInlinePageEdits(base, latest, local);
    expect(merged.strokes.map((s) => s.id)).toEqual([
      "s-remote-edit",
      "s-local-edit",
      "s-local-add",
      "s-remote-add",
    ]);
    expect(merged.strokes.find((s) => s.id === "s-remote-edit")?.color).toBe("#00ff00");
    expect(merged.strokes.find((s) => s.id === "s-local-edit")?.color).toBe("#0000ff");
  });

  it("mints collision-free dot IDs when two devices add ink from the same starting page", () => {
    const startPage = createInlineSketchPage("hw-m2");

    // Device A opens inline editor on startPage with its DevicePages DotClock
    const docA = {
      version: 3,
      view: { scrollY: 0, width: 1024, scale: 1 },
      pages: [structuredClone(startPage)],
    };
    attachDotClock(docA, new DotClock("a1b2c3d4"));
    const seqA = new IdSequence("s", () => docA);
    seqA.restart(strokeIdsOf(docA));
    const idA = seqA.next();
    docA.pages[0].strokes.push({
      id: idA,
      tool: "pen",
      color: "#000",
      size: 4,
      pts: [10, 10, 0.5],
    });

    // Device B opens inline editor on the exact same startPage with its own DotClock
    const docB = {
      version: 3,
      view: { scrollY: 0, width: 1024, scale: 1 },
      pages: [structuredClone(startPage)],
    };
    attachDotClock(docB, new DotClock("e5f60718"));
    const seqB = new IdSequence("s", () => docB);
    seqB.restart(strokeIdsOf(docB));
    const idB = seqB.next();
    docB.pages[0].strokes.push({
      id: idB,
      tool: "pen",
      color: "#f00",
      size: 4,
      pts: [20, 20, 0.5],
    });

    expect(dotClockOf(docA)).toBeDefined();
    expect(idA).not.toBe(idB);

    // Device B saves after Device A has already synced its stroke
    const merged = mergeInlinePageEdits(startPage, docA.pages[0], docB.pages[0]);
    expect(merged.strokes.map((s) => s.id)).toEqual([idB, idA]);
  });

  it("parses and resolves #id=<pageId> embed targets", () => {
    const target = embedTarget("#id=hw-a1b2c3d4");
    expect(target).toEqual({ page: 1, whole: false, pageId: "hw-a1b2c3d4" });
    expect(embedPageLink("Lecture 5.notebook#id=hw-a1b2c3d4", target!, 3)).toBe(
      "Lecture 5.notebook#page=3",
    );
    const pages = [{ id: "p1" }, { id: "hw-a1b2c3d4" }, { id: "p3" }];
    expect(pageIndexById(pages, "hw-a1b2c3d4")).toBe(1);
    expect(pageIndexById(pages, "missing")).toBe(-1);
  });
});
