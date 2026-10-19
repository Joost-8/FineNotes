/**
 * "Did you mean …?" for an underlined word: the same ink decoded a second
 * time, constrained to the word list (research/handwriting-rig/
 * LEXICON-REDECODE-2026-10-19.md, whose `lexicon/redecode.py` this follows).
 *
 * For a word of a line's reading:
 * 1. a CTC forced alignment (Viterbi) of the whole reading gives each
 *    character's frames; the word's window runs from the frame after the
 *    previous character to the frame before the next one, so the blanks on
 *    both sides are in;
 * 2. open score: log P(the word as read | window), the CTC forward sum;
 * 3. candidates: list words within edit distance ≤ half the longer word, in
 *    lower case and Capitalised (and UPPER when the reading is), plus the
 *    English 1–2-letter words the list leaves out; each scored exactly;
 * 4. both sides add the character LM at the decoder's alpha (0.3): the word
 *    given the reading's text before it, then the character after it. The
 *    report rescored the 20 best list words by CTC; here the best by CTC + LM
 *    is searched for exactly (`bestWords`), which is the same or better;
 * 5. margin = (open − best) ÷ letters, in nats per character.
 *
 * A margin under `SUGGEST_MARGIN` means the ink fits a list word about as
 * well as the reading: probably a misread, so the best words are offered
 * first. Above it the ink really shows this word. Never applied silently:
 * the report found half the fixes wrong.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { CharLm } from "./char-lm";

/** Below this margin (nats per character) the list words are offered first. */
export const SUGGEST_MARGIN = 1.0;

/** Words shown in the menu. */
export const SUGGESTIONS = 3;

/**
 * English words of one or two letters: never underlined, so not in the list,
 * but a misread of one ("tho" for "to") needs them (`redecode.SHORT`).
 */
const SHORT = [
  "a", "i", "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi", "if", "in", "is",
  "it", "me", "my", "no", "of", "oh", "ok", "on", "or", "so", "to", "up", "us", "we",
]; // prettier-ignore

const NEG = -1e30;

/** log(e^a + e^b), with NEG as log 0. */
function lse(a: number, b: number): number {
  if (a < b) {
    const s = a;
    a = b;
    b = s;
  }
  const d = b - a;
  // Below e^-40 the smaller term cannot change a float64 sum.
  return d < -40 ? a : a + Math.log1p(Math.exp(d));
}

/**
 * Per frame, the label position the best CTC path emits there, or -1 for a
 * blank (`personal_synth.ctc_align`). `logp` is `frames × C`, class 0 the
 * blank; `labels` are classes. Null when the frames cannot carry the labels.
 */
export function forceAlign(
  logp: Float32Array,
  frames: number,
  C: number,
  labels: readonly number[],
): Int32Array | null {
  const S = 2 * labels.length + 1;
  const ext = new Int32Array(S);
  labels.forEach((c, i) => (ext[2 * i + 1] = c));
  const skip = new Uint8Array(S);
  for (let s = 2; s < S; s++) skip[s] = ext[s] !== 0 && ext[s] !== ext[s - 2] ? 1 : 0;
  if (frames === 0) return labels.length === 0 ? new Int32Array(0) : null;
  let dp = new Float64Array(S).fill(NEG);
  let next = new Float64Array(S);
  dp[0] = logp[ext[0]];
  if (S > 1) dp[1] = logp[ext[1]];
  const back = new Uint8Array(frames * S);
  for (let t = 1; t < frames; t++) {
    const o = t * C;
    for (let s = 0; s < S; s++) {
      const stay = dp[s];
      const step1 = s >= 1 ? dp[s - 1] : NEG;
      const step2 = s >= 2 && skip[s] ? dp[s - 2] : NEG;
      const best = Math.max(stay, step1, step2);
      back[t * S + s] = best === stay ? 0 : best === step1 ? 1 : 2;
      next[s] = Math.max(best + logp[o + ext[s]], NEG);
    }
    const swap = dp;
    dp = next;
    next = swap;
  }
  let s = S === 1 || dp[S - 1] >= dp[S - 2] ? S - 1 : S - 2;
  if (dp[s] < NEG / 2) return null;
  const pos = new Int32Array(frames);
  for (let t = frames - 1; t >= 0; t--) {
    pos[t] = s % 2 === 1 ? (s - 1) / 2 : -1;
    s -= back[t * S + s];
  }
  return pos;
}

/**
 * The frames of the characters `[cs, ce)` of an `n`-character reading, with
 * the blanks around them: from the frame after the previous character's last
 * emission to the frame before the next character's first one, inclusive.
 */
export function wordWindow(pos: Int32Array, cs: number, ce: number, n: number): [number, number] {
  const T = pos.length;
  let start = 0;
  if (cs > 0) {
    for (let t = T - 1; t >= 0; t--) {
      if (pos[t] === cs - 1) {
        start = t + 1;
        break;
      }
    }
  }
  let end = T - 1;
  if (ce < n) {
    for (let t = 0; t < T; t++) {
      if (pos[t] === ce) {
        end = t - 1;
        break;
      }
    }
  }
  return [start, Math.max(end, start)];
}

/** log P(labels | frames [start, end]), summed over every CTC alignment. */
export function ctcScore(
  logp: Float32Array,
  C: number,
  start: number,
  end: number,
  labels: readonly number[],
): number {
  const S = 2 * labels.length + 1;
  const ext = new Int32Array(S);
  labels.forEach((c, i) => (ext[2 * i + 1] = c));
  let a = new Float64Array(S).fill(NEG);
  let b = new Float64Array(S);
  const o0 = start * C;
  a[0] = logp[o0 + ext[0]];
  if (S > 1) a[1] = logp[o0 + ext[1]];
  for (let t = start + 1; t <= end; t++) {
    const o = t * C;
    for (let s = 0; s < S; s++) {
      let v = a[s];
      if (s >= 1) v = lse(v, a[s - 1]);
      if (s >= 2 && ext[s] !== 0 && ext[s] !== ext[s - 2]) v = lse(v, a[s - 2]);
      b[s] = v <= NEG ? NEG : v + logp[o + ext[s]];
    }
    const swap = a;
    a = b;
    b = swap;
  }
  const score = S > 1 ? lse(a[S - 1], a[S - 2]) : a[S - 1];
  return score <= NEG / 2 ? -Infinity : score;
}

/** A node of the word list's trie, while it is built. */
interface LexNode {
  code: number;
  kids: Map<number, LexNode>;
  /** The word ending here, if one does. */
  word: string | null;
  /** The longest word at or below this node. */
  maxLen: number;
}

/**
 * The word list, as a trie for candidate search, flattened in preorder into
 * typed arrays so `near` walks it in one loop (a few ms for 26k words).
 */
export class Lexicon {
  readonly size: number;
  /** Per node, root excluded: its character code, depth (1 = first letter), */
  private readonly code: Uint16Array;
  private readonly depth: Uint8Array;
  /** the longest word below it, */
  private readonly maxLen: Uint8Array;
  /** the index past its subtree, */
  private readonly skip: Int32Array;
  /** and the word ending there, or -1. */
  private readonly wordAt: Int32Array;
  private readonly words: string[] = [];

  /** `words` as `parseWordList` gives them (lower case); the short words are added. */
  constructor(words: Iterable<string>) {
    const all = new Set(SHORT);
    for (const w of words) {
      const lower = w.toLowerCase();
      // Depth and length are stored in bytes; no word is that long.
      if (lower.length > 0 && lower.length < 255) all.add(lower);
    }
    const root: LexNode = { code: 0, kids: new Map(), word: null, maxLen: 0 };
    let count = 0;
    for (const w of all) {
      let node = root;
      for (let i = 0; i < w.length; i++) {
        const code = w.charCodeAt(i);
        let next = node.kids.get(code);
        if (!next) {
          next = { code, kids: new Map(), word: null, maxLen: 0 };
          node.kids.set(code, next);
          count++;
        }
        if (w.length > next.maxLen) next.maxLen = w.length;
        node = next;
      }
      node.word = w;
    }
    this.size = all.size;
    this.code = new Uint16Array(count);
    this.depth = new Uint8Array(count);
    this.maxLen = new Uint8Array(count);
    this.skip = new Int32Array(count);
    this.wordAt = new Int32Array(count);
    let at = 0;
    const lay = (node: LexNode, depth: number): void => {
      const kids = [...node.kids.values()].sort((a, b) => a.code - b.code);
      for (const kid of kids) {
        const i = at++;
        this.code[i] = kid.code;
        this.depth[i] = depth;
        this.maxLen[i] = kid.maxLen;
        this.wordAt[i] = kid.word === null ? -1 : this.words.push(kid.word) - 1;
        lay(kid, depth + 1);
        this.skip[i] = at;
      }
    };
    lay(root, 1);
  }

  /**
   * List words (lower case) within edit distance ≤ half the longer of the
   * two of `word`, nearest first, then alphabetical; never `word` itself.
   * One Levenshtein row per depth; a subtree is skipped once no word in it
   * can still come near enough (`reachable`).
   */
  near(word: string): string[] {
    const w = word.toLowerCase();
    const n = w.length;
    const codes = Int32Array.from({ length: n }, (_, j) => w.charCodeAt(j));
    const rows: Int32Array[] = [Int32Array.from({ length: n + 1 }, (_, j) => j)];
    for (let d = 1; d <= 255; d++) rows.push(new Int32Array(n + 1));
    const found: { word: string; d: number }[] = [];
    const total = this.code.length;
    let i = 0;
    while (i < total) {
      const m = this.depth[i];
      const prev = rows[m - 1];
      const row = rows[m];
      const code = this.code[i];
      let left = (row[0] = m);
      let low = left;
      for (let j = 1; j <= n; j++) {
        let v = prev[j - 1] + (code === codes[j - 1] ? 0 : 1);
        const up = prev[j] + 1;
        if (up < v) v = up;
        if (left + 1 < v) v = left + 1;
        row[j] = left = v;
        if (v < low) low = v;
      }
      // No word may be more than n away: half of at most twice this word.
      if (low > n || !reachable(row, n, m, this.maxLen[i])) {
        i = this.skip[i];
        continue;
      }
      const at = this.wordAt[i];
      if (at >= 0 && row[n] <= Math.floor(Math.max(n, m) / 2)) {
        const cand = this.words[at];
        if (cand !== w) found.push({ word: cand, d: row[n] });
      }
      i++;
    }
    found.sort((a, b) => a.d - b.d || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
    return found.map((f) => f.word);
  }
}

/**
 * Whether a word of `m` or more letters (at most `maxLen`) below a node
 * whose Levenshtein row against an `n`-letter word is `row` can be within
 * half the longer word. One that matched `j` letters of the word so far is
 * at least `row[j]` plus the difference in what remains of the two; the best
 * length leaves equal remainders, as the allowance grows by only half a
 * letter a letter.
 */
function reachable(row: Int32Array, n: number, m: number, maxLen: number): boolean {
  for (let j = 0; j <= n; j++) {
    let L = m + n - j;
    if (L > maxLen) L = maxLen;
    const gap = L - m - (n - j);
    if (row[j] + (gap < 0 ? -gap : gap) <= (L > n ? L : n) >> 1) return true;
  }
  return false;
}

/** A node of the candidates' trie, by network class. */
interface ClassNode {
  cls: number;
  /** Its character, for the LM. */
  ch: string;
  kids: Map<number, ClassNode>;
  word: string | null;
}

/** The LM's part of a word's score: `alpha` × log P(word, then `after` | `before`). */
export interface WordLm {
  lm: CharLm;
  alpha: number;
  before: string;
  after: string;
}

/**
 * The `k` words that fit frames [start, end] best, best first, by exact CTC
 * score plus, with `wordLm`, the LM's (as `ctcScore` + `lmWord` of each).
 * Shared along a trie of the words' classes, and branch and bound: a
 * prefix's chance of starting the labelling (summed over the frame where its
 * last character begins), plus its own LM score, bounds every word below it
 * (more letters only lower both), so a branch under the k-th best word found
 * is left unscored.
 */
export function bestWords(
  logp: Float32Array,
  C: number,
  start: number,
  end: number,
  words: readonly { word: string; ids: readonly number[] }[],
  k: number,
  wordLm: WordLm | null = null,
): { word: string; score: number; ctc: number }[] {
  const root: ClassNode = { cls: 0, ch: "", kids: new Map(), word: null };
  for (const { word, ids } of words) {
    let node = root;
    ids.forEach((c, i) => {
      let next = node.kids.get(c);
      if (!next) {
        next = { cls: c, ch: word[i], kids: new Map(), word: null };
        node.kids.set(c, next);
      }
      node = next;
    });
    node.word ??= word;
  }
  const T = end - start + 1;
  const best: { word: string; score: number; ctc: number }[] = [];
  const floor = () => (best.length < k ? -Infinity : best[k - 1].score);
  const keep = (word: string, score: number, ctc: number) => {
    let i = best.length;
    while (i > 0 && best[i - 1].score < score) i--;
    if (i >= k) return;
    best.splice(i, 0, { word, score, ctc });
    if (best.length > k) best.pop();
  };
  const lmLog = (history: string, ch: string): number =>
    wordLm ? wordLm.alpha * Math.log(wordLm.lm.prob(wordLm.before + history, ch)) : 0;
  // The forward sums run in probabilities, each frame divided by its best
  // class's (`scale`): every word shares the same scale, so a log is taken
  // only once a word or a bound is compared, and a good path stays near 1
  // however long the window is. A path more than ~700 nats below the
  // frames' best underflows to 0, which only drops words no one would pick.
  const scale = new Float64Array(T);
  const p = new Float64Array(T * C);
  for (let t = 0; t < T; t++) {
    const o = (start + t) * C;
    let m = -Infinity;
    for (let c = 0; c < C; c++) if (logp[o + c] > m) m = logp[o + c];
    scale[t] = m;
    for (let c = 0; c < C; c++) p[t * C + c] = Math.exp(logp[o + c] - m);
  }
  /** Σ scale up to frame t; `tail[t]` = e^(that − the whole window's), ≥ 1. */
  const upTo = new Float64Array(T);
  let sum = 0;
  for (let t = 0; t < T; t++) upTo[t] = sum += scale[t];
  const total = upTo[T - 1];
  const tail = new Float64Array(T);
  // Past e^700 a bound cannot be held in a float64: then no branch is cut.
  let exact = true;
  for (let t = 0; t < T; t++) {
    const r = upTo[t] - total;
    if (r > 700) exact = false;
    tail[t] = Math.exp(Math.min(r, 700));
  }
  const logOf = (v: number): number => (v > 0 ? Math.log(v) + total : NEG);

  /** A prefix waiting to be looked at: its forward sums, LM score and bound. */
  interface Open {
    node: ClassNode;
    /** Scaled P(prefix, ending in its last character / in a blank, at frame t). */
    gn: Float64Array;
    gb: Float64Array;
    /** Its first frame that is not 0 (a prefix of d characters needs d frames). */
    first: number;
    text: string;
    lm: number;
    bound: number;
  }
  // Best first: the prefix with the highest bound is looked at next, so once
  // the best bound left is under the k-th word found, nothing left can beat it.
  const heap: Open[] = [];
  const push = (item: Open): void => {
    let i = heap.push(item) - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up].bound >= item.bound) break;
      heap[i] = heap[up];
      i = up;
    }
    heap[i] = item;
  };
  const pop = (): Open => {
    const top = heap[0];
    const last = heap.pop() as Open;
    if (heap.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= heap.length) break;
        const r = l + 1;
        const c = r < heap.length && heap[r].bound > heap[l].bound ? r : l;
        if (heap[c].bound <= last.bound) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  /** Put the children of `parent` on the heap. */
  const expand = (parent: Open): void => {
    const isRoot = parent.node === root;
    const from = isRoot ? 0 : parent.first + 1;
    if (from >= T) return;
    const { gn: gnP, gb: gbP } = parent;
    const context = wordLm ? wordLm.lm.context(wordLm.before + parent.text) : null;
    for (const kid of parent.node.kids.values()) {
      const diff = isRoot || kid.cls !== parent.node.cls;
      const cls = kid.cls;
      const gn = new Float64Array(T);
      const gb = new Float64Array(T);
      let bound = 0;
      let gnPrev = 0;
      let gbPrev = 0;
      for (let t = from; t < T; t++) {
        // Into this character's first frame at t: from the parent, ending in
        // a blank, or in its own last character when that differs.
        const enter = t === 0 ? (isRoot ? 1 : 0) : diff ? gbP[t - 1] + gnP[t - 1] : gbP[t - 1];
        const emit = p[t * C + cls];
        bound += emit * enter * tail[t];
        const n = emit * (gnPrev + enter);
        gbPrev = gb[t] = p[t * C] * (gbPrev + gnPrev);
        gnPrev = gn[t] = n;
      }
      if (!(bound > 0)) continue;
      const lm =
        wordLm && context
          ? parent.lm + wordLm.alpha * Math.log(wordLm.lm.probIn(context, wordLm.lm.codeOf(kid.ch)))
          : 0;
      const b = exact ? logOf(bound) + lm : Infinity;
      if (b < floor()) continue;
      push({ node: kid, gn, gb, first: from, text: parent.text + kid.ch, lm, bound: b });
    }
  };
  // The empty prefix: nothing emitted, blanks only.
  const rootGb = new Float64Array(T);
  let blanks = 1;
  for (let t = 0; t < T; t++) rootGb[t] = blanks *= p[t * C];
  const rootGn = new Float64Array(T);
  expand({ node: root, gn: rootGn, gb: rootGb, first: -1, text: "", lm: 0, bound: 0 });
  while (heap.length > 0) {
    const item = pop();
    if (item.bound < floor()) break;
    if (item.node.word !== null) {
      const ctc = logOf(item.gn[T - 1] + item.gb[T - 1]);
      if (ctc > NEG / 2) {
        const score = ctc + item.lm + (wordLm ? lmLog(item.text, wordLm.after) : 0);
        keep(item.node.word, score, ctc);
      }
    }
    if (item.node.kids.size > 0) expand(item);
  }
  return best;
}

/** A word of a line's reading: the token's characters `[start, end)` in `text`. */
export interface WordInLine {
  /** The line's whole reading (as decoded, untrimmed). */
  text: string;
  start: number;
  end: number;
}

/** The letters of a token: `[cs, ce)` without the punctuation around them. */
export function wordCore(word: WordInLine): { cs: number; ce: number } {
  let cs = word.start;
  let ce = word.end;
  const letter = /\p{L}/u;
  while (cs < ce && !letter.test(word.text[cs])) cs++;
  while (ce > cs && !letter.test(word.text[ce - 1])) ce--;
  return { cs, ce };
}

export interface LexiconSuggestion {
  /** (open − best list word) ÷ letters, with the LM, in nats per character. */
  margin: number;
  /** The best list words, best first (at most `SUGGESTIONS`), cased as scored. */
  words: string[];
  /** Candidates: list words near the reading, in each case variant. */
  candidates: number;
}

export interface LineLogp {
  logp: Float32Array;
  frames: number;
}

/**
 * Score a word of a line against the list. Null when the reading does not
 * fit its frames, has characters the network lacks, or no list word is near.
 */
export function suggest(
  line: LineLogp,
  alphabet: readonly string[],
  lm: CharLm | null,
  alpha: number,
  word: WordInLine,
  lexicon: Lexicon,
): LexiconSuggestion | null {
  const C = alphabet.length + 1;
  const index = new Map<string, number>();
  alphabet.forEach((c, i) => index.set(c, i + 1));
  const toIds = (s: string): number[] | null => {
    const ids: number[] = [];
    for (const ch of s) {
      const k = index.get(ch);
      if (k === undefined) return null;
      ids.push(k);
    }
    return ids;
  };
  // The list's curly apostrophe, as the network writes it.
  const spell = (w: string): string => (index.has("’") ? w : w.replace(/’/g, "'"));
  const text = word.text;
  const { cs, ce } = wordCore(word);
  if (ce <= cs) return null;
  const ids = toIds(text);
  // One class per UTF-16 unit: an astral character would shift every offset.
  if (!ids || ids.length !== text.length) return null;
  const pos = forceAlign(line.logp, line.frames, C, ids);
  if (!pos) return null;
  const [s, e] = wordWindow(pos, cs, ce, text.length);
  const core = text.slice(cs, ce);
  const open = ctcScore(line.logp, C, s, e, ids.slice(cs, ce));

  const upper = core.length > 1 && core === core.toUpperCase() && core !== core.toLowerCase();
  const variants = new Set<string>();
  for (const near of lexicon.near(core)) {
    const w = spell(near);
    variants.add(w);
    variants.add(w.charAt(0).toUpperCase() + w.slice(1));
    if (upper) variants.add(w.toUpperCase());
  }
  const entries: { word: string; ids: number[] }[] = [];
  for (const v of variants) {
    const vi = toIds(v);
    if (vi) entries.push({ word: v, ids: vi });
  }
  const before = text.slice(0, cs);
  const after = ce < text.length ? text[ce] : "\n";
  const context = lm && { lm, alpha, before, after };
  const top = bestWords(line.logp, C, s, e, entries, SUGGESTIONS, context);
  if (top.length === 0) return null;
  const openScore = open + (lm ? alpha * lmWord(lm, before, core, after) : 0);
  return {
    margin: (openScore - top[0].score) / core.length,
    words: top.map((c) => c.word),
    candidates: entries.length,
  };
}

/** log P_LM(the word, then the character after it | the text before it). */
export function lmWord(lm: CharLm, before: string, word: string, after: string): number {
  let sum = 0;
  let history = before;
  for (const ch of word + after) {
    sum += Math.log(lm.prob(history, ch));
    history += ch;
  }
  return sum;
}

/** `token` with its letters replaced by `word`, the punctuation around them kept. */
export function replaceCore(token: string, word: string): string {
  const { cs, ce } = wordCore({ text: token, start: 0, end: token.length });
  return token.slice(0, cs) + word + token.slice(ce);
}
