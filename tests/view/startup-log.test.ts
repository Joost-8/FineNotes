import { describe, expect, it } from "vitest";
import { STALLS_KEPT, StartupLog } from "../../src/view/startup-log";

function clocked() {
  let t = 1000;
  const log = new StartupLog(() => t);
  return { log, at: (ms: number) => (t = 1000 + ms) };
}

describe("StartupLog", () => {
  it("keeps steps in ms since load", () => {
    const { log, at } = clocked();
    log.mark("onload");
    at(40.4);
    log.mark("layout ready");
    at(900);
    log.timed("grape bridge", 12.6);
    expect(log.report().marks).toEqual([
      { name: "onload", at: 0 },
      { name: "layout ready", at: 40 },
      { name: "grape bridge (13 ms)", at: 900 },
    ]);
  });

  it("counts a late timer as a stall after the step marked last", () => {
    const { log, at } = clocked();
    log.mark("onload");
    at(200);
    log.late(20);
    at(8000);
    log.mark("grape bridge");
    at(13000);
    log.late(5000);
    const report = log.report();
    expect(report.stalls).toEqual([{ at: 13000, ms: 5000, after: "grape bridge" }]);
    expect(report.stalledMs).toBe(5000);
    expect(report.watchedMs).toBe(13000);
  });

  it("keeps only the longest stalls, in time order", () => {
    const { log, at } = clocked();
    for (let i = 1; i <= STALLS_KEPT + 3; i++) {
      at(i * 1000);
      log.late(100 + i);
    }
    const { stalls, stalledMs } = log.report();
    expect(stalls).toHaveLength(STALLS_KEPT);
    expect(stalls[0].ms).toBe(104);
    expect(stalls.map((s) => s.at)).toEqual([...stalls.map((s) => s.at)].sort((a, b) => a - b));
    expect(stalledMs).toBe(
      Array.from({ length: STALLS_KEPT + 3 }, (_, i) => 101 + i).reduce((a, b) => a + b),
    );
  });

  it("adds nothing once stopped", () => {
    const { log, at } = clocked();
    log.mark("onload");
    log.stop();
    at(500);
    log.mark("notebook loaded");
    log.late(400);
    expect(log.report()).toEqual({
      marks: [{ name: "onload", at: 0 }],
      stalls: [],
      stalledMs: 0,
      watchedMs: 0,
    });
  });

  it("names a stall before any step 'load'", () => {
    const { log, at } = clocked();
    at(300);
    log.late(250);
    expect(log.report().stalls[0].after).toBe("load");
  });
});
