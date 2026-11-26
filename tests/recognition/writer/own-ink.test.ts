import { describe, expect, it } from "vitest";
import {
  type WordAnswer,
  applyAnswers,
  joinPunctuation,
  wordSureness,
  writeUnasked,
} from "../../../src/recognition/writer/sure-words";
import {
  WRITE_UNASKED_FROM,
  keepOwnInk,
  ownInkReason,
  ownInkRewrite,
} from "../../../src/recognition/writer/own-ink";

const word = (over: Partial<Parameters<typeof ownInkReason>[0]> = {}) => ({
  text: "hello",
  sure: 0.9,
  answered: false,
  ...over,
});

describe("ownInkReason", () => {
  it("lets a sure ordinary word be written", () => {
    expect(ownInkReason(word())).toBeNull();
  });

  it("keeps lone letters and digits", () => {
    for (const text of ["I", "a", "5", "x,", "(a)"]) {
      expect(ownInkReason(word({ text }))).toBe("lone");
    }
    expect(ownInkReason(word({ text: "It" }))).toBeNull();
    expect(ownInkReason(word({ text: "10" }))).toBeNull();
  });

  it("keeps an unsure word", () => {
    expect(ownInkReason(word({ sure: WRITE_UNASKED_FROM - 0.01 }))).toBe("unsure");
    expect(ownInkReason(word({ sure: WRITE_UNASKED_FROM }))).toBeNull();
  });

  it("gives lone before unsure", () => {
    expect(ownInkReason(word({ text: "a", sure: 0 }))).toBe("lone");
  });

  it("never keeps an answered word", () => {
    expect(ownInkReason(word({ text: "a", sure: 0, answered: true }))).toBeNull();
  });
});

describe("keepOwnInk", () => {
  it("sets false only the words with a reason, and never turns one on", () => {
    const words = [word(), word({ sure: 0.1 }), word({ text: "I" }), word({ sure: 0.1 })];
    expect(keepOwnInk(words, [true, true, true, false])).toEqual([true, false, false, false]);
  });
});

describe("ownInkRewrite", () => {
  const line = {
    read: ["fine", "I", "odd"],
    sure: [0.9, 0.9, 0.2],
    rewrite: [true, true, true],
  };

  it("keeps lone and unsure words", () => {
    expect(ownInkRewrite(line)).toEqual([true, false, false]);
  });

  it("lets an answered word through", () => {
    expect(ownInkRewrite({ ...line, answered: [true, true, true] })).toEqual([true, true, true]);
  });
});

describe("a lone word the writer answered", () => {
  // The line as NeatenService.jobOf builds it for "l think so", the first word's ink saved
  // as an answer "I" (Grape read an l): applyAnswers, joinPunctuation, then writeUnasked.
  const ink = [["a"], ["b"], ["c"]];
  const answers: WordAnswer[] = [{ kind: "misread", text: "I", ids: ["a"] }];
  const jobOf = () => {
    const answered = applyAnswers(["l", "think", "so"], ink, answers);
    const sure = wordSureness(answered.words.join(" "), "", [], null).map((x, i) =>
      answered.known.has(i) ? 1 : x,
    );
    const joined = joinPunctuation({
      words: answered.words,
      ink,
      rewrite: answered.words.map((_, i) => answered.known.has(i)),
      sure,
      known: answered.words.map((_, i) => answered.known.has(i)),
    });
    return {
      read: joined.words,
      sure: joined.sure ?? [],
      known: joined.known ?? [],
      rewrite: joined.rewrite,
      words: joined.ink,
    };
  };

  it("is still written when it was answered on an earlier run", () => {
    const job = jobOf();
    expect(job.read[0]).toBe("I");
    const after = { ...job, ...writeUnasked(job, new Set<string>()) };
    expect(after.answered[0]).toBe(false);
    // "think" and "so" have no sureness here: held. The answered "I" is not.
    expect(ownInkRewrite(after)).toEqual([true, false, false]);
  });

  it("is written when it was answered in this run", () => {
    const job = jobOf();
    const after = { ...job, ...writeUnasked(job, new Set(["a"])) };
    expect(after.answered[0]).toBe(true);
    expect(ownInkRewrite(after)[0]).toBe(true);
  });

  it("is held when it was never answered", () => {
    const job = jobOf();
    const after = { ...job, ...writeUnasked(job, new Set<string>()), known: [false, false, false] };
    expect(ownInkRewrite(after)[0]).toBe(false);
  });
});
