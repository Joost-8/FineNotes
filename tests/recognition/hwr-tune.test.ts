/**
 * Learning a writer's handwriting (`src/recognition/hwr/tune.ts`) and
 * saving the result (`bundle-write.ts`), on the bundled model.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLE_FORMAT_INPUT, bundleFormatOf, parseBundle } from "../../src/recognition/hwr/bundle";
import { writeBundle } from "../../src/recognition/hwr/bundle-write";
import {
  type LabelledLine,
  TUNE_MAX_FRAMES,
  augmentFeatures,
  augmentStrokes,
  editDistance,
  encodeLabel,
  prepareLine,
  seededRandom,
  splitHoldout,
  TUNE_MAX_CURVES,
  tune,
  tuneRoom,
} from "../../src/recognition/hwr/tune";

const BYTES = new Uint8Array(readFileSync("models/grape-1.0.bin"));
const BASE = parseBundle(BYTES);

/** A made-up line: a wave as long as its text. */
function line(text: string, seed: number): LabelledLine {
  const pts: number[] = [];
  const n = 8 * text.length;
  for (let i = 0; i <= n; i++) pts.push(10 + i * 3, 100 + 10 * Math.sin(i * 0.9 + seed), 0.5);
  return { strokes: [{ pts, t0: 0 }], text };
}

describe("writeBundle", () => {
  it("writes a network back so it reads the same, with a new name and the same language model", () => {
    const written = writeBundle(BYTES, BASE.net, { name: "personal" });
    const back = parseBundle(written);
    expect(back.meta.name).toBe("personal");
    expect(back.meta.alphabet).toEqual(BASE.meta.alphabet);
    expect(back.net.layers[2][1].wih).toEqual(BASE.net.layers[2][1].wih);
    expect(back.net.outBias).toEqual(BASE.net.outBias);
    expect(back.lm).not.toBeNull();
    expect(written.byteLength % 4).toBe(0);
    // Only the header differs: written compactly, it can be a few hundred bytes shorter.
    expect(Math.abs(written.byteLength - BYTES.byteLength)).toBeLessThan(4096);
  });

  it("refuses bytes that are no model", () => {
    expect(() => writeBundle(new Uint8Array(16), BASE.net, {})).toThrow();
  });
});

describe("preparing lines", () => {
  const alphabet = BASE.meta.alphabet;

  it("encodes a label, or refuses a character the model does not write", () => {
    expect(encodeLabel("ab", alphabet)).toEqual([
      alphabet.indexOf("a") + 1,
      alphabet.indexOf("b") + 1,
    ]);
    expect(encodeLabel("é", alphabet)).toBeNull();
    expect(encodeLabel("", alphabet)).toBeNull();
  });

  it("augments the ink and the features the same way for the same seed", () => {
    const strokes = line("hello", 1).strokes;
    expect(augmentStrokes(strokes, seededRandom(4))).toEqual(
      augmentStrokes(strokes, seededRandom(4)),
    );
    expect(augmentStrokes(strokes, seededRandom(4))).not.toEqual(strokes);
    const f = Float32Array.from([1, 2, 3, 0, 4, 5, 6, 1]);
    augmentFeatures(f, 2, seededRandom(2));
    expect(f[3]).toBe(0);
    expect(f[7]).toBe(1); // the new-stroke channel is left alone
  });

  it("prepares a line, augmented or not; refuses one without ink or with an unknown character", () => {
    const plain = prepareLine(line("hello", 1), alphabet, seededRandom(1), false);
    expect(plain?.frames).toBeGreaterThan(10);
    expect(plain?.target).toHaveLength(5);
    expect(prepareLine(line("hello", 1), alphabet, seededRandom(1), true)?.frames).toBeGreaterThan(
      10,
    );
    expect(prepareLine({ strokes: [], text: "x" }, alphabet, seededRandom(1), false)).toBeNull();
    expect(prepareLine(line("é", 1), alphabet, seededRandom(1), false)).toBeNull();
  });

  it("holds out every fifth line, and one at least", () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(`l${i}`, i));
    const { train, holdout } = splitHoldout(lines);
    expect(holdout.map((l) => l.text)).toEqual(["l4", "l9"]);
    expect(train).toHaveLength(8);
    expect(splitHoldout(lines.slice(0, 3)).holdout).toHaveLength(1);
    expect(splitHoldout(lines.slice(0, 1)).holdout).toHaveLength(0);
  });

  it("counts edits by character", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
});

describe("tune", () => {
  it("runs the steps, reports each, and gates the result on the held-out lines", () => {
    const lines = ["hello", "world", "notes", "ink", "pages", "lines"].map((t, i) => line(t, i));
    const steps: number[] = [];
    const result = tune(BYTES, lines, { steps: 2, batch: 2 }, (step, loss) => {
      steps.push(step);
      expect(Number.isFinite(loss)).toBe(true);
    });
    expect(steps).toEqual([1, 2]);
    expect(result).not.toBeNull();
    expect(result!.trained).toBe(5);
    expect(result!.heldOut).toBe(1);
    expect(result!.before.chars).toBe(5);
    expect(result!.better).toBe(result!.after.errors < result!.before.errors);
    // The tuned network moved, and still parses once written.
    expect(result!.net.layers[0][0].bias).not.toEqual(BASE.net.layers[0][0].bias);
    expect(parseBundle(writeBundle(BYTES, result!.net, { name: "personal" })).meta.name).toBe(
      "personal",
    );
  }, 120000);

  it("leaves out a line too long to learn from, so it cannot size the run's memory", () => {
    const lines = ["hello", "world", "notes", "ink", "pages", "lines"].map((t, i) => line(t, i));
    // The same wave for 40 letters: ~1,850 frames, past any copied practice line.
    const long = line("x".repeat(40), 9);
    expect(prepareLine(long, BASE.meta.alphabet, seededRandom(1), false)!.frames).toBeGreaterThan(
      TUNE_MAX_FRAMES,
    );
    const result = tune(BYTES, [...lines, long], { steps: 1, batch: 2 });
    expect(result!.trained + result!.heldOut).toBe(6);
  }, 120000);

  it("stops when told to, and does nothing without lines to learn from", () => {
    const lines = ["hello", "world"].map((t, i) => line(t, i));
    expect(tune(BYTES, lines, { steps: 5, batch: 1 }, () => false)).toBeNull();
    expect(tune(BYTES, [line("é", 1)], { steps: 1 })).toBeNull();
  }, 60000);
});

describe("the engine's room on a device short of memory", () => {
  it("is 2.5 times the longest line on a roomy device, 1.3 times elsewhere or when unknown", () => {
    expect(tuneRoom(400, 8)).toBe(1016);
    expect(tuneRoom(400, 16)).toBe(1016);
    expect(tuneRoom(400, 4)).toBe(536);
    expect(tuneRoom(400)).toBe(536);
  });

  it("learns exactly the same network in the smaller room", () => {
    const lines = ["hello", "world", "notes", "ink", "pages", "lines"].map((t, i) => line(t, i));
    const roomy = tune(BYTES, lines, { steps: 2, batch: 3, deviceMemory: 16 });
    const lean = tune(BYTES, lines, { steps: 2, batch: 3 });
    expect(lean!.net).toEqual(roomy!.net);
    expect(lean!.after).toEqual(roomy!.after);
  }, 120000);
});

describe("tuning a curve model (Grape 2)", () => {
  const golden = JSON.parse(
    readFileSync("tests/recognition/fixtures/hwr-curves-golden.json", "utf8"),
  ) as { bundle: string };
  const CURVES = new Uint8Array(Buffer.from(golden.bundle, "base64"));

  it("learns from its curves and writes a curve model back", () => {
    const texts = ["a long road", "go on", "no one", "an old log", "along", "dog"];
    const lines = texts.map((t, i) => line(t, i));
    const model = parseBundle(CURVES);
    const m = { input: model.meta.input, inputs: model.net.inputs };
    const points = prepareLine(lines[0], model.meta.alphabet, seededRandom(1), false)!;
    const curves = prepareLine(lines[0], model.meta.alphabet, seededRandom(1), false, m)!;
    expect(curves.frames).toBeLessThan(points.frames);
    expect(curves.features.length).toBe(curves.frames * 12);
    const result = tune(CURVES, lines, { steps: 2, batch: 2 });
    expect(result!.trained).toBe(5);
    expect(result!.net.layers[0][0].bias).not.toEqual(model.net.layers[0][0].bias);
    const written = writeBundle(CURVES, result!.net, { name: "personal" });
    expect(bundleFormatOf(written)).toBe(BUNDLE_FORMAT_INPUT);
    expect(parseBundle(written).meta.input).toEqual(model.meta.input);
    expect(TUNE_MAX_CURVES).toBeLessThan(TUNE_MAX_FRAMES);
  }, 120000);
});
