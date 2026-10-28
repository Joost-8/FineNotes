/**
 * Painting the arrows that join two shapes (`ShapeConnector`, discussion
 * #51): the right-angled route (`ink/connector-route`), stroked at the
 * connector's width with round joins, and an open arrowhead where it meets
 * the shape it points at. The tiles, the page thumbnails and exports, and
 * the wet layer while a joined shape is dragged all paint them with this.
 */

import { liveConnectors } from "../model/connectors";
import type { Bounds, Page, ShapeConnector } from "../model/document";
import { CONNECTOR_STUB, connectorRoute, routeBounds } from "../ink/connector-route";
import { nightColor } from "./night";
import { HEAD_MAX, arrowHead } from "./shape-decor";

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

/** What a routed connector covers, its width and head included, page px. */
export function connectorBounds(routed: RoutedConnector): Bounds | null {
  return routeBounds(routed.route, routed.connector.size + HEAD_MAX);
}

/** Paint one routed connector in page space, in its colour (made dark-page legible on `night`). */
export function paintConnector(
  ctx: CanvasRenderingContext2D,
  routed: RoutedConnector,
  night: boolean,
): void {
  const { route, connector } = routed;
  const n = route.length / 2;
  if (n < 2) return;
  const color = night ? nightColor(connector.color) : connector.color;
  const width = connector.size;
  // The arrowhead at the end, along the last run; the line stops at its tip.
  const tip = { x: route[(n - 1) * 2], y: route[(n - 1) * 2 + 1] };
  const before = { x: route[(n - 2) * 2], y: route[(n - 2) * 2 + 1] };
  const last = Math.hypot(tip.x - before.x, tip.y - before.y);
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(route[i * 2] - route[i * 2 - 2], route[i * 2 + 1] - route[i * 2 - 1]);
  }
  // A head no longer than the last run, or its barbs would cross the bend.
  const head = arrowHead(before, tip, width, "open", Math.min(total, last / 0.45));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(route[0], route[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(route[i * 2], route[i * 2 + 1]);
  ctx.stroke();
  if (head) {
    ctx.beginPath();
    head.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.restore();
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
