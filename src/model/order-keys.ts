/**
 * Order keys for the pages of a notebook kept as one file per page per
 * device (FineNotes#274): strings of base-36 digits, compared by code unit,
 * never ending in "0". Two devices adding pages at once each make keys of
 * their own, so both pages stay; a page moved gets a key between its new
 * neighbours, and only the pages that moved get new keys.
 *
 * Pure: no DOM, no Obsidian.
 */

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

function digit(key: string, at: number): number {
  const char = key[at];
  return char === undefined ? 0 : Math.max(0, DIGITS.indexOf(char));
}

/**
 * A key strictly between `a` and `b` (`null`: no bound on that side), read
 * as base-36 fractions. Requires `a < b` when both are given.
 */
export function keyBetween(a: string | null, b: string | null): string {
  const low = a ?? "";
  if (b !== null && !(low < b)) throw new Error("keys out of order");
  return midpoint(low, b);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // A common prefix (a's missing digits count as 0) stays.
    let n = 0;
    while (n < b.length && (a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = digit(a, 0);
  const high = b === null ? DIGITS.length : digit(b, 0);
  if (high - low > 1) return DIGITS[Math.floor((low + high) / 2)];
  // Neighbouring digits: b's first digit alone, when b goes on past it.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low] + midpoint(a.slice(1), null);
}

/**
 * Keys for pages in the order wanted, keeping as many of their keys as
 * possible: those along the longest run already in order stay, the others
 * get a key between their neighbours. `keys[i]` is page i's key, or `null`
 * for a page without one. Returns every page's key.
 */
export function orderKeys(keys: readonly (string | null)[]): string[] {
  // The longest strictly increasing run of the keys there are (patience sort).
  const tails: number[] = [];
  const before = new Array<number>(keys.length).fill(-1);
  keys.forEach((key, i) => {
    if (key === null) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((keys[tails[mid]] as string) < key) lo = mid + 1;
      else hi = mid;
    }
    before[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  });
  const kept = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = before[i]) kept.add(i);

  const out: string[] = new Array<string>(keys.length);
  let previous: string | null = null;
  for (let i = 0; i < keys.length; i++) {
    if (kept.has(i)) {
      out[i] = keys[i] as string;
    } else {
      let next: string | null = null;
      for (let j = i + 1; j < keys.length; j++) {
        if (kept.has(j)) {
          next = keys[j];
          break;
        }
      }
      out[i] = keyBetween(previous, next);
    }
    previous = out[i];
  }
  return out;
}
