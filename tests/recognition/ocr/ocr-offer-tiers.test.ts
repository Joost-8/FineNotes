import { describe, expect, it } from "vitest";
import { OCR_TIERS, ocrTiersFor } from "../../../src/recognition/ocr/ocr-model";

describe("the tiers as the download offer lists them", () => {
  it("every tier says what choosing it costs, in one short line", () => {
    for (const tier of OCR_TIERS) {
      expect(tier.downside.length).toBeGreaterThan(10);
      expect(tier.downside.length).toBeLessThanOrEqual(90);
    }
  });

  it("lists Fast first, and only Fast and Accurate on a phone or tablet", () => {
    expect(ocrTiersFor(false).map((t) => t.id)).toEqual(["fast", "accurate", "most-accurate"]);
    expect(ocrTiersFor(true).map((t) => t.id)).toEqual(["fast", "accurate"]);
  });
});
