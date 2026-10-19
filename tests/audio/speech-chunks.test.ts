import { describe, expect, it } from "vitest";
import {
  PAD_S,
  SPEECH_RATE,
  WINDOW_S,
  type SpeechSegment,
  type SpeechWindow,
  buildTimedTranscript,
  cutPoints,
  downmix,
  formatStamp,
  isNonSpeech,
  mergeSegments,
  overallPercent,
  overlapWords,
  planWindows,
  promptBefore,
  resample,
} from "../../src/audio/speech-chunks";

const RATE = SPEECH_RATE;

/** Speech-like noise everywhere except silent gaps at the given seconds (each `width` s long). */
function speechWithGaps(seconds: number, gaps: readonly number[], width = 0.4): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out[i] = ((seed / 2 ** 32) * 2 - 1) * 0.3;
  }
  for (const g of gaps) {
    const a = Math.round(g * RATE);
    const b = Math.min(out.length, a + Math.round(width * RATE));
    out.fill(0, a, b);
  }
  return out;
}

describe("downmix", () => {
  it("averages channels and passes one channel through", () => {
    const a = new Float32Array([1, 0, -1]);
    const b = new Float32Array([0, 1, 1]);
    expect(Array.from(downmix([a, b]))).toEqual([0.5, 0.5, 0]);
    expect(downmix([a])).toBe(a);
    expect(downmix([]).length).toBe(0);
  });
});

describe("resample", () => {
  it("averages each output span when going down", () => {
    const input = new Float32Array([1, 1, 1, 0, 0, 0, -1, -1, -1]);
    expect(Array.from(resample(input, 48000, 16000))).toEqual([1, 0, -1]);
  });

  it("keeps a slow sine's shape at 44.1 kHz to 16 kHz", () => {
    const n = 44100;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++) input[i] = Math.sin((2 * Math.PI * 200 * i) / 44100);
    const out = resample(input, 44100, 16000);
    expect(out.length).toBe(16000);
    for (let i = 100; i < 15900; i += 997) {
      expect(out[i]).toBeCloseTo(Math.sin((2 * Math.PI * 200 * i) / 16000), 1);
    }
  });

  it("interpolates going up and passes equal rates through", () => {
    const input = new Float32Array([0, 1]);
    expect(Array.from(resample(input, 8000, 16000))).toEqual([0, 0.5, 1, 1]);
    expect(resample(input, 16000, 16000)).toBe(input);
    expect(resample(input, 0, 16000)).toBe(input);
  });
});

describe("cutPoints", () => {
  it("is one window for a short recording", () => {
    const pcm = new Float32Array(10 * RATE);
    expect(cutPoints(pcm)).toEqual([pcm.length]);
  });

  it("cuts in the silence nearest before each window's end", () => {
    const pcm = speechWithGaps(70, [25, 50]);
    const cuts = cutPoints(pcm);
    expect(cuts).toHaveLength(3);
    expect(cuts[0] / RATE).toBeGreaterThanOrEqual(25);
    expect(cuts[0] / RATE).toBeLessThanOrEqual(25.4);
    expect(cuts[1] / RATE).toBeGreaterThanOrEqual(50);
    expect(cuts[1] / RATE).toBeLessThanOrEqual(50.4);
    expect(cuts[2]).toBe(pcm.length);
  });

  it("never makes a window longer than WINDOW_S, even with no silence", () => {
    const pcm = speechWithGaps(200, []);
    const cuts = cutPoints(pcm);
    let start = 0;
    for (const cut of cuts) {
      expect(cut - start).toBeLessThanOrEqual(WINDOW_S * RATE);
      expect(cut).toBeGreaterThan(start);
      start = cut;
    }
    expect(cuts[cuts.length - 1]).toBe(pcm.length);
  });

  it("covers an exactly-full window without an empty tail", () => {
    const pcm = new Float32Array(WINDOW_S * RATE);
    expect(cutPoints(pcm)).toEqual([pcm.length]);
  });
});

describe("planWindows", () => {
  it("pads each window past its cuts but owns only between them", () => {
    const length = 60 * RATE;
    const windows = planWindows(length, [25 * RATE, length]);
    expect(windows).toEqual([
      { index: 0, from: 0, to: (25 + PAD_S) * RATE, own0: 0, own1: 25 * RATE },
      { index: 1, from: (25 - PAD_S) * RATE, to: length, own0: 25 * RATE, own1: length },
    ]);
  });

  it("skips repeated cuts", () => {
    expect(planWindows(100, [50, 50, 100])).toHaveLength(2);
  });
});

describe("mergeSegments", () => {
  const w0: SpeechWindow = { index: 0, from: 0, to: 26 * RATE, own0: 0, own1: 25 * RATE };
  const w1: SpeechWindow = {
    index: 1,
    from: 24 * RATE,
    to: 50 * RATE,
    own0: 25 * RATE,
    own1: 50 * RATE,
  };

  it("moves times to the recording's clock and tells shared padding once", () => {
    const merged = mergeSegments([
      {
        window: w1,
        segments: [
          { start: 0, end: 1400, text: "end of it" }, // middle at 24.7 s: window 0's
          { start: 1500, end: 5000, text: " next  part " },
        ],
      },
      {
        window: w0,
        segments: [
          { start: 0, end: 4000, text: "Hello there." },
          { start: 23000, end: 25400, text: "end of it" }, // middle at 24.2 s
          { start: 25200, end: 26000, text: "next" }, // middle at 25.6 s: window 1's
        ],
      },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 4000, text: "Hello there." },
      { start: 23000, end: 25400, text: "end of it" },
      { start: 25500, end: 29000, text: "next part" },
    ]);
  });

  it("drops lines that are not speech and clamps times into the window", () => {
    const merged = mergeSegments([
      {
        window: w0,
        segments: [
          { start: 0, end: 900, text: "[BLANK_AUDIO]" },
          { start: 1000, end: 2000, text: "(music)" },
          { start: 2000, end: 3000, text: " ♪ " },
          { start: -50, end: Number.NaN, text: "kept" },
        ],
      },
    ]);
    expect(merged).toEqual([{ start: 0, end: 0, text: "kept" }]);
  });
});

describe("stitching across a cut", () => {
  it("finds the longest repeated run of two or more words, ignoring case and punctuation", () => {
    const prev = "and what we usually call pictures,".split(" ");
    expect(
      overlapWords(prev, "And what we usually call pictures makes the appeal".split(" ")),
    ).toBe(6);
    expect(overlapWords("the cat sat on the".split(" "), "the mat".split(" "))).toBe(0);
    expect(overlapWords("on the".split(" "), "on the mat".split(" "))).toBe(2);
    expect(overlapWords([], ["a"])).toBe(0);
    // The window before misheard its last word; three shared words still count.
    expect(
      overlapWords(
        "between art and what we usually call it.".split(" "),
        "And what we usually call pictures".split(" "),
      ),
    ).toBe(5);
    // ... but two shared words away from the cut do not.
    expect(overlapWords("we sat on the bank".split(" "), "on the river".split(" "))).toBe(0);
    // A misheard first word in the next window.
    expect(
      overlapWords("the frailty of man".split(" "), "a frailty of man and remarks".split(" ")),
    ).toBe(4);
  });

  it("drops the words a window repeats from the one before", () => {
    const w0: SpeechWindow = { index: 0, from: 0, to: 26 * RATE, own0: 0, own1: 25 * RATE };
    const w1: SpeechWindow = {
      index: 1,
      from: 24 * RATE,
      to: 50 * RATE,
      own0: 25 * RATE,
      own1: 50 * RATE,
    };
    const merged = mergeSegments([
      {
        window: w0,
        segments: [
          {
            start: 20000,
            end: 25500,
            text: "between decorative art and what we usually call pictures,",
          },
        ],
      },
      {
        window: w1,
        segments: [
          { start: 1000, end: 2500, text: "And what we" }, // middle at 25.75 s: window 1's
          { start: 2500, end: 6000, text: "usually call pictures makes the customary appeal" },
        ],
      },
    ]);
    expect(merged.map((s) => s.text)).toEqual([
      "between decorative art and what we usually call pictures,",
      "makes the customary appeal",
    ]);
    expect(merged[1].start).toBe(26500);
  });
});

describe("isNonSpeech", () => {
  it("knows Whisper's silence markers and keeps speech", () => {
    for (const t of [
      "",
      "  ",
      "[BLANK_AUDIO]",
      "[ Silence ]",
      "(upbeat music)",
      "*sigh*",
      "♪ ♪",
      "...",
    ]) {
      expect(isNonSpeech(t), t).toBe(true);
    }
    for (const t of [
      "Hello.",
      "(laughs) yes, that's right",
      "[1] is the reference",
      "-5 degrees",
    ]) {
      expect(isNonSpeech(t), t).toBe(false);
    }
  });
});

describe("buildTimedTranscript", () => {
  it("starts a paragraph at a pause, each with its time", () => {
    const segments: SpeechSegment[] = [
      { start: 0, end: 2000, text: "First thought." },
      { start: 2100, end: 4000, text: "Still first." },
      { start: 6000, end: 8000, text: "After a pause." },
      { start: 3_725_000, end: 3_726_000, text: "An hour in." },
    ];
    expect(buildTimedTranscript(segments)).toBe(
      "[0:00] First thought. Still first.\n\n[0:06] After a pause.\n\n[1:02:05] An hour in.",
    );
  });

  it("splits a long paragraph at a sentence end only", () => {
    const segments: SpeechSegment[] = [];
    for (let t = 0; t < 70000; t += 5000) {
      segments.push({ start: t, end: t + 5000, text: t === 55000 ? "no stop here" : "Sentence." });
    }
    const out = buildTimedTranscript(segments).split("\n\n");
    expect(out).toHaveLength(2);
    expect(out[1].startsWith("[1:05]")).toBe(true);
  });

  it("is empty for no speech", () => {
    expect(buildTimedTranscript([])).toBe("");
    expect(buildTimedTranscript([{ start: 0, end: 1, text: "  " }])).toBe("");
  });
});

describe("formatStamp", () => {
  it("writes m:ss and h:mm:ss", () => {
    expect(formatStamp(0)).toBe("0:00");
    expect(formatStamp(65_400)).toBe("1:05");
    expect(formatStamp(3_600_000)).toBe("1:00:00");
    expect(formatStamp(-5)).toBe("0:00");
    expect(formatStamp(Number.NaN)).toBe("0:00");
  });
});

describe("promptBefore", () => {
  it("takes the last words up to the limit, starting at a word", () => {
    const segs: SpeechSegment[] = [
      { start: 0, end: 1, text: "alpha beta gamma" },
      { start: 1, end: 2, text: "delta epsilon" },
    ];
    expect(promptBefore(segs)).toBe("alpha beta gamma delta epsilon");
    expect(promptBefore(segs, 16)).toBe("delta epsilon");
    expect(promptBefore([])).toBe("");
  });
});

describe("overallPercent", () => {
  it("weighs windows by the time they own", () => {
    const windows = planWindows(100, [25, 100], 1);
    expect(overallPercent(windows, 0, 0)).toBe(0);
    expect(overallPercent(windows, 0, 100)).toBe(25);
    expect(overallPercent(windows, 1, 50)).toBe(62);
    expect(overallPercent(windows, 2, 0)).toBe(100);
    expect(overallPercent([], 0, 0)).toBe(0);
  });
});
