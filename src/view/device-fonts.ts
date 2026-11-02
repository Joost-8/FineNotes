/**
 * The fonts this device has, as far as a web view can tell
 * (`model/text-family.ts` says why it is "as far as"): the desktop app's
 * Chromium lists them (`queryLocalFonts`, which may ask for permission or be
 * refused); elsewhere each candidate family is measured. Measuring is also
 * how one named family is checked, since `document.fonts.check` answers
 * true for any name that is not a web font.
 */

import {
  DEVICE_FONT_CANDIDATES,
  familyList,
  familyStack,
  measuresAsInstalled,
} from "../model/text-family";

/** Wide and narrow letters, digits and marks: few fonts share all their widths. */
const PROBE_TEXT = "mmmmmmmmmmlli1WQ@#&ÆgfiÅ";
const PROBE_PX = 48;
const GENERICS = ["monospace", "serif", "sans-serif"] as const;

let context: CanvasRenderingContext2D | null | undefined;
const known = new Map<string, boolean>();
let listed: Promise<string[]> | null = null;

function measure(): CanvasRenderingContext2D | null {
  if (context === undefined) context = createEl("canvas").getContext("2d");
  return context;
}

/** Whether this device draws text in `family` (by measurement, remembered). */
export function hasFamily(family: string): boolean {
  const key = family.toLowerCase();
  const seen = known.get(key);
  if (seen !== undefined) return seen;
  const ctx = measure();
  if (!ctx) return true;
  const width = (font: string): number => {
    ctx.font = `${PROBE_PX}px ${font}`;
    return ctx.measureText(PROBE_TEXT).width;
  };
  const present = measuresAsInstalled(
    GENERICS.map((generic) => ({
      withFamily: width(familyStack(family, generic)),
      generic: width(generic),
    })),
  );
  known.set(key, present);
  return present;
}

interface LocalFontData {
  family: string;
}
type QueryLocalFonts = () => Promise<LocalFontData[]>;

/**
 * The families this device has, in name order. Ask from a tap: the desktop
 * app's font list needs one (user activation), and may ask for permission.
 * Where it cannot list them, or is refused, the candidates it has.
 */
export function deviceFamilies(): Promise<string[]> {
  listed ??= (async () => {
    const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
    if (typeof query === "function") {
      try {
        const fonts = await query.call(window);
        const families = familyList(fonts.map((font) => font.family));
        if (families.length > 0) {
          for (const family of families) known.set(family.toLowerCase(), true);
          return families;
        }
      } catch {
        // Refused or not allowed here: measure instead.
      }
    }
    return familyList(DEVICE_FONT_CANDIDATES.filter(hasFamily));
  })();
  return listed;
}
