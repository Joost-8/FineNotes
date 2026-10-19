/**
 * `src/model/graph.ts`: the graph element, its loader, its view edits for
 * Explore, its commands, and how the lasso's commands and the serializer
 * carry it. Every inverse must leave the document `JSON.stringify`-identical,
 * key order included.
 */

import { describe, expect, it } from "vitest";
import { type GraphElement, type InkDocument, emptyDocument } from "../../src/model/document";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { History } from "../../src/model/history";
import { duplicatePageAfter } from "../../src/model/page-commands";
import { pageSignature } from "../../src/model/page-signature";
import {
  AddElements,
  RemoveElements,
  ReorientElements,
  ScaleElements,
  TranslateElements,
  copyElements,
  elementsOnPage,
  isEmptySelection,
} from "../../src/model/selection-commands";
import {
  AddGraph,
  EditGraph,
  GRAPH_DEFAULT_COLOR,
  GRAPH_MAX_EXPRESSIONS,
  GRAPH_MAX_SIDE,
  GRAPH_MAX_SPAN,
  GRAPH_MIN_SIDE,
  GRAPH_MIN_SPAN,
  graphBounds,
  GRAPH_COLORS,
  graphContentKey,
  graphFromSpec,
  specOfGraph,
  makeGraph,
  nextGraphId,
  normalizeGraph,
  panView,
  sameView,
  scaleGraph,
  valueAt,
  zoomView,
} from "../../src/model/graph-element";

function sine(id = "f1"): GraphElement {
  return makeGraph({
    id,
    x: 100,
    y: 200,
    w: 300,
    h: 200,
    expressions: [{ text: "sin(x)", color: "#cc3333" }],
    xRange: [-5, 5],
    yRange: [-2, 2],
  });
}

function withGraph(graph = sine()): InkDocument {
  const doc = emptyDocument();
  new AddGraph("p1", graph).apply(doc);
  return doc;
}

const noMint = (): string => {
  throw new Error("minted");
};

describe("makeGraph and normalizeGraph", () => {
  it("keeps every field it is given, in a fixed key order", () => {
    const graph = sine();
    expect(Object.keys(graph)).toEqual([
      "id",
      "x",
      "y",
      "w",
      "h",
      "expressions",
      "xRange",
      "yRange",
    ]);
    expect(graph.expressions).toEqual([{ text: "sin(x)", color: "#cc3333" }]);
  });

  it("stores the options only when they are off", () => {
    const off = makeGraph({ ...sine(), grid: false, labels: false });
    expect(off.grid).toBe(false);
    expect(off.labels).toBe(false);
    const on = makeGraph({ ...sine(), grid: true, labels: true });
    expect("grid" in on).toBe(false);
    expect("labels" in on).toBe(false);
  });

  it("keeps a graph with no expression placeable, but never loads one", () => {
    const empty = makeGraph({ ...sine(), expressions: [] });
    expect(empty.expressions).toEqual([]);
    expect(normalizeGraph(empty, noMint)).toBeNull();
  });

  it("refuses what is not a graph", () => {
    expect(normalizeGraph(null, noMint)).toBeNull();
    expect(normalizeGraph("sin(x)", noMint)).toBeNull();
    expect(normalizeGraph({ expressions: "sin(x)" }, noMint)).toBeNull();
    expect(
      normalizeGraph({ expressions: [{ text: "  " }, { color: "#000000" }, 3] }, noMint),
    ).toBeNull();
  });

  it("repairs a damaged graph rather than losing the user's expressions", () => {
    const graph = normalizeGraph(
      {
        x: "left",
        y: Infinity,
        w: 1,
        h: 1e9,
        expressions: [{ text: "  x^2 ", color: "red" }],
        xRange: [5, -5],
        yRange: [0, Number.NaN],
        grid: "no",
        labels: 0,
      },
      () => "f7",
    );
    expect(graph).toEqual({
      id: "f7",
      x: 0,
      y: 0,
      w: GRAPH_MIN_SIDE,
      h: GRAPH_MAX_SIDE,
      expressions: [{ text: "x^2", color: GRAPH_DEFAULT_COLOR }],
      xRange: [-10, 10],
      yRange: [-10, 10],
    });
  });

  it("caps the number and length of expressions", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `x+${i}`, color: "#000000" }));
    const long = { text: "x".repeat(2000), color: "#000000" };
    const graph = normalizeGraph({ expressions: [long, ...many] }, () => "f1");
    expect(graph?.expressions).toHaveLength(GRAPH_MAX_EXPRESSIONS);
    expect(graph?.expressions[0].text.length).toBe(500);
  });

  it("refuses ranges too narrow, too wide or too far out", () => {
    const at = (xRange: unknown): [number, number] | undefined =>
      normalizeGraph({ expressions: [{ text: "x" }], xRange }, () => "f1")?.xRange;
    expect(at([0, GRAPH_MIN_SPAN / 2])).toEqual([-10, 10]);
    expect(at([0, GRAPH_MAX_SPAN * 2])).toEqual([-10, 10]);
    expect(at([1e13, 1e13 + 1])).toEqual([-10, 10]);
    expect(at([0, 1])).toEqual([0, 1]);
    expect(at([0, 1, 2])).toEqual([-10, 10]);
    expect(at(["0", "1"])).toEqual([-10, 10]);
  });
});

describe("ids, bounds and the content key", () => {
  it("mints one above the highest f<N> in the document", () => {
    expect(nextGraphId(emptyDocument())).toBe("f1");
    const doc = withGraph(sine("f4"));
    new AddGraph("p1", sine("graph")).apply(doc);
    expect(nextGraphId(doc)).toBe("f5");
  });

  it("gives the frame as bounds", () => {
    expect(graphBounds(sine())).toEqual({ minX: 100, minY: 200, maxX: 400, maxY: 400 });
  });

  it("changes the key with what is drawn, not with where", () => {
    const graph = sine();
    const key = graphContentKey(graph);
    graph.x += 50;
    graph.y -= 20;
    expect(graphContentKey(graph)).toBe(key);
    const changes: Array<(g: GraphElement) => void> = [
      (g) => (g.expressions[0].text = "cos(x)"),
      (g) => (g.expressions[0].color = "#000000"),
      (g) => (g.xRange = [-5, 6]),
      (g) => (g.yRange = [-3, 2]),
      (g) => (g.w = 301),
      (g) => (g.h = 199),
      (g) => (g.grid = false),
      (g) => (g.labels = false),
      (g) => g.expressions.push({ text: "x", color: "#000000" }),
    ];
    for (const change of changes) {
      const copy = structuredClone(graph);
      change(copy);
      expect(graphContentKey(copy)).not.toBe(key);
    }
  });
});

describe("Explore's view edits", () => {
  const view = { xRange: [-5, 5] as [number, number], yRange: [-2, 2] as [number, number] };

  it("moves the curve with the finger", () => {
    // Dragging right by a tenth of the frame shows a tenth of the span further left.
    const panned = panView(view, 30, 0, 300, 200);
    expect(panned.xRange).toEqual([-6, 4]);
    expect(panned.yRange).toEqual([-2, 2]);
    // Dragging down shows higher values: y grows upwards on a graph.
    const down = panView(view, 0, 50, 300, 200);
    expect(down.yRange).toEqual([-1, 3]);
  });

  it("ignores a pan it cannot make", () => {
    expect(panView(view, Number.NaN, 0, 300, 200)).toEqual(view);
    expect(panView(view, 10, 10, 0, 200)).toEqual(view);
    const far = { xRange: [1e12 - 1, 1e12] as [number, number], yRange: view.yRange };
    expect(panView(far, -300, 0, 300, 200).xRange).toEqual(far.xRange);
  });

  it("keeps the value under the fingers while zooming", () => {
    const fx = 75;
    const fy = 40;
    const before = valueAt(view, fx, fy, 300, 200);
    const zoomed = zoomView(view, 2, 4, fx, fy, 300, 200);
    const after = valueAt(zoomed, fx, fy, 300, 200);
    expect(after.x).toBeCloseTo(before.x, 12);
    expect(after.y).toBeCloseTo(before.y, 12);
    expect(zoomed.xRange[1] - zoomed.xRange[0]).toBeCloseTo(5, 12);
    expect(zoomed.yRange[1] - zoomed.yRange[0]).toBeCloseTo(1, 12);
  });

  it("stops zooming at the span limits", () => {
    const tiny = zoomView(view, 1e20, 1, 150, 100, 300, 200);
    expect(tiny.xRange[1] - tiny.xRange[0]).toBeCloseTo(GRAPH_MIN_SPAN, 20);
    const huge = zoomView(view, 1e-20, 1, 150, 100, 300, 200);
    expect(huge.xRange[1] - huge.xRange[0]).toBeCloseTo(GRAPH_MAX_SPAN, 0);
    expect(zoomView(view, 0, Number.NaN, 0, 0, 300, 200)).toEqual(view);
    expect(zoomView(view, 2, 2, 0, 0, 0, 0)).toEqual(view);
  });

  it("tells two views apart to the bit", () => {
    expect(sameView(view, { xRange: [-5, 5], yRange: [-2, 2] })).toBe(true);
    expect(sameView(view, { xRange: [-5, 5 + 1e-12], yRange: [-2, 2] })).toBe(false);
  });
});

describe("AddGraph and EditGraph", () => {
  it("adds and takes away exactly that graph, leaving no empty list", () => {
    const doc = emptyDocument();
    const before = JSON.stringify(doc);
    const add = new AddGraph("p1", sine());
    add.apply(doc);
    expect(doc.pages[0].graphs).toHaveLength(1);
    add.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
    new AddGraph("nope", sine()).apply(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("commits a new view as one undo step, identical on undo", () => {
    const doc = withGraph();
    const graph = doc.pages[0].graphs![0];
    const before = JSON.stringify(doc);
    const history = new History();
    history.push(doc, new EditGraph("p1", graph, { xRange: [0, 1], yRange: [2, 3] }));
    expect(graph.xRange).toEqual([0, 1]);
    expect(graph.yRange).toEqual([2, 3]);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
    history.redo(doc);
    expect(graph.xRange).toEqual([0, 1]);
  });

  it("edits the expressions and options, and refuses a bad range", () => {
    const doc = withGraph();
    const graph = doc.pages[0].graphs![0];
    const before = JSON.stringify(doc);
    const edit = new EditGraph("p1", graph, {
      expressions: [{ text: "x^2", color: "#000000" }],
      xRange: [3, 1],
      grid: false,
      labels: false,
    });
    expect(edit.label).toBe("Edit graph");
    edit.apply(doc);
    expect(graph.expressions).toEqual([{ text: "x^2", color: "#000000" }]);
    expect(graph.xRange).toEqual([-5, 5]);
    expect(graph.grid).toBe(false);
    expect(graph.labels).toBe(false);
    new EditGraph("p1", graph, { grid: true, labels: true }).apply(doc);
    expect("grid" in graph || "labels" in graph).toBe(false);
    edit.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("does nothing to a graph no longer on its page", () => {
    const doc = withGraph();
    const stray = sine("f9");
    const edit = new EditGraph("p1", stray, { xRange: [0, 1] });
    edit.apply(doc);
    expect(stray.xRange).toEqual([-5, 5]);
    edit.invert(doc);
    expect(stray.xRange).toEqual([-5, 5]);
  });
});

describe("the lasso's commands carry graphs", () => {
  it("moves, scales, turns, removes and re-adds a graph, each undone exactly", () => {
    const doc = withGraph();
    const page = doc.pages[0];
    const graph = page.graphs![0];
    const sel = { strokes: [], images: [], textBoxes: [], graphs: [graph] };
    expect(isEmptySelection(sel)).toBe(false);
    expect(elementsOnPage(page, sel).graphs).toEqual([graph]);
    const before = JSON.stringify(doc);

    const move = new TranslateElements("p1", sel, 10, -5);
    move.apply(doc);
    expect([graph.x, graph.y]).toEqual([110, 195]);
    move.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);

    const scale = new ScaleElements("p1", sel, 100, 200, 2);
    scale.apply(doc);
    expect([graph.x, graph.y, graph.w, graph.h]).toEqual([100, 200, 600, 400]);
    expect(graph.xRange).toEqual([-5, 5]);
    scale.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);

    // A half turn about the graph's own middle leaves it where it was, upright.
    const turn = new ReorientElements("p1", sel, { kind: "rotate", angle: Math.PI }, 250, 300);
    turn.apply(doc);
    expect(graph.x).toBeCloseTo(100, 9);
    expect(graph.y).toBeCloseTo(200, 9);
    turn.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);

    const remove = new RemoveElements("p1", sel);
    remove.apply(doc);
    expect(page.graphs).toEqual([]);
    remove.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("duplicates a graph whole, with a fresh id, and undoes it", () => {
    const doc = withGraph();
    const graph = doc.pages[0].graphs![0];
    graph.grid = false;
    const before = JSON.stringify(doc);
    const ids = {
      stroke: () => "s1",
      image: () => "i1",
      textBox: () => "t1",
      table: () => "g1",
      graph: () => "f2",
    };
    const copies = copyElements(
      { strokes: [], images: [], textBoxes: [], graphs: [graph] },
      ids,
      20,
      20,
    );
    const copy = copies.graphs![0];
    expect(copy).not.toBe(graph);
    expect(copy).toEqual({ ...graph, id: "f2", x: 120, y: 220 });
    const add = new AddElements("p1", copies);
    add.apply(doc);
    expect(doc.pages[0].graphs).toHaveLength(2);
    add.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("leaves no graphs list behind on a page that had none", () => {
    const doc = emptyDocument();
    const before = JSON.stringify(doc);
    const add = new AddElements("p1", { strokes: [], images: [], textBoxes: [], graphs: [sine()] });
    add.apply(doc);
    add.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("gives a duplicated page's graphs fresh ids", () => {
    const doc = withGraph(sine("f3"));
    const dup = duplicatePageAfter(doc, 0);
    expect(dup?.page.graphs?.[0].id).toBe("f4");
    expect(dup?.page.graphs?.[0]).not.toBe(doc.pages[0].graphs![0]);
  });

  it("changes the page's signature when a graph changes", () => {
    const doc = withGraph();
    const page = doc.pages[0];
    const before = pageSignature(page);
    page.graphs![0].xRange = [0, 1];
    expect(pageSignature(page)).not.toBe(before);
    const plain = emptyDocument().pages[0];
    expect(pageSignature(plain)).not.toContain("graphs");
  });
});

describe("saving and loading", () => {
  it("round-trips a graph exactly, and a page without one stays without", () => {
    const doc = withGraph();
    doc.pages[0].graphs![0].labels = false;
    const back = decodeDocument(encodeDocument(doc));
    expect(JSON.stringify(back.pages[0].graphs)).toBe(JSON.stringify(doc.pages[0].graphs));
    const plain = decodeDocument(encodeDocument(emptyDocument()));
    expect("graphs" in plain.pages[0]).toBe(false);
  });

  it("writes the pinned wire form (golden)", () => {
    const doc = withGraph();
    const json = inflateFromBase64(encodeDocument(doc).slice(encodeDocument(doc).indexOf(":") + 1));
    const page = (JSON.parse(json) as { pages: Array<Record<string, unknown>> }).pages[0];
    expect(JSON.stringify(page.graphs)).toBe(
      '[{"id":"f1","x":100,"y":200,"w":300,"h":200,' +
        '"expressions":[{"text":"sin(x)","color":"#cc3333"}],' +
        '"xRange":[-5,5],"yRange":[-2,2]}]',
    );
    // The page's keys stay in their order, graphs after tables and before comments.
    expect(Object.keys(page)).toEqual([
      "id",
      "kind",
      "geometry",
      "backdrop",
      "images",
      "textBoxes",
      "graphs",
      "strokes",
    ]);
  });

  it("mints ids for stored graphs without one, above the highest", () => {
    const stored = JSON.parse(inflateFromBase64(encodeDocument(emptyDocument()).slice(3))) as {
      pages: Array<Record<string, unknown>>;
    };
    stored.pages[0].graphs = [
      { id: "f5", expressions: [{ text: "x", color: "#000000" }] },
      { expressions: [{ text: "x^2", color: "#000000" }] },
      { expressions: [] },
    ];
    const doc = decodeDocument(`v2:${deflateToBase64(JSON.stringify(stored))}`);
    expect(doc.pages[0].graphs!.map((g) => g.id)).toEqual(["f5", "f6"]);
  });

  it("opens a note whose page holds an element kind it does not know", () => {
    // What 2.3.0 does with `graphs` is what this build does with any key it
    // has never heard of: the note opens, the rest of the page is intact.
    const stored = JSON.parse(inflateFromBase64(encodeDocument(withGraph()).slice(3))) as {
      pages: Array<Record<string, unknown>>;
    };
    stored.pages[0].sparkles = [{ id: "z1", glitter: true }];
    const doc = decodeDocument(`v2:${deflateToBase64(JSON.stringify(stored))}`);
    expect(doc.pages[0].graphs).toHaveLength(1);
    expect("sparkles" in doc.pages[0]).toBe(false);
  });

  it("scales a graph's frame only within its limits", () => {
    const graph = sine();
    scaleGraph(graph, 0, 0, 1e6);
    expect(graph.w).toBe(GRAPH_MAX_SIDE);
    const g2 = sine();
    scaleGraph(g2, 0, 0, Number.NaN);
    expect(g2).toEqual(sine());
  });
});

describe("graphFromSpec and specOfGraph", () => {
  it("makes a graph from the calculator's spec, colouring in the palette's order", () => {
    const graph = graphFromSpec(
      "f3",
      10,
      20,
      { expressions: ["y = sin(x)", "  ", "x^2"], xMin: -3, xMax: 3, yMin: -1, yMax: 9 },
      ["#123456", "#abcdef", "not a colour"],
    );
    expect(graph.id).toBe("f3");
    expect([graph.x, graph.y]).toEqual([10, 20]);
    expect(graph.expressions).toEqual([
      { text: "y = sin(x)", color: "#123456" },
      { text: "x^2", color: GRAPH_COLORS[1] },
    ]);
    expect(graph.xRange).toEqual([-3, 3]);
    expect(graph.yRange).toEqual([-1, 9]);
    expect("angle" in graph).toBe(false);
  });

  it("keeps degrees, and gives Edit back the spec it came from", () => {
    const spec = {
      expressions: ["sin(x)"],
      xMin: -360,
      xMax: 360,
      yMin: -2,
      yMax: 2,
      angle: "deg" as const,
    };
    const graph = graphFromSpec("f1", 0, 0, spec);
    expect(graph.angle).toBe("deg");
    expect(specOfGraph(graph)).toEqual(spec);
    expect(specOfGraph(sine()).angle).toBe("rad");
    const back = decodeDocument(encodeDocument(withGraph(graph)));
    expect(back.pages[0].graphs![0].angle).toBe("deg");
  });

  it("changes the content key with the angle mode, and EditGraph switches it", () => {
    const doc = withGraph();
    const graph = doc.pages[0].graphs![0];
    const key = graphContentKey(graph);
    const before = JSON.stringify(doc);
    const edit = new EditGraph("p1", graph, { angle: "deg" });
    edit.apply(doc);
    expect(graph.angle).toBe("deg");
    expect(graphContentKey(graph)).not.toBe(key);
    new EditGraph("p1", graph, { angle: "rad" }).apply(doc);
    expect("angle" in graph).toBe(false);
    edit.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("falls back to the default view for a range it cannot use", () => {
    const graph = graphFromSpec("f1", 0, 0, {
      expressions: ["x"],
      xMin: 1,
      xMax: 1,
      yMin: 0,
      yMax: Infinity,
    });
    expect(graph.xRange).toEqual([-10, 10]);
    expect(graph.yRange).toEqual([-10, 10]);
  });
});
