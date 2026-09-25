/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The notebook surface paints its pages into three full-pane canvases with a
 * tile cache; an export cannot carry those pixels. It carries the pages
 * instead: one canvas per visible page, at its place on the desk, with the
 * ruling as one op and the ink as a reference into the shared pages.js.
 */
import { styleOf } from "../../../src/canvas/renderer";
import { inkPath, penOptions } from "../../../src/ink/freehand";
import type { Page } from "../../../src/model/document";
import { pageKey, roundPath, textOps } from "../recorder";

const surfaces = new Set<any>();
(globalThis as any).__gallerySurfaces = surfaces;
const HIGHLIGHTER_ALPHA = 0.35;
const EXPORT_DPR = 2;

export function registerSurface(surface: any): void {
  if (surface) surfaces.add(surface);
}
export function resetSurfaces(): void {
  surfaces.clear();
}

/** A page's ink as paint ops in page space (pages.js). */
export function inkOps(page: Page): Record<string, unknown>[] {
  const ops: Record<string, unknown>[] = [];
  for (const stroke of page.strokes) {
    const style = styleOf(stroke, true);
    const usePressure = style.tool !== "highlighter";
    const ink = inkPath(
      stroke.pts,
      penOptions(style.size, usePressure),
      true,
      style.shape === true,
    );
    if (!ink) continue;
    const op: Record<string, unknown> = { path: roundPath(ink.d), color: stroke.color };
    if (ink.stroke !== null) op.stroke = ink.stroke;
    if (style.tool === "highlighter") op.alpha = HIGHLIGHTER_ALPHA;
    ops.push(op);
  }
  return ops;
}

/** For pages-*.js: every page a snapshot referred to, its ink and its text. */
export function pagesTable(registry: Map<string, Page>): Record<string, unknown> {
  const table: Record<string, unknown> = {};
  for (const [key, page] of registry) table[key] = { ink: inkOps(page), text: textOps(page) };
  return table;
}

function pageOps(page: Page, theme: any, k: number): Record<string, unknown>[] {
  const t = [k, 0, 0, k, 0, 0];
  const ops: Record<string, unknown>[] = [];
  const backdrop: any = page.backdrop;
  if (backdrop.kind === "pdf")
    ops.push({ g: "fillRect", t: [1, 0, 0, 1, 0, 0], st: { f: theme.paper }, a: [0, 0, 1e5, 1e5] });
  else ops.push({ t, s: [backdrop, page.geometry, theme, 1] });
  for (const image of page.images ?? []) {
    ops.push({ t, rect: [image.x, image.y, image.w, image.h], color: "#d8d8dc" });
  }
  // Text boxes are DOM on the surface, so only the ink is painted here.
  const key = pageKey(page);
  if (key && page.strokes.length > 0) ops.push({ ref: key, t });
  return ops;
}

/** Replace each registered surface's canvases, in `clone`, with its pages. */
export function exportSurfaces(src: HTMLElement, clone: HTMLElement): void {
  const srcEls = Array.from(src.querySelectorAll(".goodobsidian-surface"));
  const dstEls = Array.from(clone.querySelectorAll<HTMLElement>(".goodobsidian-surface"));
  for (const s of surfaces) {
    const i = srcEls.indexOf(s.surfaceEl);
    if (i < 0) continue;
    const dst = dstEls[i];
    dst.querySelectorAll(":scope > canvas").forEach((c) => c.remove());
    const theme = s.paper;
    const desk = document.createElement("div");
    desk.className = "gallery-desk";
    desk.setAttribute(
      "style",
      `position: absolute; inset: 0; overflow: hidden; background: ${theme.desk}`,
    );
    const boxes = s.pageLayout.boxes as Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    const scale = s.scale as number;
    const cssW = s.cssW as number;
    const cssH = s.cssH as number;
    const scrollY = s.viewport.scrollY as number;
    const offsetX = s.offsetX as number;
    const pages = s.document.pages as Page[];
    boxes.forEach((box, index) => {
      const left = offsetX + box.x * scale;
      const top = (box.y - scrollY) * scale;
      const width = box.width * scale;
      const height = box.height * scale;
      if (left > cssW || top > cssH || left + width < 0 || top + height < 0) return;
      const canvas = document.createElement("canvas");
      canvas.className = "gallery-page";
      canvas.width = Math.round(width * EXPORT_DPR);
      canvas.height = Math.round(height * EXPORT_DPR);
      canvas.setAttribute(
        "style",
        `position: absolute; left: ${left.toFixed(1)}px; top: ${top.toFixed(1)}px; ` +
          `width: ${width.toFixed(1)}px; height: ${height.toFixed(1)}px; ` +
          `box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 6px 20px rgba(0, 0, 0, 0.3)`,
      );
      const k = Math.round((canvas.width / box.width) * 1000) / 1000;
      canvas.setAttribute("data-gallery-paint", JSON.stringify(pageOps(pages[index], theme, k)));
      desk.appendChild(canvas);
    });
    dst.insertBefore(desk, dst.firstChild);
  }
}
