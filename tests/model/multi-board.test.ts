/**
 * A board file of several boards (discussion #160): saved under the
 * `boards` label, so FineNotes 2.9.1 and older hold it read-only instead of
 * reading the boards as pages metres long and dropping the board flag; a
 * one-board file keeps the plain label and its bytes. Plus the pure parts
 * the view builds on: a new board, and the part of a board its thumbnail
 * shows.
 */

import { describe, expect, it } from "vitest";
import {
  BOARD_BLOCK,
  BOARD_THUMB_ASPECT,
  boardDrawingBox,
  boardLabel,
  boardStartGeometry,
  boardThumbBox,
  hasBoards,
  isBoardPage,
  newBoardPage,
} from "../../src/model/board";
import { AddPage, RemovePage } from "../../src/model/commands";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { type InkDocument, type Page, type Stroke, blankPage } from "../../src/model/document";
import {
  FORMAT_FEATURES,
  isLabelProblem,
  needsNewerReader,
  readPayloadLabel,
} from "../../src/model/format-features";
import { History } from "../../src/model/history";
import { DEFAULT_NOTEBOOK_CHOICES, buildNewDocument } from "../../src/model/new-notebook";
import { MovePage, nextPageId, pageToInsertAfter } from "../../src/model/page-commands";
import { paperPageFor, shapePageFor } from "../../src/model/templates";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

/**
 * A one-board file as FineNotes 2.9.1 (243e286) saved it: a dotted board
 * titled "Ideas" with one stroke. Made by that build's `encodeDocument`
 * before this change; the build after it must read it the same and save it
 * back byte for byte.
 */
const ONE_BOARD_291 =
  "v2:VY7BTsMwDIbfxVxzaCuGRo7ceASEdgiN1VrN4iox26Dau2NvQYLkkHy/7d//BicslTiDHxycCM/gN6hj4ZTewHcOzhRlBr976hTqGBKC768Ojijh1kt5Mk3KJzrAHBPWekftWsOESu8bUAQPaw8OFsr2p7woTMjqVL7M6t+qGWma5U5q9BHGJRZera8ZRBbBCFoUEosArxFDVVM6trUHreFFXvjyi1UKL38jVYs0cuKi8NDdjiqVvtXxUeeZkyXHrOoqNjnsrcm1px/2bnhuyq4ph6vdHw==";

/** The features FineNotes 2.9.1 reads, as its `format-features.ts` lists them. */
const FEATURES_291 = [
  "sticky",
  "connectors",
  "tilt",
  "tape",
  "side-space",
  "shape-content",
  "text-turn",
];

const board = (): InkDocument =>
  buildNewDocument(
    { ...DEFAULT_NOTEBOOK_CHOICES, type: "endless", boardRuling: "dotted" },
    "Mind map",
  );

function stroke(id: string, x: number, y: number): Stroke {
  return { id, color: "#000000", size: 4, tool: "pen", pts: [x, y, 0.5, x + 100, y + 50, 0.5] };
}

/** A board file of three boards, each with a stroke, the second titled. */
function threeBoards(): InkDocument {
  const doc = board();
  doc.pages[0].strokes.push(stroke("s1", 2800, 2800));
  for (const n of [2, 3]) {
    const page = newBoardPage(nextPageId(doc), doc.pages[0]);
    page.strokes.push(stroke(`s${n}`, 1000 * n, 1000 * n));
    doc.pages.push(page);
  }
  doc.pages[1].title = "Plan";
  return doc;
}

function stored(payload: string): { requires?: string[]; meta?: Record<string, unknown> } {
  return JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as {
    requires?: string[];
    meta?: Record<string, unknown>;
  };
}

describe("a one-board file", () => {
  it("reads as 2.9.1 saved it and saves back byte for byte", () => {
    const doc = decodeDocument(ONE_BOARD_291);
    expect(doc.endless).toBe(true);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].title).toBe("Ideas");
    expect(encodeDocument(doc)).toBe(ONE_BOARD_291);
  });

  it("keeps the plain label: every older build still opens it", () => {
    const payload = encodeDocument(board());
    expect(payload.startsWith("v2:")).toBe(true);
    expect(stored(payload).requires).toBeUndefined();
  });
});

describe("a file of several boards", () => {
  it("saves under the boards label and loads as the same boards", () => {
    const doc = threeBoards();
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2+boards:")).toBe(true);
    expect(stored(payload).requires).toEqual(["boards"]);
    expect(stored(payload).meta).toMatchObject({ single: true, endless: true });
    const loaded = decodeDocument(payload);
    expect(loaded.endless).toBe(true);
    expect(loaded.pages.map((page) => page.id)).toEqual(["p1", "p2", "p3"]);
    expect(loaded.pages[1].title).toBe("Plan");
    expect(loaded.pages.map((page) => page.strokes[0].id)).toEqual(["s1", "s2", "s3"]);
    expect(encodeDocument(loaded)).toBe(payload);
  });

  it("is refused by FineNotes 2.9.1, whose protected load then holds it read-only", () => {
    const label = encodeDocument(threeBoards()).split(":")[0];
    const read = readPayloadLabel(label);
    expect(isLabelProblem(read)).toBe(false);
    // 2.9.1 accepts only the features it lists; `boards` is not one of them.
    const features = label.split("+").slice(1);
    expect(features).toEqual(["boards"]);
    expect(features.every((feature) => FEATURES_291.includes(feature))).toBe(false);
    // And this build knows every feature 2.9.1 did, in the same order.
    expect(FORMAT_FEATURES.slice(0, FEATURES_291.length)).toEqual(FEATURES_291);
  });

  it("is a newer file to a reader that lacks the feature, not a broken one", () => {
    expect(needsNewerReader("v2+boards+later:AAAA")).toBe(true);
    expect(needsNewerReader(encodeDocument(threeBoards()))).toBe(false);
  });

  it("goes back to the plain label once one board is left", () => {
    const doc = threeBoards();
    doc.pages.splice(1, 2);
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2:")).toBe(true);
    expect(decodeDocument(payload).endless).toBe(true);
  });

  it("still names its other features, boards last", () => {
    const doc = threeBoards();
    doc.pages[2].textBoxes.push({
      id: "t1",
      x: 1,
      y: 2,
      w: 100,
      text: "Turned",
      color: "#000",
      fontSize: 20,
      rotation: 0.3,
    });
    expect(encodeDocument(doc).startsWith("v2+text-turn+boards:")).toBe(true);
  });

  it("without the label (a hand edit), is a notebook of its pages, none lost", () => {
    const json = stored(encodeDocument(threeBoards()));
    delete json.requires;
    expect(json.meta?.endless).toBe(true);
    const loaded = decodeDocument(`v2:${deflateToBase64(JSON.stringify(json))}`);
    expect(loaded.endless).toBeUndefined();
    expect(loaded.pages).toHaveLength(3);
    expect(loaded.pages[2].strokes).toHaveLength(1);
  });
});

describe("boards come and go as pages do", () => {
  it("adds, moves and removes a board as one undo step each", () => {
    const doc = threeBoards();
    const before = JSON.stringify(doc);
    const history = new History();
    history.push(doc, new AddPage(3, newBoardPage(nextPageId(doc), doc.pages[0])));
    history.push(doc, new MovePage(3, 0));
    history.push(doc, new RemovePage(2));
    expect(doc.pages.map((page) => page.id)).toEqual(["p4", "p1", "p3"]);
    history.undo(doc);
    history.undo(doc);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("newBoardPage", () => {
  it("is an empty board of the starting size on the paper of the board being read", () => {
    const like = board().pages[0];
    const page = newBoardPage("p7", like);
    expect(page.id).toBe("p7");
    expect(page.geometry).toEqual(boardStartGeometry());
    expect(page.backdrop).toEqual(like.backdrop);
    expect(page.backdrop).not.toBe(like.backdrop);
    expect(page.strokes).toEqual([]);
  });

  it("is blank when there is no board paper to follow", () => {
    expect(newBoardPage("p2", undefined).backdrop).toEqual({ kind: "blank" });
    const lined: Page = {
      ...blankPage("p1"),
      backdrop: { kind: "ruled-wide" } as Page["backdrop"],
    };
    expect(newBoardPage("p2", lined).backdrop).toEqual({ kind: "blank" });
  });
});

describe("boardThumbBox", () => {
  const withInk = (pts: number[]): Page => {
    const page = newBoardPage("p1", undefined);
    page.strokes.push({ id: "s", color: "#000", size: 4, tool: "pen", pts });
    return page;
  };

  it("shows a squarish drawing as the export cuts it", () => {
    const page = withInk([2000, 2000, 0.5, 2600, 2500, 0.5]);
    expect(boardThumbBox(page)).toEqual(boardDrawingBox(page));
  });

  it("widens one long line to the thumbnail's flattest shape, about its middle", () => {
    const page = withInk([1000, 2800, 0.5, 4000, 2800, 0.5]);
    const cut = boardDrawingBox(page);
    const box = boardThumbBox(page);
    expect(box.width).toBe(cut.width);
    expect(box.width / box.height).toBeCloseTo(BOARD_THUMB_ASPECT, 9);
    expect(box.y + box.height / 2).toBeCloseTo(cut.y + cut.height / 2, 9);
  });

  it("widens a tall drawing too, and stays on the page at its edge", () => {
    const page = withInk([0, 0, 0.5, 0, 4000, 0.5]);
    const box = boardThumbBox(page);
    expect(box.height / box.width).toBeCloseTo(BOARD_THUMB_ASPECT, 9);
    expect(box.x).toBe(0);
  });

  it("never reaches past a page smaller than the shape it wants", () => {
    const page = withInk([10, 10, 0.5, BOARD_BLOCK - 10, 10, 0.5]);
    page.geometry = { width: BOARD_BLOCK, height: 280 };
    const box = boardThumbBox(page);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(280);
    expect(box.x + box.width).toBeLessThanOrEqual(BOARD_BLOCK);
  });
});

describe("boardLabel", () => {
  it("is the board's number, and its name when it has one", () => {
    const page = newBoardPage("p1", undefined);
    expect(boardLabel(page, 0)).toBe("1");
    page.title = "Plan";
    expect(boardLabel(page, 1)).toBe("2  Plan");
    expect(boardLabel(undefined, 2)).toBe("3");
  });
});

describe("a board among a notebook's pages", () => {
  function notebookWithBoard(): InkDocument {
    const doc = buildNewDocument(DEFAULT_NOTEBOOK_CHOICES, "Physics");
    const board = newBoardPage(nextPageId(doc), doc.pages[1], true);
    board.strokes.push(stroke("s7", 2800, 2800));
    doc.pages.splice(1, 0, board);
    return doc;
  }

  it("is flagged on its page, and the notebook saves under the boards label", () => {
    const doc = notebookWithBoard();
    expect(doc.pages[1].board).toBe(true);
    expect(isBoardPage(doc, doc.pages[1])).toBe(true);
    expect(isBoardPage(doc, doc.pages[0])).toBe(false);
    expect(hasBoards(doc)).toBe(true);
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2+boards:")).toBe(true);
    const loaded = decodeDocument(payload);
    expect(loaded.endless).toBeUndefined();
    expect(loaded.pages.map((page) => page.board === true)).toEqual(
      doc.pages.map((page) => page.board === true),
    );
    expect(encodeDocument(loaded)).toBe(payload);
  });

  it("leaves a notebook without one on the plain label, with no flag stored", () => {
    const doc = buildNewDocument(DEFAULT_NOTEBOOK_CHOICES, "Physics");
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2:")).toBe(true);
    expect(hasBoards(doc)).toBe(false);
    expect(JSON.stringify(stored(payload))).not.toContain('"board"');
  });

  it("reads anything but a literal true as an ordinary page", () => {
    const doc = notebookWithBoard();
    const json = stored(encodeDocument(doc)) as unknown as { pages: Array<{ board?: unknown }> };
    json.pages[1].board = "yes";
    const loaded = decodeDocument(`v2+boards:${deflateToBase64(JSON.stringify(json))}`);
    expect(loaded.pages[1].board).toBeUndefined();
  });

  it("every page of a board file is a board, flag or not", () => {
    const doc = board();
    expect(isBoardPage(doc, doc.pages[0])).toBe(true);
    expect(newBoardPage("p2", doc.pages[0]).board).toBeUndefined();
  });
});

describe("a page added next to a board among the pages", () => {
  function pagesAroundBoard(): InkDocument {
    const doc = buildNewDocument(
      { ...DEFAULT_NOTEBOOK_CHOICES, cover: "none", ruling: "ruled-narrow" },
      "x",
    );
    doc.pages.push(newBoardPage(nextPageId(doc), doc.pages[0], true));
    return doc;
  }

  it("takes a page's size and paper, not the board's", () => {
    const doc = pagesAroundBoard();
    const board = doc.pages.length - 1;
    const insert = pageToInsertAfter(doc, board)!;
    expect(insert.page.geometry).toEqual(doc.pages[0].geometry);
    expect(insert.page.backdrop.kind).toBe(doc.pages[0].backdrop.kind);
    expect(insert.page.board).toBeUndefined();
    expect(shapePageFor(doc.pages, board)).toBe(doc.pages[0]);
    expect(paperPageFor(doc.pages, board)).toBe(doc.pages[0]);
  });

  it("is a plain page of the default size in a notebook of boards only", () => {
    const doc = pagesAroundBoard();
    doc.pages.splice(0, doc.pages.length - 1);
    expect(shapePageFor(doc.pages, 0)).toBeUndefined();
    expect(pageToInsertAfter(doc, 0)!.page.geometry).toEqual(blankPage().geometry);
  });
});
