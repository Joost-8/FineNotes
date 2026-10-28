/**
 * The shortcuts the notebook can run, as data: every tool the tool bar has,
 * every action the keyboard already had, one input each, and whether a tool
 * switches on a press or is lent only while the input is held.
 *
 * This is the customizable layer, not the reference sheet (`./shortcuts.ts`,
 * the list the ? pop-up shows). A row with no user change behaves exactly as
 * the built-in key did; an input the user changed is what the notebook
 * listens for. Per device, because a laptop, an iPad and an Android tablet
 * with a stylus button have different keys.
 *
 * Conflicting rows are invalid: the notebook refuses every input they share
 * until one row is changed, cleared or reset.
 *
 * PURE: no DOM, no Obsidian.
 */

import { type Modifier, keyLabel } from "./shortcuts";

/** A stored input's modifiers, named as the reference sheet names them. */
export type ShortcutModifier = Modifier;

/** A key pressed on its own or with modifiers. `key` is `KeyboardEvent.key`, normalized. */
export interface ShortcutKeyInput {
  type: "key";
  key: string;
  mods: readonly ShortcutModifier[];
}

/** A pen, mouse or stylus button, with the keys held at the time. */
export interface ShortcutPointerInput {
  type: "pointer";
  /** `PointerEvent.button`: 2 barrel, 5 eraser end, 1 middle (never 0: the contact). */
  button: number;
  mods: readonly ShortcutModifier[];
}

export type ShortcutInput = ShortcutKeyInput | ShortcutPointerInput;

/** Press switches to a tool; hold lends it until the input is let go. */
export type ShortcutMode = "press" | "hold";

export interface ShortcutAction {
  /** Stable id: what `localStorage` and the runtime dispatch name. */
  id: string;
  label: string;
  /** The table's heading. */
  group: string;
  /** One line under the name when the label alone is not enough. */
  hint?: string;
  /** Whether Hold means anything: tools and the hand, not one-shot commands. */
  holdable: boolean;
  /** What the notebook does when the row is not customized. */
  defaults: readonly ShortcutInput[];
  /** How the defaults behave (Space for the hand is held). */
  defaultMode: ShortcutMode;
  /**
   * The page's context decides when the built-in key acts (Delete, Copy,
   * Paste): left to `surface-keys.ts` until the row is customized.
   */
  contextual?: boolean;
  /** FineNotes' own list of the inputs, for a row whose user input is cleared. */
  resetHint?: string;
}

// --- The registry -------------------------------------------------------------

const key = (value: string, ...mods: ShortcutModifier[]): ShortcutKeyInput => ({
  type: "key",
  key: normalizeKey(value),
  mods: mods,
});

const NO_INPUTS: readonly ShortcutInput[] = [];

/** Every action, in the table's order. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  // Tools. The keys are the ones `surface-keys.ts` already listens for.
  {
    id: "tool.pen",
    label: "Pen",
    group: "Tools",
    holdable: true,
    defaults: [key("p"), key("w")],
    defaultMode: "press",
  },
  {
    id: "tool.highlighter",
    label: "Highlighter",
    group: "Tools",
    holdable: true,
    defaults: [key("h")],
    defaultMode: "press",
  },
  {
    id: "tool.eraser",
    label: "Eraser",
    group: "Tools",
    holdable: true,
    defaults: [key("e")],
    defaultMode: "press",
  },
  {
    id: "tool.select",
    label: "Lasso",
    group: "Tools",
    holdable: true,
    defaults: [key("v")],
    defaultMode: "press",
  },
  {
    id: "tool.shape",
    label: "Shapes",
    group: "Tools",
    holdable: true,
    defaults: [key("s")],
    defaultMode: "press",
  },
  {
    id: "tool.text",
    label: "Text",
    group: "Tools",
    holdable: true,
    defaults: [key("t")],
    defaultMode: "press",
  },
  {
    id: "tool.laser",
    label: "Laser pointer",
    group: "Tools",
    hint: "A trail that fades; never saved",
    holdable: true,
    defaults: [key("l")],
    defaultMode: "press",
  },
  {
    id: "tool.pan",
    label: "Hand",
    group: "Tools",
    hint: "Hold to move the page while the pen writes",
    holdable: true,
    defaults: [key(" ")],
    defaultMode: "hold",
  },
  {
    id: "tool.zoom",
    label: "Magnifier",
    group: "Tools",
    holdable: true,
    defaults: NO_INPUTS,
    defaultMode: "hold",
  },

  // Saved pens, 1 to 8, as they have always been.
  ...Array.from({ length: 8 }, (_, index): ShortcutAction => {
    const number = index + 1;
    return {
      id: `pen.saved.${number}`,
      label: `Saved pen ${number}`,
      group: "Saved pens",
      holdable: false,
      defaults: [key(String(number))],
      defaultMode: "press",
    };
  }),

  // The actions the keyboard already had.
  {
    id: "edit.undo",
    label: "Undo",
    group: "Selection and editing",
    holdable: false,
    defaults: [key("z", "Mod")],
    defaultMode: "press",
  },
  {
    id: "edit.redo",
    label: "Redo",
    group: "Selection and editing",
    holdable: false,
    defaults: [key("z", "Mod", "Shift")],
    defaultMode: "press",
    resetHint: "Ctrl + Shift + Z; Ctrl + Y also redoes",
  },
  {
    id: "edit.select-all",
    label: "Select everything on the page",
    group: "Selection and editing",
    holdable: false,
    defaults: [key("a", "Mod")],
    defaultMode: "press",
  },
  {
    id: "edit.delete",
    label: "Delete the selection",
    group: "Selection and editing",
    holdable: false,
    defaults: [key("Delete"), key("Backspace")],
    defaultMode: "press",
    contextual: true,
  },
  {
    id: "edit.copy",
    label: "Copy",
    group: "Selection and editing",
    holdable: false,
    defaults: [key("c", "Mod")],
    defaultMode: "press",
    contextual: true,
  },
  {
    id: "edit.cut",
    label: "Cut",
    group: "Selection and editing",
    holdable: false,
    defaults: [key("x", "Mod")],
    defaultMode: "press",
    contextual: true,
  },
  {
    id: "edit.paste",
    label: "Paste",
    group: "Selection and editing",
    holdable: false,
    defaults: [key("v", "Mod")],
    defaultMode: "press",
    contextual: true,
  },
  {
    id: "edit.turn-into-text",
    label: "Turn the selection into text",
    group: "Selection and editing",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },

  // View and zoom.
  {
    id: "view.zoom-in",
    label: "Zoom in",
    group: "View and zoom",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "view.zoom-out",
    label: "Zoom out",
    group: "View and zoom",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "view.zoom-fit",
    label: "Fit the page",
    group: "View and zoom",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "view.next-page",
    label: "Next page",
    group: "View and zoom",
    holdable: false,
    defaults: [key("PageDown")],
    defaultMode: "press",
  },
  {
    id: "view.previous-page",
    label: "Previous page",
    group: "View and zoom",
    holdable: false,
    defaults: [key("PageUp")],
    defaultMode: "press",
  },
  {
    id: "view.fullscreen",
    label: "Full screen",
    group: "View and zoom",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "view.shortcuts",
    label: "Show the shortcut sheet",
    group: "View and zoom",
    holdable: false,
    defaults: [key("?")],
    defaultMode: "press",
  },

  // Tool bar items that are actions rather than tools.
  {
    id: "bar.image",
    label: "Insert image",
    group: "Tool bar actions",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.pdf",
    label: "Insert PDF",
    group: "Tool bar actions",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.sticker",
    label: "Stickers",
    group: "Tool bar actions",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.sticky",
    label: "Sticky notes",
    group: "Tool bar actions",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.ruler",
    label: "Ruler",
    group: "Tool bar actions",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.record",
    label: "Record audio",
    group: "Tool bar actions",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.stylus",
    label: "Stylus only mode",
    group: "Tool bar actions",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
];

/** The registry by id, for reading stored rows. */
export const SHORTCUT_ACTIONS_BY_ID: ReadonlyMap<string, ShortcutAction> = new Map(
  SHORTCUT_ACTIONS.map((action) => [action.id, action]),
);

/** The table's headings, in order, with the actions under each. */
export const SHORTCUT_ACTION_GROUPS: readonly {
  title: string;
  actions: readonly ShortcutAction[];
}[] = ["Tools", "Saved pens", "Selection and editing", "View and zoom", "Tool bar actions"].map(
  (title) => ({
    title,
    actions: SHORTCUT_ACTIONS.filter((action) => action.group === title),
  }),
);

// --- Inputs -------------------------------------------------------------------

const MODIFIERS: readonly ShortcutModifier[] = ["Mod", "Alt", "Shift"];

/** Whether `value` is a modifier this module knows. */
export function isShortcutModifier(value: unknown): value is ShortcutModifier {
  return (MODIFIERS as readonly unknown[]).includes(value);
}

/** Modifiers in the one order the table writes them, each once. */
export function normalizeMods(mods: readonly ShortcutModifier[]): ShortcutModifier[] {
  return MODIFIERS.filter((mod) => mods.includes(mod));
}

/** `KeyboardEvent.key` as the table stores it: the same spelling on every layout's row. */
export function normalizeKey(value: string): string {
  if (value === "Spacebar" || value === "Space") return " ";
  if (value === "Esc") return "Escape";
  if (value === "Del") return "Delete";
  if (value === "Left") return "ArrowLeft";
  if (value === "Right") return "ArrowRight";
  if (value === "Up") return "ArrowUp";
  if (value === "Down") return "ArrowDown";
  // A physical code names the same key as its character does.
  if (/^Key[A-Z]$/.test(value)) return value.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(value)) return value.slice(5);
  if (/^[A-Z]$/.test(value)) return value.toLowerCase();
  return value;
}

/** A modifier pressed alone, which is not a shortcut until it is let go. */
export function isModifierKey(value: string): boolean {
  return (
    value === "Shift" ||
    value === "Control" ||
    value === "Alt" ||
    value === "Meta" ||
    value === "AltGraph"
  );
}

/**
 * The part of a `KeyboardEvent` this module reads. `key` is the character
 * produced, not the physical key: a Bluetooth or Android stylus that sends
 * its own key names is stored exactly as it sends them.
 */
export interface KeyboardReading {
  key: string;
  /**
   * `KeyboardEvent.code`, read only when `key` says nothing: an Android or
   * Bluetooth stylus may send a button as a key with no character.
   */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The parts of a `PointerEvent` or `MouseEvent` this module reads. */
export interface PointerReading {
  button: number;
  buttons?: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * A key press as one input, or null for a bare modifier (nothing to bind
 * yet). Shift is a modifier for letters, digits and named keys; a character
 * that already carries it (`?`, `+`) does not get a second Shift.
 */
export function keyInput(reading: KeyboardReading): ShortcutKeyInput | null {
  if (isModifierKey(reading.key)) return null;
  const raw = reading.key && reading.key !== "Unidentified" ? reading.key : (reading.code ?? "");
  const value = normalizeKey(raw);
  if (!value) return null;
  const mods: ShortcutModifier[] = [];
  // Ctrl and Cmd are one "Mod", as Obsidian names them: ⌘ on Apple devices.
  if (reading.metaKey || reading.ctrlKey) mods.push("Mod");
  if (reading.altKey) mods.push("Alt");
  if (reading.shiftKey && shiftIsSeparate(value)) mods.push("Shift");
  return { type: "key", key: value, mods };
}

/** The `buttons` bit of a pen's eraser end. */
const ERASER_BIT = 32;

/**
 * A pen, stylus or mouse button as one input, or null for the primary
 * contact (left click, the pen's tip): that is drawing, never a shortcut.
 * The eraser end is accepted even where a driver reports it as button 0 with
 * the eraser bit set.
 */
export function pointerInput(reading: PointerReading): ShortcutPointerInput | null {
  const eraser = reading.button === 5 || ((reading.buttons ?? 0) & ERASER_BIT) !== 0;
  if (reading.button === 0 && !eraser) return null;
  if (!Number.isInteger(reading.button) || reading.button < 0) return null;
  const mods: ShortcutModifier[] = [];
  if (reading.metaKey || reading.ctrlKey) mods.push("Mod");
  if (reading.altKey) mods.push("Alt");
  if (reading.shiftKey) mods.push("Shift");
  // Drivers that report the eraser end as button 0 still store it as the
  // eraser's own button, so it survives a save and matches the next one.
  return { type: "pointer", button: eraser && reading.button === 0 ? 5 : reading.button, mods };
}

/** Whether Shift changes the key rather than merely accompanying it. */
function shiftIsSeparate(value: string): boolean {
  if (value.length !== 1) return true;
  return /[a-z0-9]/.test(value);
}

/** One input's identity, for maps and conflicts. */
export function inputKey(input: ShortcutInput): string {
  const mods = normalizeMods(input.mods).join("+");
  return input.type === "key" ? `key:${mods}:${input.key}` : `pointer:${mods}:${input.button}`;
}

/** Whether two inputs are the same one. */
export function sameInput(a: ShortcutInput, b: ShortcutInput): boolean {
  return inputKey(a) === inputKey(b);
}

// --- Labels -------------------------------------------------------------------

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Escape: "Esc",
  Backspace: "Backspace",
  Enter: "Return",
  Tab: "Tab",
  AudioVolumeUp: "Volume Up",
  AudioVolumeDown: "Volume Down",
  AudioVolumeMute: "Mute",
  MediaPlayPause: "Play/Pause",
  MediaTrackNext: "Next track",
  MediaTrackPrevious: "Previous track",
};

/** A key as its key cap shows it. */
export function keyCap(value: string): string {
  if (value.length === 1 && /[a-z]/.test(value)) return value.toUpperCase();
  return KEY_NAMES[value] ?? value;
}

/** One input as key caps and words, e.g. `["Ctrl", "Shift", "Z"]`. */
export function inputCaps(input: ShortcutInput, apple: boolean): string[] {
  const mods = normalizeMods(input.mods).map((mod) => keyLabel(mod, apple));
  if (input.type === "pointer") {
    if (input.button === 5) return [...mods, "Eraser end"];
    if (input.button === 2) return [...mods, "Pen button 2"];
    return [...mods, `Button ${input.button}`];
  }
  return [...mods, keyCap(input.key)];
}

/** An input as one line, as Obsidian prints a hotkey. */
export function inputText(input: ShortcutInput, apple: boolean): string {
  return inputCaps(input, apple).join(apple ? " " : " + ");
}

/** A row's input as one line: its ways with "or", or "Not set". */
export function inputsText(inputs: readonly ShortcutInput[], apple: boolean): string {
  if (inputs.length === 0) return "Not set";
  return inputs.map((input) => inputText(input, apple)).join(" or ");
}

// --- User changes and the effective table -------------------------------------

/** A row the user changed: one input (or none) and how it triggers. */
export interface ShortcutOverride {
  /**
   * null clears the row; left out when the user changed only Press/Hold, so
   * a tool with two built-in keys (the pen's P and W) keeps both.
   */
  input?: ShortcutInput | null;
  mode: ShortcutMode;
}

export type ShortcutOverrides = Record<string, ShortcutOverride>;

/** The version `localStorage` writes; a different one falls back to defaults. */
export const SHORTCUT_STORAGE_VERSION = 1;

/** The `localStorage` key, per device, as the other per-device settings are. */
export const SHORTCUTS_STORAGE_KEY = "goodobsidian:shortcuts";

export interface ShortcutRow {
  action: ShortcutAction;
  /** The inputs in force: the default ones, or the one the user recorded. */
  inputs: readonly ShortcutInput[];
  mode: ShortcutMode;
  /** The user changed this row (input or mode). */
  customized: boolean;
  /** Another row shares one of its inputs. */
  conflicted: boolean;
  /** The page's context decides when its default keys act. */
  contextual: boolean;
}

export interface ShortcutConflict {
  key: string;
  input: ShortcutInput;
  rows: readonly ShortcutRow[];
}

export interface ShortcutTable {
  rows: readonly ShortcutRow[];
  byInput: ReadonlyMap<string, readonly ShortcutRow[]>;
  /** Default inputs an override took away, unless another row still uses them. */
  blocked: ReadonlySet<string>;
  conflicts: readonly ShortcutConflict[];
  customized: number;
}

/** The inputs and mode a row has, before conflicts are looked for. */
function effective(
  action: ShortcutAction,
  overrides: ShortcutOverrides,
): {
  inputs: readonly ShortcutInput[];
  mode: ShortcutMode;
  customized: boolean;
} {
  const override = overrides[action.id];
  if (!override) {
    return { inputs: action.defaults, mode: action.defaultMode, customized: false };
  }
  return {
    inputs: override.input === undefined ? action.defaults : override.input ? [override.input] : [],
    mode: action.holdable ? override.mode : "press",
    customized: true,
  };
}

/**
 * Every row as it now is, the inputs they share, and the default inputs an
 * override took away. A row is conflicted when any of its inputs is shared,
 * and all of its inputs then do nothing.
 */
export function shortcutTable(overrides: ShortcutOverrides = {}): ShortcutTable {
  const rows: ShortcutRow[] = SHORTCUT_ACTIONS.map((action) => {
    const { inputs, mode, customized } = effective(action, overrides);
    return {
      action,
      inputs,
      mode,
      customized,
      conflicted: false,
      contextual: action.contextual === true && !customized,
    };
  });
  const byInput = new Map<string, ShortcutRow[]>();
  for (const row of rows) {
    for (const input of row.inputs) {
      const key = inputKey(input);
      const found = byInput.get(key);
      if (found) found.push(row);
      else byInput.set(key, [row]);
    }
  }
  const conflicts: ShortcutConflict[] = [];
  for (const [key, shared] of byInput) {
    if (shared.length < 2) continue;
    for (const row of shared) row.conflicted = true;
    const input = shared[0]?.inputs.find((candidate) => inputKey(candidate) === key);
    if (input) conflicts.push({ key, input, rows: shared });
  }
  const blocked = new Set<string>();
  for (const action of SHORTCUT_ACTIONS) {
    if (!overrides[action.id]) continue;
    for (const input of action.defaults) {
      const key = inputKey(input);
      if (!byInput.has(key)) blocked.add(key);
    }
  }
  return {
    rows,
    byInput,
    blocked,
    conflicts,
    customized: rows.filter((row) => row.customized).length,
  };
}

/** What an input does now: one action, a conflict, an input an override freed, or nothing. */
export type ShortcutMatch =
  | { kind: "action"; row: ShortcutRow }
  | { kind: "conflict"; rows: readonly ShortcutRow[] }
  | { kind: "blocked" };

/**
 * The action `input` runs, if any. Conflicted rows never run, nor does an
 * input a user took away from its default action.
 */
export function matchShortcut(table: ShortcutTable, input: ShortcutInput): ShortcutMatch | null {
  const key = inputKey(input);
  const rows = table.byInput.get(key);
  if (rows && rows.length > 0) {
    if (rows.length > 1 || rows.some((row) => row.conflicted)) return { kind: "conflict", rows };
    return { kind: "action", row: rows[0] };
  }
  if (table.blocked.has(key)) return { kind: "blocked" };
  return null;
}

// --- Storing ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A stored input, if it is one this build knows. */
export function parseInput(raw: unknown): ShortcutInput | null {
  if (!isRecord(raw)) return null;
  const mods = Array.isArray(raw.mods) ? raw.mods.filter(isShortcutModifier) : [];
  if (raw.type === "key") {
    if (typeof raw.key !== "string" || raw.key.length === 0) return null;
    return { type: "key", key: raw.key, mods: normalizeMods(mods) };
  }
  if (raw.type === "pointer") {
    if (!Number.isInteger(raw.button) || (raw.button as number) < 1) return null;
    return { type: "pointer", button: raw.button as number, mods: normalizeMods(mods) };
  }
  return null;
}

/**
 * What this device stored, or no changes at all when it has nothing usable
 * yet (a fresh install, a hand-edited value, a shape from a later build).
 */
export function parseShortcutOverrides(raw: unknown): ShortcutOverrides {
  let value = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!isRecord(value)) return {};
  if (value.version !== undefined && value.version !== SHORTCUT_STORAGE_VERSION) return {};
  const stored = value.bindings;
  if (!isRecord(stored)) return {};
  const overrides: ShortcutOverrides = {};
  for (const [id, entry] of Object.entries(stored)) {
    const action = SHORTCUT_ACTIONS_BY_ID.get(id);
    if (!action || !isRecord(entry)) continue;
    const keepInputs = !("input" in entry);
    const input = keepInputs ? undefined : entry.input === null ? null : parseInput(entry.input);
    // A row that names an input this build cannot read is ignored, not cleared.
    if (!keepInputs && entry.input !== null && input === null) continue;
    const mode: ShortcutMode = action.holdable && entry.mode === "hold" ? "hold" : "press";
    overrides[id] = keepInputs ? { mode } : { input, mode };
  }
  return overrides;
}

/** The JSON this device keeps. Only changed rows are written. */
export function serializeShortcutOverrides(overrides: ShortcutOverrides): string {
  return JSON.stringify({
    version: SHORTCUT_STORAGE_VERSION,
    bindings: overrides,
  });
}

/** `overrides` with `actionId` bound to `input` in `mode` (null clears it). */
export function withShortcut(
  overrides: ShortcutOverrides,
  actionId: string,
  input: ShortcutInput | null,
  mode: ShortcutMode = "press",
): ShortcutOverrides {
  const action = SHORTCUT_ACTIONS_BY_ID.get(actionId);
  if (!action) return overrides;
  return {
    ...overrides,
    [actionId]: {
      input: input ? { ...input, mods: normalizeMods(input.mods) } : null,
      mode: action.holdable && mode === "hold" ? "hold" : "press",
    },
  };
}

/**
 * `overrides` with just `actionId`'s Press/Hold changed. The input is left
 * alone: a row the user has not recorded a key for keeps all its built-in
 * keys (the pen's P and W), and a cleared row stays cleared.
 */
export function withMode(
  overrides: ShortcutOverrides,
  actionId: string,
  mode: ShortcutMode,
): ShortcutOverrides {
  const action = SHORTCUT_ACTIONS_BY_ID.get(actionId);
  if (!action || !action.holdable) return overrides;
  const nextMode: ShortcutMode = mode === "hold" ? "hold" : "press";
  const existing = overrides[actionId];
  return {
    ...overrides,
    [actionId]: existing ? { ...existing, mode: nextMode } : { mode: nextMode },
  };
}

/** `overrides` with `actionId` back to its defaults. */
export function withoutShortcut(overrides: ShortcutOverrides, actionId: string): ShortcutOverrides {
  if (!(actionId in overrides)) return overrides;
  const next = { ...overrides };
  delete next[actionId];
  return next;
}

/** No changes: every row back to the built-in keys. */
export function noShortcutOverrides(): ShortcutOverrides {
  return {};
}
