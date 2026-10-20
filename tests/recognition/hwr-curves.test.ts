/**
 * Grape 2's Bézier-curve input (src/recognition/hwr/curves.ts) against the
 * Python reference (research/handwriting-rig/htr.py), on synthetic ink:
 * tests/recognition/fixtures/hwr-curves-golden.json, written by
 * research/handwriting-rig/export_curve_fixtures.py.
 *
 * The fit is float64 in the reference's order, but numpy's `@` runs on
 * BLAS, whose summation order is its own; the curves must agree in count and
 * stroke exactly, and every float32 value within 1e-6 (relative to the value,
 * floored at 1e-3). On 2,046 real lines (research/handwriting-rig/ts_eval.mjs,
 * 2026-10-20) every line had the same curves, 981 bit for bit, and no value
 * differed by more than 3e-8 (about one float32 step).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forward } from "../../src/recognition/hwr/blstm";
import { writeBundle } from "../../src/recognition/hwr/bundle-write";
import {
  BUNDLE_FORMAT_INPUT,
  BUNDLE_FORMAT_POINTS,
  bundleFormatOf,
  HwrFormatError,
  parseBundle,
} from "../../src/recognition/hwr/bundle";
import { CURVE_RAW, curvesFromFeatures, networkInput } from "../../src/recognition/hwr/curves";
import { readLine } from "../../src/recognition/hwr/recognizer";

interface CurveLine {
  name: string;
  frames: number;
  points: string;
  curves: Record<string, { frames: number; raw: string; stroke: number[] }>;
  logp: string;
}

const golden = JSON.parse(
  readFileSync("tests/recognition/fixtures/hwr-curves-golden.json", "utf8"),
) as { bundle: string; lines: CurveLine[] };

function f32(b64: string): Float32Array {
  const b = Buffer.from(b64, "base64");
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const bundleBytes = (): Uint8Array => new Uint8Array(Buffer.from(golden.bundle, "base64"));

/** The model file with its header replaced (and its version set). */
function withHeader(edit: (meta: Record<string, unknown>) => void, version?: number): Uint8Array {
  const src = bundleBytes();
  const view = new DataView(src.buffer, src.byteOffset);
  const metaLength = view.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(src.subarray(12, 12 + metaLength))) as Record<
    string,
    unknown
  >;
  edit(meta);
  let json = new TextEncoder().encode(JSON.stringify(meta));
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
  padded.set(json);
  json = padded;
  const out = new Uint8Array(12 + json.length + src.length - 12 - metaLength);
  out.set(src.subarray(0, 12));
  const ov = new DataView(out.buffer);
  if (version !== undefined) ov.setUint32(4, version, true);
  ov.setUint32(8, json.length, true);
  out.set(json, 12);
  out.set(src.subarray(12 + metaLength), 12 + json.length);
  return out;
}

describe("curvesFromFeatures (htr.curves_from_features, raw encoding)", () => {
  for (const line of golden.lines) {
    for (const [tol, ref] of Object.entries(line.curves)) {
      it(`${line.name} at tolerance ${tol}`, () => {
        const got = curvesFromFeatures(f32(line.points), line.frames, Number(tol));
        expect(got.frames).toBe(ref.frames);
        expect(Array.from(got.curveStroke)).toEqual(ref.stroke);
        const want = f32(ref.raw);
        let worst = 0;
        for (let i = 0; i < want.length; i++) {
          const d = Math.abs(want[i] - got.features[i]) / Math.max(Math.abs(want[i]), 1e-3);
          worst = Math.max(worst, d);
        }
        expect(worst).toBeLessThan(1e-6);
      });
    }
  }

  it("joins strokes with a straight pen-up curve, and pads rows with zeros", () => {
    // Two strokes of three frames each: (dx, dy, dt, new stroke).
    const f = new Float32Array([
      0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 3, 0, 2, 1, 1, 0, 1, 0, 1, 0, 1, 0,
    ]);
    const got = curvesFromFeatures(f, 6, 0.01, 12);
    expect(got.frames).toBe(3);
    expect(Array.from(got.curveStroke)).toEqual([0, 1, 1]);
    const up = Array.from(got.features.subarray(12, 24));
    expect(up[0]).toBe(3);
    expect(up[2]).toBeCloseTo(1, 6);
    expect(up[4]).toBeCloseTo(-1, 6);
    expect(up[9]).toBe(1);
    expect(up.slice(10)).toEqual([0, 0]);
    expect(() => curvesFromFeatures(f, 6, 0.01, CURVE_RAW - 1)).toThrow();
  });

  it("gives a point model its frames unchanged", () => {
    const f = f32(golden.lines[0].points);
    const got = networkInput(undefined, 4, f, golden.lines[0].frames);
    expect(got.features).toBe(f);
  });
});

describe("a curve model file (format 2)", () => {
  it("is read with its input, padded to a multiple of four", () => {
    const bundle = parseBundle(bundleBytes());
    expect(bundleFormatOf(bundleBytes())).toBe(BUNDLE_FORMAT_INPUT);
    expect(bundle.meta.input).toEqual({ kind: "curves", tol: 0.01, encoding: "raw" });
    expect(bundle.net.inputs).toBe(12);
    expect(bundle.net.std![10]).toBe(1);
  });

  for (const simd of [true, false]) {
    it(`computes the reference's log-probabilities on its curves (${simd ? "SIMD" : "JS"})`, () => {
      const bundle = parseBundle(bundleBytes());
      for (const line of golden.lines) {
        const x = networkInput(bundle.meta.input, bundle.net.inputs, f32(line.points), line.frames);
        const want = f32(line.logp);
        const got = forward(bundle.net, x.features, x.frames, { simd });
        expect(got.length).toBe(want.length);
        let worst = 0;
        for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(want[i] - got[i]));
        expect(worst).toBeLessThan(1e-4);
      }
    });
  }

  it("reads a line from strokes through its curves", () => {
    const bundle = parseBundle(bundleBytes());
    const pts = Array.from({ length: 40 }, (_, i) => [i * 2, 10 + 8 * Math.sin(i / 3), 0.5]).flat();
    const reading = readLine(bundle, [{ pts, t0: 0 }]);
    expect(reading.frames).toBeGreaterThan(0);
    expect(reading.frames).toBeLessThan(40);
  });

  it("refuses a format 2 header that does not say what it reads, or asks for what this build lacks", () => {
    const refuse = (edit: (m: Record<string, unknown>) => void, re: RegExp) =>
      expect(() => parseBundle(withHeader(edit))).toThrow(re);
    refuse((m) => delete m.input, /must say what its network reads/);
    refuse((m) => (m.input = { kind: "pixels", tol: 0.01, encoding: "raw" }), /reads pixels/);
    refuse((m) => (m.input = { kind: "curves", tol: 0.01, encoding: "carbune" }), /carbune/);
    refuse((m) => (m.input = { kind: "curves", tol: 0, encoding: "raw" }), /tolerance/);
    refuse((m) => ((m.net as { inputs: number }).inputs = 8), /network inputs/);
    expect(() => parseBundle(withHeader(() => {}, 3))).toThrow(HwrFormatError);
  });

  it("ignores an input field in a format 1 file", () => {
    // Format 1 never had one; a build must read such a file as points.
    const bytes = withHeader(() => {}, BUNDLE_FORMAT_POINTS);
    expect(parseBundle(bytes).meta.input).toBeUndefined();
  });

  it("keeps its version when a tuned network is written into it", () => {
    const bundle = parseBundle(bundleBytes());
    const out = writeBundle(bundleBytes(), bundle.net, { name: "tuned" });
    expect(bundleFormatOf(out)).toBe(BUNDLE_FORMAT_INPUT);
    const again = parseBundle(out);
    expect(again.meta.input).toEqual(bundle.meta.input);
    expect(again.meta.name).toBe("tuned");
  });
});
