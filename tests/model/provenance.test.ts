import { describe, expect, it } from "vitest";
import {
  covers,
  erasedBy,
  isDeviceId,
  joinVersionVectors,
  newerVersion,
  readDot,
  readVersionVector,
} from "../../src/model/provenance";

describe("dots (#274)", () => {
  it("read `<device>.<counter>`, and nothing else", () => {
    expect(readDot("ab12cd34.812")).toEqual({ device: "ab12cd34", counter: 812 });
    // The counter is after the last dot; a device id holds none.
    expect(readDot("a.b.3")).toBeNull();
    for (const old of ["s12", "p1", "", ".3", "ab12.", "ab12.0", "ab12.03", "AB.3", 7, null]) {
      expect(readDot(old)).toBeNull();
    }
    expect(readDot("ab.99999999999999999")).toBeNull();
  });

  it("device ids are short, lower case, and hold no dot", () => {
    expect(isDeviceId("ab12cd34")).toBe(true);
    expect(isDeviceId("ipad-4f3a")).toBe(true);
    for (const bad of ["", "a.b", "AB", "x".repeat(33), "a/b", 3])
      expect(isDeviceId(bad)).toBe(false);
  });
});

describe("version vectors (#274)", () => {
  it("keep only devices with whole positive counters", () => {
    expect(readVersionVector({ ab: 3, cd: 0, "e.f": 2, gh: 1.5, ij: "4", kl: 9 })).toEqual({
      ab: 3,
      kl: 9,
    });
    for (const none of [undefined, null, [], "x", 3]) expect(readVersionVector(none)).toEqual({});
  });

  it("cover a dot at or below their counter for its device", () => {
    const vv = { ab: 5 };
    expect(covers(vv, "ab.5")).toBe(true);
    expect(covers(vv, "ab.6")).toBe(false);
    expect(covers(vv, "cd.1")).toBe(false);
    // An old id or none: never covered, so never taken for an erase.
    expect(covers(vv, "s12")).toBe(false);
    expect(covers(vv, undefined)).toBe(false);
  });

  it("join pointwise", () => {
    expect(joinVersionVectors({ ab: 3, cd: 7 }, { ab: 5 }, {})).toEqual({ ab: 5, cd: 7 });
  });
});

describe("which version of an element is newer (#274)", () => {
  it("is the one the other copy did not see", () => {
    // B moved A's stroke after seeing it: B's version wins.
    expect(newerVersion({ d: "a.1", vv: { a: 1 } }, { d: "b.4", vv: { a: 1, b: 4 } })).toBe("b");
    expect(newerVersion({ d: "b.4", vv: { a: 1, b: 4 } }, { d: "a.1", vv: { a: 1 } })).toBe("a");
  });

  it("is the same change, or concurrent when neither saw the other", () => {
    expect(newerVersion({ d: "a.1", vv: {} }, { d: "a.1", vv: { a: 9 } })).toBe("same");
    expect(newerVersion({ vv: {}, d: undefined }, { vv: {}, d: undefined })).toBe("same");
    expect(newerVersion({ d: "a.2", vv: { a: 2 } }, { d: "b.2", vv: { b: 2 } })).toBe("concurrent");
  });

  it("an absence is an erase only when the other copy saw that version", () => {
    expect(erasedBy({ a: 3 }, "a.3")).toBe(true);
    // A stale copy, or one that never got it: the element stays.
    expect(erasedBy({ a: 2 }, "a.3")).toBe(false);
    expect(erasedBy({}, "s12")).toBe(false);
  });
});
