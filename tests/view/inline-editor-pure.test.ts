import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type InlineEditorHandle,
  activeInlineEditor,
  claimInlineEditor,
  closeAnyInlineEditor,
  closeInlineEditorIn,
  closeInlineEditorsOf,
  makeRoomFor,
  releaseInlineEditor,
} from "../../src/view/inline-editor-registry";
import { flashRing, inGrowBand } from "../../src/view/inline-surface-model";
import { type InlineKeyFacts, inlineKeyVerdict } from "../../src/view/inline-editor-keys";
import { reusableNoteNotebook } from "../../src/model/inline-sketch";
import { PAGE_ID_ATTEMPTS, pageIdStep } from "../../src/view/pending-page";
import { DARK_PAPER, LIGHT_PAPER, fillPaper, pageLook } from "../../src/canvas/backdrop";

/** An editor over `slot` whose save works (`saves`) or fails. */
function editor(slot: { isConnected: boolean }, saves = true, filePath = "Note.notebook.md") {
  const handle: InlineEditorHandle & { closed: boolean; forced: boolean[] } = {
    hostSlot: slot as unknown as HTMLElement,
    filePath,
    closed: false,
    forced: [],
    close: vi.fn((force = false) => {
      handle.forced.push(force);
      if (!saves && !force) return Promise.resolve(false);
      handle.closed = true;
      releaseInlineEditor(handle);
      return Promise.resolve(saves);
    }),
  };
  claimInlineEditor(handle);
  return handle;
}

afterEach(async () => {
  await closeAnyInlineEditor();
});

describe("one block edited at a time (#312)", () => {
  it("closes the open block before another opens", async () => {
    const first = editor({ isConnected: true });
    expect(await makeRoomFor({} as HTMLElement)).toBe(true);
    expect(first.closed).toBe(true);
    expect(activeInlineEditor()).toBeNull();
  });

  it("refuses a second editor over the same block", async () => {
    const slot = { isConnected: true };
    editor(slot);
    expect(await makeRoomFor(slot as unknown as HTMLElement)).toBe(false);
  });

  it("keeps a block that could not save open while it is on screen", async () => {
    const stuck = editor({ isConnected: true }, false);
    expect(await makeRoomFor({} as HTMLElement)).toBe(false);
    expect(activeInlineEditor()).toBe(stuck);
  });

  it("takes down a block that could not save once Live Preview has dropped it", async () => {
    const slot = { isConnected: true };
    const stuck = editor(slot, false);
    slot.isConnected = false;
    // Not stuck forever: the next block opens.
    expect(await makeRoomFor({} as HTMLElement)).toBe(true);
    expect(stuck.forced).toEqual([true]);
    expect(activeInlineEditor()).toBeNull();
  });
});

describe("an editor's block going away (#312)", () => {
  it("closes the editor over that block, even when its save fails", async () => {
    const slot = { isConnected: true };
    const open = editor(slot, false);
    await closeInlineEditorIn({} as HTMLElement);
    expect(open.closed).toBe(false);
    await closeInlineEditorIn(slot as unknown as HTMLElement);
    expect(open.closed).toBe(true);
    expect(open.forced).toEqual([true]);
    expect(activeInlineEditor()).toBeNull();
  });

  it("closes the block of a notebook that opens in its own view, and only that one", async () => {
    const open = editor({ isConnected: true }, false, "Lecture.notebook.md");
    await closeInlineEditorsOf("Other.notebook.md");
    expect(open.closed).toBe(false);
    // Saved and closed even if the save fails: the view must not mint the same ids.
    await closeInlineEditorsOf("Lecture.notebook.md");
    expect(open.closed).toBe(true);
    expect(open.forced).toEqual([true]);
  });

  it("closes whatever is open when the plugin unloads", async () => {
    const open = editor({ isConnected: true }, false);
    await closeAnyInlineEditor();
    expect(open.closed).toBe(true);
    expect(activeInlineEditor()).toBeNull();
  });
});

describe("the surface's sums for a block", () => {
  it("grows only for the pen along the block's bottom", () => {
    const size = { width: 1000, height: 300 };
    expect(inGrowBand({ x: 500, y: 290 }, size, 40)).toBe(true);
    expect(inGrowBand({ x: 500, y: 330 }, size, 40)).toBe(true);
    expect(inGrowBand({ x: 500, y: 200 }, size, 40)).toBe(false);
    expect(inGrowBand({ x: -1, y: 300 }, size, 40)).toBe(false);
    expect(inGrowBand({ x: 1000, y: 300 }, size, 40)).toBe(false);
  });

  it("rings the drawing of the page opened, else the page", () => {
    const box = { x: 100, y: 1000, width: 800, height: 400 };
    const view = { scale: 0.5, offsetX: 10, scrollY: 900 };
    expect(flashRing(box, null, view)).toEqual({ left: 60, top: 50, width: 400, height: 200 });
    expect(flashRing(box, { minX: 100, minY: 100, maxX: 300, maxY: 200 }, view)).toEqual({
      left: 100,
      top: 90,
      width: 120,
      height: 70,
    });
    // A dot of ink still gets a ring one can see.
    expect(flashRing(box, { minX: 5, minY: 5, maxX: 6, maxY: 6 }, view).width).toBe(40);
  });
});

describe("a page asked for by id", () => {
  const pages = [{ id: "p1" }, { id: "hw-1" }];

  it("goes to it, waits for it, then gives up", () => {
    expect(pageIdStep(pages, null, 0)).toEqual({ kind: "none" });
    expect(pageIdStep(pages, "hw-1", 0)).toEqual({ kind: "found", index: 1 });
    expect(pageIdStep(pages, "hw-2", 0)).toEqual({ kind: "wait" });
    expect(pageIdStep(pages, "hw-2", PAGE_ID_ATTEMPTS - 1)).toEqual({ kind: "wait" });
    // Never kept forever: after the last look it is dropped.
    expect(pageIdStep(pages, "hw-2", PAGE_ID_ATTEMPTS)).toEqual({ kind: "missing" });
  });
});

describe("transparent paper outside its note (#312)", () => {
  const backdrop = { kind: "blank", paperColor: "transparent" } as const;

  it("is the theme's paper in the notebook, Home, covers and export", () => {
    expect(pageLook(backdrop, LIGHT_PAPER).paper).toBe(LIGHT_PAPER.paper);
    expect(pageLook(backdrop, DARK_PAPER).paper).toBe(DARK_PAPER.paper);
    const fills: string[] = [];
    const ctx = {
      save() {},
      restore() {},
      fillRect() {
        fills.push(this.fillStyle);
      },
      fillStyle: "",
    };
    fillPaper(ctx as never, { width: 10, height: 10 }, LIGHT_PAPER, "transparent");
    expect(fills).toEqual([LIGHT_PAPER.paper]);
  });

  it("is left unfilled where the block shows in its note", () => {
    const note = { ...LIGHT_PAPER, seeThrough: true };
    expect(pageLook(backdrop, note).paper).toBe("transparent");
    const ctx = { save() {}, restore() {}, fillRect: vi.fn(), fillStyle: "" };
    fillPaper(ctx as never, { width: 10, height: 10 }, note, "transparent");
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

describe("the keys that finish a block (#312)", () => {
  const key = (extra: Partial<InlineKeyFacts>): InlineKeyFacts => ({
    key: "Escape",
    mod: false,
    shift: false,
    alt: false,
    prevented: false,
    composing: false,
    modalOpen: false,
    inside: true,
    editable: false,
    popoverOpen: false,
    ...extra,
  });

  it("finishes on Esc and Mod+Enter pressed in the block", () => {
    expect(inlineKeyVerdict(key({}))).toBe("surface");
    expect(inlineKeyVerdict(key({ key: "Enter", mod: true }))).toBe("finish");
    expect(inlineKeyVerdict(key({ key: "Enter" }))).toBe("pass");
    expect(inlineKeyVerdict(key({ key: "z", mod: true }))).toBe("pass");
  });

  it("leaves Esc to an open popover: it closes the popover only", () => {
    expect(inlineKeyVerdict(key({ popoverOpen: true }))).toBe("pass");
    // Mod+Enter still finishes: no popover takes it.
    expect(inlineKeyVerdict(key({ key: "Enter", mod: true, popoverOpen: true }))).toBe("finish");
  });

  it("does nothing to the block for a key pressed outside it", () => {
    expect(inlineKeyVerdict(key({ inside: false }))).toBe("pass");
    expect(inlineKeyVerdict(key({ key: "Enter", mod: true, inside: false }))).toBe("pass");
  });

  it("leaves keys to text boxes, menus, dialogs and anyone who took them first", () => {
    expect(inlineKeyVerdict(key({ editable: true }))).toBe("pass");
    expect(inlineKeyVerdict(key({ modalOpen: true }))).toBe("pass");
    expect(inlineKeyVerdict(key({ prevented: true }))).toBe("pass");
    expect(inlineKeyVerdict(key({ composing: true }))).toBe("pass");
  });
});

describe("reusing the notebook named after a note (#312)", () => {
  const blocks = [{ id: "hw-1" }, { id: "hw-2" }];

  it("reuses the one Handwrite here made for this note", () => {
    expect(reusableNoteNotebook(blocks, [], "A/Lecture.md")).toBe(true);
    expect(reusableNoteNotebook(blocks, ["A/Lecture.md"], "A/Lecture.md")).toBe(true);
  });

  it("leaves a notebook of the user's own that shares the name", () => {
    expect(reusableNoteNotebook([{ id: "p1" }, { id: "hw-1" }], [], "Physics.md")).toBe(false);
    expect(reusableNoteNotebook([], [], "Physics.md")).toBe(false);
  });

  it("leaves the notebook another note of the same name uses", () => {
    expect(reusableNoteNotebook(blocks, ["B/Lecture.md"], "A/Lecture.md")).toBe(false);
  });
});
