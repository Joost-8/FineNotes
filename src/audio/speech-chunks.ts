/**
 * Turning a recording into windows the on-device speech recognizer can take,
 * and its answers back into one transcript.
 *
 * - **Windows.** Whisper reads at most 30 s at a time. A recording is cut
 *   into windows of up to `WINDOW_S`, each cut placed at the quietest moment
 *   near its end (`cutPoints`), so a cut rarely falls inside a word. Each
 *   window also reads `PAD_S` past both of its cuts, so a word that does
 *   straddle one is heard whole by at least one window.
 * - **Merge.** A window keeps only the segments whose middle lies between
 *   its own cuts (`mergeSegments`); what it read in the padding belongs to
 *   its neighbour. Times move from the window's clock to the recording's.
 * - **Transcript.** Segments join into paragraphs at a pause or after a
 *   minute, each led by its time (`buildTimedTranscript`).
 *
 * PURE: no DOM, no Obsidian, no worker.
 */

/** The recognizer's sample rate. */
export const SPEECH_RATE = 16000;
/** The longest window: Whisper's 30 s, less the padding on both sides. */
export const WINDOW_S = 28;
/** Audio read past each cut. */
export const PAD_S = 0.3;
/** How far back from a window's end a cut may move to find quiet. */
export const SEARCH_S = 6;
/** The span whose loudness decides a cut: about a syllable. */
export const QUIET_SPAN_S = 0.2;

/** Average the channels into one. All channels have the same length. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i] += channel[i] ?? 0;
  }
  const scale = 1 / channels.length;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/**
 * Samples at `from` Hz as samples at `to` Hz, for a platform that will not
 * decode straight to 16 kHz: each output sample averages the input over its
 * own span (a box filter, enough against aliasing for speech), and an
 * upsample interpolates linearly.
 */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (!(from > 0) || !(to > 0) || from === to) return samples;
  const ratio = from / to;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const a = i * ratio;
      const b = Math.min(samples.length, a + ratio);
      let sum = 0;
      let weight = 0;
      for (let j = Math.floor(a); j < b; j++) {
        const w = Math.min(j + 1, b) - Math.max(j, a);
        sum += samples[j] * w;
        weight += w;
      }
      out[i] = weight > 0 ? sum / weight : 0;
    }
  } else {
    for (let i = 0; i < length; i++) {
      const x = i * ratio;
      const j = Math.floor(x);
      const t = x - j;
      out[i] = samples[j] * (1 - t) + (samples[Math.min(samples.length - 1, j + 1)] ?? 0) * t;
    }
  }
  return out;
}

/**
 * Where the windows end, in samples, the last being `length`: each at the
 * quietest `QUIET_SPAN_S` within `SEARCH_S` before the longest a window may
 * run. Quiet is the lowest mean square, the earliest on a tie.
 */
export function cutPoints(samples: Float32Array, rate = SPEECH_RATE): number[] {
  const length = samples.length;
  const window = Math.round(WINDOW_S * rate);
  const search = Math.round(SEARCH_S * rate);
  const span = Math.max(1, Math.round(QUIET_SPAN_S * rate));
  const step = Math.max(1, Math.round(span / 4));
  const cuts: number[] = [];
  let start = 0;
  while (length - start > window) {
    const latest = start + window;
    const earliest = Math.max(start + span, latest - search);
    let best = latest;
    let bestEnergy = Infinity;
    for (let at = earliest; at + span <= latest; at += step) {
      let sum = 0;
      for (let i = at; i < at + span; i++) sum += samples[i] * samples[i];
      if (sum < bestEnergy) {
        bestEnergy = sum;
        best = at + Math.round(span / 2);
      }
    }
    cuts.push(best);
    start = best;
  }
  cuts.push(length);
  return cuts;
}

/** One window to read: `[from, to)` is what it reads, `[own0, own1)` what it keeps, in samples. */
export interface SpeechWindow {
  index: number;
  from: number;
  to: number;
  own0: number;
  own1: number;
}

/** The windows for a recording of `length` samples cut at `cuts` (from {@link cutPoints}). */
export function planWindows(
  length: number,
  cuts: readonly number[],
  rate = SPEECH_RATE,
): SpeechWindow[] {
  const pad = Math.round(PAD_S * rate);
  const windows: SpeechWindow[] = [];
  let own0 = 0;
  for (const own1 of cuts) {
    if (own1 <= own0) continue;
    windows.push({
      index: windows.length,
      from: Math.max(0, own0 - pad),
      to: Math.min(length, own1 + pad),
      own0,
      own1,
    });
    own0 = own1;
  }
  return windows;
}

/** A recognized stretch of speech, times in ms. */
export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
}

/** What a window answered: times in ms from the window's own start (`from`). */
export interface WindowResult {
  window: SpeechWindow;
  segments: readonly SpeechSegment[];
}

/**
 * Lines Whisper writes for silence or noise rather than speech, said as
 * the whole segment: "[BLANK_AUDIO]", "(music)", "[ Silence ]", "♪".
 */
export function isNonSpeech(text: string): boolean {
  const t = text.trim();
  if (t === "") return true;
  if (/^\[[^\]]*\]$/.test(t) || /^\([^)]*\)$/.test(t) || /^\*[^*]*\*$/.test(t)) return true;
  return /^[\s♪.…-]+$/u.test(t);
}

/** The most words looked at on each side of a cut for a repeat. */
export const STITCH_MAX_WORDS = 12;

/** A word as compared across a cut: lower case, letters and digits only. */
function wordKey(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** How many words at either edge of a cut may be misheard and still let a repeat be found. */
export const STITCH_SLACK = 2;

/**
 * How many words at the start of `next` to drop because they repeat the end
 * of `previous`. A repeat is a run of words both sides share: right at the
 * cut it needs two words (one shared word is too often just "the"); a run
 * that ends up to `STITCH_SLACK` words before `previous`'s end, or starts
 * up to that many words into `next`, needs three, since the window before
 * often mishears its last word or two ("call it" for "call pictures"). The
 * longest run wins, and `next` loses everything up to its end. Up to `max`
 * words a side are compared.
 */
export function overlapWords(
  previous: readonly string[],
  next: readonly string[],
  max = STITCH_MAX_WORDS,
): number {
  const p = previous.slice(-max).map(wordKey);
  const n = next.slice(0, max).map(wordKey);
  const matches = (pEnd: number, nStart: number, len: number): boolean => {
    if (pEnd - len < 0 || nStart + len > n.length) return false;
    for (let i = 0; i < len; i++) {
      const word = n[nStart + i];
      if (word === "" || p[pEnd - len + i] !== word) return false;
    }
    return true;
  };
  for (let len = Math.min(p.length, n.length); len >= 2; len--) {
    for (let back = 0; back <= STITCH_SLACK; back++) {
      for (let skip = 0; skip <= STITCH_SLACK; skip++) {
        if ((back > 0 || skip > 0) && len < 3) continue;
        if (matches(p.length - back, skip, len)) return skip + len;
      }
    }
  }
  return 0;
}

/** Drop the first `count` words from a run of segments, and segments left empty. */
function dropLeadingWords(segments: SpeechSegment[], count: number): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  let left = count;
  for (const segment of segments) {
    if (left <= 0) {
      out.push(segment);
      continue;
    }
    const words = segment.text.split(" ");
    const cut = Math.min(left, words.length);
    left -= cut;
    const text = words.slice(cut).join(" ");
    if (text) out.push({ ...segment, text });
  }
  return out;
}

/**
 * The windows' segments as one list on the recording's clock, in order: a
 * window keeps the segments whose middle falls between its own cuts, so the
 * padding two windows share is told once. A segment can still straddle a
 * cut and be heard by both windows, so words that start a window by
 * repeating the end of the one before are dropped (`overlapWords`).
 * Non-speech lines are dropped and whitespace is tidied.
 */
export function mergeSegments(
  results: readonly WindowResult[],
  rate = SPEECH_RATE,
): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  const toMs = (samples: number): number => (samples * 1000) / rate;
  const sorted = [...results].sort((a, b) => a.window.from - b.window.from);
  for (const { window, segments } of sorted) {
    const offset = toMs(window.from);
    const own0 = toMs(window.own0);
    const own1 = toMs(window.own1);
    const span = toMs(window.to - window.from);
    let kept: SpeechSegment[] = [];
    for (const segment of segments) {
      const text = segment.text.replace(/\s+/g, " ").trim();
      if (isNonSpeech(text)) continue;
      const start = offset + clamp(segment.start, 0, span);
      const end = offset + clamp(Math.max(segment.end, segment.start), 0, span);
      const middle = (start + end) / 2;
      if (middle < own0 || middle >= own1) continue;
      kept.push({ start: Math.round(start), end: Math.round(end), text });
    }
    if (out.length > 0 && kept.length > 0) {
      const tail = out
        .slice(-4)
        .map((s) => s.text)
        .join(" ")
        .split(" ");
      const head = kept
        .slice(0, 4)
        .map((s) => s.text)
        .join(" ")
        .split(" ");
      kept = dropLeadingWords(kept, overlapWords(tail, head));
    }
    out.push(...kept);
  }
  return out;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/** A new paragraph starts after a pause this long, ms ... */
export const PARAGRAPH_PAUSE_MS = 1500;
/** ... or once a paragraph has run this long and a sentence ends. */
export const PARAGRAPH_MAX_MS = 60000;

/** `m:ss`, or `h:mm:ss` past an hour. */
export function formatStamp(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * The transcript body: paragraphs, each starting with its time in brackets
 * (`[1:05] …`), split at a pause or at a sentence end once a paragraph is a
 * minute long. Empty when nothing was said.
 */
export function buildTimedTranscript(segments: readonly SpeechSegment[]): string {
  const paragraphs: string[] = [];
  let words: string[] = [];
  let startMs = 0;
  let lastEnd = -Infinity;
  const flush = (): void => {
    if (words.length > 0) paragraphs.push(`[${formatStamp(startMs)}] ${words.join(" ")}`);
    words = [];
  };
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const previous = words[words.length - 1] ?? "";
    const pause = segment.start - lastEnd >= PARAGRAPH_PAUSE_MS;
    const long = segment.start - startMs >= PARAGRAPH_MAX_MS && /[.!?…]["')\]]?$/.test(previous);
    if (words.length > 0 && (pause || long)) flush();
    if (words.length === 0) startMs = segment.start;
    words.push(text);
    lastEnd = segment.end;
  }
  flush();
  return paragraphs.join("\n\n");
}

/**
 * The text before a window, for the recognizer's prompt: the last few
 * words, so a sentence cut by a window goes on in the same spelling and
 * style. Whisper takes at most ~224 tokens of prompt; 200 characters is
 * well inside that.
 */
export function promptBefore(segments: readonly SpeechSegment[], maxChars = 200): string {
  let text = "";
  for (let i = segments.length - 1; i >= 0 && text.length < maxChars; i--) {
    text = `${segments[i].text} ${text}`;
  }
  text = text.trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(text.length - maxChars);
  const space = cut.indexOf(" ");
  return space >= 0 ? cut.slice(space + 1) : cut;
}

/** Overall progress, 0 to 100: windows done plus the share of the one running. */
export function overallPercent(
  windows: readonly SpeechWindow[],
  done: number,
  current: number,
): number {
  const total = windows.reduce((sum, w) => sum + (w.own1 - w.own0), 0);
  if (total <= 0) return 0;
  let finished = 0;
  for (let i = 0; i < Math.min(done, windows.length); i++)
    finished += windows[i].own1 - windows[i].own0;
  const running = windows[done];
  if (running) finished += ((running.own1 - running.own0) * clamp(current, 0, 100)) / 100;
  return Math.max(0, Math.min(100, Math.floor((100 * finished) / total)));
}
