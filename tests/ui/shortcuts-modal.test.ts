/**
 * The shortcuts pop-up (`src/ui/shortcuts-modal.ts`): the settings' list,
 * keys named by platform, and ? closing it as it opened it.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../fakes/obsidian"));

const { ShortcutsModal } = await import("../../src/ui/shortcuts-modal");
const { SHORTCUT_GROUPS } = await import("../../src/model/shortcuts");

type Modal = {
  shown: boolean;
  modalEl: { hasClass: (c: string) => boolean };
  titleEl: { text: string };
  contentEl: {
    findAll: (
      c: string,
    ) => Array<{ text: string; findAll: (c: string) => Array<{ text: string }> }>;
    children: unknown[];
  };
  scopeKeys: Array<{ modifiers: unknown; key: string | null; run: () => unknown }>;
  isOpen: boolean;
};

function open(apple: boolean): Modal {
  const modal = new ShortcutsModal({} as never, apple);
  modal.open();
  return modal as unknown as Modal;
}

describe("the shortcuts pop-up", () => {
  it("lists every group of the settings' list", () => {
    const modal = open(false);
    expect(modal.shown).toBe(true);
    expect(modal.titleEl.text).toBe("Keyboard and stylus shortcuts");
    expect(modal.modalEl.hasClass("goodobsidian-shortcuts-modal")).toBe(true);
    expect(
      modal.contentEl.findAll("goodobsidian-shortcut-group-title").map((el) => el.text),
    ).toEqual(SHORTCUT_GROUPS.map((group) => group.title));
    expect(modal.contentEl.findAll("goodobsidian-shortcut")).toHaveLength(
      SHORTCUT_GROUPS.reduce((n, group) => n + group.shortcuts.length, 0),
    );
  });

  it("names Ctrl, or ⌘ on a Mac or an iPad", () => {
    const keysOf = (modal: Modal) =>
      modal.contentEl.findAll("goodobsidian-key").map((el) => el.text);
    expect(keysOf(open(false))).toContain("Ctrl");
    expect(keysOf(open(false))).not.toContain("⌘");
    expect(keysOf(open(true))).toContain("⌘");
    expect(keysOf(open(true))).not.toContain("Ctrl");
  });

  it("closes on ?, and empties itself", () => {
    const modal = open(true);
    const question = modal.scopeKeys.find((k) => k.key === "?");
    expect(question?.modifiers).toBeNull();
    expect(question?.run()).toBe(false);
    expect(modal.shown).toBe(false);
    expect(modal.isOpen).toBe(false);
    expect(modal.contentEl.children).toEqual([]);
  });
});
