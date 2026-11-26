import { describe, expect, it } from "vitest";
import { keyBetween, orderKeys } from "../../src/model/order-keys";
import { orderKeyAt } from "../../src/model/device-pages-union";

describe("order keys (#274)", () => {
  it("make a key strictly between two, or past either end", () => {
    const keys = [orderKeyAt(0), orderKeyAt(1), orderKeyAt(35), orderKeyAt(36)];
    for (let i = 0; i + 1 < keys.length; i++) {
      const mid = keyBetween(keys[i], keys[i + 1]);
      expect(keys[i] < mid && mid < keys[i + 1]).toBe(true);
    }
    expect(keyBetween(null, keys[0]) < keys[0]).toBe(true);
    expect(keyBetween(keys[3], null) > keys[3]).toBe(true);
    expect(keyBetween(null, null)).toBe("i");
    expect(() => keyBetween("b", "a")).toThrow();
  });

  it("keep making keys between neighbours, however often", () => {
    let low = orderKeyAt(4);
    const high = orderKeyAt(5);
    for (let i = 0; i < 200; i++) {
      const mid = keyBetween(low, high);
      expect(low < mid && mid < high && !mid.endsWith("0")).toBe(true);
      low = mid;
    }
    let top = orderKeyAt(0);
    for (let i = 0; i < 200; i++) {
      const before = keyBetween(null, top);
      expect(before < top && !before.endsWith("0")).toBe(true);
      top = before;
    }
  });

  it("keep the longest run in order and give only the others new keys", () => {
    const k = [0, 1, 2, 3].map(orderKeyAt);
    // The last page moved to the front: only it gets a new key.
    const moved = orderKeys([k[3], k[0], k[1], k[2]]);
    expect(moved.slice(1)).toEqual([k[0], k[1], k[2]]);
    expect(moved[0] < k[0]).toBe(true);
    // New pages between and after.
    const added = orderKeys([k[0], null, k[1], null]);
    expect(added[0]).toBe(k[0]);
    expect(added[2]).toBe(k[1]);
    expect(k[0] < added[1] && added[1] < k[1] && added[3] > k[1]).toBe(true);
    // Two pages with one key (added on two devices): one keeps it.
    const tied = orderKeys([k[0], k[0]]);
    expect(tied[0] < tied[1]).toBe(true);
    // Random shuffles stay strictly increasing.
    for (let round = 0; round < 50; round++) {
      const keys = Array.from({ length: 12 }, (_, i) => (i % 5 === 0 ? null : orderKeyAt(i)));
      keys.sort(() => Math.random() - 0.5);
      const out = orderKeys(keys);
      for (let i = 0; i + 1 < out.length; i++) expect(out[i] < out[i + 1]).toBe(true);
    }
  });
});
