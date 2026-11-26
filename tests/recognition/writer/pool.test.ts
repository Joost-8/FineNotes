import { describe, expect, it } from "vitest";

import { proseLike } from "../../../src/recognition/writer/pool";

const writable = (ch: string): boolean => /[a-z0-9 .,]/i.test(ch);

describe("proseLike", () => {
  it("accepts a line with letters the model writes", () => {
    expect(proseLike("The quick brown fox, 3 times.", writable)).toBe(true);
  });

  it("refuses a line without a letter", () => {
    expect(proseLike("12 + 34", writable)).toBe(false);
    expect(proseLike("", writable)).toBe(false);
  });

  it.each([..."^_=<>|{}\\~"])(
    "refuses a line with %s, which sits off the line or stands for maths",
    (ch) => {
      expect(proseLike(`a ${ch} b`, () => true)).toBe(false);
    },
  );

  it("refuses a line with a character the model cannot write", () => {
    expect(proseLike("naïve text", writable)).toBe(false);
  });

  it("counts letters outside ASCII", () => {
    expect(proseLike("é", () => true)).toBe(true);
  });
});
