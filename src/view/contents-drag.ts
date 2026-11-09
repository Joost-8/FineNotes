/**
 * Dragging entries in the sidebar's Contents tab (discussion #185). What a
 * drop means is `model/contents-drag.ts`; this is the drawing.
 *
 * A copy of the entry follows the pointer, the entries moving with it fade,
 * and an accent bar shows the gap and, by how far in it starts, the level.
 * Moving sideways while dragging changes the level. Letting go outside the
 * panel, Escape or a cancelled touch puts it back.
 */

import { contentsBlockEnd, contentsDropGaps, contentsDropLevels } from "../model/contents-drag";
import { type ContentsEntry, contentsEntries } from "../model/contents";
import type { ContentsLevel, InkDocument } from "../model/document";
import { edgeScrollSpeed } from "./page-drag-model";
import { PressDrag } from "./press-drag";

/** How far one level indents, CSS px (`.goodobsidian-contents-row.is-sub`). */
export const CONTENTS_INDENT_PX = 20;

export interface ContentsDragHost {
  canDrag(): boolean;
  document(): InkDocument | null;
  /** Every row of the contents, indexed by entry; a folded one is hidden. */
  rows(): readonly HTMLElement[];
  /** The top of the panel's visible part, below its sticky header (client px). */
  visibleTop(): number;
  onDrop(at: number, gap: number, level: ContentsLevel): void;
  onPenTap(at: number): void;
}

/** How far above the pointer the dragged copy rides, CSS px. */
const GHOST_RAISE_PX = 14;

/** The candidate closest to `y`, or `null` for none. */
export function nearestContentsGap<T extends { y: number }>(
  candidates: readonly T[],
  y: number,
): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (best === null || Math.abs(candidate.y - y) < Math.abs(best.y - y)) best = candidate;
  }
  return best;
}

/** The level for a drag `dx` px sideways of where it began, inside what the gap allows. */
export function draggedLevel(
  from: number,
  dx: number,
  range: { min: ContentsLevel; max: ContentsLevel },
): ContentsLevel {
  const want = from + Math.round(dx / CONTENTS_INDENT_PX);
  return Math.max(range.min, Math.min(range.max, want)) as ContentsLevel;
}

interface Drag {
  at: number;
  entries: ContentsEntry[];
  gaps: number[];
  sources: HTMLElement[];
  ghost: HTMLElement;
  bar: HTMLElement;
  startX: number;
  grabX: number;
  grabY: number;
  /** Where a bar for level 1 starts, client px. */
  left: number;
  slot: { gap: number; level: ContentsLevel } | null;
  frame: number;
}

export class ContentsDrag {
  private readonly input: PressDrag<number>;
  private drag: Drag | null = null;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly list: HTMLElement,
    private readonly host: ContentsDragHost,
  ) {
    this.input = new PressDrag<number>(list, {
      canDrag: () => host.canDrag(),
      itemAt: (target) => this.entryAt(target),
      begin: (at, x) => this.begin(at, x),
      moveTo: (x, y) => this.moveTo(x, y),
      end: (drop) => this.end(drop),
      onPenTap: (at) => host.onPenTap(at),
    });
  }

  get active(): boolean {
    return this.input.active;
  }

  consumeClick(): boolean {
    return this.input.consumeClick();
  }

  cancel(): void {
    this.input.cancel();
  }

  destroy(): void {
    this.input.destroy();
  }

  private entryAt(target: EventTarget | null): number | null {
    if (!(target instanceof Element) || !target.closest(".goodobsidian-contents-entry")) {
      return null;
    }
    const row = target.closest<HTMLElement>(".goodobsidian-contents-row");
    const at = row ? this.host.rows().indexOf(row) : -1;
    return at >= 0 ? at : null;
  }

  private begin(at: number, startX: number): void {
    const doc = this.host.document();
    const rows = this.host.rows();
    const row = rows[at];
    if (!doc || !row) return;
    const entries = contentsEntries(doc);
    const end = contentsBlockEnd(entries, at);
    const sources = rows.slice(at, end);
    const rect = row.getBoundingClientRect();
    const body = row.doc.body;
    const ghost = body.createDiv({ cls: "goodobsidian-contents-ghost" });
    ghost.createSpan({ text: entries[at].title });
    if (end - at > 1) {
      ghost.createSpan({ cls: "goodobsidian-contents-ghost-count", text: String(end - at) });
    }
    ghost.setCssStyles({ width: `${rect.width}px` });
    const bar = body.createDiv({ cls: "goodobsidian-thumb-drop is-level is-hidden" });
    for (const source of sources) source.addClass("is-drag-source");
    this.scroller.addClass("is-dragging-page");
    const entry = row.querySelector(".goodobsidian-contents-entry") ?? row;
    this.drag = {
      at,
      entries,
      gaps: contentsDropGaps(doc, at),
      sources,
      ghost,
      bar,
      startX,
      grabX: startX - rect.left,
      // Held above the pointer, so neither it nor a finger hides the bar.
      grabY: GHOST_RAISE_PX + ghost.offsetHeight,
      left:
        entry.getBoundingClientRect().left -
        Number(row.getAttribute("aria-level") ?? 1) * CONTENTS_INDENT_PX +
        CONTENTS_INDENT_PX,
      slot: null,
      frame: 0,
    };
    this.list.win.navigator.vibrate?.(30);
    this.autoScroll();
  }

  private moveTo(x: number, y: number): void {
    const drag = this.drag;
    if (!drag) return;
    drag.ghost.setCssStyles({
      transform: `translate(${x - drag.grabX}px, ${y - drag.grabY}px)`,
    });
    this.updateSlot();
  }

  /** The bar's height for gap `gap`, or `null` when that gap is folded away. */
  private gapY(gap: number): number | null {
    const rows = this.host.rows();
    const row = rows[gap];
    if (row) {
      if (row.hasClass("is-hidden")) return null;
      return row.getBoundingClientRect().top;
    }
    const last = rows.filter((each) => !each.hasClass("is-hidden")).pop();
    return last ? last.getBoundingClientRect().bottom : null;
  }

  private updateSlot(): void {
    const drag = this.drag;
    const point = this.input.point;
    if (!drag || !point) return;
    const panel = this.scroller.getBoundingClientRect();
    const inside =
      point.x >= panel.left &&
      point.x <= panel.right &&
      point.y >= panel.top &&
      point.y <= panel.bottom;
    const candidates = drag.gaps.flatMap((gap) => {
      const y = this.gapY(gap);
      return y === null ? [] : [{ gap, y }];
    });
    const found = inside ? nearestContentsGap(candidates, point.y) : null;
    if (!found) {
      drag.slot = null;
      drag.bar.addClass("is-hidden");
      return;
    }
    const level = draggedLevel(
      drag.entries[drag.at].level,
      point.x - drag.startX,
      contentsDropLevels(drag.entries, drag.at, found.gap),
    );
    drag.slot = { gap: found.gap, level };
    const left = drag.left + (level - 1) * CONTENTS_INDENT_PX;
    const top = Math.max(panel.top, this.host.visibleTop());
    drag.bar.toggleClass("is-hidden", found.y < top || found.y > panel.bottom);
    drag.bar.setCssStyles({
      left: `${left}px`,
      top: `${found.y - 2}px`,
      width: `${Math.max(0, panel.right - left - 8)}px`,
    });
  }

  /** Scroll the panel while the pointer rests near its top or bottom edge. */
  private autoScroll(): void {
    const drag = this.drag;
    if (!drag) return;
    drag.frame = this.list.win.requestAnimationFrame(() => {
      if (this.drag !== drag) return;
      const point = this.input.point;
      if (point) {
        const panel = this.scroller.getBoundingClientRect();
        const within = point.x >= panel.left && point.x <= panel.right;
        const top = Math.max(panel.top, this.host.visibleTop());
        const speed = within ? edgeScrollSpeed(point.y, top, panel.bottom) : 0;
        if (speed !== 0) {
          const before = this.scroller.scrollTop;
          this.scroller.scrollTop += speed;
          if (this.scroller.scrollTop !== before) this.updateSlot();
        }
      }
      this.autoScroll();
    });
  }

  private end(drop: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.list.win.cancelAnimationFrame(drag.frame);
    drag.ghost.remove();
    drag.bar.remove();
    for (const source of drag.sources) source.removeClass("is-drag-source");
    this.scroller.removeClass("is-dragging-page");
    if (drop && drag.slot) this.host.onDrop(drag.at, drag.slot.gap, drag.slot.level);
  }
}
