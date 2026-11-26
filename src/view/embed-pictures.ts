/**
 * Settings → Embeds in notes, "How to embed a notebook": one small picture
 * for each way of embedding, drawn in the settings' own idiom (the row
 * drawings of `settings-art.ts`, the same `ga-*` classes and theme colours):
 * an Obsidian note with its title and a couple of lines of text, the link as
 * typed (a code chip), and under it what the note then shows.
 *
 * {@link embedPicture} is pure (the shapes, as data); {@link drawEmbedPictures}
 * puts the cards in the DOM, each with its link and meaning as text you can
 * select and its picture named for screen readers.
 */

import type { ArtShape } from "./settings-art";

/** The ways of embedding a notebook in a note, in the order the settings show them. */
export type EmbedForm = "whole" | "page" | "region" | "sketch" | "markdown";

export const EMBED_FORMS: readonly EmbedForm[] = ["whole", "page", "region", "sketch", "markdown"];

/** Each form's link, as typed in a note (syntax: the same in every language). */
export const EMBED_CODES: Readonly<Record<EmbedForm, string>> = {
  whole: "![[Notebook]]",
  page: "![[Notebook#page=3]]",
  region: "![[Notebook#Region name]]",
  sketch: "![[Notebook#id=hw-…]]",
  markdown: "![](Notebook.notebook.md#page=3)",
};

/** The picture's coordinate space. */
export const EMBED_PICTURE_BOX = { width: 160, height: 112 } as const;

const path = (cls: string, d: string): ArtShape => ({ tag: "path", cls, attrs: { d } });

const rect = (
  cls: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rx = 0,
  extra: Record<string, string | number> = {},
): ArtShape => ({ tag: "rect", cls, attrs: { x, y, width, height, rx, ...extra } });

/** The note around every picture: its card, title, two lines of text, the typed link. */
function note(): ArtShape[] {
  return [
    rect("ga-card", 1, 1, 158, 110, 8),
    path("ga-embed-title", "M12 14h58"),
    path("ga-text", "M12 25h132M12 33h104"),
    rect("ga-surface", 12, 40, 96, 10, 3),
    path("ga-accent-thin", "M17 45h40"),
  ];
}

/** A page of paper at (x, y), `w` x `h`, ruled, with a little ink on it. */
function page(x: number, y: number, w: number, h: number, ink = true): ArtShape[] {
  const rules: string[] = [];
  for (let ry = y + 10; ry < y + h - 4; ry += 9) rules.push(`M${x + 5} ${ry}h${w - 10}`);
  const shapes: ArtShape[] = [rect("ga-paper", x, y, w, h, 3), path("ga-rule", rules.join(""))];
  if (ink) {
    shapes.push(
      path(
        "ga-ink-thin",
        `M${x + 7} ${y + 17}c4 -5 8 4 12 -1s6 -4 9 0M${x + 8} ${y + 26}c5 -3 9 3 15 0`,
      ),
    );
  }
  return shapes;
}

/** What the note shows for embed form `form`, below its typed link. */
function shown(form: EmbedForm): ArtShape[] {
  switch (form) {
    case "whole":
      // Every page, one under the other, the note scrolling past them.
      return [
        ...page(14, 56, 40, 50),
        ...page(60, 56, 40, 50, false),
        ...page(106, 56, 40, 50, false),
        path("ga-line", "M152 58v46"),
        rect("ga-accent-solid", 150, 60, 4, 16, 2),
      ];
    case "page":
    case "markdown":
      return page(48, 56, 64, 52);
    case "region":
      // The page, cut to the region of that name.
      return [
        ...page(40, 56, 80, 52),
        rect("ga-accent-thin", 45, 64, 44, 26, 3, { "stroke-dasharray": "4 3" }),
      ];
    case "sketch":
      // Ink between two lines of the note's text, with no page around it.
      return [
        path("ga-text", "M12 60h120"),
        path("ga-embed-sketch", "M24 86c10 -16 22 -16 30 -2s20 12 28 -4M92 80l12 -8l10 10"),
        path("ga-text", "M12 104h96"),
      ];
  }
}

/** The shapes of the picture for `form`: the note, its typed link, and what it shows. */
export function embedPicture(form: EmbedForm): ArtShape[] {
  return [...note(), ...shown(form)];
}

const SVG_NS = "http://www.w3.org/2000/svg";

function build(doc: Document, shape: ArtShape): SVGElement {
  const el = doc.createElementNS(SVG_NS, shape.tag);
  if (shape.cls) el.setAttribute("class", shape.cls);
  for (const [name, value] of Object.entries(shape.attrs ?? {}))
    el.setAttribute(name, String(value));
  for (const kid of shape.kids ?? []) el.append(build(doc, kid));
  return el;
}

/** One card's words: the link as typed, and what it shows. */
export interface EmbedCardText {
  code: string;
  meaning: string;
}

/** The cards, one per form, into `parent`: a picture, then its link and meaning as text. */
export function drawEmbedPictures(
  parent: HTMLElement,
  text: (form: EmbedForm) => EmbedCardText,
): HTMLElement {
  const doc = parent.ownerDocument;
  const grid = parent.createDiv({ cls: "goodobsidian-embed-cards" });
  for (const form of EMBED_FORMS) {
    const { code, meaning } = text(form);
    const card = grid.createDiv({ cls: "goodobsidian-embed-card" });
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${EMBED_PICTURE_BOX.width} ${EMBED_PICTURE_BOX.height}`);
    svg.setAttribute("class", "goodobsidian-art-svg goodobsidian-embed-picture");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${code}: ${meaning}`);
    for (const shape of embedPicture(form)) svg.append(build(doc, shape));
    card.append(svg);
    card.createEl("code", { text: code });
    card.createDiv({ cls: "goodobsidian-embed-card-meaning", text: meaning });
  }
  return grid;
}
