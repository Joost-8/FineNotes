import { describe, expect, it } from "vitest";
import { EINK_CHOICES, einkOn, isEinkModel, parseEinkChoice } from "../../src/model/eink";

describe("e-ink choice", () => {
  it("keeps on and off, and reads anything else as auto", () => {
    expect(EINK_CHOICES).toEqual(["auto", "on", "off"]);
    expect(parseEinkChoice("on")).toBe("on");
    expect(parseEinkChoice("off")).toBe("off");
    for (const raw of ["auto", undefined, null, "", "yes", 1, true]) {
      expect(parseEinkChoice(raw)).toBe("auto");
    }
  });

  it("follows the device only on auto", () => {
    expect(einkOn("auto", true)).toBe(true);
    expect(einkOn("auto", false)).toBe(false);
    expect(einkOn("on", false)).toBe(true);
    expect(einkOn("off", true)).toBe(false);
  });
});

describe("e-ink models", () => {
  it("knows Onyx BOOX tablets, readers and phones", () => {
    for (const model of [
      "NoteAir3C",
      "NoteAir2P",
      "Note Air 2 Plus",
      "NoteAir5C",
      "NoteMax",
      "NoteX3",
      "Note5",
      "Nova3",
      "NovaAir2",
      "Nova Air C",
      "Tab Ultra C Pro",
      "TabUltraC",
      "TabXC",
      "Tab Mini C",
      "Go103",
      "Go 10.3",
      "Go Color 7",
      "GoColor7",
      "Go 6 Gen II",
      "Palma",
      "Palma2",
      "Palma 2 Pro",
      "Page",
      "Poke5",
      "Leaf3C",
      "Max Lumi 2",
      "BOOX Note Air4 C",
      "ONYX BOOX",
    ]) {
      expect(isEinkModel(model), model).toBe(true);
    }
  });

  it("does not take phones and tablets with a similar word for one", () => {
    for (const model of [
      "Redmi Note 12",
      "SM-N986B",
      "SM-X900",
      "Galaxy Tab S8 Ultra",
      "Pixel 9",
      "nova 5T",
      "TB350FU",
      "Notebook",
      "Pagemaker",
      "Google",
      "K",
      "",
    ]) {
      expect(isEinkModel(model), model).toBe(false);
    }
    expect(isEinkModel(null)).toBe(false);
    expect(isEinkModel(undefined)).toBe(false);
  });
});
