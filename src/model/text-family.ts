/**
 * Text box fonts by name (discussion #107): any family the device has, past
 * the six of `TEXT_FONTS`. **Pure:** names in, names and CSS out.
 *
 * A box keeps its `font`, one of the six that iPadOS, macOS and Windows all
 * have, and may add a `family`. It is shown in that family where the device
 * has it and in `font` where it does not, so a box typed on another device
 * stays readable; a build from before `family` shows it in `font` too. The
 * box's width is stored, so a fallback rewraps the text inside it, and
 * never moves it.
 *
 * A web view cannot list the device's fonts everywhere: `queryLocalFonts`
 * is Chromium's (the desktop app), and iPadOS has nothing. So the list is
 * what `queryLocalFonts` gives, or else {@link DEVICE_FONT_CANDIDATES}
 * probed one by one, by measurement (`document.fonts.check` says true for
 * any local name, installed or not). A family from another device that this
 * one lacks is kept, marked, and shown in `font`.
 */

/** Longest family name a box keeps; a longer one is no font's name. */
export const MAX_FAMILY_LENGTH = 64;

/**
 * Names that are not families: CSS's generic families and its keywords. A
 * quoted generic (`"serif"`) names no font, so it would only ever fall back.
 */
const NOT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "default",
]);

/**
 * Characters no family name has, and that would break out of the quoted
 * name in a CSS or canvas `font-family` list: quotes, backslashes, the list
 * comma, declaration and markup punctuation, control characters.
 */
const BAD_CHARACTER = /["'\\,;{}<>\p{Cc}]/u;

/**
 * A family name as a box keeps it, or `undefined` when `raw` is not one:
 * spaces collapsed and trimmed, one pair of surrounding quotes taken off,
 * at most {@link MAX_FAMILY_LENGTH} characters, no generic family. Never
 * altered beyond that: a name the loader would change is dropped instead.
 */
export function cleanFamily(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let name = raw.replace(/\s+/g, " ").trim();
  const quoted = /^(["'])(.*)\1$/.exec(name);
  if (quoted) name = quoted[2].trim();
  if (name === "" || Array.from(name).length > MAX_FAMILY_LENGTH) return undefined;
  if (BAD_CHARACTER.test(name)) return undefined;
  if (NOT_FAMILIES.has(name.toLowerCase())) return undefined;
  return name;
}

/** A `font-family` list: `family` first, quoted, then the `fallback` list. */
export function familyStack(family: string | undefined, fallback: string): string {
  const name = cleanFamily(family);
  return name ? `"${name}", ${fallback}` : fallback;
}

/**
 * Whether a probe's widths say a family is installed. Each pair is one
 * sample measured in `"<family>", <generic>` and in `<generic>` alone: a
 * missing family falls back to the generic, so every pair is equal. One
 * pair that differs means the family drew it.
 */
export function measuresAsInstalled(
  pairs: ReadonlyArray<{ withFamily: number; generic: number }>,
): boolean {
  return pairs.some((p) => Math.abs(p.withFamily - p.generic) > 0.01);
}

/** Family names as a list shows them: cleaned, each once (ignoring case), in name order. */
export function familyList(names: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const name = cleanFamily(raw);
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/**
 * Families to probe for where the device cannot list its fonts. Goodnotes
 * has no font list of its own: its picker shows the system's fonts, so a
 * notebook from it names one of iPadOS' (Apple's list for iPadOS 17 and 18,
 * less the symbol and emoji fonts) or one the user installed. Then the
 * common ones of macOS, Windows, Android and Linux, and the fonts note-takers
 * most often install. Only the ones the device draws are offered; the rest
 * cost a measurement each.
 */
export const DEVICE_FONT_CANDIDATES: readonly string[] = [
  // iPadOS
  "Academy Engraved LET",
  "Al Nile",
  "American Typewriter",
  "Apple SD Gothic Neo",
  "Arial",
  "Arial Hebrew",
  "Arial Rounded MT Bold",
  "Avenir",
  "Avenir Next",
  "Avenir Next Condensed",
  "Baskerville",
  "Bodoni 72",
  "Bodoni 72 Oldstyle",
  "Bodoni 72 Smallcaps",
  "Bradley Hand",
  "Chalkboard SE",
  "Chalkduster",
  "Charter",
  "Cochin",
  "Copperplate",
  "Courier",
  "Courier New",
  "Damascus",
  "Devanagari Sangam MN",
  "Didot",
  "DIN Alternate",
  "DIN Condensed",
  "Euphemia UCAS",
  "Farah",
  "Futura",
  "Galvji",
  "Geeza Pro",
  "Georgia",
  "Gill Sans",
  "Gujarati Sangam MN",
  "Gurmukhi MN",
  "Helvetica",
  "Helvetica Neue",
  "Hiragino Maru Gothic ProN",
  "Hiragino Mincho ProN",
  "Hiragino Sans",
  "Hoefler Text",
  "Kailasa",
  "Kannada Sangam MN",
  "Kefa",
  "Khmer Sangam MN",
  "Kohinoor Bangla",
  "Kohinoor Devanagari",
  "Kohinoor Gujarati",
  "Kohinoor Telugu",
  "Lao Sangam MN",
  "Malayalam Sangam MN",
  "Marker Felt",
  "Menlo",
  "Mishafi",
  "Mukta Mahee",
  "Myanmar Sangam MN",
  "Noteworthy",
  "Noto Nastaliq Urdu",
  "Noto Sans Kannada",
  "Noto Sans Myanmar",
  "Noto Sans Oriya",
  "Optima",
  "Palatino",
  "Papyrus",
  "Party LET",
  "PingFang HK",
  "PingFang SC",
  "PingFang TC",
  "Rockwell",
  "Savoye LET",
  "Sinhala Sangam MN",
  "Snell Roundhand",
  "STIX Two Text",
  "Tamil Sangam MN",
  "Telugu Sangam MN",
  "Thonburi",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Zapfino",
  // macOS
  "Andale Mono",
  "Apple Chancery",
  "Arial Black",
  "Arial Narrow",
  "Athelas",
  "Ayuthaya",
  "Big Caslon",
  "Brush Script MT",
  "Chalkboard",
  "Comic Sans MS",
  "Herculanum",
  "Impact",
  "Iowan Old Style",
  "Krungthep",
  "Lucida Grande",
  "Luminari",
  "Marion",
  "Monaco",
  "Phosphate",
  "PT Mono",
  "PT Sans",
  "PT Serif",
  "Seravek",
  "SignPainter",
  "Silom",
  "Skia",
  "Superclarendon",
  "Tahoma",
  "Trattatello",
  // Windows
  "Bahnschrift",
  "Book Antiqua",
  "Bookman Old Style",
  "Calibri",
  "Cambria",
  "Candara",
  "Cascadia Code",
  "Cascadia Mono",
  "Century Gothic",
  "Consolas",
  "Constantia",
  "Corbel",
  "Ebrima",
  "Franklin Gothic Medium",
  "Gabriola",
  "Gadugi",
  "Garamond",
  "Gill Sans MT",
  "Ink Free",
  "Leelawadee UI",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Malgun Gothic",
  "Microsoft JhengHei",
  "Microsoft YaHei",
  "MV Boli",
  "Nirmala UI",
  "Palatino Linotype",
  "Segoe Print",
  "Segoe Script",
  "Segoe UI",
  "SimSun",
  "Sitka Text",
  "Sylfaen",
  "Tw Cen MT",
  "Yu Gothic",
  // Android and Linux
  "Cantarell",
  "DejaVu Sans",
  "DejaVu Sans Mono",
  "DejaVu Serif",
  "Liberation Mono",
  "Liberation Sans",
  "Liberation Serif",
  "Noto Sans",
  "Noto Serif",
  "Roboto",
  "Roboto Mono",
  "Ubuntu",
  // Installed by hand (font apps, Google Fonts): what note-takers pick most
  "Architects Daughter",
  "Caveat",
  "Comic Neue",
  "Dancing Script",
  "Fira Code",
  "Fira Sans",
  "Gaegu",
  "Indie Flower",
  "Inter",
  "JetBrains Mono",
  "Kalam",
  "Lato",
  "Lora",
  "Merriweather",
  "Montserrat",
  "Nanum Pen Script",
  "Nunito",
  "Open Sans",
  "Pacifico",
  "Patrick Hand",
  "Playfair Display",
  "Poppins",
  "Quicksand",
  "Raleway",
  "Shadows Into Light",
  "Source Sans Pro",
  "Source Serif Pro",
];
