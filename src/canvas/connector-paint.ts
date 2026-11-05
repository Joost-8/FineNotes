/**
 * Painting the arrows that join two shapes (`ShapeConnector`, discussion
 * #51): the right-angled route (`ink/connector-route`), stroked at the
 * connector's width with round joins, and an open arrowhead where it meets
 * the shape it points at. The tiles, the page thumbnails and exports, and
 * the wet layer while a joined shape is dragged all paint them with this.
 */

import { connectorHeads, liveConnectors } from "../model/connectors";
import type { ArrowHead, Bounds, Page, ShapeConnector } from "../model/document";
import { CONNECTOR_STUB, connectorRoute, routeBounds } from "../ink/connector-route";
import { nightColor } from "./night";
import { HEAD_MAX, arrowHead, dashPattern } from "./shape-decor";

/** A connector and the route it takes now, `[x, y, …]` page px. */
export interface RoutedConnector {
  connector: ShapeConnector;
  route: number[];
}

/**
 * The route of each live connector on `page`, its shapes' points looked up
 * by stroke id; `pointsOf` may answer for a shape first (a dragged
 * shape's draft), and `only` keeps the connectors it accepts.
 */
export function routeConnectors(
  page: Page,
  pointsOf?: (id: string) => readonly number[] | undefined,
  only?: (connector: ShapeConnector) => boolean,
): RoutedConnector[] {
  const live = liveConnectors(page);
  if (live.length === 0) return [];
  const byId = new Map(page.strokes.map((stroke) => [stroke.id, stroke.pts]));
  const pts = (id: string): readonly number[] | undefined => pointsOf?.(id) ?? byId.get(id);
  const out: RoutedConnector[] = [];
  for (const connector of live) {
    if (only && !only(connector)) continue;
    const a = pts(connector.from.stroke);
    const b = pts(connector.to.stroke);
    if (!a || !b) continue;
    const route = connectorRoute(a, connector.from.side, b, connector.to.side, CONNECTOR_STUB);
    if (route) out.push({ connector, route });
  }
  return out;
}

/**
 * Every connector is drawn this wide, page px, whatever its shapes' pens
 * (Joost, 2026-10-29: one standard, thin width, elegant rather than thick),
 * until a width is set in its line panel (`ShapeConnector.width`). Its
 * stored `size` is kept for the file, and not drawn.
 */
export const CONNECTOR_WIDTH = 1.5;

/** And its open head is at most this long a side, page px: small, as the line is thin. */
const CONNECTOR_HEAD = 10;

/** The width a connector is drawn at, page px: its own once set, else the standard thin one. */
export function connectorWidth(connector: ShapeConnector): number {
  return connector.width ?? CONNECTOR_WIDTH;
}

/** The longest side its heads may have, page px: the standard head, larger for a wide line. */
function headCap(width: number): number {
  return Math.max(CONNECTOR_HEAD, width * 4);
}

/** What a routed connector covers, its width and heads included, page px. */
export function connectorBounds(routed: RoutedConnector): Bounds | null {
  const width = connectorWidth(routed.connector);
  return routeBounds(routed.route, width + Math.max(HEAD_MAX, headCap(width)));
}

/**
 * Paint one routed connector in page space, in its colour (made dark-page
 * legible on `night`): the route at its width, dashed or dotted as it says,
 * and a head at each end it has one (an open one at its end by default).
 */
export function paintConnector(
  ctx: CanvasRenderingContext2D,
  routed: RoutedConnector,
  night: boolean,
): void {
  const { route, connector } = routed;
  const n = route.length / 2;
  if (n < 2) return;
  const color = night ? nightColor(connector.color) : connector.color;
  const width = connectorWidth(connector);
  const at = (i: number): { x: number; y: number } => ({ x: route[i * 2], y: route[i * 2 + 1] });
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(route[i * 2] - route[i * 2 - 2], route[i * 2 + 1] - route[i * 2 - 1]);
  }
  // A head no longer than its run, or its barbs would cross the bend, and
  // never past the cap (arrowHead keeps a side to 45 % of the span).
  const headAt = (
    from: { x: number; y: number },
    tip: { x: number; y: number },
    kind: ArrowHead,
  ) => {
    const run = Math.hypot(tip.x - from.x, tip.y - from.y);
    const span = Math.min(total, run / 0.45, headCap(width) / 0.45);
    return arrowHead(from, tip, width, kind, span);
  };
  const heads = connectorHeads(connector);
  const drawn = [
    heads.end
      ? { head: headAt(at(n - 2), at(n - 1), heads.end), filled: heads.end === "filled" }
      : null,
    heads.start
      ? { head: headAt(at(1), at(0), heads.start), filled: heads.start === "filled" }
      : null,
  ];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (connector.dash) ctx.setLineDash(dashPattern(connector.dash, width));
  ctx.beginPath();
  ctx.moveTo(route[0], route[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(route[i * 2], route[i * 2 + 1]);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const end of drawn) {
    if (!end?.head) continue;
    ctx.beginPath();
    end.head.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (end.filled) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Whether page point (x, y) is within `reach` page px of a routed
 * connector's line: a tap that picks it.
 */
export function nearConnector(
  routed: RoutedConnector,
  x: number,
  y: number,
  reach: number,
): boolean {
  const { route } = routed;
  const r = reach + connectorWidth(routed.connector) / 2;
  for (let i = 2; i + 1 < route.length; i += 2) {
    const ax = route[i - 2];
    const ay = route[i - 1];
    const bx = route[i];
    const by = route[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= r) return true;
  }
  return false;
}

/**
 * Paint the page's live connectors that reach `region` (all of them when
 * `region` is absent), in page space, leaving out those in `hidden` (being
 * dragged on the wet layer instead).
 */
export function paintConnectors(
  ctx: CanvasRenderingContext2D,
  page: Page,
  night: boolean,
  region?: Bounds,
  hidden?: ReadonlySet<string>,
): void {
  for (const routed of routeConnectors(page)) {
    if (hidden?.has(routed.connector.id)) continue;
    if (region) {
      const b = connectorBounds(routed);
      if (!b || b.maxX < region.minX || b.minX > region.maxX) continue;
      if (b.maxY < region.minY || b.minY > region.maxY) continue;
    }
    paintConnector(ctx, routed, night);
  }
}
