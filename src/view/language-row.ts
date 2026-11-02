/**
 * The Language row at the top of the settings tab: one dropdown, Obsidian's
 * own languages each named in itself, "Follow Obsidian" first. A change
 * shows in the tab at once; everything else follows a relaunch, which the
 * row offers with one button, as Obsidian does for its own language.
 */

import type { Setting } from "obsidian";
import {
  FOLLOW_OBSIDIAN,
  INTERFACE_LANGUAGES,
  interfaceLanguageOf,
  resolveLanguage,
} from "../i18n/languages";
import { t } from "../i18n/translate";
import { obsidianLanguage } from "./interface-language";

export interface LanguageRowHost {
  chosen(): string | undefined;
  /** Store the choice and get its table; false when it could not be had. */
  choose(code: string): Promise<boolean>;
  /** Draw the tab again, in the language now in use. */
  redraw(): void;
}

/** Search words for the row, in the languages people look for it in. */
export const LANGUAGE_ALIASES = [
  "language",
  "interface language",
  "translation",
  "taal",
  "sprache",
  "langue",
  "idioma",
  "lingua",
  "język",
  "язык",
  "言語",
  "语言",
  "언어",
];

/** Set when a choice was made this session: the relaunch button shows from then on. */
let changed = false;
/** Set while the last choice could not be had: the row says so. */
let failed = false;

export function drawLanguageRow(setting: Setting, host: LanguageRowHost): void {
  const obsidianName =
    INTERFACE_LANGUAGES.find((l) => l.code === resolveLanguage(undefined, obsidianLanguage()))
      ?.name ?? "English";
  setting.addDropdown((d) => {
    d.addOption(FOLLOW_OBSIDIAN, t("language.follow", { language: obsidianName }));
    for (const l of INTERFACE_LANGUAGES) d.addOption(l.code, l.name);
    d.selectEl.setAttribute("aria-label", t("language.name"));
    d.setValue(interfaceLanguageOf(host.chosen()));
    d.onChange((value) => {
      d.setDisabled(true);
      setting.setDesc(t("language.downloading"));
      void host.choose(value).then((ok) => {
        changed = true;
        failed = !ok;
        host.redraw();
      });
    });
  });
  if (failed) setting.setDesc(t("language.failed"));
  if (changed) {
    setting.addButton((b) =>
      b
        .setButtonText(t("language.relaunch"))
        .setTooltip(t("language.relaunchTip"))
        .setCta()
        .onClick(() => window.location.reload()),
    );
  }
}
