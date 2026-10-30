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
 * Keys and buttons: a right click, a pen's side button or eraser end, a
 * mouse's middle, back and forward buttons. A pen's side button nobody
 * recorded keeps its own two settings (`input/pen-modifiers.ts`,
 * `input/stylus-click.ts`); a recorded one wins over them.
 *
 * Conflicting rows are invalid: the notebook refuses every input they share
 * until one row is changed or reset.
 *
 * PURE: no DOM, no Obsidian.
 */

import { type Modifier, type Shortcut, type ShortcutGroup, keyLabel } from "./shortcuts";

/** A stored input's modifiers, named as the reference sheet names them. */
export type ShortcutModifier = Modifier;

/** A key pressed on its own or with modifiers. `key` is `KeyboardEvent.key`, normalized. */
export interface ShortcutKeyInput {
  type: "key";
  key: string;
  mods: readonly ShortcutModifier[];
}

/**
 * A pen or mouse button other than the contact (or left button), with the
 * keys held at the time. The same button of a pen and a mouse is one input:
 * a tablet driver may send the side button as a right click.
 */
export interface ShortcutButtonInput {
  type: "button";
  /**
   * `PointerEvent.button`: 2 a right click or a pen's side button, 1 the
   * middle button, 3 back, 4 forward, 5 a pen's eraser end. Never 0.
   */
  button: number;
  mods: readonly ShortcutModifier[];
  /** Recorded with a pen: it is named as the pen's ("Side button"), nothing more. */
  pen?: boolean;
}

/** One input: a key or a button. */
export type ShortcutInput = ShortcutKeyInput | ShortcutButtonInput;

/** Press switches to a tool; hold lends it until the input is let go. */
export type ShortcutMode = "press" | "hold";

export interface ShortcutAction {
  /** Stable id: what `localStorage` and the runtime dispatch name. */
  id: string;
  label: string;
  /** The table's heading. */
  group: string;
  /** What the row's ⓘ says, when the label alone is not enough. */
  hint?: string;
  /**
   * Whether Hold means anything: a tool, which the key puts in hand while it
   * is down (its own gesture and ink), not a one-shot command.
   */
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

  // Tool bar items that are actions rather than tools: they are tools too.
  {
    id: "bar.image",
    label: "Insert image",
    group: "Tools",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.pdf",
    label: "Insert PDF",
    group: "Tools",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.sticker",
    label: "Stickers",
    group: "Tools",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.sticky",
    label: "Sticky notes",
    group: "Tools",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.ruler",
    label: "Ruler",
    group: "Tools",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.record",
    label: "Record audio",
    group: "Tools",
    holdable: false,
    defaults: NO_INPUTS,
    defaultMode: "press",
  },
  {
    id: "bar.stylus",
    label: "Stylus only mode",
    group: "Tools",
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
}[] = ["Tools", "Saved pens", "Selection and editing", "View and zoom"].map((title) => ({
  title,
  actions: SHORTCUT_ACTIONS.filter((action) => action.group === title),
}));

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

/** Whether Shift changes the key rather than merely accompanying it. */
function shiftIsSeparate(value: string): boolean {
  if (value.length !== 1) return true;
  return /[a-z0-9]/.test(value);
}

/** The parts of a `PointerEvent` a button press is read from. */
export interface PointerReading {
  pointerType: string;
  /** The button that changed (0 contact or left, 2 side or right, 5 eraser end). */
  button: number;
  /** Every button held, as a bit set (1 contact, 2 side or right, 32 eraser end). */
  buttons: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** `buttons` bit of a pen's side button, or a mouse's right one. */
const SIDE_BIT = 2;
/** `buttons` bit of a pen's eraser end. */
const ERASER_BIT = 32;
/** `button` of a pen's eraser end. */
const ERASER_BUTTON = 5;

/**
 * A press of a button that can be a shortcut, or null for the contact (a
 * pen touching, a left click, a finger). A pen that touches down with its
 * side button or eraser end held reports `button` 0 on some drivers: its
 * `buttons` say which.
 */
export function buttonInput(reading: PointerReading): ShortcutButtonInput | null {
  if (reading.pointerType === "touch") return null;
  const pen = reading.pointerType === "pen";
  let button = reading.button;
  if (pen && ((reading.buttons & ERASER_BIT) !== 0 || button === ERASER_BUTTON)) {
    button = ERASER_BUTTON;
  } else if (pen && button <= 0 && (reading.buttons & SIDE_BIT) !== 0) {
    button = 2;
  }
  if (!Number.isInteger(button) || button < 1) return null;
  const mods: ShortcutModifier[] = [];
  if (reading.metaKey || reading.ctrlKey) mods.push("Mod");
  if (reading.altKey) mods.push("Alt");
  if (reading.shiftKey) mods.push("Shift");
  const input: ShortcutButtonInput = { type: "button", button, mods };
  if (pen) input.pen = true;
  return input;
}

/** The `buttons` bit of a button, to see when it is let go. */
export function buttonBit(button: number): number {
  switch (button) {
    case 1:
      return 4;
    case 2:
      return SIDE_BIT;
    case 5:
      return ERASER_BIT;
    default:
      return button >= 3 && button <= 4 ? 1 << button : 0;
  }
}

/** One input's identity, for maps and conflicts. */
export function inputKey(input: ShortcutInput): string {
  const mods = normalizeMods(input.mods).join("+");
  return input.type === "key" ? `key:${mods}:${input.key}` : `button:${mods}:${input.button}`;
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

/** A button as its chip names it. */
export function buttonCap(input: ShortcutButtonInput): string {
  switch (input.button) {
    case 1:
      return "Middle click";
    case 2:
      return input.pen ? "Side button" : "Right click";
    case 3:
      return "Back button";
    case 4:
      return "Forward button";
    case 5:
      return "Eraser end";
    default:
      return `Button ${input.button}`;
  }
}

/** The last cap of an input: its key or its button. */
function mainCap(input: ShortcutInput): string {
  return input.type === "key" ? keyCap(input.key) : buttonCap(input);
}

/** One input as key caps and words, e.g. `["Ctrl", "Shift", "Z"]`. */
export function inputCaps(input: ShortcutInput, apple: boolean): string[] {
  const mods = normalizeMods(input.mods).map((mod) => keyLabel(mod, apple));
  return [...mods, mainCap(input)];
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
  // "pointer" is what the first build of this table (#69) stored a button as.
  if (raw.type === "button" || raw.type === "pointer") {
    const button = raw.button;
    if (typeof button !== "number" || !Number.isInteger(button) || button < 1) return null;
    const input: ShortcutButtonInput = { type: "button", button, mods: normalizeMods(mods) };
    if (raw.pen === true) input.pen = true;
    return input;
  }
  if (raw.type !== "key" || typeof raw.key !== "string" || raw.key.length === 0) return null;
  return { type: "key", key: raw.key, mods: normalizeMods(mods) };
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

// --- The reference sheet ------------------------------------------------------

/** A recorded input as the sheet writes a way: modifiers by name, then the key cap. */
function sheetKeys(input: ShortcutInput): string[] {
  return [...normalizeMods(input.mods), mainCap(input)];
}

/**
 * The ? sheet (`./shortcuts.ts`) with this device's own keys: a line whose
 * row the user changed shows the inputs in force (none: the line goes), and
 * a held tool keeps the line's gesture ("Space + drag"). Saved pens are one
 * line, "1 – 8", until one of them is changed; then each is its own. Lines
 * nobody changed stay as written.
 */
export function boundShortcutGroups(
  table: ShortcutTable,
  groups: readonly ShortcutGroup[],
): ShortcutGroup[] {
  const rows = new Map(table.rows.map((row) => [row.action.id, row]));
  const bound = (shortcut: Shortcut): Shortcut[] => {
    const id = shortcut.binding;
    if (id === "pen.saved") {
      const pens = table.rows.filter((row) => row.action.id.startsWith("pen.saved."));
      if (!pens.some((row) => row.customized)) return [shortcut];
      return pens
        .filter((row) => row.inputs.length > 0)
        .map((row) => ({
          action: row.action.label,
          ways: row.inputs.map((input) => ({ keys: sheetKeys(input) })),
        }));
    }
    const row = id ? rows.get(id) : undefined;
    if (!row?.customized) return [shortcut];
    if (row.inputs.length === 0) return [];
    const gesture = row.mode === "hold" ? shortcut.ways[0]?.gesture : undefined;
    return [
      {
        action: shortcut.action,
        ways: row.inputs.map((input) => ({ keys: sheetKeys(input), gesture })),
      },
    ];
  };
  return groups.map((group) => ({ title: group.title, shortcuts: group.shortcuts.flatMap(bound) }));
}
