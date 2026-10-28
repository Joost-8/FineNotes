/**
 * This device's shortcut rows (`src/view/shortcut-store.ts`): read once from
 * `localStorage`, written back on every change, and able to put one row or
 * all of them back. The JSON rules are `model/shortcut-bindings.ts`; this
 * pins the storage key and that a broken value is just "no changes".
 */

import { describe, expect, it } from "vitest";
import { SHORTCUTS_STORAGE_KEY } from "../../src/model/shortcut-bindings";
import { ShortcutStore } from "../../src/view/shortcut-store";

class FakeStorage {
  readonly values = new Map<string, string>();
  loads = 0;

  loadLocalStorage(key: string): unknown {
    this.loads++;
    return this.values.get(key) ?? null;
  }

  saveLocalStorage(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const custom = { type: "key" as const, key: "k", mods: [] as const };

describe("the per-device shortcut store", () => {
  it("reads the device's rows under the shortcuts key", () => {
    const storage = new FakeStorage();
    storage.values.set(
      SHORTCUTS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        bindings: { "tool.pen": { input: custom, mode: "press" } },
      }),
    );
    const store = new ShortcutStore(storage);
    expect(store.customized).toBe(1);
    expect(store.table.rows.find((row) => row.action.id === "tool.pen")?.inputs).toEqual([custom]);
  });

  it("is the built-in table when the device has nothing", () => {
    const storage = new FakeStorage();
    const store = new ShortcutStore(storage);
    expect(store.customized).toBe(0);
    expect(store.table.conflicts).toEqual([]);
    expect(storage.loads).toBe(1);
  });

  it("writes a change back at once", () => {
    const storage = new FakeStorage();
    const store = new ShortcutStore(storage);
    store.set("tool.pen", custom, "press");
    expect(store.table.rows.find((row) => row.action.id === "tool.pen")?.inputs).toEqual([custom]);
    expect(storage.values.get(SHORTCUTS_STORAGE_KEY)).toContain('"tool.pen"');
  });

  it("changes only the mode, keeping every built-in input", () => {
    const storage = new FakeStorage();
    const store = new ShortcutStore(storage);
    // The pen has two keys; changing only Press/Hold must not drop one.
    store.setMode("tool.pen", "hold");
    const pen = store.table.rows.find((candidate) => candidate.action.id === "tool.pen");
    expect(pen?.mode).toBe("hold");
    expect(pen?.inputs).toEqual([
      { type: "key", key: "p", mods: [] },
      { type: "key", key: "w", mods: [] },
    ]);
    // A stored mode-only row survives the round trip.
    const again = new ShortcutStore(storage);
    expect(again.table.rows.find((candidate) => candidate.action.id === "tool.pen")?.mode).toBe(
      "hold",
    );
    expect(again.customized).toBe(1);
  });

  it("resets one row, and all of them", () => {
    const storage = new FakeStorage();
    const store = new ShortcutStore(storage);
    store.set("tool.pen", custom, "press");
    store.set("tool.eraser", { type: "key", key: "r", mods: [] }, "press");
    store.reset("tool.pen");
    expect(store.customized).toBe(1);
    store.resetAll();
    expect(store.customized).toBe(0);
    expect(storage.values.get(SHORTCUTS_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, bindings: {} }),
    );
  });

  it("treats a hand-edited value as no changes, not a crash", () => {
    const storage = new FakeStorage();
    storage.values.set(SHORTCUTS_STORAGE_KEY, "{not json");
    const store = new ShortcutStore(storage);
    expect(store.customized).toBe(0);
  });
});
