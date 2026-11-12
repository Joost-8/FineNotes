/**
 * Features as rows: what a search over the feature index shows, on Home, in
 * a notebook's search and in Tips. A row is the feature's name and where it
 * belongs; a switch shows its state and flips it in place; a command has a
 * button that runs it. A tap on the row opens the feature's tip.
 */

import { ToggleComponent, setIcon } from "obsidian";
import { t } from "../i18n/translate";
import { type Feature, searchFeatures, searchableFeatures } from "../model/feature-index";

/** What a feature's row can do; the plugin provides it. */
export interface FeatureHost {
  /** A switch's value now. */
  settingOn(key: string): boolean;
  setSetting(key: string, on: boolean): Promise<void>;
  /** Run one of FineNotes' commands; false when it cannot run here (no notebook open). */
  runCommand(id: string): boolean;
  /** The feature's tip, or its row in settings when it has no tip. */
  show(feature: Feature): void;
  /** A gesture's Try it: a scratch page with the tip's picture over it. */
  tryFeature(feature: Feature): void;
  /** The features taken out of search results with their ×. */
  hiddenFeatures(): readonly string[];
  /** Take a feature out of search results, or put it back. Its tip stays in Tips. */
  hideFeature(id: string, hide: boolean): void;
  /** Start a request on GitHub that carries these words. */
  ask(query: string): void;
}

/** Features a search list shows at most, under notebooks and pages. */
export const FEATURE_HITS = 3;

/** The features `query` means, in the language in use, leaving out those in `hidden`. */
export function featureHits(
  query: string,
  limit = FEATURE_HITS,
  hidden: readonly string[] = [],
): Feature[] {
  return searchFeatures(query, (key) => t(key), limit, searchableFeatures(hidden));
}

/**
 * The × at a search result's far end: takes the feature out of search
 * results. `gone` runs after, so the list can close up.
 */
export function hideButton(
  parent: HTMLElement,
  feature: Feature,
  host: FeatureHost,
  gone: () => void,
): HTMLElement {
  const button = parent.createEl("button", {
    cls: "goodobsidian-feature-hide clickable-icon",
    attr: { type: "button", "aria-label": t("notebooks.features.hide") },
  });
  setIcon(button, "x");
  // In a list of suggestions a press would also choose the row under it.
  for (const name of ["pointerdown", "mousedown"] as const) {
    button.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    host.hideFeature(feature.id, true);
    gone();
  });
  return button;
}

/** Icon of a feature's row: what kind of thing a tap leads to. */
function rowIcon(feature: Feature): string {
  if (feature.tip) return "lightbulb";
  return feature.action?.kind === "setting" ? "sliders-horizontal" : "sparkles";
}

/**
 * One feature's row inside `parent`. `done` runs after a tap that leaves
 * the list (a tip opened, a command ran), so a dialog holding it can close.
 */
export function featureRow(
  parent: HTMLElement,
  feature: Feature,
  host: FeatureHost,
  done: () => void = () => undefined,
  /** Give the row the × that takes it out of search results; `gone` runs once it is out. */
  onHidden?: () => void,
): HTMLElement {
  const row = parent.createDiv({ cls: "goodobsidian-feature-row" });
  const main = row.createEl("button", {
    cls: "goodobsidian-feature-main clickable-icon",
    attr: { type: "button" },
  });
  setIcon(main.createSpan({ cls: "goodobsidian-feature-icon" }), rowIcon(feature));
  const words = main.createSpan({ cls: "goodobsidian-feature-words" });
  words.createSpan({ cls: "goodobsidian-feature-title", text: t(feature.title) });
  // A tip says which collection it is in; a bare switch says what it does.
  const sub = feature.collection ? t(feature.collection.title) : feature.tip ? "" : t(feature.body);
  if (sub) words.createSpan({ cls: "goodobsidian-feature-sub", text: sub });
  main.addEventListener("click", () => {
    done();
    host.show(feature);
  });
  featureControl(row, feature, host, done);
  if (onHidden) {
    hideButton(row, feature, host, () => {
      row.remove();
      onHidden();
    });
  }
  return row;
}

/**
 * The feature's own control: a switch that is its setting, or a button that
 * runs its command. Nothing for a feature that is only a tip.
 */
export function featureControl(
  parent: HTMLElement,
  feature: Feature,
  host: FeatureHost,
  done: () => void = () => undefined,
  /** Say the switch's own name beside it: under a tip, whose title is not the switch's. */
  named = false,
): void {
  const action = feature.action;
  if (!action) return;
  if (action.kind === "setting") {
    const holder = parent.createSpan({ cls: "goodobsidian-feature-switch" });
    if (named) holder.createSpan({ cls: "goodobsidian-feature-switch-name", text: t(action.name) });
    const toggle = new ToggleComponent(holder);
    toggle.setValue(host.settingOn(action.key));
    toggle.toggleEl.setAttribute("aria-label", t(action.name));
    toggle.onChange((on) => void host.setSetting(action.key, on));
    return;
  }
  const go = parent.createEl("button", {
    cls: "goodobsidian-feature-go clickable-icon",
    attr: { type: "button", "aria-label": t("notebooks.features.open") },
  });
  setIcon(go, "arrow-right");
  go.addEventListener("click", () => {
    done();
    host.runCommand(action.id);
  });
}

/**
 * The features a search found, under a "Features" label. With `askFor`, an
 * empty list offers to ask for the feature instead of saying nothing.
 * Returns how many rows it drew.
 */
export function featureList(
  parent: HTMLElement,
  query: string,
  host: FeatureHost,
  options: {
    limit?: number;
    askFor?: boolean;
    done?: () => void;
    /** Search results: leave out the features taken out, and give each row its ×. */
    hideable?: boolean;
  } = {},
): number {
  const hidden = options.hideable ? host.hiddenFeatures() : [];
  const hits = featureHits(query, options.limit, hidden);
  if (hits.length === 0) {
    if (options.askFor) askRow(parent, query, host, options.done);
    return 0;
  }
  const label = parent.createDiv({
    cls: "goodobsidian-library-label",
    text: t("notebooks.features.heading"),
  });
  const list = parent.createDiv({ cls: "goodobsidian-feature-list" });
  // The last row taken out takes its heading with it.
  const closeUp = (): void => {
    if (list.childElementCount > 0) return;
    label.remove();
    list.remove();
  };
  for (const feature of hits) {
    featureRow(list, feature, host, options.done, options.hideable ? closeUp : undefined);
  }
  return hits.length;
}

/** "Ask for it": nothing matched, so the words go into a request. */
export function askRow(
  parent: HTMLElement,
  query: string,
  host: FeatureHost,
  done: () => void = () => undefined,
): HTMLElement {
  const button = parent.createEl("button", {
    cls: "goodobsidian-feature-ask clickable-icon",
    attr: { type: "button" },
  });
  setIcon(button.createSpan({ cls: "goodobsidian-feature-icon" }), "message-circle-plus");
  button.createSpan({ text: t("notebooks.features.ask") });
  button.addEventListener("click", () => {
    done();
    host.ask(query);
  });
  return button;
}
