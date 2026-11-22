/**
 * A text note read again because it changed on disk (`TextNoteView.setViewData`
 * with `clear` false): its own text coming back, an empty file mid-copy, a
 * change under the pen, and a merge with what this view has not saved yet.
 * The view is built from its prototype, with the editor as a stub.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextNote } from "../../src/model/text-note";
import { resetFakes, TFile } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { TextNoteView } = await import("../../src/view/note-view");
const { OwnTexts } = await import("../../src/model/note-merge");
const { buildNoteFile, parseNoteFile } = await import("../../src/model/text-note-file");
const { textBlock } = await import("../../src/model/text-note");

const FRONT = "---\ncreated: 2026-11-22\n---\n";

function file(...lines: string[]): string {
  let n = 0;
  return buildNoteFile(FRONT, {
    blocks: lines.map((text) => textBlock(`x${++n}`, "body", [{ text, marks: 0 }])),
  });
}

const textsOf = (note: TextNote): string[] =>
  note.blocks.map((b) => (b.type === "text" ? b.runs.map((r) => r.text).join("") : b.type));

function setup(onDisk: string) {
  let current = parseNoteFile(
    onDisk,
    (() => {
      let n = 0;
      return () => `e${++n}`;
    })(),
  ).note;
  const editor = {
    el: { scrollTop: 120 },
    penDown: false,
    current: () => current,
    load: vi.fn((note: TextNote) => {
      current = note;
    }),
    isPenDown(): boolean {
      return this.penDown;
    },
    foldTitles: vi.fn(),
  };
  const saves = vi.fn();
  const timers: Array<() => void> = [];
  const path = "Trips/Note.note.md";
  const view = Object.assign(Object.create(TextNoteView.prototype) as object, {
    editor,
    file: new TFile(path),
    loadedPath: path,
    written: onDisk,
    frontmatter: FRONT,
    ownTexts: new OwnTexts(),
    loads: 0,
    lastEdit: 0,
    pendingDisk: null,
    pendingTimer: 0,
    diskReloads: { own: 0, empty: 0, merged: 0, carried: 0, replaced: 0 },
    requestSave: saves,
    showDate: vi.fn(),
    extras: null,
    app: { loadLocalStorage: () => null },
    contentEl: {
      win: {
        setTimeout: (f: () => void) => timers.push(f),
        clearTimeout: () => undefined,
      },
    },
  }) as unknown as {
    setViewData(data: string, clear: boolean): void;
    diskReloads: Record<string, number>;
    ownTexts: InstanceType<typeof OwnTexts>;
  };
  view.ownTexts.note(onDisk);
  return {
    view,
    editor,
    saves,
    timers,
    edit(note: TextNote) {
      current = note;
    },
    get current() {
      return current;
    },
  };
}

beforeEach(() => resetFakes());

describe("a text note changed on disk", () => {
  it("ignores an older text of its own put back by a sync, and saves its own again", () => {
    const old = file("Alpha");
    const t = setup(old);
    const now = file("Alpha", "Bravo");
    (t.view as unknown as { written: string }).written = now;
    t.view.ownTexts.note(now);
    t.view.setViewData(old, false);
    expect(t.editor.load).not.toHaveBeenCalled();
    expect(t.saves).toHaveBeenCalled();
    expect(t.view.diskReloads.own).toBe(1);
  });

  it("skips an empty read while the file is being written, and saves nothing", () => {
    const t = setup(file("Alpha"));
    t.view.setViewData("", false);
    expect(t.editor.load).not.toHaveBeenCalled();
    expect(t.saves).not.toHaveBeenCalled();
    expect(t.view.diskReloads.empty).toBe(1);
  });

  it("loads the file as it is when nothing here is unsaved", () => {
    const t = setup(file("Alpha"));
    t.view.setViewData(file("Alpha", "From there"), false);
    expect(textsOf(t.current).slice(0, 2)).toEqual(["Alpha", "From there"]);
    expect(t.view.diskReloads.replaced).toBe(1);
    // Where the reader was.
    expect(t.editor.el.scrollTop).toBe(120);
  });

  it("merges a change from elsewhere with what is not saved here, and saves the merge", () => {
    const disk = file("Alpha", "Bravo", "Charlie");
    const t = setup(disk);
    const here = t.current.blocks.map((b, i) =>
      i === 0 ? textBlock(b.id, "body", [{ text: "Alpha here", marks: 0 }]) : b,
    );
    t.edit({ blocks: here });
    t.view.setViewData(file("Alpha", "Bravo", "Charlie there"), false);
    expect(textsOf(t.current).slice(0, 3)).toEqual(["Alpha here", "Bravo", "Charlie there"]);
    expect(t.view.diskReloads.merged).toBe(1);
    expect(t.saves).toHaveBeenCalled();
  });

  it("waits for the pen to lift before merging", () => {
    const t = setup(file("Alpha"));
    t.editor.penDown = true;
    t.view.setViewData(file("Alpha", "There"), false);
    expect(t.editor.load).not.toHaveBeenCalled();
    t.editor.penDown = false;
    t.timers.shift()?.();
    expect(textsOf(t.current).slice(0, 2)).toEqual(["Alpha", "There"]);
  });
});
