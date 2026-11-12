/**
 * The feature index: one record per thing FineNotes can do, joining what was
 * five unconnected lists (a tip, a setting, a command, a shortcut, a menu
 * row). Search reads it, a tip's button acts through it, and a link names a
 * feature by its id. PURE.
 *
 * Every tip is a feature. A switch in settings that has no tip is one too,
 * so "can it do X?" finds an off-by-default switch as well.
 */

import type { TextKey } from "../i18n/translate";
import type { NudgeEvent } from "./nudges";
import { RELEASE_HIGHLIGHTS, TIP_COLLECTIONS, type Tip, type TipCollection } from "./tips";

/** What a feature's one button does. */
export type FeatureAction =
  /**
   * A switch in settings (`key` in the plugin's settings, or `penGestures.<name>`
   * for a pen gesture's switch): turned on or off in place.
   */
  | { kind: "setting"; key: string; name: TextKey }
  /** A command of this plugin, by its id without the plugin's prefix. */
  | { kind: "command"; id: string };

/**
 * A gesture done on a page: Try it opens a scratch page with the tip's
 * picture over it. `done` is the event that says it was done (nudges.ts),
 * which marks it ✓; null where nothing reports it, and Done ends the try.
 */
export interface TryOn {
  done: NudgeEvent | null;
}

/** The key of a pen gesture's switch, `penGestures.circleLasso`, as a setting action names it. */
export const PEN_GESTURE_PREFIX = "penGestures.";

/**
 * A switch's value in `settings`: a top-level key, or one pen gesture
 * (`penGestures.circleLasso`), whose missing value is `fallback`'s. Undefined
 * when the key names no on/off setting.
 */
export function switchValue(
  settings: Readonly<Record<string, unknown>>,
  key: string,
  fallback: Readonly<Record<string, boolean>> = {},
): boolean | undefined {
  if (key.startsWith(PEN_GESTURE_PREFIX)) {
    const name = key.slice(PEN_GESTURE_PREFIX.length);
    const gestures = settings.penGestures;
    const value =
      gestures && typeof gestures === "object"
        ? (gestures as Record<string, unknown>)[name]
        : undefined;
    if (typeof value === "boolean") return value;
    return Object.prototype.hasOwnProperty.call(fallback, name) ? fallback[name] : undefined;
  }
  const value = settings[key];
  return typeof value === "boolean" ? value : undefined;
}

export interface Feature {
  id: string;
  title: TextKey;
  body: TextKey;
  /** Its moving picture, when it has one. */
  tip: Tip | null;
  /** The Tips collection it sits in, when it sits in one. */
  collection: TipCollection | null;
  action: FeatureAction | null;
  /** A gesture to try on a scratch page; null when the tip is not one. */
  tryOn: TryOn | null;
  /** More words a search may use, English only. */
  also: string;
}

/** `name` is the switch's own name in settings, said beside it where the tip's title is not it. */
const setting = (key: string, name: TextKey): FeatureAction => ({ kind: "setting", key, name });
const command = (id: string): FeatureAction => ({ kind: "command", id });

/** What a tip's button does. Each line was checked against the setting or command it names. */
const TIP_ACTIONS: Readonly<Record<string, FeatureAction>> = {
  searchInk: command("search-notebook"),
  stylusOnly: command("toggle-only-stylus-mode"),
  customizeBar: command("customize-toolbar"),
  shortcutSheet: command("show-keyboard-shortcuts"),
  copyPageLink: command("copy-page-link"),
  copyHighlighted: command("copy-highlighted-text"),
  scan: command("scan-document"),
  dropPdf: command("import-pdf"),
  plainExport: command("export-pdf"),
  pictureExport: command("export-pdf"),
  saveTemplate: command("save-page-as-template"),
  learnWriting: command("learn-handwriting"),
  homeSearch: command("open-library"),
  calc: setting("calcNotes", "settings.calcNotes.name"),
  // The pen gestures' own switches, from the pen's ⌄ › Pen gestures.
  scribble: setting(`${PEN_GESTURE_PREFIX}scribbleErase`, "toolbar.gesture.scribbleErase"),
  scribbleFill: setting(`${PEN_GESTURE_PREFIX}scribbleFill`, "toolbar.gesture.scribbleFill"),
  circleLasso: setting(`${PEN_GESTURE_PREFIX}circleLasso`, "toolbar.gesture.circleLasso"),
};

const tryIt = (done: NudgeEvent | null = null): TryOn => ({ done });

/**
 * The tips that are a gesture on a page, which a blank page with a little
 * writing on it is enough to try. The events are the ones the earned hints
 * already count (ink-surface.ts, ink-view.ts `noteUse`).
 */
const TIP_TRY: Readonly<Record<string, TryOn>> = {
  hold: tryIt("shape.hold"),
  holdResize: tryIt("shape.hold"),
  arcsHearts: tryIt("shape.hold"),
  pathArrow: tryIt("shape.hold"),
  scribble: tryIt("erase.scribble"),
  undo: tryIt("undo.gesture"),
  redoThree: tryIt("redo.gesture"),
  circleLasso: tryIt("lasso.circle"),
  pullPage: tryIt("page.pull"),
  fillScreen: tryIt(),
  scribbleFill: tryIt(),
  fingerPick: tryIt(),
  fingerHoldMenu: tryIt(),
  pinchSelection: tryIt(),
  turnKnob: tryIt(),
};

/** English words people search with that a tip's own text does not hold. */
const TIP_ALSO: Readonly<Record<string, string>> = {
  hold: "shape snap straight line circle rectangle",
  scribble: "erase delete rub scratch",
  undo: "undo gesture",
  redoThree: "redo gesture",
  circleLasso: "select lasso loop",
  pullPage: "add new page",
  newBoard: "infinite canvas endless whiteboard",
  joinedPages: "pages across side by side horizontal",
  customizeBar: "toolbar tools remove hide add rearrange",
  penOrder: "highlighter quick pen order",
  darkDesk: "dark mode night",
  embedPages: "embed markdown note",
  importBooks: "goodnotes notability zip import",
  lockFit: "zoom fit width",
};

interface SettingFeature {
  id: string;
  key: string;
  title: TextKey;
  body: TextKey;
  also: string;
}

/** Switches in settings with no tip of their own. */
const SETTING_FEATURES: readonly SettingFeature[] = [
  {
    id: "textDragSize",
    key: "textDragSize",
    title: "settings.textDragSize.name",
    body: "settings.textDragSize.line",
    also: "resize width click drag text box",
  },
  {
    id: "lassoTouches",
    key: "lassoTouches",
    title: "settings.lassoTouches.name",
    body: "settings.lassoTouches.line",
    also: "select partly",
  },
  {
    id: "pressure",
    key: "pressureWidth",
    title: "settings.pressure.name",
    body: "settings.pressure.line",
    also: "pressure thickness pencil",
  },
  {
    id: "pencilTilt",
    key: "pencilTilt",
    title: "settings.pencilTilt.name",
    body: "settings.pencilTilt.line",
    also: "tilt shading",
  },
  {
    id: "simpleLook",
    key: "simpleLook",
    title: "settings.simpleLook.name",
    body: "settings.simpleLook.line",
    also: "sidebar side panels tabs ribbon hide obsidian menus",
  },
];

function build(): Feature[] {
  const features: Feature[] = [];
  const seen = new Set<string>();
  const add = (tip: Tip, collection: TipCollection | null): void => {
    if (seen.has(tip.id)) return;
    seen.add(tip.id);
    features.push({
      id: tip.id,
      title: tip.title,
      body: tip.body,
      tip,
      collection,
      action: TIP_ACTIONS[tip.id] ?? null,
      tryOn: TIP_TRY[tip.id] ?? null,
      also: TIP_ALSO[tip.id] ?? "",
    });
  };
  for (const collection of TIP_COLLECTIONS) {
    for (const tip of collection.tips) add(tip, collection);
  }
  // A release's highlight that is in no collection is still a feature.
  for (const release of RELEASE_HIGHLIGHTS) {
    for (const tip of release.tips) add(tip, null);
  }
  for (const item of SETTING_FEATURES) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    features.push({
      id: item.id,
      title: item.title,
      body: item.body,
      tip: null,
      collection: null,
      action: setting(item.key, item.title),
      tryOn: null,
      also: item.also,
    });
  }
  return features;
}

/** Every feature, tips first in reading order. */
export const FEATURES: readonly Feature[] = build();

const BY_ID: ReadonlyMap<string, Feature> = new Map(FEATURES.map((f) => [f.id, f]));

/** The feature called `id`; ids match whatever case a link was typed in. */
export function featureById(id: string): Feature | null {
  const direct = BY_ID.get(id);
  if (direct) return direct;
  const lower = id.toLowerCase();
  return FEATURES.find((f) => f.id.toLowerCase() === lower) ?? null;
}

/** The feature a settings switch belongs to, for the mark beside a search result. */
export function settingKeyOf(feature: Feature): string | null {
  return feature.action?.kind === "setting" ? feature.action.key : null;
}

// --- Search ------------------------------------------------------------------

/** Words of a text, lower case, accents folded: "Café-Boxes" gives café → cafe, boxes. */
export function searchWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/** Whether a typed term means a word: its start, or the word with an ending ("boxes" for "box"). */
function means(term: string, word: string): boolean {
  if (word.startsWith(term)) return true;
  return word.length >= 3 && term.startsWith(word) && term.length - word.length <= 3;
}

/** Fewest characters a query needs before features are looked for. */
export const MIN_FEATURE_QUERY = 2;

const TITLE_WEIGHT = 4;
const ALSO_WEIGHT = 2;
const BODY_WEIGHT = 1;

/**
 * The features a query means, best first. Every typed word must be found in
 * a feature's title, body or extra words; a word in the title counts most.
 * `text` gives a key's words in the language in use.
 */
export function searchFeatures(
  query: string,
  text: (key: TextKey) => string,
  limit = 3,
  features: readonly Feature[] = FEATURES,
): Feature[] {
  const terms = searchWords(query);
  if (terms.join("").length < MIN_FEATURE_QUERY) return [];
  const scored: { feature: Feature; score: number; at: number }[] = [];
  features.forEach((feature, at) => {
    const title = searchWords(text(feature.title));
    const body = searchWords(text(feature.body));
    const also = searchWords(feature.also);
    let score = 0;
    for (const term of terms) {
      if (title.some((word) => means(term, word))) score += TITLE_WEIGHT;
      else if (also.some((word) => means(term, word))) score += ALSO_WEIGHT;
      else if (body.some((word) => means(term, word))) score += BODY_WEIGHT;
      else return;
    }
    scored.push({ feature, score, at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.slice(0, limit).map((item) => item.feature);
}

// --- Links ---------------------------------------------------------------------

/** `obsidian://finenotes?do=show&feature=<id>`: opens that feature's tip, or its switch. */
export function featureLink(id: string): string {
  return `obsidian://finenotes?do=show&feature=${encodeURIComponent(id)}`;
}
