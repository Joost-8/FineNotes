/**
 * `src/input/multi-finger-tap.ts`: two-finger double tap (undo) and
 * three-finger double tap (redo), and every near miss that must stay a
 * scroll, a pinch or nothing.
 */

import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_DISTANCE_PX,
  DOUBLE_TAP_GAP_MS,
  MULTI_TAP_MAX_MS,
  MULTI_TAP_SLOP_PX,
  MultiFingerTap,
  STALE_GROUP_MS,
  type TapReport,
} from "../../src/input/multi-finger-tap";

function recogniser(): { tap: MultiFingerTap; fired: number[]; reports: TapReport[] } {
  const fired: number[] = [];
  const reports: TapReport[] = [];
  const tap = new MultiFingerTap(
    (fingers) => fired.push(fingers),
    (report) => reports.push(report),
  );
  return { tap, fired, reports };
}

/**
 * One tap with `fingers` fingers about (x, y): all land at `t`, ten ms apart,
 * and lift `hold` ms later. Ids start at `id0` so taps never share ids.
 */
function tapAt(
  tap: MultiFingerTap,
  fingers: number,
  t: number,
  { x = 200, y = 300, hold = 120, id0 = 1 } = {},
): number {
  for (let i = 0; i < fingers; i++) tap.down(id0 + i, x + i * 60, y, t + i * 10);
  const end = t + hold;
  for (let i = 0; i < fingers; i++) tap.up(id0 + i, end + i * 5);
  return end + (fingers - 1) * 5;
}

describe("MultiFingerTap", () => {
  it("reports a two-finger double tap", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 2, 1000);
    tapAt(tap, 2, end + 150, { id0: 10 });
    expect(fired).toEqual([2]);
  });

  it("reports a three-finger double tap", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 3, 1000);
    tapAt(tap, 3, end + 150, { id0: 10 });
    expect(fired).toEqual([3]);
  });

  it("does nothing for a single two-finger tap", () => {
    const { tap, fired } = recogniser();
    tapAt(tap, 2, 1000);
    expect(fired).toEqual([]);
  });

  it("ignores one-finger double taps", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 1, 1000);
    tapAt(tap, 1, end + 100, { id0: 10 });
    expect(fired).toEqual([]);
  });

  it("does not pair taps with different numbers of fingers", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 2, 1000);
    tapAt(tap, 3, end + 100, { id0: 10 });
    expect(fired).toEqual([]);
  });

  it("refuses a second tap that comes too late", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 2, 1000);
    tapAt(tap, 2, end + DOUBLE_TAP_GAP_MS + 1, { id0: 10 });
    expect(fired).toEqual([]);
  });

  it("accepts a second tap right at the gap limit", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 2, 1000);
    tapAt(tap, 2, end + DOUBLE_TAP_GAP_MS, { id0: 10 });
    expect(fired).toEqual([2]);
  });

  it("refuses a tap held too long", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 2, 1000, { hold: MULTI_TAP_MAX_MS + 20 });
    tapAt(tap, 2, end + 100, { id0: 10 });
    expect(fired).toEqual([]);
  });

  it("refuses a second tap far from the first", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 2, 1000);
    tapAt(tap, 2, end + 100, { id0: 10, x: 200 + DOUBLE_TAP_DISTANCE_PX + 1 });
    expect(fired).toEqual([]);
  });

  it("treats a finger that slides as a scroll, not a tap", () => {
    const { tap, fired } = recogniser();
    tap.down(1, 200, 300, 1000);
    tap.down(2, 260, 300, 1010);
    tap.move(1, 200, 300 + MULTI_TAP_SLOP_PX + 1);
    tap.up(1, 1100);
    tap.up(2, 1105);
    tapAt(tap, 2, 1200, { id0: 10 });
    expect(fired).toEqual([]);
  });

  it("allows a small wobble within the slop", () => {
    const { tap, fired } = recogniser();
    tap.down(1, 200, 300, 1000);
    tap.down(2, 260, 300, 1010);
    tap.move(1, 205, 305);
    tap.up(1, 1100);
    tap.up(2, 1105);
    tapAt(tap, 2, 1200, { id0: 10 });
    expect(fired).toEqual([2]);
  });

  it("treats a pinch (fingers spreading) as no tap", () => {
    const { tap, fired } = recogniser();
    tap.down(1, 200, 300, 1000);
    tap.down(2, 260, 300, 1010);
    tap.move(1, 150, 300);
    tap.move(2, 320, 300);
    tap.up(1, 1150);
    tap.up(2, 1155);
    tapAt(tap, 2, 1250, { id0: 10 });
    expect(fired).toEqual([]);
  });

  it("is voided by a pen landing during a tap", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 2, 1000);
    tap.down(10, 200, 300, end + 100);
    tap.down(11, 260, 300, end + 110);
    tap.penDown();
    tap.up(10, end + 200);
    tap.up(11, end + 205);
    expect(fired).toEqual([]);
  });

  it("forgets the first tap when a pen lands between the two", () => {
    const { tap, fired } = recogniser();
    const end = tapAt(tap, 2, 1000);
    tap.penDown();
    tapAt(tap, 2, end + 100, { id0: 10 });
    expect(fired).toEqual([]);
  });

  it("makes a triple tap one double tap, not two", () => {
    const { tap, fired } = recogniser();
    let end = tapAt(tap, 2, 1000);
    end = tapAt(tap, 2, end + 100, { id0: 10 });
    tapAt(tap, 2, end + 100, { id0: 20 });
    expect(fired).toEqual([2]);
  });

  it("makes four quick taps two double taps", () => {
    const { tap, fired } = recogniser();
    let end = tapAt(tap, 2, 1000);
    end = tapAt(tap, 2, end + 100, { id0: 10 });
    end = tapAt(tap, 2, end + 100, { id0: 20 });
    tapAt(tap, 2, end + 100, { id0: 30 });
    expect(fired).toEqual([2, 2]);
  });

  it("counts the most fingers down at once, even if they land unevenly", () => {
    const { tap, fired } = recogniser();
    // Third finger lands as the first lifts: three were down together.
    tap.down(1, 200, 300, 1000);
    tap.down(2, 260, 300, 1020);
    tap.down(3, 320, 300, 1040);
    tap.up(1, 1100);
    tap.up(2, 1110);
    tap.up(3, 1120);
    tapAt(tap, 3, 1250, { id0: 10 });
    expect(fired).toEqual([3]);
  });

  it("counts a finger the system cancels at once as lifted (Android three-finger touches)", () => {
    const { tap, fired, reports } = recogniser();
    for (const base of [1, 10]) {
      const t = base === 1 ? 1000 : 1200;
      tap.down(base, 200, 300, t);
      tap.down(base + 1, 260, 300, t + 5);
      tap.down(base + 2, 320, 300, t + 10);
      // The system claims the touch: every finger is cancelled, none lifts.
      tap.cancel(base, t + 40);
      tap.cancel(base + 1, t + 40);
      tap.cancel(base + 2, t + 40);
    }
    expect(fired).toEqual([3]);
    expect(reports.map((r) => [r.fingers, r.outcome, r.cancelled])).toEqual([
      [3, "tap", true],
      [3, "double", true],
    ]);
  });

  it("still refuses a cancel that ends a long hold (WebKit's long press on the iPad)", () => {
    const { tap, fired, reports } = recogniser();
    tap.down(1, 200, 300, 1000);
    tap.down(2, 260, 300, 1005);
    tap.cancel(1, 1600);
    tap.cancel(2, 1600);
    tapAt(tap, 2, 1700, { id0: 10 });
    expect(fired).toEqual([]);
    expect(reports[0].outcome).toBe("slow");
  });

  it("abandons a group whose last finger never lifted", () => {
    const { tap, fired, reports } = recogniser();
    tap.down(1, 200, 300, 1000);
    tap.down(2, 260, 300, 1005);
    tap.up(1, 1080); // finger 2's lift never arrives
    const t = 1000 + STALE_GROUP_MS + 1;
    const end = tapAt(tap, 2, t, { id0: 10 });
    tapAt(tap, 2, end + 100, { id0: 20 });
    expect(fired).toEqual([2]);
    expect(reports[0].outcome).toBe("stale");
  });

  it("reports why a group was not a tap, and stays quiet for one finger", () => {
    const { tap, reports } = recogniser();
    tapAt(tap, 1, 1000);
    tap.down(1, 200, 300, 2000);
    tap.down(2, 260, 300, 2005);
    tap.move(1, 200, 400);
    tap.up(1, 2100);
    tap.up(2, 2100);
    tap.down(3, 200, 300, 3000);
    tap.down(4, 260, 300, 3005);
    tap.penDown();
    tap.up(3, 3050);
    tap.up(4, 3050);
    expect(reports.map((r) => r.outcome)).toEqual(["slid", "pen"]);
  });

  it("ignores a lift for a finger it never saw", () => {
    const { tap, fired } = recogniser();
    tap.up(99, 1000);
    tap.move(99, 0, 0);
    expect(fired).toEqual([]);
  });
});
