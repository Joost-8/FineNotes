/**
 * `src/model/update-button.ts`: what Home's update control shows.
 */

import { describe, expect, it } from "vitest";
import { CHECK_RESULT_MS, phaseAfter, updateButtonLook } from "../../src/model/update-button";

describe("updateButtonLook", () => {
  it("shows the two arrows until the user asks", () => {
    expect(updateButtonLook(null, "idle")).toEqual({ kind: "check" });
  });

  it("spins while checking, then says no update or no connection", () => {
    expect(updateButtonLook(null, "checking")).toEqual({ kind: "checking" });
    expect(updateButtonLook(null, "none")).toEqual({ kind: "none" });
    expect(updateButtonLook(null, "offline")).toEqual({ kind: "offline" });
  });

  it("is the Update pill whenever a newer version is known, whatever the check is doing", () => {
    for (const phase of ["idle", "checking", "none", "offline"] as const)
      expect(updateButtonLook("2.8.4", phase)).toEqual({ kind: "update", version: "2.8.4" });
  });
});

describe("phaseAfter", () => {
  it("leaves a found update to the pill, and holds the other answers for a moment", () => {
    expect(phaseAfter("found")).toBe("idle");
    expect(phaseAfter("none")).toBe("none");
    expect(phaseAfter("offline")).toBe("offline");
    expect(CHECK_RESULT_MS).toBeGreaterThanOrEqual(1500);
  });
});
