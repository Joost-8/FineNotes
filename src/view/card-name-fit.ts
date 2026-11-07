/**
 * A cover or template card's name whose longest word is wider than the card
 * ("kleurovergang", "toningsövergång") would break inside that word. Where
 * the system can hyphenate the interface language (`lang` on the name,
 * `hyphens: auto`) it breaks at a hyphen; Chromium without its dictionaries
 * (Obsidian's desktop app) breaks after whichever letter runs out of room.
 * So such a name is set a little smaller instead, just enough for the word
 * to fit, down to a floor where it would stop being readable.
 */

/** The smallest a name is set, in px. */
export const NAME_FONT_FLOOR = 10;

/**
 * The font size, in px, at which a word `wordWidth` px wide at `fontSize`
 * fits `boxWidth`. Unchanged when it already fits; never below `floor`.
 * PURE.
 */
export function fittedNameSize(
  fontSize: number,
  boxWidth: number,
  wordWidth: number,
  floor = NAME_FONT_FLOOR,
): number {
  if (!(fontSize > 0) || !(boxWidth > 0) || !(wordWidth > boxWidth)) return fontSize;
  // A hair under the exact ratio: text width does not scale quite linearly.
  const scaled = Math.floor(fontSize * (boxWidth / wordWidth) * 20) / 20 - 0.05;
  return Math.min(fontSize, Math.max(floor, scaled));
}

/**
 * Fit every translated card name (`.goodobsidian-template-name[lang]`) under
 * `root`, once it is laid out: on the next frame, as pickers build their
 * cards before they are attached.
 */
export function fitCardNames(root: HTMLElement): void {
  window.requestAnimationFrame(() => {
    for (const name of Array.from(
      root.querySelectorAll<HTMLElement>(".goodobsidian-template-name[lang]"),
    )) {
      fitCardName(name);
    }
  });
}

function fitCardName(name: HTMLElement): void {
  if (!name.isConnected || name.clientWidth === 0) return;
  // With breaking inside words off, the box overflows by its longest word.
  name.setCssStyles({ overflowWrap: "normal", hyphens: "manual", fontSize: "" });
  const fontSize = parseFloat(getComputedStyle(name).fontSize);
  const size = fittedNameSize(fontSize, name.clientWidth, name.scrollWidth);
  name.setCssStyles({
    overflowWrap: "",
    hyphens: "",
    fontSize: size < fontSize ? `${size}px` : "",
  });
}
