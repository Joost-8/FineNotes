import { describe, expect, it } from "vitest";
import { FAST_WAY_SHORTCUTS, fastKeys, withKeys } from "../../src/model/fast-ways";
import { SHORTCUT_ACTIONS_BY_ID, shortcutTable } from "../../src/model/shortcut-bindings";

describe("fast ways", () => {
  it("names only shortcut rows that exist", () => {
    for (const id of Object.values(FAST_WAY_SHORTCUTS)) {
      expect(SHORTCUT_ACTIONS_BY_ID.has(id), id).toBe(true);
    }
  });

  it("reads the default key as this device writes it", () => {
    const table = shortcutTable();
    expect(fastKeys("copy", table, false)).toBe("Ctrl + C");
    expect(fastKeys("copy", table, true)).toBe("⌘ C");
    expect(fastKeys("delete", table, false)).toBe("Delete");
  });

  it("shows the key the user chose, and nothing for a key they took away", () => {
    const moved = shortcutTable({
      "edit.copy": { input: { type: "key", key: "k", mods: ["Mod"] }, mode: "press" },
    });
    expect(fastKeys("copy", moved, false)).toBe("Ctrl + K");
    const gone = shortcutTable({ "edit.copy": { input: null, mode: "press" } });
    expect(fastKeys("copy", gone, false)).toBeNull();
  });

  it("says nothing for a key two rows share, an entry without one, or no table", () => {
    const shared = shortcutTable({
      "edit.cut": { input: { type: "key", key: "c", mods: ["Mod"] }, mode: "press" },
    });
    expect(fastKeys("copy", shared, false)).toBeNull();
    expect(fastKeys("duplicate", shortcutTable(), false)).toBeNull();
    expect(fastKeys("copy", null, false)).toBeNull();
  });

  it("puts the key after the label", () => {
    expect(withKeys("Copy", "Ctrl + C")).toBe("Copy (Ctrl + C)");
    expect(withKeys("Copy", null)).toBe("Copy");
  });
});
