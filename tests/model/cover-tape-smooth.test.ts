/**
 * Freehand cover tape, cleaned as it is laid (`smoothTapePath`): a wobbly
 * pen becomes a smooth curve, and the hook the pen makes as it lands or
 * lifts is cut.
 */

import { describe, expect, it } from "vitest";
import {
  FREEHAND_TAPE_TOLERANCE,
  type TapePt,
  freehandTapePoints,
  smoothTapePath,
} from "../../src/model/cover-tape";

const SIZE = 24;
const SMOOTH = { radius: SIZE * 0.6, hook: 14, lift: true };

/** Hand tremor: three slow sinusoids, as the ledger says, never white noise. */
function tremor(t: number, amp: number): number {
  return (
    amp * (Math.sin(t * 0.21 + 1) * 0.5 + Math.sin(t * 0.47 + 2) * 0.3 + Math.sin(t * 0.9) * 0.2)
  );
}

/** A level 300 px drag with ~1.5 px of tremor, sampled every 1.4 px. */
function wobblyLine(): TapePt[] {
  const out: TapePt[] = [];
  for (let x = 0; x <= 300; x += 1.4) out.push({ x, y: 100 + tremor(x, 1.5) });
  return out;
}

/** The largest heading change between neighbouring segments, degrees. */
function sharpestTurn(path: readonly TapePt[]): number {
  let worst = 0;
  for (let i = 1; i + 1 < path.length; i++) {
    const a = Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x);
    const b = Math.atan2(path[i + 1].y - path[i].y, path[i + 1].x - path[i].x);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    worst = Math.max(worst, (d * 180) / Math.PI);
  }
  return worst;
}

describe("smoothing a freehand tape's drag", () => {
  it("turns a wobbly line into a smooth one", () => {
    const raw = wobblyLine();
    const smooth = smoothTapePath(raw, SMOOTH);
    expect(sharpestTurn(raw)).toBeGreaterThan(20);
    expect(sharpestTurn(smooth)).toBeLessThan(3);
  });

  it("keeps both ends where the pen was when there is no hook", () => {
    const raw = wobblyLine();
    const smooth = smoothTapePath(raw, SMOOTH);
    expect(smooth[0]).toEqual(raw[0]);
    expect(smooth[smooth.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it("keeps a real bend: a U stays a U", () => {
    const raw: TapePt[] = [];
    for (let a = 0; a <= Math.PI; a += 0.02) {
      raw.push({ x: 200 - 100 * Math.cos(a), y: 100 + 100 * Math.sin(a) + tremor(a * 60, 1.2) });
    }
    const smooth = smoothTapePath(raw, SMOOTH);
    const bottom = Math.max(...smooth.map((p) => p.y));
    expect(bottom).toBeGreaterThan(195);
  });

  it("cuts a pen-down hook", () => {
    // The pen lands, ticks 8 px down, then sets off to the right.
    const raw: TapePt[] = [];
    for (let y = 0; y <= 8; y += 1) raw.push({ x: 0, y: -y });
    for (let x = 1.4; x <= 200; x += 1.4) raw.push({ x, y: -8 });
    const smooth = smoothTapePath(raw, SMOOTH);
    expect(smooth[0].y).toBeCloseTo(-8, 0);
    expect(Math.max(...smooth.map((p) => Math.abs(p.y + 8)))).toBeLessThan(1);
  });

  it("cuts a lift hook only once the pen has lifted", () => {
    const raw: TapePt[] = [];
    for (let i = 0; i <= 140; i++) raw.push({ x: i * 1.4, y: 0 });
    for (let y = 1; y <= 8; y += 1) raw.push({ x: 196, y });
    expect(smoothTapePath(raw, SMOOTH).at(-1)?.y).toBeCloseTo(0, 0);
    expect(smoothTapePath(raw, { ...SMOOTH, lift: false }).at(-1)?.y).toBe(8);
  });

  it("leaves a gentle curve at the start alone", () => {
    const raw: TapePt[] = [];
    for (let a = 0; a <= 1.2; a += 0.01)
      raw.push({ x: 150 * Math.sin(a), y: 150 - 150 * Math.cos(a) });
    expect(smoothTapePath(raw, SMOOTH)[0]).toEqual(raw[0]);
  });

  it("stores a smooth wobbly line as a straight tape", () => {
    const pts = freehandTapePoints(wobblyLine(), FREEHAND_TAPE_TOLERANCE, 8, SMOOTH) ?? [];
    expect(pts.length / 3).toBeLessThan(12);
  });
});
