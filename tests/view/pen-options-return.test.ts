/**
 * "Hide pen options while writing", until the pen lifts: the notebook view
 * brings back the options a stroke tucked away once the pen has rested
 * (PEN_OPTIONS_RETURN_MS), and a pen-down in that pause keeps them away.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEN_OPTIONS_RETURN_MS } from "../../src/view/tool-return";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { InkView } = await import("../../src/view/ink-view");

function viewWith(mode: unknown) {
  const showTuckedOptions = vi.fn();
  const members = {
    plugin: { settings: { tuckPenOptionsOnWrite: mode } },
    toolbar: { showTuckedOptions },
    optionsReturnTimer: 0,
  };
  const view = Object.create(InkView.prototype) as Record<string, unknown>;
  for (const [key, value] of Object.entries(members)) {
    Object.defineProperty(view, key, { value, writable: true, configurable: true });
  }
  const pen = (down: boolean): void =>
    (view as unknown as { returnPenOptions(down: boolean): void }).returnPenOptions(down);
  return { pen, showTuckedOptions };
}

describe("pen options back after the pen lifts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("come back once the pen has rested", () => {
    const { pen, showTuckedOptions } = viewWith("until-lift");
    pen(true);
    pen(false);
    vi.advanceTimersByTime(PEN_OPTIONS_RETURN_MS - 1);
    expect(showTuckedOptions).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(showTuckedOptions).toHaveBeenCalledOnce();
  });

  it("stay away while the next stroke follows within the pause", () => {
    const { pen, showTuckedOptions } = viewWith("until-lift");
    pen(false);
    vi.advanceTimersByTime(PEN_OPTIONS_RETURN_MS / 2);
    pen(true);
    vi.advanceTimersByTime(PEN_OPTIONS_RETURN_MS * 2);
    expect(showTuckedOptions).not.toHaveBeenCalled();
    pen(false);
    vi.advanceTimersByTime(PEN_OPTIONS_RETURN_MS);
    expect(showTuckedOptions).toHaveBeenCalledOnce();
  });

  it.each(["until-tap", "off", true, undefined])(
    "never come back by themselves with %s",
    (mode) => {
      const { pen, showTuckedOptions } = viewWith(mode);
      pen(false);
      vi.advanceTimersByTime(PEN_OPTIONS_RETURN_MS * 5);
      expect(showTuckedOptions).not.toHaveBeenCalled();
    },
  );
});
