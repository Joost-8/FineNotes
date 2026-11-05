import { describe, expect, it } from "vitest";
import { nearConnector, routeConnectors } from "../../src/canvas/connector-paint";
import {
  RemoveConnector,
  RestyleConnector,
  connectorHeads,
  isStyledConnector,
  readConnectors,
} from "../../src/model/connectors";
import {
  type InkDocument,
  type ShapeConnector,
  type Stroke,
  emptyDocument,
} from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

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

function linked(): { doc: InkDocument; connector: ShapeConnector } {
  const doc = emptyDocument(1024);
  const connector: ShapeConnector = {
    id: "cn1",
    from: { stroke: "s1", side: "right" },
    to: { stroke: "s2", side: "left" },
    color: "#1f6feb",
    size: 3,
  };
  doc.pages[0].strokes.push(rect("s1", 100, 100), rect("s2", 400, 100));
  doc.pages[0].connectors = [connector];
  return { doc, connector };
}

describe("a connector's own style (2.9)", () => {
  it("has an open head at its end until it is given others", () => {
    const { connector } = linked();
    expect(connectorHeads(connector)).toEqual({ end: "open" });
    expect(isStyledConnector(connector)).toBe(false);
    expect(connectorHeads({ ...connector, heads: {} })).toEqual({});
  });

  it("is restyled as one step, and undo puts back exactly what it had", () => {
    const { doc, connector } = linked();
    const before = structuredClone(connector);
    const command = new RestyleConnector(doc.pages[0].id, connector, {
      color: "#E03131",
      width: 4,
      dash: "dot",
      heads: { start: "filled", end: "filled" },
    });
    command.apply(doc);
    expect(connector).toMatchObject({
      color: "#e03131",
      width: 4,
      dash: "dot",
      heads: { start: "filled", end: "filled" },
    });
    command.invert(doc);
    expect(connector).toEqual(before);
    // Heads taken off are stored as none, not as the default.
    const none = new RestyleConnector(doc.pages[0].id, connector, { heads: null });
    none.apply(doc);
    expect(connector.heads).toEqual({});
  });

  it("keeps its style through a save, and labels the notebook for newer readers", () => {
    const { doc, connector } = linked();
    Object.assign(connector, { width: 2.5, dash: "dash", heads: { start: "open" } });
    const payload = encodeDocument(doc);
    expect(payload.startsWith("v2+connectors+shape-content:")).toBe(true);
    const back = decodeDocument(payload).pages[0].connectors?.[0];
    expect(back).toMatchObject({ width: 2.5, dash: "dash", heads: { start: "open" } });
  });

  it("reads only a style it understands", () => {
    const ids = new Set(["s1", "s2"]);
    const [read] = readConnectors(
      [
        {
          id: "cn1",
          from: { stroke: "s1", side: "right" },
          to: { stroke: "s2", side: "left" },
          color: "#1f6feb",
          size: 3,
          width: -2,
          dash: "wiggly",
          heads: { end: "barbed" },
        },
      ],
      ids,
      new Set(),
    );
    expect(read.width).toBeUndefined();
    expect(read.dash).toBeUndefined();
    expect(read.heads).toEqual({});
  });

  it("is deleted as one step, and undo puts it back where it stood", () => {
    const { doc, connector } = linked();
    const page = doc.pages[0];
    const other: ShapeConnector = { ...connector, id: "cn2" };
    page.connectors?.push(other);
    const command = new RemoveConnector(page.id, connector);
    command.apply(doc);
    expect(page.connectors).toEqual([other]);
    command.invert(doc);
    expect(page.connectors?.[0]).toBe(connector);
    const alone = linked();
    const remove = new RemoveConnector(alone.doc.pages[0].id, alone.connector);
    remove.apply(alone.doc);
    expect(alone.doc.pages[0].connectors).toBeUndefined();
  });

  it("is picked by a tap on its line, not beside it", () => {
    const { doc } = linked();
    const [routed] = routeConnectors(doc.pages[0]);
    expect(routed).toBeDefined();
    // The middle of its first run.
    const x = (routed.route[0] + routed.route[2]) / 2;
    const y = (routed.route[1] + routed.route[3]) / 2;
    expect(nearConnector(routed, x, y + 4, 6)).toBe(true);
    expect(nearConnector(routed, x, y + 60, 6)).toBe(false);
  });
});
