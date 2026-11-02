/**
 * Every English text, by key: the source every translation is made from,
 * and what shows wherever a translation has no entry. One file per area,
 * so the areas can be edited apart; keys never repeat across areas, as
 * each starts with its area's name. See ../README.md.
 */

import { ai } from "./ai";
import { calculator } from "./calculator";
import { common } from "./common";
import { notebooks } from "./notebooks";
import { settings } from "./settings";
import { surface } from "./surface";
import { toolbar } from "./toolbar";
import { view } from "./view";

export const EN = {
  ...common,
  ...settings,
  ...toolbar,
  ...surface,
  ...view,
  ...notebooks,
  ...ai,
  ...calculator,
} as const;

/** The areas, by name: one translation file each per language. */
export const AREAS = {
  common,
  settings,
  toolbar,
  surface,
  view,
  notebooks,
  ai,
  calculator,
} as const;
