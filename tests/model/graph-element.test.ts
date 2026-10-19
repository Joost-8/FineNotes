/**
 * `src/model/graph-element.ts`: the graph element, which keeps the
 * calculator's spec whole; its loader (and the earlier stored shape), its
 * view edits for Explore, its commands, and how the lasso's commands, the
 * clipboard and the serializer carry it. Every inverse must leave the
 * document `JSON.stringify`-identical, key order included, and a spec field
 * this file has never heard of must survive all of it.
 */

import { describe, expect, it } from "vitest";
import { type GraphElement, type InkDocument, emptyDocument } from "../../src/model/document";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { History } from "../../src/model/history";
import { InkClipboard, pasteCopies } from "../../src/model/clipboard";
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
  GRAPH_COLORS,
  GRAPH_MAX_SIDE,
  GRAPH_MAX_SPAN,
  GRAPH_MAX_SPEC_CHARS,
  GRAPH_MIN_SIDE,
  GRAPH_MIN_SPAN,
  curveColor,
  graphBounds,
  graphContentKey,
  graphFrameHeight,
  graphFromSpec,
  makeGraph,
  nextGraphId,
  normalizeGraph,
  panView,
  sameView,
  scaleGraph,
  setView,
  specOfGraph,
  valueAt,
  viewOf,
  zoomView,
} from "../../src/model/graph-element";

/** A spec as the calculator gives it, plus a field from a future calculator. */
function futureSpec(): Record<string, unknown> & {
  expressions: string[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  return {
    expressions: ["sin(a·x)"],
    xMin: -5,
    xMax: 5,
    yMin: -2,
    yMax: 2,
    angle: "rad",
    sliders: [{ name: "a", value: 1.5, min: 0, max: 3 }],
  };
}

function sine(id = "f1"): GraphElement {
  return makeGraph({
    id,
    x: 100,
    y: 200,
    w: 300,
    h: 200,
    spec: futureSpec() as never,
    colors: ["#cc3333"],
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

/** A note whose first page's stored JSON is changed by `edit`, read back. */
function reread(doc: InkDocument, edit: (page: Record<string, unknown>) => void): InkDocument {
  const payload = encodeDocument(doc);
  const stored = JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as {
    pages: Array<Record<string, unknown>>;
  };
  edit(stored.pages[0]);
  return decodeDocument(`v2:${deflateToBase64(JSON.stringify(stored))}`);
}

describe("makeGraph and normalizeGraph", () => {
  it("keeps the spec whole, every field it has, as a copy", () => {
    const spec = futureSpec();
    const graph = makeGraph({ id: "f1", x: 1, y: 2, spec: spec as never });
    expect(graph.spec).toEqual(spec);
    expect(graph.spec).not.toBe(spec);
    (spec.sliders as Array<{ value: number }>)[0].value = 9;
    expect((graph.spec.sliders as Array<{ value: number }>)[0].value).toBe(1.5);
    expect(Object.keys(graph)).toEqual(["id", "x", "y", "w", "h", "spec", "colors"]);
  });

  it("gives every expression a colour: its own when valid, else the palette's", () => {
    const graph = makeGraph({
      id: "f1",
      x: 0,
      y: 0,
      spec: { expressions: ["x", "x^2", "x^3"], xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
      colors: ["#123456", "red"],
    });
    expect(graph.colors).toEqual(["#123456", GRAPH_COLORS[1], GRAPH_COLORS[2]]);
    expect(curveColor(graph, 0)).toBe("#123456");
    expect(curveColor({ colors: [] }, 7)).toBe(GRAPH_COLORS[1]);
  });

  it("stores the options only when they are off", () => {
    const off = makeGraph({
      id: "f1",
      x: 0,
      y: 0,
      spec: futureSpec() as never,
      grid: false,
      labels: false,
    });
    expect(off.grid).toBe(false);
    expect(off.labels).toBe(false);
    const on = makeGraph({ id: "f1", x: 0, y: 0, spec: futureSpec() as never, grid: true });
    expect("grid" in on || "labels" in on).toBe(false);
  });

  it("refuses what is not a graph, and loads no graph with nothing to plot", () => {
    expect(normalizeGraph(null, noMint)).toBeNull();
    expect(normalizeGraph({ spec: "sin(x)" }, noMint)).toBeNull();
    expect(normalizeGraph({ spec: [1, 2] }, noMint)).toBeNull();
    expect(normalizeGraph({ spec: { expressions: "x" } }, noMint)).toBeNull();
    expect(normalizeGraph({ spec: { expressions: [] } }, noMint)).toBeNull();
    const huge = { expressions: ["x"], note: "y".repeat(GRAPH_MAX_SPEC_CHARS) };
    expect(normalizeGraph({ spec: huge }, noMint)).toBeNull();
    const cyclic: Record<string, unknown> = { expressions: ["x"] };
    cyclic.self = cyclic;
    expect(normalizeGraph({ spec: cyclic }, noMint)).toBeNull();
    // A placed graph with nothing to plot still makes an object to test.
    expect(makeGraph({ id: "f1", x: 0, y: 0, spec: "x" as never }).spec.expressions).toEqual([]);
  });

  it("repairs a damaged frame and view rather than losing what it plots", () => {
    const graph = normalizeGraph(
      {
        x: "left",
        y: Infinity,
        w: 1,
        h: 1e9,
        spec: { expressions: ["x^2"], xMin: 5, xMax: -5, yMin: 0, yMax: 2, angle: "grad", z: 1 },
        colors: "red",
      },
      () => "f7",
    );
    expect(graph).toEqual({
      id: "f7",
      x: 0,
      y: 0,
      w: GRAPH_MIN_SIDE,
      h: GRAPH_MAX_SIDE,
      spec: { expressions: ["x^2"], xMin: -10, xMax: 10, yMin: 0, yMax: 2, z: 1 },
      colors: [GRAPH_COLORS[0]],
    });
  });

  it("refuses ranges too narrow, too wide or too far out", () => {
    const at = (xMin: unknown, xMax: unknown): number[] | undefined => {
      const g = normalizeGraph({ spec: { expressions: ["x"], xMin, xMax } }, () => "f1");
      return g ? [g.spec.xMin, g.spec.xMax] : undefined;
    };
    expect(at(0, GRAPH_MIN_SPAN / 2)).toEqual([-10, 10]);
    expect(at(0, GRAPH_MAX_SPAN * 2)).toEqual([-10, 10]);
    expect(at(1e13, 1e13 + 1)).toEqual([-10, 10]);
    expect(at("0", "1")).toEqual([-10, 10]);
    expect(at(0, 1)).toEqual([0, 1]);
  });

  it("reads a graph stored in the first builds' shape", () => {
    const graph = normalizeGraph(
      {
        id: "f2",
        x: 10,
        y: 20,
        w: 300,
        h: 200,
        expressions: [{ text: "sin(x)", color: "#cc3333" }, { text: "x", color: "nope" }, 3],
        xRange: [-360, 360],
        yRange: [-2, 2],
        angle: "deg",
        labels: false,
      },
      noMint,
    );
    expect(graph).toEqual({
      id: "f2",
      x: 10,
      y: 20,
      w: 300,
      h: 200,
      spec: {
        expressions: ["sin(x)", "x"],
        xMin: -360,
        xMax: 360,
        yMin: -2,
        yMax: 2,
        angle: "deg",
      },
      colors: ["#cc3333", GRAPH_COLORS[1]],
      labels: false,
    });
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

  it("changes the key with anything drawn, a field it does not know included, not with where", () => {
    const graph = sine();
    const key = graphContentKey(graph);
    graph.x += 50;
    graph.y -= 20;
    expect(graphContentKey(graph)).toBe(key);
    const changes: Array<(g: GraphElement) => void> = [
      (g) => (g.spec.expressions[0] = "cos(x)"),
      (g) => (g.colors[0] = "#000000"),
      (g) => (g.spec.xMax = 6),
      (g) => (g.spec.yMin = -3),
      (g) => (g.spec.angle = "deg"),
      (g) => ((g.spec.sliders as Array<{ value: number }>)[0].value = 2),
      (g) => (g.w = 301),
      (g) => (g.h = 199),
      (g) => (g.grid = false),
      (g) => (g.labels = false),
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

  it("reads and sets the view on the spec, touching nothing else", () => {
    const graph = sine();
    expect(viewOf(graph)).toEqual(view);
    setView(graph, { xRange: [0, 1], yRange: [2, 3] });
    expect(graph.spec).toEqual({ ...futureSpec(), xMin: 0, xMax: 1, yMin: 2, yMax: 3 });
  });

  it("moves the curve with the finger", () => {
    const panned = panView(view, 30, 0, 300, 200);
    expect(panned.xRange).toEqual([-6, 4]);
    expect(panned.yRange).toEqual([-2, 2]);
    expect(panView(view, 0, 50, 300, 200).yRange).toEqual([-1, 3]);
  });

  it("ignores a pan it cannot make", () => {
    expect(panView(view, Number.NaN, 0, 300, 200)).toEqual(view);
    expect(panView(view, 10, 10, 0, 200)).toEqual(view);
    const far = { xRange: [1e12 - 1, 1e12] as [number, number], yRange: view.yRange };
    expect(panView(far, -300, 0, 300, 200).xRange).toEqual(far.xRange);
  });

  it("keeps the value under the fingers while zooming", () => {
    const before = valueAt(view, 75, 40, 300, 200);
    const zoomed = zoomView(view, 2, 2, 75, 40, 300, 200);
    const after = valueAt(zoomed, 75, 40, 300, 200);
    expect(after.x).toBeCloseTo(before.x, 12);
    expect(after.y).toBeCloseTo(before.y, 12);
    expect(zoomed.xRange[1] - zoomed.xRange[0]).toBeCloseTo(5, 12);
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

  it("commits a new view as one undo step, keeping every other spec field", () => {
    const doc = withGraph();
    const graph = doc.pages[0].graphs![0];
    const before = JSON.stringify(doc);
    const history = new History();
    const edit = new EditGraph("p1", graph, { view: { xRange: [0, 1], yRange: [2, 3] } });
    expect(edit.label).toBe("Move graph view");
    history.push(doc, edit);
    expect(graph.spec).toEqual({ ...futureSpec(), xMin: 0, xMax: 1, yMin: 2, yMax: 3 });
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
    history.redo(doc);
    expect(graph.spec.xMax).toBe(1);
  });

  it("replaces the whole spec on Edit, with colours, and refuses one it cannot read", () => {
    const doc = withGraph();
    const graph = doc.pages[0].graphs![0];
    const before = JSON.stringify(doc);
    const next = {
      expressions: ["x^2", "x"],
      xMin: -1,
      xMax: 1,
      yMin: 0,
      yMax: 1,
      parametric: true,
    };
    const edit = new EditGraph("p1", graph, { spec: next, colors: ["#000000"], grid: false });
    expect(edit.label).toBe("Edit graph");
    edit.apply(doc);
    expect(graph.spec).toEqual(next);
    expect(graph.colors).toEqual(["#000000", GRAPH_COLORS[1]]);
    expect(graph.grid).toBe(false);
    new EditGraph("p1", graph, { spec: "nonsense" as never, grid: true, labels: false }).apply(doc);
    expect(graph.spec).toEqual(next);
    expect("grid" in graph).toBe(false);
    expect(graph.labels).toBe(false);
    edit.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("does nothing to a graph no longer on its page", () => {
    const doc = withGraph();
    const stray = sine("f9");
    const edit = new EditGraph("p1", stray, { view: { xRange: [0, 1], yRange: [0, 1] } });
    edit.apply(doc);
    expect(stray.spec.xMin).toBe(-5);
    edit.invert(doc);
    expect(stray.spec.xMin).toBe(-5);
  });
});

describe("the lasso's commands and the clipboard carry graphs whole", () => {
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
    expect(viewOf(graph)).toEqual({ xRange: [-5, 5], yRange: [-2, 2] });
    scale.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);

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

  const ids = {
    stroke: () => "s1",
    image: () => "i1",
    textBox: () => "t1",
    table: () => "g1",
    graph: () => "f2",
  };

  it("duplicates a graph whole, unknown spec fields included, and undoes it", () => {
    const doc = withGraph();
    const graph = doc.pages[0].graphs![0];
    graph.grid = false;
    const before = JSON.stringify(doc);
    const copies = copyElements(
      { strokes: [], images: [], textBoxes: [], graphs: [graph] },
      ids,
      20,
      20,
    );
    const copy = copies.graphs![0];
    expect(copy).toEqual({ ...graph, id: "f2", x: 120, y: 220 });
    expect(copy.spec).not.toBe(graph.spec);
    const add = new AddElements("p1", copies);
    add.apply(doc);
    expect(doc.pages[0].graphs).toHaveLength(2);
    add.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("copies and pastes a graph whole through the clipboard", () => {
    const graph = sine();
    const clipboard = new InkClipboard();
    clipboard.put({ strokes: [], images: [], textBoxes: [], graphs: [graph] }, graphBounds(graph));
    (graph.spec.sliders as Array<{ value: number }>)[0].value = 0;
    const pasted = pasteCopies(clipboard.content!, ids, 0, 0).graphs![0];
    expect((pasted.spec.sliders as Array<{ value: number }>)[0].value).toBe(1.5);
    expect(pasted.spec).toEqual({ ...graph.spec, sliders: futureSpec().sliders });
  });

  it("leaves no graphs list behind on a page that had none", () => {
    const doc = emptyDocument();
    const before = JSON.stringify(doc);
    const add = new AddElements("p1", { strokes: [], images: [], textBoxes: [], graphs: [sine()] });
    add.apply(doc);
    add.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("gives a duplicated page's graphs fresh ids and their own specs", () => {
    const doc = withGraph(sine("f3"));
    const dup = duplicatePageAfter(doc, 0);
    expect(dup?.page.graphs?.[0].id).toBe("f4");
    expect(dup?.page.graphs?.[0].spec).toEqual(doc.pages[0].graphs![0].spec);
    expect(dup?.page.graphs?.[0].spec).not.toBe(doc.pages[0].graphs![0].spec);
  });

  it("changes the page's signature when a graph changes", () => {
    const doc = withGraph();
    const page = doc.pages[0];
    const before = pageSignature(page);
    (page.graphs![0].spec.sliders as Array<{ value: number }>)[0].value = 2;
    expect(pageSignature(page)).not.toBe(before);
  });
});

describe("saving and loading", () => {
  it("round-trips a graph exactly, unknown spec fields included", () => {
    const doc = withGraph();
    doc.pages[0].graphs![0].labels = false;
    const back = decodeDocument(encodeDocument(doc));
    expect(JSON.stringify(back.pages[0].graphs)).toBe(JSON.stringify(doc.pages[0].graphs));
    const plain = decodeDocument(encodeDocument(emptyDocument()));
    expect("graphs" in plain.pages[0]).toBe(false);
  });

  it("writes the pinned wire form (golden)", () => {
    const payload = encodeDocument(withGraph());
    const page = (
      JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as {
        pages: Array<Record<string, unknown>>;
      }
    ).pages[0];
    expect(JSON.stringify(page.graphs)).toBe(
      '[{"id":"f1","x":100,"y":200,"w":300,"h":200,' +
        '"spec":{"expressions":["sin(a·x)"],"xMin":-5,"xMax":5,"yMin":-2,"yMax":2,' +
        '"angle":"rad","sliders":[{"name":"a","value":1.5,"min":0,"max":3}]},' +
        '"colors":["#cc3333"]}]',
    );
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
    const doc = reread(emptyDocument(), (page) => {
      page.graphs = [
        { id: "f5", spec: { expressions: ["x"] } },
        { spec: { expressions: ["x^2"] } },
        { spec: { expressions: [] } },
      ];
    });
    expect(doc.pages[0].graphs!.map((g) => g.id)).toEqual(["f5", "f6"]);
  });

  it("opens a note whose page holds an element kind it does not know", () => {
    // What 2.3.0 does with `graphs` is what this build does with any key it
    // has never heard of: the note opens, the rest of the page is intact.
    const doc = reread(withGraph(), (page) => {
      page.sparkles = [{ id: "z1", glitter: true }];
    });
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

describe("graphFromSpec, specOfGraph and graphFrameHeight", () => {
  it("makes a graph from the calculator's spec and gives Edit back a copy of it", () => {
    const spec = { ...futureSpec(), angle: "deg" as const };
    const graph = graphFromSpec("f3", 10, 20, spec, ["#123456"]);
    expect([graph.id, graph.x, graph.y]).toEqual(["f3", 10, 20]);
    expect(graph.spec).toEqual(spec);
    expect(graph.colors).toEqual(["#123456"]);
    const back = specOfGraph(graph);
    expect(back).toEqual(spec);
    expect(back).not.toBe(graph.spec);
  });

  it("keeps the view's shape between half and the whole of the width", () => {
    const s = (xMin: number, xMax: number, yMin: number, yMax: number) => ({
      expressions: ["x"],
      xMin,
      xMax,
      yMin,
      yMax,
    });
    expect(graphFrameHeight(s(-10, 10, -7.5, 7.5), 320, 240)).toBe(240);
    expect(graphFrameHeight(s(-360, 360, -2, 2), 320, 240)).toBe(160);
    expect(graphFrameHeight(s(-1, 1, -10, 10), 320, 240)).toBe(320);
    expect(graphFrameHeight(s(0, 0, 0, 1), 320, 240)).toBe(240);
  });
});
