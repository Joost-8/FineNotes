/**
 * Golden record of `StrokeBuilder`: which samples it keeps and what it
 * stores for them, over seeded pen streams — sub-threshold jitter, forced
 * pen-up samples, pressure readings that are missing (0), out of range or
 * not numbers — under the option sets the surface uses. Written before the
 * builder was rewritten (2026-09-25); the stored points are the ink, so they
 * must come out the same to the last bit.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  StrokeBuilder,
  type StrokeBuilderOptions,
  mapPressure,
} from "../../src/ink/stroke-builder";
import squiggles from "./fixtures/real-handwriting-squiggles.json";

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Park–Miller, so every run feeds the same stream. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

interface Sample {
  x: number;
  y: number;
  pressure: number;
  final?: boolean;
}

/** A wandering pen: mostly small steps, some below any spacing, odd pressure readings. */
function stream(seed: number, n: number): Sample[] {
  const next = rng(seed);
  const out: Sample[] = [];
  let x = 100;
  let y = 100;
  let pressure = 0.3;
  for (let i = 0; i < n; i++) {
    const step = next() < 0.3 ? next() * 0.8 : next() * 4;
    const angle = next() * Math.PI * 2;
    x += step * Math.cos(angle);
    y += step * Math.sin(angle);
    pressure = Math.min(1, Math.max(0.05, pressure + (next() - 0.5) * 0.2));
    const roll = next();
    const reading =
      roll < 0.08 ? 0 : roll < 0.1 ? 1.4 : roll < 0.11 ? Number.NaN : roll < 0.12 ? -0.2 : pressure;
    out.push({ x, y, pressure: reading });
  }
  return out;
}

/** A stroke as the Pencil sends it: no reading on pen-down, a real one after, 0 on pen-up. */
function pencil(pts: readonly number[]): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const pressure = i === 0 ? 0 : 0.1 + ((i / 3) % 7) * 0.05;
    out.push({ x: pts[i], y: pts[i + 1], pressure });
    // Coalesced samples often repeat a position, or barely move.
    out.push({ x: pts[i] + 0.05, y: pts[i + 1], pressure });
  }
  const last = out[out.length - 1];
  out.push({ x: last.x + 0.2, y: last.y, pressure: 0, final: true });
  return out;
}

const STREAMS: Array<[string, Sample[]]> = [
  ["random 1", stream(7, 160)],
  ["random 2", [...stream(1234, 120), { x: 101, y: 99, pressure: 0, final: true }]],
  ["pencil squiggle 1", pencil(squiggles.strokes[1].pts)],
  ["pencil squiggle 5", pencil(squiggles.strokes[5].pts)],
  ["all missing", stream(99, 30).map((s) => ({ ...s, pressure: 0 }))],
];

const OPTIONS: Array<[string, Partial<StrokeBuilderOptions> | undefined]> = [
  ["defaults", undefined],
  ["spacing 0", { minDistance: 0 }],
  ["spacing 3.5 (5x zoom out)", { minDistance: 3.5 }],
  ["spacing 0.28 (5x zoom)", { minDistance: 0.28 }],
  ["pressure off", { pressureEnabled: false }],
  ["fallback 0.8", { fallbackPressure: 0.8 }],
];

function golden(): string {
  const lines: string[] = [];
  for (const [optionName, options] of OPTIONS) {
    for (const [streamName, samples] of STREAMS) {
      const builder = new StrokeBuilder(options);
      const kept = samples
        .map((s) => ((s.final ? builder.addFinal(s) : builder.add(s)) ? "1" : "0"))
        .join("");
      lines.push(`${optionName} / ${streamName}: kept ${builder.length} empty=${builder.isEmpty}`);
      lines.push(`  ${kept}`);
      const points = JSON.stringify(builder.points());
      // The default options in full, so a change can be read; the rest by hash.
      lines.push(options === undefined ? `  ${points}` : `  points#${digest(points)}`);
    }
  }
  const mapped: StrokeBuilderOptions = {
    minDistance: 1,
    pressureEnabled: true,
    fallbackPressure: 0.5,
  };
  const raws = [0, -1, 0.001, 0.25, 0.999, 1, 1.0001, 7, Number.NaN, Infinity, -Infinity];
  lines.push(`mapPressure on: ${JSON.stringify(raws.map((r) => mapPressure(r, mapped)))}`);
  lines.push(
    `mapPressure off: ${JSON.stringify(raws.map((r) => mapPressure(r, { ...mapped, pressureEnabled: false })))}`,
  );
  return `${lines.join("\n")}\n`;
}

describe("StrokeBuilder, sample by sample", () => {
  it("keeps and stores exactly what the golden record says", async () => {
    await expect(golden()).toMatchFileSnapshot("./golden/stroke-builder.txt");
  });

  it("starts empty", () => {
    const builder = new StrokeBuilder();
    expect(builder.isEmpty).toBe(true);
    expect(builder.length).toBe(0);
    expect(builder.points()).toEqual([]);
  });
});
