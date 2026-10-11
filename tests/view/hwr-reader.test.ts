/**
 * `src/view/hwr-reader.ts`: the model's name as the page-reading dialog shows it.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { modelLabel } = await import("../../src/view/hwr-reader");

describe("modelLabel", () => {
  it("calls the bundled model and a model learned from it Grape 1.0", () => {
    expect(modelLabel("finenotes-hwr-1.0")).toBe("Grape 1.0");
    expect(modelLabel("grape-1.0, learned")).toBe("Grape 1.0, learned");
    expect(modelLabel("my-own-model")).toBe("my-own-model");
  });
});
