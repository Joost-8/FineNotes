import type { Scene } from "./types";
import { NOTEBOOK_SCENES } from "./notebook";
import { TOOLBAR_SCENES } from "./toolbar";
import { PANEL_SCENES } from "./panels";
import { DIALOG_SCENES } from "./dialogs";
import { SETTINGS_SCENES } from "./settings";

export const SCENES: Scene[] = [
  ...NOTEBOOK_SCENES,
  ...TOOLBAR_SCENES,
  ...PANEL_SCENES,
  ...DIALOG_SCENES,
  ...SETTINGS_SCENES,
];
