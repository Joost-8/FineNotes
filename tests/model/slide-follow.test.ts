import { describe, expect, it } from "vitest";
import { followOnWrite, slideToOpen, slidesAround } from "../../src/model/slide-follow";

describe("followOnWrite", () => {
  it("records the slide read last", () => {
    expect(followOnWrite({ tab: "b1", page: 3 }, {})).toEqual({ tab: "b1", page: 3 });
  });

  it("records nothing before a slide was read", () => {
    expect(followOnWrite(null, {})).toBeNull();
    expect(followOnWrite(null, { follows: { tab: "b1", page: 0 } })).toBeNull();
  });

  it("leaves a page that already follows that slide alone", () => {
    expect(followOnWrite({ tab: "b1", page: 3 }, { follows: { tab: "b1", page: 3 } })).toBeNull();
  });

  it("moves a page on to another slide or tab", () => {
    expect(followOnWrite({ tab: "b1", page: 4 }, { follows: { tab: "b1", page: 3 } })).toEqual({
      tab: "b1",
      page: 4,
    });
    expect(followOnWrite({ tab: "b2", page: 3 }, { follows: { tab: "b1", page: 3 } })).toEqual({
      tab: "b2",
      page: 3,
    });
  });

  it("hands back a copy, never the reference it was given", () => {
    const shown = { tab: "b1", page: 1 };
    const got = followOnWrite(shown, {});
    expect(got).not.toBe(shown);
  });
});

describe("slideToOpen", () => {
  const page = { follows: { tab: "b1", page: 5 } };

  it("opens the slide the page follows on its own tab", () => {
    expect(slideToOpen(page, "b1", { page: 0 }, 10)).toBe(5);
    expect(slideToOpen(page, "b1", null, 10)).toBe(5);
  });

  it("keeps the tab as it was left for another tab, or a page following none", () => {
    expect(slideToOpen(page, "b2", { page: 0 }, 10)).toBeNull();
    expect(slideToOpen({}, "b1", { page: 0 }, 10)).toBeNull();
    expect(slideToOpen(null, "b1", { page: 0 }, 10)).toBeNull();
  });

  it("stays put when the tab was left on that slide already", () => {
    expect(slideToOpen(page, "b1", { page: 5 }, 10)).toBeNull();
  });

  it("ignores a slide the PDF no longer has", () => {
    expect(slideToOpen(page, "b1", { page: 0 }, 5)).toBeNull();
  });
});

describe("slidesAround", () => {
  it("is the next slide, the one before, then the one after the next", () => {
    expect(slidesAround(3, 10)).toEqual([4, 2, 5]);
  });

  it("stays inside the PDF", () => {
    expect(slidesAround(0, 10)).toEqual([1, 2]);
    expect(slidesAround(9, 10)).toEqual([8]);
    expect(slidesAround(0, 1)).toEqual([]);
  });
});
