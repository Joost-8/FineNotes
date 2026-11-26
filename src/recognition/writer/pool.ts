/**
 * Which copied lines the writer may be shown (2026-11-24's plan, Joost's
 * call): a writer's practice sheets, prose-like lines only, every one of
 * them as the pool. A sum, a formula, a sign line or the symbol sheet would
 * set ink off the line or show letters the model has no id for.
 *
 * PURE: no DOM, no Obsidian.
 */

/** Characters that sit off the line or stand for maths (research/handwriting-rig/gen/sheet_coverage.py). */
const OFF_LINE = new Set("^_=<>|{}\\~");

/** Whether a copied line may show the writer's hand: a letter, and only characters the model writes on the line. */
export function proseLike(text: string, writable: (ch: string) => boolean): boolean {
  if (!/\p{L}/u.test(text)) return false;
  for (const ch of text) if (OFF_LINE.has(ch) || !writable(ch)) return false;
  return true;
}
