/**
 * An item shown nowhere in Customize toolbar leaves nothing on (Joost,
 * 2026-10-30): turned off, its effect ends; while off, a key cannot turn it
 * on unseen. The rule itself is `effectsOfOffItems` (toolbar-layout.ts);
 * this pins what the notebook view does with it.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { InkView } = await import("../../src/view/ink-view");

interface Live {
  tool: string;
  rulerOut: boolean;
  recording: boolean;
  stickyArmed: boolean;
}

function viewWith(off: string[], live: Live) {
  const calls: string[] = [];
  const toolState = { tool: live.tool };
  const members = {
    settings: { toolbarItems: ["select", "pen", "eraser"], toolbarOff: off },
    toolState,
    surface: {
      rulerOut: live.rulerOut,
      stickyArmed: live.stickyArmed,
      setTool: (tool: string) => {
        calls.push(`setTool(${tool})`);
        toolState.tool = tool;
      },
      setRulerOut: (out: boolean) => calls.push(`setRulerOut(${out})`),
    },
    toolbar: {
      setItems: () => calls.push("setItems"),
      setState: () => calls.push("toolbar.setState"),
      setRulerOut: (out: boolean) => calls.push(`toolbar.setRulerOut(${out})`),
    },
    audio: {
      isRecording: live.recording,
      toggleRecording: () => calls.push("toggleRecording"),
    },
    armStickyNote: (color: string | null) => calls.push(`armStickyNote(${String(color)})`),
    plugin: { setOnlyStylusMode: () => calls.push("setOnlyStylusMode") },
  };
  const view = Object.create(InkView.prototype) as Record<string, unknown>;
  for (const [key, value] of Object.entries(members)) {
    Object.defineProperty(view, key, { value, writable: true, configurable: true });
  }
  const typed = view as unknown as {
    setToolbarItems(layout: { bar: string[]; off: string[] }): void;
    runShortcutAction(id: string): boolean;
  };
  return { view: typed, calls, toolState };
}

const quiet: Live = { tool: "pen", rulerOut: false, recording: false, stickyArmed: false };
const busy: Live = { tool: "eraser", rulerOut: true, recording: true, stickyArmed: true };

describe("an item turned off in Customize toolbar", () => {
  it("ends what it left on: its tool, the ruler, a recording, a waiting sticky note", () => {
    const off = ["eraser", "ruler", "record", "sticky"];
    const { view, calls, toolState } = viewWith(off, busy);
    view.setToolbarItems({ bar: ["select", "pen"], off });
    expect(toolState.tool).toBe("pen");
    expect(calls).toEqual([
      "setItems",
      "setTool(pen)",
      "toolbar.setState",
      "setRulerOut(false)",
      "toolbar.setRulerOut(false)",
      "toggleRecording",
      "armStickyNote(null)",
    ]);
  });

  it("leaves what an item in the menu turned on: its button still shows it", () => {
    const { view, calls } = viewWith([], busy);
    view.setToolbarItems({ bar: ["select", "pen"], off: [] });
    expect(calls).toEqual(["setItems"]);
  });

  it("does nothing when nothing it turns on is on", () => {
    const off = ["eraser", "ruler", "record", "sticky"];
    const { view, calls } = viewWith(off, quiet);
    view.setToolbarItems({ bar: ["select", "pen"], off });
    expect(calls).toEqual(["setItems"]);
  });

  it("takes a shortcut for an item that is off and does nothing with it", () => {
    const { view, calls } = viewWith(["ruler", "stylus", "record"], quiet);
    expect(view.runShortcutAction("bar.ruler")).toBe(true);
    expect(view.runShortcutAction("bar.stylus")).toBe(true);
    expect(view.runShortcutAction("bar.record")).toBe(true);
    expect(calls).toEqual([]);
  });
});
