/**
 * {@link PdfCanvasRecorder} for a whole page of a text note: as well as
 * paths it records text (`fillText`, as real PDF text in one of the
 * standard fonts), rounded rectangles, pictures (`drawImage`, placed for
 * the caller to embed) and a handwriting section's ink, as the vector ink
 * the notebook export writes (`./vector-ink`). What it still cannot write
 * (a gradient, a blend, text the font cannot encode) marks it unsupported,
 * and the caller draws that page as a picture instead.
 *
 * Text is measured and encoded through a {@link PdfFontBook} the caller
 * supplies (pdf-lib's standard fonts, in `./note-pdf`), so a page is laid
 * out with the very widths it is written in.
 *
 * PURE: no DOM, no Obsidian, no pdf-lib.
 */

import { parseCssColor } from "../canvas/night";
import { PdfCanvasRecorder } from "./pdf-canvas";
import type { InkGraphicsState, VectorInk } from "./vector-ink";

/** The faces a page's text is written in: the standard fonts every PDF reader has. */
export type PdfFace =
  | "sans"
  | "sans-bold"
  | "sans-italic"
  | "sans-bold-italic"
  | "mono"
  | "mono-bold"
  | "mono-italic"
  | "mono-bold-italic";

export interface PdfFontBook {
  /** The width of `text` at `size` in `face`. */
  measure(face: PdfFace, text: string, size: number): number;
  /** `text` as a PDF string (`<hex>`) in `face`'s encoding, or null when the face cannot show it. */
  encode(face: PdfFace, text: string): string | null;
}

/**
 * Characters the standard fonts lack, and what they are written as: the
 * minus sign a graph's numbers use, and the narrow spaces. By code point,
 * so no invisible character sits in this file.
 */
const SUBSTITUTES: ReadonlyArray<[string, string]> = [
  [String.fromCharCode(0x2212), "-"],
  [String.fromCharCode(0x2010), "-"],
  [String.fromCharCode(0x2011), "-"],
  [String.fromCharCode(0x2009), " "],
  [String.fromCharCode(0x202f), " "],
  [String.fromCharCode(0x200a), " "],
];

/** `text` with the characters the standard fonts lack swapped for their nearest. */
export function pdfText(text: string): string {
  let out = text;
  for (const [from, to] of SUBSTITUTES) if (out.includes(from)) out = out.split(from).join(to);
  return out;
}

/** The em box's ascent and descent, as a share of the size: where `textBaseline` puts the baseline. */
const ASCENT = 0.77;
const DESCENT = 0.23;

/**
 * The face and size a canvas `font` shorthand asks for: monospaced when
 * its family names a monospaced font, bold at a weight of 600 or more.
 */
export function faceOf(font: string): { face: PdfFace; size: number } {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const before = font.slice(0, Math.max(0, font.search(/\d+(?:\.\d+)?px/)));
  const family = font.slice(font.search(/px/) + 2).toLowerCase();
  const weight = Number(/\b([1-9]00|[1-9]50)\b/.exec(before)?.[1] ?? 400);
  const bold = /\bbold\b/.test(before) || weight >= 600;
  const italic = /\b(?:italic|oblique)\b/.test(before);
  const mono = /mono|courier|consol|menlo/.test(family);
  const face =
    `${mono ? "mono" : "sans"}${bold ? "-bold" : ""}${italic ? "-italic" : ""}` as PdfFace;
  return { face, size: size > 0 ? size : 10 };
}

/** A picture the page places, for the caller to embed under {@link PdfPicture.name}. */
export interface PdfPicture {
  name: string;
  source: unknown;
}

/** What a recorded page holds besides its operators. */
export interface PdfPageResult extends VectorInk {
  /** The faces its text uses, by resource name. */
  fonts: Map<string, PdfFace>;
  /** Its pictures, by resource name. */
  pictures: PdfPicture[];
}

export class PdfPageRecorder extends PdfCanvasRecorder {
  private readonly faces = new Map<string, PdfFace>();
  private readonly placed: PdfPicture[] = [];
  private readonly sources = new Map<unknown, string>();
  private readonly inkStates = new Map<string, InkGraphicsState>();
  private readonly inkGroups: VectorInk["groups"] = new Map();
  private inks = 0;

  constructor(
    width: number,
    height: number,
    private readonly book: PdfFontBook,
  ) {
    super(width, height);
  }

  /** The page: operators (device px, y down), graphics states, ink groups, fonts and pictures. */
  page(): PdfPageResult {
    const base = this.result();
    const states = new Map(base.states);
    for (const [name, state] of this.inkStates) states.set(name, state);
    return {
      ops: base.ops,
      states,
      groups: new Map(this.inkGroups),
      fonts: new Map(this.faces),
      pictures: [...this.placed],
    };
  }

  measureText(text: string): { width: number } {
    const { face, size } = faceOf(this.font);
    return { width: this.book.measure(face, pdfText(text), size) };
  }

  fillText(text: string, x: number, y: number): void {
    this.text(text, x, y, false);
  }

  strokeText(text: string, x: number, y: number): void {
    this.text(text, x, y, true);
  }

  /** Text at `x, y` as the canvas places it (`textAlign`, `textBaseline`), filled or outlined. */
  private text(raw: string, x: number, y: number, outline: boolean): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || raw === "") return;
    const text = pdfText(raw);
    const { face, size } = faceOf(this.font);
    const encoded = this.book.encode(face, text);
    if (encoded === null) {
      this.unsupported ??= "text the PDF's fonts cannot show";
      return;
    }
    const style = outline ? this.strokeStyle : this.fillStyle;
    const color = typeof style === "string" ? parseCssColor(style) : null;
    if (!color) {
      this.unsupported ??= "a text colour";
      return;
    }
    const width = this.book.measure(face, text, size);
    const align = this.textAlign;
    const left =
      align === "right" || align === "end" ? x - width : align === "center" ? x - width / 2 : x;
    const base = this.textBaseline;
    const baseline =
      base === "top" || base === "hanging"
        ? y + ASCENT * size
        : base === "middle"
          ? y + ((ASCENT - DESCENT) / 2) * size
          : base === "bottom" || base === "ideographic"
            ? y - DESCENT * size
            : y;
    const { a, b, c, d, e, f } = this.getTransform();
    // The text's own matrix: the user space's, with y turned back up for the glyphs.
    const m = [
      a * size,
      b * size,
      -c * size,
      -d * size,
      a * left + c * baseline + e,
      b * left + d * baseline + f,
    ];
    let name = [...this.faces].find(([, have]) => have === face)?.[0];
    if (!name) {
      name = `Fnt${this.faces.size}`;
      this.faces.set(name, face);
    }
    const u = (n: number): string => String(Math.round(n * 1000) / 1000);
    const rgb = `${u(color.r)} ${u(color.g)} ${u(color.b)}`;
    const gs = this.alphaState(color.a * this.globalAlpha);
    const paint = outline
      ? // The outline's width is in the page's space, as the canvas strokes it.
        [`${rgb} RG`, `${u(this.lineWidth * Math.sqrt(Math.abs(a * d - b * c)))} w`, "1 j", "1 Tr"]
      : [`${rgb} rg`, "0 Tr"];
    this.out.push(
      "q",
      ...(gs ? [`/${gs} gs`] : []),
      "BT",
      ...paint,
      `/${name} 1 Tf`,
      `${m.map(u).join(" ")} Tm`,
      `${encoded} Tj`,
      "ET",
      "Q",
    );
    this.painted = true;
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: number | readonly number[] = 0,
  ): void {
    if (![x, y, w, h].every(Number.isFinite)) return;
    const list = typeof radii === "number" ? [radii] : radii.length > 0 ? radii : [0];
    const at = (i: number): number => Math.max(0, Number(list[i % list.length]) || 0);
    // The canvas's order: top-left, top-right, bottom-right, bottom-left (one, two or four given).
    const r =
      list.length === 2
        ? [at(0), at(1), at(0), at(1)]
        : list.length === 3
          ? [at(0), at(1), at(2), at(1)]
          : [at(0), at(1), at(2), at(3)];
    const half = Math.min(Math.abs(w), Math.abs(h)) / 2;
    const [tl, tr, br, bl] = r.map((v) => Math.min(v, half));
    this.moveTo(x + tl, y);
    this.arcTo(x + w, y, x + w, y + h, tr);
    this.arcTo(x + w, y + h, x, y + h, br);
    this.arcTo(x, y + h, x, y, bl);
    this.arcTo(x, y, x + w, y, tl);
    this.closePath();
  }

  /** `drawImage(source, x, y, w, h)`: the picture placed in that box, its pixels the caller's. */
  drawImage(source: unknown, ...args: number[]): void {
    if (args.length !== 4 || !args.every(Number.isFinite)) {
      this.unsupported ??= "a cropped picture";
      return;
    }
    const [x, y, w, h] = args;
    let name = this.sources.get(source);
    if (!name) {
      name = `FnPic${this.sources.size}`;
      this.sources.set(source, name);
      this.placed.push({ name, source });
    }
    const { a, b, c, d, e, f } = this.getTransform();
    // The image's unit square (y up) onto the box (y down), then the user space's matrix.
    const m = [a * w, b * w, -c * h, -d * h, a * x + c * (y + h) + e, b * x + d * (y + h) + f];
    this.out.push("q", `${m.map(pdfNumber4).join(" ")} cm`, `/${name} Do`, "Q");
    this.painted = true;
  }

  /**
   * A handwriting section's ink, as `vectorInk` wrote it in the current user
   * space: its states and groups renamed so they never meet the page's own.
   */
  drawVectorInk(ink: VectorInk): void {
    if (!ink.ops) return;
    const prefix = `Nk${this.inks++}`;
    const rename = new Map<string, string>();
    for (const [name, state] of ink.states) {
      rename.set(name, `${prefix}${name}`);
      this.inkStates.set(`${prefix}${name}`, state);
    }
    for (const [name, group] of ink.groups) {
      rename.set(name, `${prefix}${name}`);
      this.inkGroups.set(`${prefix}${name}`, group);
    }
    const ops = ink.ops.replace(/\/((?:Gs|Ink)\d+) (gs|Do)/g, (all, name: string, op: string) => {
      const own = rename.get(name);
      return own ? `/${own} ${op}` : all;
    });
    const { a, b, c, d, e, f } = this.getTransform();
    this.out.push("q", `${[a, b, c, d, e, f].map(pdfNumber4).join(" ")} cm`, ops, "Q");
    this.painted = true;
  }
}

/** Four decimals: a matrix's scale terms are small numbers. */
function pdfNumber4(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 10000) / 10000;
  return r === 0 ? "0" : String(r);
}
