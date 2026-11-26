/**
 * E-ink screens (discussion #309): which choice this device stored, whether
 * the device looks like one, and whether FineNotes draws for one. PURE.
 *
 * An e-ink panel redraws slowly and leaves ghosts, so every pixel FineNotes
 * changes without need (an animation, a layer shown and hidden) costs there.
 * Nothing in CSS or the web platform says a screen is e-ink: Chromium on
 * Android never matches `(monochrome)` and reports `(update: fast)`. What
 * is left is the device model, which Chromium reports through
 * `navigator.userAgentData` (`view/eink-screen.ts`); Obsidian's plugin
 * review does not allow reading `navigator.userAgent`.
 */

/** What the person chose on this device: follow the model, or always on or off. */
export type EinkChoice = "auto" | "on" | "off";

export const EINK_CHOICES: readonly EinkChoice[] = ["auto", "on", "off"];

/** A stored choice, or "auto" for anything this build does not know. */
export function parseEinkChoice(raw: unknown): EinkChoice {
  return raw === "on" || raw === "off" ? raw : "auto";
}

/**
 * Onyx BOOX models, as Android names them (`Build.MODEL`). Each pattern must
 * match the whole name, so a phone such as "Redmi Note 12" never matches
 * "Note".
 */
const BOOX_MODELS: readonly RegExp[] = [
  /^(onyx|boox)\b.*$/,
  /^note ?air ?\w*( ?c| ?plus| ?pro)?$/,
  /^note ?(max|x\d?|\d+\w?)( ?c| ?pro| ?plus)?$/,
  /^nova ?(air ?\d*|pro|\d+)( ?c| ?plus| ?pro)?$/,
  /^tab ?(ultra|x|mini)\w*( ?c| ?pro)*$/,
  /^go ?(color ?)?\d+(\.\d+)?( ?gen ?ii)?$/,
  /^(poke|leaf|palma|page|max ?lumi|kon-?tiki|darwin|lomonosov)\s?\d*[a-z]?( ?pro| ?c)?$/,
];

/** Whether `model` is an e-ink device FineNotes knows: an Onyx BOOX. */
export function isEinkModel(model: string | null | undefined): boolean {
  const name = (model ?? "").trim().toLowerCase();
  if (name === "") return false;
  return BOOX_MODELS.some((pattern) => pattern.test(name));
}

/** Whether FineNotes draws for an e-ink screen: the choice, or with "auto", the device. */
export function einkOn(choice: EinkChoice, detected: boolean): boolean {
  return choice === "auto" ? detected : choice === "on";
}
