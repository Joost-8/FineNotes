import { describe, expect, it } from "vitest";
import { QuietWork } from "../../src/view/quiet-work";

describe("QuietWork", () => {
  it("runs at once while the pen is not writing", () => {
    const work = new QuietWork();
    const ran: string[] = [];
    work.run("sidebar", false, () => ran.push("sidebar"));
    expect(ran).toEqual(["sidebar"]);
    expect(work.pending).toBe(false);
  });

  it("waits while writing, keeps one job per kind, the latest, and runs them when the pen rests", () => {
    const work = new QuietWork();
    const ran: string[] = [];
    work.run("sidebar", true, () => ran.push("sidebar 1"));
    work.run("learn", true, () => ran.push("learn"));
    work.run("sidebar", true, () => ran.push("sidebar 2"));
    expect(ran).toEqual([]);
    expect(work.pending).toBe(true);
    work.flush();
    expect(ran).toEqual(["sidebar 2", "learn"]);
    expect(work.pending).toBe(false);
    work.flush();
    expect(ran).toHaveLength(2);
  });

  it("a job run at once drops the one of its kind still waiting", () => {
    const work = new QuietWork();
    const ran: string[] = [];
    work.run("sidebar", true, () => ran.push("old"));
    work.run("sidebar", false, () => ran.push("new"));
    work.flush();
    expect(ran).toEqual(["new"]);
  });

  it("clear forgets what waited", () => {
    const work = new QuietWork();
    const ran: string[] = [];
    work.run("learn", true, () => ran.push("learn"));
    work.clear();
    work.flush();
    expect(ran).toEqual([]);
  });
});
