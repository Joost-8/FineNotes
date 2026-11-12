import { describe, expect, it } from "vitest";
import {
  type ToolbarLayout,
  defaultLayout,
  isItemOff,
  isPinnedIn,
  moveTo,
  normalizeLayout,
  penButtonType,
  penRowOffers,
  penSlotInHand,
  penSlotsOf,
  penTypeSlot,
  penTypesOnBar,
  placeOf,
  savedPenSlot,
  setPenSlot,
  slotPenType,
  slotSavedId,
} from "../../src/view/toolbar-layout";
import type { SavedPen, SavedPenType } from "../../src/model/saved-pens";

/** The default bar with `slots` right after the pen's button. */
function withSlots(...slots: string[]): ToolbarLayout {
  const layout = defaultLayout();
  const at = layout.middle.indexOf("pen") + 1;
  layout.middle.splice(at, 0, ...(slots as ToolbarLayout["middle"]));
  return normalizeLayout(layout);
}

describe("pens as buttons of their own (FineNotes#211)", () => {
  it("names a pen type's slot and a saved pen's, and reads them back", () => {
    expect(penTypeSlot("ball")).toBe("pen:ball");
    expect(savedPenSlot("pen2")).toBe("saved:pen2");
    expect(slotPenType("pen:highlighter")).toBe("highlighter");
    expect(slotPenType("saved:pen2")).toBeNull();
    expect(slotSavedId("saved:pen2")).toBe("pen2");
    expect(slotSavedId("pen:ball")).toBeNull();
  });

  it("keeps pens in the zones, in their order, and nowhere else", () => {
    const layout = normalizeLayout({
      start: ["home"],
      middle: ["select", "pen", "pen:ball", "saved:pen8", "eraser", "accessories"],
      end: ["more"],
      off: ["pen:brush", "saved:pen3", "ruler"],
    });
    expect(penSlotsOf(layout)).toEqual(["pen:ball", "saved:pen8"]);
    expect(layout.off).toEqual(["ruler"]);
    expect(placeOf(layout, "pen:brush")).toBe("off");
  });

  it("drops what is not a pen, a pen twice, and a saved pen that is gone", () => {
    const raw = {
      start: [],
      middle: ["pen", "pen:pencil", "saved:no way!", "pen:ball", "pen:ball", "saved:gone"],
      end: ["more"],
      off: [],
    };
    expect(penSlotsOf(normalizeLayout(raw))).toEqual(["pen:ball", "saved:gone"]);
    expect(penSlotsOf(normalizeLayout(raw, new Set(["kept"])))).toEqual(["pen:ball"]);
  });

  it("lets the pen's button leave the bar only while another pen is on it", () => {
    const alone = defaultLayout();
    expect(isPinnedIn(alone, "pen")).toBe(true);
    expect(moveTo(alone, "pen", "off")).toEqual(alone);

    const two = withSlots("pen:ball", "pen:highlighter");
    expect(isPinnedIn(two, "pen")).toBe(false);
    const away = moveTo(two, "pen", "off");
    expect(placeOf(away, "pen")).toBe("off");
    expect(penSlotsOf(away)).toEqual(["pen:ball", "pen:highlighter"]);
    // Out of sight, the pen still writes: its types are on the bar.
    expect(isItemOff(away, "pen")).toBe(false);
  });

  it("brings the pen's button back when the last other pen leaves", () => {
    const away = moveTo(withSlots("pen:ball"), "pen", "off");
    const back = moveTo(away, "pen:ball", "off");
    expect(penSlotsOf(back)).toEqual([]);
    expect(placeOf(back, "pen")).toBe("middle");
    expect(back.off).not.toContain("pen");
  });

  it("reads a stored bar whose pen is away and whose pens are gone as one with the pen", () => {
    const stored = { start: [], middle: ["saved:gone"], end: ["more"], off: ["pen"] };
    const layout = normalizeLayout(stored, new Set<string>());
    expect(placeOf(layout, "pen")).toBe("middle");
  });

  it("never sends a pen to More tools: off the bar it is gone", () => {
    const layout = moveTo(withSlots("saved:pen1"), "saved:pen1", "menu");
    expect(penSlotsOf(layout)).toEqual([]);
    expect(layout.off).toEqual([]);
  });

  it("puts a pen after the pen's button, then after the pens already there", () => {
    const one = setPenSlot(defaultLayout(), "pen:ball", true);
    const pen = one.middle.indexOf("pen");
    expect(one.middle[pen + 1]).toBe("pen:ball");
    const two = setPenSlot(one, "saved:pen8", true);
    expect(two.middle.slice(pen, pen + 3)).toEqual(["pen", "pen:ball", "saved:pen8"]);
    expect(setPenSlot(two, "pen:ball", true)).toEqual(two);
    expect(penSlotsOf(setPenSlot(two, "pen:ball", false))).toEqual(["saved:pen8"]);
  });

  it("puts a pen where the pen's button was moved to, any zone", () => {
    const moved = moveTo(defaultLayout(), "pen", { zone: "start", index: 0 });
    const layout = setPenSlot(moved, "pen:highlighter", true);
    expect(layout.start.slice(0, 2)).toEqual(["pen", "pen:highlighter"]);
  });

  it("knows which pen types have buttons of their own", () => {
    expect([...penTypesOnBar(withSlots("pen:ball", "saved:pen1", "pen:highlighter"))]).toEqual([
      "ball",
      "highlighter",
    ]);
  });
});

describe("the pen's row beside pens on the bar", () => {
  const all: SavedPenType[] = ["fountain", "ball", "brush", "calligraphy", "highlighter"];

  it("offers every type while none has a button of its own", () => {
    expect(penRowOffers(all, new Set(), "fountain")).toEqual(all);
  });

  it("leaves out the types on the bar", () => {
    const onBar = new Set<SavedPenType>(["ball", "highlighter"]);
    expect(penRowOffers(all, onBar, "fountain")).toEqual(["fountain", "brush", "calligraphy"]);
  });

  it("has no row for a type on the bar in hand, or for the one type left", () => {
    expect(penRowOffers(all, new Set(["ball"]), "ball")).toEqual([]);
    const four = new Set<SavedPenType>(["ball", "brush", "calligraphy", "highlighter"]);
    expect(penRowOffers(all, four, "fountain")).toEqual([]);
  });
});

describe("which pen button the pen in hand belongs to", () => {
  const blue: SavedPen = { type: "ball", color: "#1971c2", size: 2, id: "pen1" };
  const saved = (id: string): SavedPen | null => (id === "pen1" ? blue : null);

  it("is a saved pen it draws exactly as, before its type's own button", () => {
    const layout = withSlots("pen:ball", "saved:pen1");
    const inHand: SavedPen = { type: "ball", color: "#1971C2", size: 2 };
    expect(penSlotInHand(layout, inHand, saved)).toBe("saved:pen1");
  });

  it("is its type's button once it draws otherwise", () => {
    const layout = withSlots("pen:ball", "saved:pen1");
    const inHand: SavedPen = { type: "ball", color: "#e03131", size: 2 };
    expect(penSlotInHand(layout, inHand, saved)).toBe("pen:ball");
  });

  it("is the pen's own button for a type without one", () => {
    const layout = withSlots("pen:ball", "saved:pen1");
    const inHand: SavedPen = { type: "fountain", color: "#1971c2", size: 2 };
    expect(penSlotInHand(layout, inHand, saved)).toBeNull();
  });
});

describe("what the pen's button stands for", () => {
  const order: SavedPenType[] = ["fountain", "ball", "brush", "calligraphy", "highlighter"];

  it("is the type in hand while that has no button of its own", () => {
    expect(penButtonType(order, new Set(["ball"]), "brush", "fountain")).toBe("brush");
  });

  it("is the type it last stood for while another's button holds the pen", () => {
    expect(penButtonType(order, new Set(["ball"]), "ball", "calligraphy")).toBe("calligraphy");
  });

  it("is the first free type when the last one has a button now, or none is left", () => {
    expect(penButtonType(order, new Set(["ball", "fountain"]), "ball", "fountain")).toBe("brush");
    expect(penButtonType(order, new Set(order), "ball", null)).toBeNull();
  });
});
