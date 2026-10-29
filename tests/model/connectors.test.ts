/**
 * Arrows joining two shapes (src/model/connectors.ts, discussion #51): what
 * is live, how they are read, saved, copied with a page, and the two edits
 * that make linked shapes. The notebook is labelled `v2+connectors:` so an
 * older FineNotes holds it read-only instead of saving the arrows away.
 */

import { describe, expect, it } from "vitest";
import { inflateFromBase64 } from "../../src/model/compress";
import {
  AddConnector,
  AddLinkedCopy,
  RetypeShape,
  connectorsOf,
  liveConnectors,
  nextConnectorId,
  readConnectors,
  remapConnectors,
} from "../../src/model/connectors";
import {
  type InkDocument,
  type ShapeConnector,
  type Stroke,
  emptyDocument,
} from "../../src/model/document";
import { History } from "../../src/model/history";
import { duplicatePageAfter } from "../../src/model/page-commands";
import { prepareTransfer } from "../../src/model/page-transfer";
import {
  buildInkFile,
  decodeDocument,
  encodeDocument,
  parseInkFile,
} from "../../src/model/serialize";
import { distrust } from "../../src/view/load-guard";

function rect(id: string, x: number, y: number): Stroke {
  return {
    id,
    color: "#1f6feb",
    size: 3,
    tool: "pen",
    shape: "rect",
    pts: [x, y, 0.5, x + 100, y, 0.5, x + 100, y + 60, 0.5, x, y + 60, 0.5, x, y, 0.5],
  };
}

function link(id: string, from: string, to: string): ShapeConnector {
  return {
    id,
    from: { stroke: from, side: "right" },
    to: { stroke: to, side: "left" },
    color: "#1f6feb",
    size: 3,
  };
}

function linked(): InkDocument {
  const doc = emptyDocument(1024);
  doc.pages[0].strokes.push(rect("s1", 100, 100), rect("s2", 400, 100));
  doc.pages[0].connectors = [link("cn1", "s1", "s2")];
  return doc;
}

function stored(payload: string): { pages: Array<Record<string, unknown>> } {
  return JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as {
    pages: Array<Record<string, unknown>>;
  };
}

/** Every reader since 2.0 checked the whole label for a number, nothing more. */
function olderReaderAccepts(payload: string): boolean {
  const colon = payload.indexOf(":");
  return payload.startsWith("v") && Number.isFinite(Number(payload.slice(1, colon)));
}

describe("live connectors", () => {
  it("are those whose two shapes are on the page", () => {
    const doc = linked();
    const page = doc.pages[0];
    expect(liveConnectors(page).map((c) => c.id)).toEqual(["cn1"]);
    expect(connectorsOf(page, "s2").map((c) => c.id)).toEqual(["cn1"]);
    expect(connectorsOf(page, "s9")).toEqual([]);
    page.strokes.splice(1, 1);
    expect(liveConnectors(page)).toEqual([]);
    expect(liveConnectors(emptyDocument().pages[0])).toEqual([]);
  });

  it("number on from the notebook's highest", () => {
    const doc = linked();
    expect(nextConnectorId(doc)).toBe("cn2");
    doc.pages[0].connectors!.push({ ...link("cn7", "s2", "s1") });
    expect(nextConnectorId(doc)).toBe("cn8");
    expect(nextConnectorId(emptyDocument())).toBe("cn1");
  });
});

describe("readConnectors", () => {
  const ids = new Set(["s1", "s2"]);

  it("keeps a whole connector", () => {
    expect(readConnectors([link("cn1", "s1", "s2")], ids, new Set())).toEqual([
      link("cn1", "s1", "s2"),
    ]);
  });

  it("drops what it cannot draw: unknown shapes, one shape twice, bad sides, colours, widths, repeats", () => {
    const good = link("cn1", "s1", "s2");
    const seen = new Set<string>();
    const out = readConnectors(
      [
        good,
        { ...good, id: "cn1" },
        { ...good, id: "cn2", to: { stroke: "s9", side: "left" } },
        { ...good, id: "cn3", to: { stroke: "s1", side: "left" } },
        { ...good, id: "cn4", from: { stroke: "s1", side: "middle" } },
        { ...good, id: "cn5", color: "blue" },
        { ...good, id: "cn6", size: 0 },
        { ...good, id: "" },
        null,
        "cn7",
      ],
      ids,
      seen,
    );
    expect(out.map((c) => c.id)).toEqual(["cn1"]);
    expect(readConnectors("nope", ids, new Set())).toEqual([]);
  });
});

describe("a notebook with linked shapes, saved", () => {
  it("is labelled v2+connectors, which no older reader accepts, and reads back", () => {
    const payload = encodeDocument(linked());
    expect(payload.startsWith("v2+connectors:")).toBe(true);
    expect(olderReaderAccepts(payload)).toBe(false);
    const back = decodeDocument(payload, 1024);
    expect(back.pages[0].connectors).toEqual([link("cn1", "s1", "s2")]);
    // The same bytes again once read.
    expect(encodeDocument(back)).toBe(payload);
  });

  it("is held read-only by an older build, as sticky notes are", () => {
    const text = buildInkFile("Prose.", linked());
    const block = text.split("\n").find((line) => line.startsWith("v2"));
    expect(block && olderReaderAccepts(block)).toBe(false);
    expect(distrust({ text, bytesOnDisk: text.length, decoded: false })).toBe("unreadable-ink");
    expect(parseInkFile(text).doc?.pages[0].connectors?.length).toBe(1);
  });

  it("does not save an arrow whose shape is gone, and keeps the plain label then", () => {
    const doc = linked();
    doc.pages[0].strokes.splice(1, 1);
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2:")).toBe(true);
    expect(stored(payload).pages[0].connectors).toBeUndefined();
    expect(decodeDocument(payload, 1024).pages[0].connectors).toBeUndefined();
  });
});

describe("copying a page keeps its shapes joined", () => {
  it("duplicate: the arrow joins the copies, under a new id", () => {
    const doc = linked();
    const made = duplicatePageAfter(doc, 0)!;
    const copy = made.page;
    const [a, b] = copy.strokes.map((s) => s.id);
    expect(a).not.toBe("s1");
    expect(copy.connectors).toEqual([{ ...link("cn2", a, b) }]);
    // The original is untouched.
    expect(doc.pages[0].connectors).toEqual([link("cn1", "s1", "s2")]);
  });

  it("transfer to another notebook: the same, numbered above what it holds", () => {
    const dest = linked();
    const [copy] = prepareTransfer(linked().pages, dest);
    const ids = copy.strokes.map((s) => s.id);
    expect(copy.connectors?.[0]).toMatchObject({
      id: "cn2",
      from: { stroke: ids[0] },
      to: { stroke: ids[1] },
    });
  });

  it("leaves behind an arrow whose shapes did not come along", () => {
    expect(remapConnectors([link("cn1", "s1", "s2")], new Map([["s1", "s5"]]), () => "x")).toEqual(
      [],
    );
    expect(remapConnectors(undefined, new Map(), () => "x")).toEqual([]);
  });
});

describe("AddLinkedCopy", () => {
  it("adds the copy and its arrow as one step, and undo leaves the page exactly as it was", () => {
    const doc = emptyDocument(1024);
    doc.pages[0].strokes.push(rect("s1", 100, 100));
    const before = JSON.stringify(doc);
    const copy = rect("s2", 400, 100);
    const arrow = link("cn1", "s1", "s2");
    const history = new History();
    history.push(doc, new AddLinkedCopy("p1", copy, arrow));
    expect(doc.pages[0].strokes.at(-1)).toBe(copy);
    expect(doc.pages[0].connectors).toEqual([arrow]);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
    history.redo(doc);
    expect(liveConnectors(doc.pages[0])).toEqual([arrow]);
  });

  it("keeps a page's other arrows, and its list, on undo", () => {
    const doc = linked();
    const command = new AddLinkedCopy("p1", rect("s3", 100, 400), link("cn2", "s1", "s3"));
    command.apply(doc);
    command.invert(doc);
    expect(doc.pages[0].connectors).toEqual([link("cn1", "s1", "s2")]);
    // A page that is gone: nothing to do.
    new AddLinkedCopy("p9", rect("s4", 0, 0), link("cn3", "s1", "s4")).invert(doc);
  });
});

describe("AddConnector", () => {
  it("joins two shapes already on the page as one step, and undo leaves the page exactly as it was", () => {
    // Joost, 2026-10-29: a side dot's arrow dropped on another shape.
    const doc = emptyDocument(1024);
    doc.pages[0].strokes.push(rect("s1", 100, 100), rect("s2", 400, 100));
    const before = JSON.stringify(doc);
    const arrow = link("cn1", "s1", "s2");
    const history = new History();
    history.push(doc, new AddConnector("p1", arrow));
    expect(doc.pages[0].strokes).toHaveLength(2);
    expect(liveConnectors(doc.pages[0])).toEqual([arrow]);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
    history.redo(doc);
    expect(doc.pages[0].connectors).toEqual([arrow]);
  });

  it("keeps a page's other arrows on undo, and does nothing on a page that is gone", () => {
    const doc = linked();
    const command = new AddConnector("p1", link("cn2", "s2", "s1"));
    command.apply(doc);
    expect(doc.pages[0].connectors).toHaveLength(2);
    command.invert(doc);
    expect(doc.pages[0].connectors).toEqual([link("cn1", "s1", "s2")]);
    const lost = new AddConnector("p9", link("cn3", "s1", "s2"));
    lost.apply(doc);
    lost.invert(doc);
    expect(doc.pages[0].connectors).toEqual([link("cn1", "s1", "s2")]);
  });
});

describe("RetypeShape", () => {
  it("gives a shape new points and kind in place, and undo puts back the very array", () => {
    const doc = linked();
    const shape = doc.pages[0].strokes[1];
    const old = shape.pts;
    const pts = [450, 100, 0.5, 500, 160, 0.5, 400, 160, 0.5, 450, 100, 0.5];
    const history = new History();
    history.push(doc, new RetypeShape("p1", shape, pts, "triangle"));
    expect(shape.pts).toBe(pts);
    expect(shape.shape).toBe("triangle");
    expect(liveConnectors(doc.pages[0]).length).toBe(1);
    history.undo(doc);
    expect(shape.pts).toBe(old);
    expect(shape.shape).toBe("rect");
  });

  it("does nothing for a shape no longer on its page", () => {
    const doc = linked();
    const loose = rect("s9", 0, 0);
    const command = new RetypeShape("p1", loose, [1, 1, 0.5], "triangle");
    command.apply(doc);
    expect(loose.shape).toBe("rect");
    command.invert();
  });
});
