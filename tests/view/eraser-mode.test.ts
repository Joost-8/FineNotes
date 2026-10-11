/**
 * `eraserModeFor` in `src/view/toolbar.ts`: the stored eraser mode, read
 * back. Plugin data can hold anything, and an unknown mode must not reach
 * the eraser.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { eraserModeFor } = await import("../../src/view/toolbar");

describe("eraserModeFor", () => {
  it("keeps the three modes", () => {
    expect(eraserModeFor({ tool: "eraser", eraserMode: "standard" } as never)).toBe("standard");
    expect(eraserModeFor({ tool: "eraser", eraserMode: "stroke" } as never)).toBe("stroke");
    expect(eraserModeFor({ tool: "eraser", eraserMode: "ruled" } as never)).toBe("ruled");
  });

  it("reads anything else as standard", () => {
    expect(eraserModeFor({ tool: "eraser" } as never)).toBe("standard");
    expect(eraserModeFor({ tool: "eraser", eraserMode: "lines" } as never)).toBe("standard");
  });
});
