import { describe, expect, it } from "vitest";
import { initToolbarLock, setToolbarLocked, toolbarLocked } from "../../src/view/toolbar-lock";

describe("toolbar lock", () => {
  it("reads only true or 'true' as locked", () => {
    for (const stored of [null, undefined, "", "false", false, 1, "on"]) {
      initToolbarLock(stored, () => {});
      expect(toolbarLocked()).toBe(false);
    }
    initToolbarLock("true", () => {});
    expect(toolbarLocked()).toBe(true);
    initToolbarLock(true, () => {});
    expect(toolbarLocked()).toBe(true);
  });

  it("keeps each change, and only changes", () => {
    const saved: boolean[] = [];
    initToolbarLock(null, (on) => saved.push(on));
    setToolbarLocked(false);
    setToolbarLocked(true);
    setToolbarLocked(true);
    expect(toolbarLocked()).toBe(true);
    setToolbarLocked(false);
    expect(saved).toEqual([true, false]);
  });
});
