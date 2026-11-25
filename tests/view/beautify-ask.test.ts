import { describe, expect, it } from "vitest";

import { type WordCardHost, askUnsureWords } from "../../src/view/beautify-ask";

type Script = "chip" | "dismiss" | "typed" | "none";

/** A host whose card answers each word as `script` says; it records the words it opened. */
function host(script: Record<string, Script>, log: string[]): WordCardHost {
  let dialog = 0;
  return {
    open: (ids, after) => {
      const how = script[ids[0]];
      if (how === "none") return Promise.resolve(false);
      log.push(ids[0]);
      queueMicrotask(() => {
        if (how === "chip") {
          after.closed();
          after.done();
        } else if (how === "dismiss") {
          after.closed();
        } else {
          // "Type what it says": the card goes, a dialog stays up a while, then the answer.
          dialog = 3;
          after.closed();
        }
      });
      if (how === "typed") {
        const tick = setInterval(() => {
          dialog--;
          if (dialog === 0) {
            clearInterval(tick);
            after.done();
          }
        }, 1);
      }
      return Promise.resolve(true);
    },
    dialogOpen: () => dialog > 0,
  };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 5)));

describe("askUnsureWords", () => {
  it("asks each word in turn and returns the ones answered, by a chip or typed in the dialog", async () => {
    const log: string[] = [];
    const got = await askUnsureWords(
      host({ a: "chip", b: "dismiss", c: "typed" }, log),
      [["a"], ["b"], ["c", "c2"]],
      () => false,
      wait,
    );
    expect(log).toEqual(["a", "b", "c"]);
    expect(got).toEqual([["a"], ["c", "c2"]]);
  });

  it("skips a word with no card and stops asking once told to", async () => {
    const log: string[] = [];
    let stopped = false;
    const h = host({ a: "none", b: "chip", c: "chip" }, log);
    const open = h.open;
    h.open = async (ids, after) => {
      const r = await open(ids, after);
      if (ids[0] === "b") stopped = true;
      return r;
    };
    const got = await askUnsureWords(h, [["a"], ["b"], ["c"]], () => stopped, wait);
    expect(log).toEqual(["b"]);
    expect(got).toEqual([["b"]]);
  });
});
