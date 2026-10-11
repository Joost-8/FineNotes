/**
 * The 6-gram character language model of research/handwriting-rig/lm_decode.py
 * (interpolated Witten-Bell), read from the "LM01" section of a recogniser
 * file (export_hwr.py). Contexts are a trie walked from the most recent
 * character into the past, so the contexts of every order a history has are
 * one walk: P(c | h) = (count + types · P_shorter) / (total + types), from
 * the empty context up to the longest one the model kept. For an unpruned
 * export this is `CharLM.prob` exactly.
 *
 * PURE: no DOM, no Obsidian.
 */

/** Pads the start of every line (lm_decode.BOS). */
export const BOS = "\u0002";

/** What the file header says about the LM. */
export interface CharLmMeta {
  order: number;
  /** Code k is `chars[k]`; code 0 is BOS. */
  chars: string[];
  /** The uniform floor is 1 / V. */
  V: number;
  nodes: number;
  preds: number;
}

/** A context: the trie nodes of its suffixes, shortest (the empty context) first. */
export type LmContext = readonly number[];

export class CharLm {
  private readonly codes = new Map<string, number>();
  private readonly firstChild: Uint32Array;
  private readonly firstPred: Uint32Array;
  private readonly totals: Float64Array;

  private constructor(
    readonly order: number,
    readonly chars: readonly string[],
    private readonly V: number,
    private readonly nodeChar: Uint8Array,
    private readonly children: Uint8Array,
    private readonly predCount: Uint8Array,
    private readonly predChar: Uint8Array,
    private readonly counts: Uint32Array,
  ) {
    chars.forEach((c, i) => this.codes.set(c, i));
    const nodes = nodeChar.length;
    this.firstChild = new Uint32Array(nodes);
    this.firstPred = new Uint32Array(nodes);
    this.totals = new Float64Array(nodes);
    let child = 1;
    let pred = 0;
    for (let i = 0; i < nodes; i++) {
      this.firstChild[i] = child;
      this.firstPred[i] = pred;
      child += children[i];
      let total = 0;
      for (let k = 0; k < predCount[i]; k++) total += counts[pred + k];
      this.totals[i] = total;
      pred += predCount[i];
    }
    if (child !== nodes || pred !== predChar.length) {
      throw new Error("the language model's tables do not add up");
    }
  }

  /** Read the "LM01" section at `start` (`size` bytes) of `buffer`. */
  static fromSection(meta: CharLmMeta, buffer: ArrayBuffer, start: number, size: number): CharLm {
    const view = new DataView(buffer, start, size);
    const nodes = view.getUint32(0, true);
    const preds = view.getUint32(4, true);
    const countBytes = view.getUint32(8, true);
    if (
      nodes !== meta.nodes ||
      preds !== meta.preds ||
      12 + 3 * nodes + preds + countBytes > size
    ) {
      throw new Error("the language model section does not match its header");
    }
    let o = start + 12;
    const bytes = (n: number): Uint8Array => {
      const a = new Uint8Array(buffer, o, n);
      o += n;
      return a;
    };
    const nodeChar = bytes(nodes);
    const children = bytes(nodes);
    const predCount = bytes(nodes);
    const predChar = bytes(preds);
    const raw = bytes(countBytes);
    const counts = new Uint32Array(preds);
    let p = 0;
    for (let i = 0; i < preds; i++) {
      let v = 0;
      let mul = 1;
      for (;;) {
        if (p >= raw.length) throw new Error("the language model's counts end early");
        const b = raw[p++];
        v += (b & 0x7f) * mul;
        mul *= 128;
        if (b < 0x80) break;
      }
      counts[i] = v;
    }
    return new CharLm(
      meta.order,
      meta.chars,
      meta.V,
      nodeChar,
      children,
      predCount,
      predChar,
      counts,
    );
  }

  /** The LM's code for a character, or -1 for one it has never seen. */
  codeOf(ch: string): number {
    return this.codes.get(ch) ?? -1;
  }

  /** Index of `code` in the sorted `keys[start, start + n)`, or -1. */
  private static find(keys: Uint8Array, start: number, n: number, code: number): number {
    let lo = start;
    let hi = start + n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid] < code) lo = mid + 1;
      else hi = mid;
    }
    return lo < start + n && keys[lo] === code ? lo : -1;
  }

  /** The contexts of `history` (its last order − 1 characters, BOS-padded) the model has. */
  context(history: string): LmContext {
    const nodes = [0];
    let node = 0;
    for (let k = 1; k < this.order; k++) {
      const code = k <= history.length ? this.codeOf(history[history.length - k]) : 0;
      if (code < 0) break;
      node = CharLm.find(this.nodeChar, this.firstChild[node], this.children[node], code);
      if (node < 0) break;
      nodes.push(node);
    }
    return nodes;
  }

  /** P(code | context); a code of -1 (unknown) only gets the smoothing mass. */
  probIn(context: LmContext, code: number): number {
    let p = 1 / this.V;
    for (const node of context) {
      const types = this.predCount[node];
      const at = code < 0 ? -1 : CharLm.find(this.predChar, this.firstPred[node], types, code);
      const count = at < 0 ? 0 : this.counts[at];
      p = (count + types * p) / (this.totals[node] + types);
    }
    return p;
  }

  /** P(ch | history), as `CharLM.prob`. */
  prob(history: string, ch: string): number {
    return this.probIn(this.context(history), this.codeOf(ch));
  }
}
