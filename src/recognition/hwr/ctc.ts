/**
 * Reading text off the network's per-frame log-probabilities (CTC):
 *
 * - `greedyDecode`: the best class per frame, repeats merged and blanks
 *   dropped — the letters as written (`htr.greedy`).
 * - `beamDecode`: prefix beam search with the character LM's weight `alpha`
 *   and an insertion bonus `beta` per character (`lm_decode.beam_decode`).
 *
 * Both follow the Python reference's order of operations (which prefix is
 * kept on a tie, which candidate comes first), so they give the same text.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { CharLm, LmContext } from "./char-lm";

export interface GreedyResult {
  text: string;
  /** Per character, the first and last frame it was the best class. */
  spans: [number, number][];
  /** Mean best probability over the frames that are not blank (0 when all are). */
  confidence: number;
}

/**
 * `htr.greedy`. `alphabet[k - 1]` is class k; class 0 is the blank.
 * `logp` is `frames × (alphabet.length + 1)`.
 */
export function greedyDecode(
  logp: Float32Array,
  frames: number,
  alphabet: readonly string[],
): GreedyResult {
  const C = alphabet.length + 1;
  let text = "";
  const spans: [number, number][] = [];
  let prev = 0;
  let confSum = 0;
  let confN = 0;
  for (let t = 0; t < frames; t++) {
    const o = t * C;
    let best = 0;
    for (let k = 1; k < C; k++) if (logp[o + k] > logp[o + best]) best = k;
    if (best !== 0 && best !== prev) {
      text += alphabet[best - 1];
      spans.push([t, t]);
    } else if (best !== 0 && best === prev && spans.length > 0) {
      spans[spans.length - 1][1] = t;
    }
    if (best !== 0) {
      confSum += Math.exp(logp[o + best]);
      confN++;
    }
    prev = best;
  }
  return { text, spans, confidence: confN ? confSum / confN : 0 };
}

export interface BeamOptions {
  /** LM weight (0.3 for the v2 models, tuned on U-dev). */
  alpha: number;
  /** Bonus per character. */
  beta: number;
  /** Prefixes kept per frame. */
  beam: number;
  /** Characters tried per frame. */
  topk: number;
  /** Characters below this log-probability are not tried. */
  prune: number;
}

export const DEFAULT_BEAM: BeamOptions = { alpha: 0.3, beta: 0, beam: 16, topk: 8, prune: -9 };

const NEG = -1e30;

/** log(e^a + e^b), with NEG as log 0 (`lm_decode._lse`). */
function lse(a: number, b: number): number {
  if (a < b) {
    const s = a;
    a = b;
    b = s;
  }
  if (b <= NEG) return a;
  return a + Math.log1p(Math.exp(b - a));
}

interface Prefix {
  text: string;
  /** log P(prefix, ending in a blank). */
  pb: number;
  /** log P(prefix, ending in its last character). */
  pnb: number;
  /** The LM's context for `text`, worked out when first needed. */
  context: LmContext | null;
}

/**
 * The `count` best classes of a frame, best first, from `top + 1` candidates
 * as `np.argsort(lp)[::-1][:top + 1]`; ties go to the higher class.
 */
function topClasses(logp: Float32Array, o: number, C: number, n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < C; k++) {
    const v = logp[o + k];
    let i = out.length;
    while (i > 0 && logp[o + out[i - 1]] <= v) i--;
    if (i < n) {
      out.splice(i, 0, k);
      if (out.length > n) out.pop();
    }
  }
  return out;
}

/** `lm_decode.beam_decode` without the word bonus. `lm` null: a plain beam search. */
export function beamDecode(
  logp: Float32Array,
  frames: number,
  alphabet: readonly string[],
  lm: CharLm | null,
  options: Partial<BeamOptions> = {},
): string {
  const { alpha, beta, beam, topk, prune } = { ...DEFAULT_BEAM, ...options };
  const C = alphabet.length + 1;
  const codes = lm ? alphabet.map((c) => lm.codeOf(c)) : [];
  const contextOf = (p: Prefix): LmContext => (p.context ??= (lm as CharLm).context(p.text));
  let beams: Prefix[] = [{ text: "", pb: 0, pnb: NEG, context: null }];
  for (let t = 0; t < frames; t++) {
    const o = t * C;
    const cand = topClasses(logp, o, C, topk + 1)
      .filter((k) => k !== 0 && logp[o + k] > prune)
      .slice(0, topk);
    const next = new Map<string, Prefix>();
    const entry = (text: string): Prefix => {
      let e = next.get(text);
      if (!e) {
        e = { text, pb: NEG, pnb: NEG, context: null };
        next.set(text, e);
      }
      return e;
    };
    const blank = logp[o];
    for (const b of beams) {
      const ptot = lse(b.pb, b.pnb);
      const e = entry(b.text);
      e.context ??= b.context;
      e.pb = lse(e.pb, ptot + blank);
      const last = b.text.length ? b.text[b.text.length - 1] : null;
      for (const k of cand) {
        const ch = alphabet[k - 1];
        const p = logp[o + k];
        const bonus = lm ? alpha * Math.log(lm.probIn(contextOf(b), codes[k - 1])) + beta : 0;
        if (ch === last) {
          e.pnb = lse(e.pnb, b.pnb + p);
          const n = entry(b.text + ch);
          n.pnb = lse(n.pnb, b.pb + p + bonus);
        } else {
          const n = entry(b.text + ch);
          n.pnb = lse(n.pnb, ptot + p + bonus);
        }
      }
    }
    const scored = [...next.values()].map((e) => ({ e, s: lse(e.pb, e.pnb) }));
    scored.sort((a, b) => b.s - a.s);
    beams = scored.slice(0, beam).map((x) => x.e);
  }
  let best = beams[0];
  let bestScore = -Infinity;
  const end = lm ? lm.codeOf("\n") : -1;
  for (const b of beams) {
    let score = lse(b.pb, b.pnb);
    if (lm) score += alpha * Math.log(lm.probIn(contextOf(b), end));
    if (score > bestScore) {
      best = b;
      bestScore = score;
    }
  }
  return best.text;
}
