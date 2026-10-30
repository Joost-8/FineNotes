/**
 * The shortcut table (`src/model/shortcut-bindings.ts`): the built-in keys,
 * what a `KeyboardEvent` becomes, the conflicts that pause
 * rows, and the per-device JSON. The rules here are the ones the settings tab
 * and the notebook both rely on: a changed row replaces its built-in key, and
 * two rows sharing an input do nothing at all.
 */

import { describe, expect, it } from "vitest";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_STORAGE_VERSION,
  SHORTCUTS_STORAGE_KEY,
  boundShortcutGroups,
  buttonBit,
  buttonInput,
  inputCaps,
  inputKey,
  inputText,
  inputsText,
  keyInput,
  matchShortcut,
  normalizeMods,
  parseInput,
  parseShortcutOverrides,
  serializeShortcutOverrides,
  shortcutTable,
  withMode,
  withShortcut,
  withoutShortcut,
} from "../../src/model/shortcut-bindings";
import { SHORTCUT_GROUPS } from "../../src/model/shortcuts";

const keyEvent = (
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
) => ({
  key,
  metaKey: mods.meta === true,
  ctrlKey: mods.ctrl === true,
  altKey: mods.alt === true,
  shiftKey: mods.shift === true,
});

describe("the built-in shortcut table", () => {
  it("starts with every action and no conflicts", () => {
    const table = shortcutTable();
    expect(table.rows).toHaveLength(SHORTCUT_ACTIONS.length);
    expect(table.conflicts).toEqual([]);
    expect(table.customized).toBe(0);
    expect(table.rows.every((row) => !row.conflicted)).toBe(true);
  });

  it("keeps the keys the notebook already had", () => {
    const table = shortcutTable();
    const found = (key: string, mods: ("Mod" | "Alt" | "Shift")[] = []) =>
      matchShortcut(table, { type: "key", key, mods });
    expect(found("p")).toMatchObject({ kind: "action", row: { action: { id: "tool.pen" } } });
    expect(found("w")).toMatchObject({ kind: "action", row: { action: { id: "tool.pen" } } });
    expect(found("h")).toMatchObject({
      kind: "action",
      row: { action: { id: "tool.highlighter" } },
    });
    expect(found("z", ["Mod"])).toMatchObject({
      kind: "action",
      row: { action: { id: "edit.undo" } },
    });
    expect(found("z", ["Mod", "Shift"])).toMatchObject({
      kind: "action",
      row: { action: { id: "edit.redo" } },
    });
    expect(found("c", ["Mod"])).toMatchObject({
      kind: "action",
      row: { action: { id: "edit.copy" }, contextual: true },
    });
    expect(found(" ")).toMatchObject({
      kind: "action",
      row: { action: { id: "tool.pan" }, mode: "hold" },
    });
  });

  it("offers Hold to every tool, and to nothing else", () => {
    const holdable = SHORTCUT_ACTIONS.filter((action) => action.holdable).map(
      (action) => action.id,
    );
    expect(holdable).toEqual([
      "tool.pen",
      "tool.highlighter",
      "tool.eraser",
      "tool.select",
      "tool.shape",
      "tool.text",
      "tool.laser",
      "tool.pan",
      "tool.zoom",
    ]);
  });
});

describe("key readings", () => {
  it("names letters in lower case and keeps a shifted character as one key", () => {
    expect(keyInput(keyEvent("P"))).toEqual({ type: "key", key: "p", mods: [] });
    expect(keyInput(keyEvent("P", { shift: true }))).toEqual({
      type: "key",
      key: "p",
      mods: ["Shift"],
    });
    expect(keyInput(keyEvent("?", { shift: true }))).toEqual({
      type: "key",
      key: "?",
      mods: [],
    });
    expect(keyInput(keyEvent(" ", { shift: true }))).toEqual({
      type: "key",
      key: " ",
      mods: [],
    });
  });

  it("makes Ctrl and Cmd one Mod, in the table's order", () => {
    expect(keyInput(keyEvent("z", { ctrl: true, shift: true, alt: true }))).toEqual({
      type: "key",
      key: "z",
      mods: ["Mod", "Alt", "Shift"],
    });
    expect(normalizeMods(["Shift", "Mod", "Shift"])).toEqual(["Mod", "Shift"]);
  });

  it("ignores a modifier pressed alone", () => {
    for (const key of ["Shift", "Control", "Alt", "Meta", "AltGraph"])
      expect(keyInput(keyEvent(key))).toBeNull();
  });

  it("falls back to the physical code when a stylus sends no character", () => {
    expect(keyInput({ ...keyEvent("Unidentified"), code: "F13" })).toEqual({
      type: "key",
      key: "F13",
      mods: [],
    });
    expect(keyInput({ ...keyEvent(""), code: "MediaPlayPause" })).toEqual({
      type: "key",
      key: "MediaPlayPause",
      mods: [],
    });
    expect(keyInput({ ...keyEvent("Unidentified"), code: "KeyQ" })).toEqual({
      type: "key",
      key: "q",
      mods: [],
    });
    // A real character wins over the code, so layouts keep typing as typed.
    expect(keyInput({ ...keyEvent("p"), code: "KeyQ" })).toEqual({
      type: "key",
      key: "p",
      mods: [],
    });
  });

  it("keeps function, navigation and media keys by name", () => {
    expect(keyInput(keyEvent("F24"))).toEqual({ type: "key", key: "F24", mods: [] });
    expect(keyInput(keyEvent("PageDown"))).toEqual({ type: "key", key: "PageDown", mods: [] });
    expect(keyInput(keyEvent("AudioVolumeUp"))).toEqual({
      type: "key",
      key: "AudioVolumeUp",
      mods: [],
    });
    expect(keyInput(keyEvent("Left"))).toEqual({ type: "key", key: "ArrowLeft", mods: [] });
    expect(keyInput(keyEvent("Spacebar"))).toEqual({ type: "key", key: " ", mods: [] });
  });
});

describe("labels", () => {
  it("shows modifiers and key caps as the rest of the settings do", () => {
    expect(inputCaps({ type: "key", key: "z", mods: ["Mod", "Shift"] }, false)).toEqual([
      "Ctrl",
      "Shift",
      "Z",
    ]);
    expect(inputText({ type: "key", key: "z", mods: ["Mod", "Shift"] }, false)).toBe(
      "Ctrl + Shift + Z",
    );
    expect(inputText({ type: "key", key: "z", mods: ["Mod", "Shift"] }, true)).toBe("⌘ ⇧ Z");
    expect(inputText({ type: "key", key: " ", mods: [] }, false)).toBe("Space");
    expect(inputsText([], false)).toBe("Not set");
    expect(
      inputsText(
        [
          { type: "key", key: "p", mods: [] },
          { type: "key", key: "w", mods: [] },
        ],
        false,
      ),
    ).toBe("P or W");
  });
});

describe("changing a row", () => {
  it("replaces the built-in keys, so the old one no longer acts", () => {
    const overrides = withShortcut({}, "tool.pen", { type: "key", key: "k", mods: [] }, "press");
    const table = shortcutTable(overrides);
    expect(matchShortcut(table, { type: "key", key: "k", mods: [] })).toMatchObject({
      kind: "action",
      row: { action: { id: "tool.pen" } },
    });
    // P and W were the pen's; nothing else wants them, so they are taken
    // away rather than falling back to the built-in tool keys.
    expect(matchShortcut(table, { type: "key", key: "p", mods: [] })).toMatchObject({
      kind: "blocked",
    });
    expect(matchShortcut(table, { type: "key", key: "w", mods: [] })).toMatchObject({
      kind: "blocked",
    });
  });

  it("clears a row, which also takes its built-in keys away", () => {
    const overrides = withShortcut({}, "tool.pen", null, "press");
    expect(matchShortcut(shortcutTable(overrides), { type: "key", key: "p", mods: [] })).toEqual({
      kind: "blocked",
    });
  });

  it("keeps Hold only for a tool, and Press for a command", () => {
    const tool = shortcutTable(withShortcut({}, "tool.eraser", null, "hold"));
    expect(tool.rows.find((row) => row.action.id === "tool.eraser")?.mode).toBe("hold");
    const command = shortcutTable(
      withShortcut({}, "edit.undo", { type: "key", key: "u", mods: [] }, "hold"),
    );
    expect(command.rows.find((row) => row.action.id === "edit.undo")?.mode).toBe("press");
  });

  it("changes Press/Hold without losing a row's built-in key", () => {
    const overrides = withMode({}, "tool.eraser", "hold");
    const row = shortcutTable(overrides).rows.find(
      (candidate) => candidate.action.id === "tool.eraser",
    );
    expect(row?.mode).toBe("hold");
    expect(row?.inputs).toEqual([{ type: "key", key: "e", mods: [] }]);
    // A cleared row stays cleared when its mode changes.
    const cleared = withMode(withShortcut({}, "tool.eraser", null, "press"), "tool.eraser", "hold");
    const clearedRow = shortcutTable(cleared).rows.find(
      (candidate) => candidate.action.id === "tool.eraser",
    );
    expect(clearedRow?.inputs).toEqual([]);
    expect(clearedRow?.mode).toBe("hold");
    // The hand's own default is Hold; Press is a real choice too.
    const hand = shortcutTable(withMode({}, "tool.pan", "press")).rows.find(
      (candidate) => candidate.action.id === "tool.pan",
    );
    expect(hand?.mode).toBe("press");
    expect(hand?.inputs).toEqual([{ type: "key", key: " ", mods: [] }]);
    // The pen's two keys both stay when only its mode changes.
    expect(
      shortcutTable(withMode({}, "tool.pen", "hold")).rows.find(
        (candidate) => candidate.action.id === "tool.pen",
      )?.inputs,
    ).toEqual([
      { type: "key", key: "p", mods: [] },
      { type: "key", key: "w", mods: [] },
    ]);
    // A command has nothing to hold.
    expect(withMode({}, "edit.undo", "hold")).toEqual({});
  });

  it("keeps a mode-only change through the store", () => {
    const overrides = withMode({}, "tool.eraser", "hold");
    expect(parseShortcutOverrides(serializeShortcutOverrides(overrides))).toEqual(overrides);
    expect(JSON.parse(serializeShortcutOverrides(overrides)).bindings["tool.eraser"]).toEqual({
      mode: "hold",
    });
  });

  it("puts one row back without touching the others", () => {
    const changed = withShortcut({}, "tool.pen", { type: "key", key: "k", mods: [] }, "press");
    expect(withoutShortcut(changed, "tool.pen")).toEqual({});
    expect(withoutShortcut(changed, "tool.eraser")).toBe(changed);
  });
});

describe("conflicts", () => {
  it("pauses both rows that share an input, and every input of theirs", () => {
    // The pen keeps P and W; Undo takes P. Neither may act.
    const overrides = withShortcut({}, "edit.undo", { type: "key", key: "p", mods: [] }, "press");
    const table = shortcutTable(overrides);
    expect(table.conflicts).toHaveLength(1);
    expect(table.conflicts[0]?.rows.map((row) => row.action.id).sort()).toEqual([
      "edit.undo",
      "tool.pen",
    ]);
    expect(matchShortcut(table, { type: "key", key: "p", mods: [] })).toMatchObject({
      kind: "conflict",
    });
    // The pen's other way is paused with it.
    expect(matchShortcut(table, { type: "key", key: "w", mods: [] })).toMatchObject({
      kind: "conflict",
    });
  });

  it("resolves when one row is reset", () => {
    const conflicting = withShortcut(
      withShortcut({}, "edit.undo", { type: "key", key: "p", mods: [] }, "press"),
      "tool.pen",
      { type: "key", key: "k", mods: [] },
      "press",
    );
    expect(shortcutTable(conflicting).conflicts).toEqual([]);
    expect(shortcutTable(withoutShortcut(conflicting, "edit.undo")).conflicts).toEqual([]);
  });
});

describe("this device's stored rows", () => {
  it("round-trips what it wrote", () => {
    const overrides = withShortcut(
      withShortcut({}, "tool.pen", { type: "key", key: "k", mods: ["Mod"] }, "press"),
      "tool.eraser",
      { type: "key", key: "x", mods: ["Alt"] },
      "hold",
    );
    const raw = serializeShortcutOverrides(overrides);
    expect(JSON.parse(raw)).toMatchObject({ version: SHORTCUT_STORAGE_VERSION });
    expect(parseShortcutOverrides(raw)).toEqual(overrides);
  });

  it("falls back to the defaults for an empty, broken or future store", () => {
    expect(parseShortcutOverrides(null)).toEqual({});
    expect(parseShortcutOverrides("")).toEqual({});
    expect(parseShortcutOverrides("{not json")).toEqual({});
    expect(parseShortcutOverrides({ version: 99, bindings: { "tool.pen": {} } })).toEqual({});
  });

  it("drops rows and inputs this build does not know", () => {
    const raw = JSON.stringify({
      version: 1,
      bindings: {
        "tool.pen": { input: { type: "key", key: "k", mods: ["Mod", "Nope"] }, mode: "press" },
        "tool.gone": { input: { type: "key", key: "g", mods: [] }, mode: "press" },
        "tool.eraser": { input: { type: "gesture", name: "swipe", mods: [] }, mode: "hold" },
        "tool.shape": { mode: "hold" },
        "view.zoom-in": { mode: "hold" },
        "edit.undo": { input: null, mode: "hold" },
      },
    });
    expect(parseShortcutOverrides(raw)).toEqual({
      "tool.pen": { input: { type: "key", key: "k", mods: ["Mod"] }, mode: "press" },
      "edit.undo": { input: null, mode: "press" },
      "tool.shape": { mode: "hold" },
      "view.zoom-in": { mode: "press" },
    });
  });

  it("writes under the device-local key, not a synced setting", () => {
    expect(SHORTCUTS_STORAGE_KEY).toBe("goodobsidian:shortcuts");
  });

  it("keeps an input's identity stable whatever order its modifiers came in", () => {
    expect(inputKey({ type: "key", key: "z", mods: ["Shift", "Mod"] })).toBe(
      inputKey({ type: "key", key: "z", mods: ["Mod", "Shift"] }),
    );
  });
});

describe("the ? sheet", () => {
  const line = (groups: ReturnType<typeof boundShortcutGroups>, action: string) =>
    groups.flatMap((group) => group.shortcuts).find((shortcut) => shortcut.action === action);

  it("stays as written while nothing is changed", () => {
    expect(boundShortcutGroups(shortcutTable(), SHORTCUT_GROUPS)).toEqual(SHORTCUT_GROUPS);
  });

  it("shows a changed key, and keeps a held tool's gesture", () => {
    const overrides = withShortcut(
      withShortcut({}, "tool.pen", { type: "key", key: "k", mods: ["Mod"] }, "press"),
      "tool.pan",
      { type: "key", key: "g", mods: [] },
      "hold",
    );
    const groups = boundShortcutGroups(shortcutTable(overrides), SHORTCUT_GROUPS);
    expect(line(groups, "Pen")?.ways).toEqual([{ keys: ["Mod", "K"], gesture: undefined }]);
    expect(line(groups, "Move the page")?.ways).toEqual([{ keys: ["G"], gesture: "drag" }]);
    expect(line(groups, "Eraser")?.ways).toEqual([{ keys: ["E"] }]);
  });

  it("drops a line whose row has no key, and splits the saved pens once one changes", () => {
    const overrides = withShortcut(
      withShortcut({}, "tool.eraser", null, "press"),
      "pen.saved.2",
      { type: "key", key: "q", mods: [] },
      "press",
    );
    const groups = boundShortcutGroups(shortcutTable(overrides), SHORTCUT_GROUPS);
    expect(line(groups, "Eraser")).toBeUndefined();
    expect(line(groups, "Saved pens 1 to 8")).toBeUndefined();
    expect(line(groups, "Saved pen 2")?.ways).toEqual([{ keys: ["Q"] }]);
    expect(line(groups, "Saved pen 8")?.ways).toEqual([{ keys: ["8"] }]);
  });
});

describe("buttons", () => {
  const press = (
    pointerType: string,
    button: number,
    buttons: number,
    mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
  ) => ({
    pointerType,
    button,
    buttons,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("reads a right click, a pen's side button and eraser end, and the mouse's other buttons", () => {
    expect(buttonInput(press("mouse", 2, 2))).toEqual({ type: "button", button: 2, mods: [] });
    expect(buttonInput(press("pen", 2, 2))).toEqual({
      type: "button",
      button: 2,
      mods: [],
      pen: true,
    });
    // Some drivers report a pen touching down with its side button held as button 0.
    expect(buttonInput(press("pen", 0, 3))).toMatchObject({ button: 2, pen: true });
    // The eraser end, by its bit or by its button.
    expect(buttonInput(press("pen", 0, 32))).toMatchObject({ button: 5 });
    expect(buttonInput(press("pen", 5, 0))).toMatchObject({ button: 5 });
    expect(buttonInput(press("mouse", 1, 4))).toMatchObject({ button: 1 });
    expect(buttonInput(press("mouse", 3, 8))).toMatchObject({ button: 3 });
    expect(buttonInput(press("mouse", 4, 16))).toMatchObject({ button: 4 });
    expect(buttonInput(press("mouse", 2, 2, { shiftKey: true, ctrlKey: true }))).toEqual({
      type: "button",
      button: 2,
      mods: ["Mod", "Shift"],
    });
  });

  it("is never the contact, a left click or a finger", () => {
    expect(buttonInput(press("pen", 0, 1))).toBeNull();
    expect(buttonInput(press("mouse", 0, 1))).toBeNull();
    // A mouse's left button with the right one held is still the left click.
    expect(buttonInput(press("mouse", 0, 3))).toBeNull();
    expect(buttonInput(press("touch", 2, 2))).toBeNull();
  });

  it("knows which buttons bit each one holds", () => {
    expect([1, 2, 3, 4, 5].map(buttonBit)).toEqual([4, 2, 8, 16, 32]);
    expect(buttonBit(0)).toBe(0);
  });

  it("is one input for a pen and a mouse, named as each", () => {
    const right = { type: "button", button: 2, mods: [] } as const;
    const side = { ...right, pen: true };
    expect(inputKey(side)).toBe(inputKey(right));
    expect(inputText(right, false)).toBe("Right click");
    expect(inputText(side, false)).toBe("Side button");
    expect(inputCaps({ type: "button", button: 5, mods: ["Shift"] }, false)).toEqual([
      "Shift",
      "Eraser end",
    ]);
    expect(inputText({ type: "button", button: 1, mods: [] }, false)).toBe("Middle click");
    // Never the same as a key.
    expect(inputKey(right)).not.toBe(inputKey({ type: "key", key: "2", mods: [] }));
  });

  it("binds, conflicts and is stored like a key", () => {
    const side = { type: "button", button: 2, mods: [], pen: true } as const;
    const overrides = withShortcut({}, "tool.highlighter", side, "hold");
    const table = shortcutTable(overrides);
    // Recorded with the pen, a tablet driver's right click finds it too.
    expect(matchShortcut(table, { type: "button", button: 2, mods: [] })).toMatchObject({
      kind: "action",
      row: { mode: "hold", action: { id: "tool.highlighter" } },
    });
    const both = withShortcut(
      overrides,
      "edit.undo",
      { type: "button", button: 2, mods: [] },
      "press",
    );
    expect(matchShortcut(shortcutTable(both), side)).toMatchObject({ kind: "conflict" });
    const stored = parseShortcutOverrides(serializeShortcutOverrides(overrides));
    expect(stored).toEqual(overrides);
  });

  it('reads a stored button, the first build\'s "pointer" too, and refuses a bad one', () => {
    expect(parseInput({ type: "button", button: 5, mods: ["Shift"] })).toEqual({
      type: "button",
      button: 5,
      mods: ["Shift"],
    });
    expect(parseInput({ type: "pointer", button: 2, mods: [] })).toEqual({
      type: "button",
      button: 2,
      mods: [],
    });
    expect(parseInput({ type: "button", button: 0, mods: [] })).toBeNull();
    expect(parseInput({ type: "button", button: 1.5, mods: [] })).toBeNull();
    expect(parseInput({ type: "button", mods: [] })).toBeNull();
  });

  it("writes a button's own name on the ? sheet", () => {
    const overrides = withShortcut(
      {},
      "edit.undo",
      { type: "button", button: 2, mods: [], pen: true },
      "press",
    );
    const groups = boundShortcutGroups(shortcutTable(overrides), SHORTCUT_GROUPS);
    const undo = groups.flatMap((group) => group.shortcuts).find((s) => s.action === "Undo");
    expect(undo?.ways[0]?.keys).toEqual(["Side button"]);
  });
});
