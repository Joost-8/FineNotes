/**
 * What a lasso selection is, and so what its menu offers (Joost on PR #59):
 * one kind of thing keeps its own editing options, handwriting counting as
 * one kind however many strokes it is; a mix of kinds gets only its ink's
 * colour, never options that overlap; and Turn into offers only what fits,
 * so a shape is not offered what only handwriting can become, and a mix
 * gets little. Pure.
 */

/** The kinds a lasso selection can hold, or a mix of them. */
export type SelectionKind =
  "handwriting" | "shapes" | "table" | "graphs" | "pictures" | "text" | "mixed";

export interface KindInput {
  strokes: readonly { shape?: string }[];
  images: readonly unknown[];
  textBoxes: readonly unknown[];
  tables?: readonly unknown[];
  graphs?: readonly unknown[];
}

/**
 * The kind of a selection. `tableInk`: its strokes are the ink written in
 * its one table (a table is picked up with it), so they do not make it a mix.
 */
export function selectionKind(sel: KindInput, tableInk = false): SelectionKind {
  const tables = sel.tables?.length ?? 0;
  const graphs = sel.graphs?.length ?? 0;
  const shapes = sel.strokes.filter((stroke) => stroke.shape !== undefined).length;
  const ink = sel.strokes.length - shapes;
  const strokes = tableInk && tables > 0 ? 0 : sel.strokes.length;
  const present = [
    tables > 0 ? "table" : null,
    graphs > 0 ? "graphs" : null,
    sel.images.length > 0 ? "pictures" : null,
    sel.textBoxes.length > 0 ? "text" : null,
    strokes > 0 && ink > 0 ? "handwriting" : null,
    strokes > 0 && shapes > 0 ? "shapes" : null,
  ].filter((kind): kind is SelectionKind => kind !== null);
  return present.length === 1 ? present[0] : "mixed";
}

/** Which parts of the lasso menu a kind of selection gets, past Cut, Copy, Duplicate, Paste, Flip and Delete. */
export interface SelectionMenu {
  /** The ink colour swatches. */
  colour: boolean;
  /** A shape's fill, line, corners and arrows. */
  shapeStyle: boolean;
  /** What only handwriting can become: Text, Contents heading, Task, and Copy text of a highlight. */
  handwriting: boolean;
  /** Link to…, with Open and Remove link. */
  link: boolean;
  /** Turn into › Sticker. */
  sticker: boolean;
  /** Turn into › Comment. */
  comment: boolean;
}

export function selectionMenu(kind: SelectionKind): SelectionMenu {
  const none: SelectionMenu = {
    colour: false,
    shapeStyle: false,
    handwriting: false,
    link: false,
    sticker: false,
    comment: false,
  };
  switch (kind) {
    case "handwriting":
      return { ...none, colour: true, handwriting: true, link: true, sticker: true, comment: true };
    case "shapes":
      return { ...none, colour: true, shapeStyle: true, link: true, sticker: true, comment: true };
    case "mixed":
      // Only what applies to everything at once: its ink's colour, and
      // under Turn into what any selection can become.
      return { ...none, colour: true, sticker: true, comment: true };
    default:
      return { ...none, sticker: true, comment: true };
  }
}
