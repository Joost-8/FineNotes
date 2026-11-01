/**
 * The order of the pen types in the pen's row (PURE). Every pen type is
 * always there, as in Goodnotes: the row cannot gain or lose one, only be
 * put in another order, by holding a pen and dragging it (`pen-type-drag.ts`).
 * The order is kept with the settings, as the colours' row is.
 */

/**
 * A stored order, read back against `all`, the pen types there are: the
 * known ones in their stored order, each once, then any it lacks (a pen type
 * added in a later release, or an order never stored) in `all`'s order.
 */
export function penTypeOrderOf<T extends string>(stored: unknown, all: readonly T[]): T[] {
  const order: T[] = [];
  if (Array.isArray(stored)) {
    for (const id of stored) {
      if (typeof id === "string" && (all as readonly string[]).includes(id)) {
        if (!order.includes(id as T)) order.push(id as T);
      }
    }
  }
  for (const id of all) if (!order.includes(id)) order.push(id);
  return order;
}

/**
 * `order` with `id` moved to `gap`: the place before the pen shown `gap`th
 * (0 the first; `order.length` after the last), counted as the row stood
 * when the pen was picked up. A gap either side of the pen itself leaves the
 * order as it was.
 */
export function movePenType<T extends string>(order: readonly T[], id: T, gap: number): T[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const at = Math.max(0, Math.min(order.length, Math.round(gap)));
  const rest = order.filter((each) => each !== id);
  const to = at > from ? at - 1 : at;
  rest.splice(to, 0, id);
  return rest;
}

/**
 * The gap a pen let go at `at` lands in, among pens whose middles are at
 * `centres` along the row (in order): before the first pen whose middle is
 * past it, else after the last.
 */
export function gapAt(centres: readonly number[], at: number): number {
  const index = centres.findIndex((centre) => at < centre);
  return index < 0 ? centres.length : index;
}

/**
 * Where to draw the mark for `gap` along the row, from the pens' spans
 * there: halfway between the two pens either side of it, or just outside
 * the first or last pen by half the space between pens.
 */
export function gapMark(spans: ReadonlyArray<{ start: number; end: number }>, gap: number): number {
  if (spans.length === 0) return 0;
  const space = spans.length > 1 ? (spans[1].start - spans[0].end) / 2 : 2;
  if (gap <= 0) return spans[0].start - space;
  if (gap >= spans.length) return spans[spans.length - 1].end + space;
  return (spans[gap - 1].end + spans[gap].start) / 2;
}

/** The pen types the row shows: all of them, but a practice sheet has no highlighter. */
export function shownPenTypes<T extends string>(
  order: readonly T[],
  practice: boolean,
  highlighter: T,
): T[] {
  return practice ? order.filter((id) => id !== highlighter) : [...order];
}
