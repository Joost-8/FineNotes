/**
 * The wet layer on an e-ink screen (#309): kept shown between strokes and
 * emptied, instead of hidden and shown again at every stroke.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Renderer } from "../../src/canvas/renderer";
import { DrawLog } from "./draw-log";

const HIDE = "wet.classList + goodobsidian-wet-hidden";
const SHOW = "wet.classList - goodobsidian-wet-hidden";

let log: DrawLog;

beforeEach(() => {
  log = new DrawLog();
});

function renderer(): Renderer {
  const r = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
  r.resize(800, 600, 1);
  return r;
}

/** The wet layer's class changes logged since `from`. */
function shows(from: number): string[] {
  return log.lines.slice(from).filter((line) => line === HIDE || line === SHOW);
}

describe("the wet layer on an e-ink screen", () => {
  it("is hidden between strokes by default", () => {
    const r = renderer();
    expect(log.lines).toContain(HIDE);
    const from = log.lines.length;
    r.clearWet();
    expect(shows(from)).toEqual([HIDE]);
  });

  it("stays shown, emptied, while kept shown", () => {
    const r = renderer();
    const from = log.lines.length;
    r.keepWetShown(true);
    r.clearWet();
    r.clearWet();
    expect(shows(from)).toEqual([SHOW, SHOW, SHOW]);
  });

  it("hides again once it is no longer kept shown", () => {
    const r = renderer();
    r.keepWetShown(true);
    const from = log.lines.length;
    r.keepWetShown(false);
    expect(shows(from)).toEqual([HIDE]);
  });
});
