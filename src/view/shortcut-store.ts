/**
 * This device's shortcut changes (`model/shortcut-bindings.ts`), kept in
 * `localStorage` rather than the synced `data.json`: a laptop's keyboard and
 * an Android tablet's stylus button are not the same hardware, and syncing
 * one device's keys to the other only breaks both.
 *
 * The plugin owns one, `plugin.shortcuts`, so the settings tab, every open
 * notebook and a newly opened one all read the same rows.
 */

import {
  type ShortcutInput,
  type ShortcutMode,
  type ShortcutOverrides,
  type ShortcutTable,
  SHORTCUTS_STORAGE_KEY,
  noShortcutOverrides,
  parseShortcutOverrides,
  serializeShortcutOverrides,
  shortcutTable,
  withMode,
  withShortcut,
  withoutShortcut,
} from "../model/shortcut-bindings";

/** What the store needs of Obsidian's device-local storage. */
export interface LocalStorageHost {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, value: string): void;
}

/** The shortcut rows as this device has them, and the one way to change them. */
export class ShortcutStore {
  private overrides: ShortcutOverrides;
  private cached: ShortcutTable | null = null;

  constructor(private readonly host: LocalStorageHost) {
    this.overrides = parseShortcutOverrides(host.loadLocalStorage(SHORTCUTS_STORAGE_KEY));
  }

  /** Every row, its effective input and the conflicts between them. */
  get table(): ShortcutTable {
    this.cached ??= shortcutTable(this.overrides);
    return this.cached;
  }

  /** Whether the user changed anything on this device. */
  get customized(): number {
    return this.table.customized;
  }

  /** Bind `actionId` to `input`, or clear it with null; `mode` is Press or Hold. */
  set(actionId: string, input: ShortcutInput | null, mode: ShortcutMode): void {
    this.replace(withShortcut(this.overrides, actionId, input, mode));
  }

  /** Change only how a row triggers, keeping every input it has. */
  setMode(actionId: string, mode: ShortcutMode): void {
    this.replace(withMode(this.overrides, actionId, mode));
  }

  /** Put one row back to FineNotes' own keys. */
  reset(actionId: string): void {
    this.replace(withoutShortcut(this.overrides, actionId));
  }

  /** Put every row back. */
  resetAll(): void {
    this.replace(noShortcutOverrides());
  }

  private replace(next: ShortcutOverrides): void {
    this.overrides = next;
    this.cached = null;
    this.host.saveLocalStorage(SHORTCUTS_STORAGE_KEY, serializeShortcutOverrides(next));
  }
}
