/**
 * `src/recognition/reading-guard.ts`: a page that took the app down while it
 * was read on the device is not read again at the next start.
 */

import { describe, expect, it } from "vitest";
import {
  type GuardStore,
  MAX_CRASHED,
  type ReadingMark,
  ReadingGuard,
} from "../../src/recognition/reading-guard";

/** Device storage that outlives a guard, as it outlives the app. */
function storage(initial?: string): GuardStore & { value: string | undefined; saves: number } {
  const s = {
    value: initial,
    saves: 0,
    load: (): unknown => s.value,
    save: (value: string): void => {
      s.value = value;
      s.saves++;
    },
  };
  return s;
}

const mark = (key: string, hash = `h-${key}`, path = "A.notebook.md"): ReadingMark => ({
  path,
  key,
  hash,
  page: Number(key.slice(1)),
});

describe("ReadingGuard", () => {
  it("finds nothing on a first start, and stores nothing until a page is read", () => {
    const store = storage();
    const guard = new ReadingGuard(store, "2.0.1");
    expect(guard.crash).toBeNull();
    expect(guard.paused).toBe(false);
    expect(guard.skipped("A.notebook.md").size).toBe(0);
    expect(store.saves).toBe(0);
  });

  it("forgets a reading that finished", () => {
    const store = storage();
    const guard = new ReadingGuard(store, "2.0.1");
    guard.begin(mark("p1"));
    guard.end();
    guard.end();
    const next = new ReadingGuard(store, "2.0.1");
    expect(next.crash).toBeNull();
    expect(next.skipped("A.notebook.md").size).toBe(0);
  });

  it("skips a page whose reading never finished, until it changes, and pauses reading once", () => {
    const store = storage();
    new ReadingGuard(store, "2.0.1").begin(mark("p2"));
    // The app was killed here. At the next start:
    const after = new ReadingGuard(store, "2.0.1");
    expect(after.crash).toEqual(mark("p2"));
    expect(after.paused).toBe(true);
    expect(after.skipped("A.notebook.md")).toEqual(new Map([["p2", "h-p2"]]));
    expect(after.skipped("B.notebook.md").size).toBe(0);
    // The start after that reads again, and still skips the page.
    const later = new ReadingGuard(store, "2.0.1");
    expect(later.crash).toBeNull();
    expect(later.paused).toBe(false);
    expect(later.skipped("A.notebook.md")).toEqual(new Map([["p2", "h-p2"]]));
  });

  it("reads such pages again under a new version, which may have fixed the cause", () => {
    const store = storage();
    new ReadingGuard(store, "2.0.0").begin(mark("p2"));
    new ReadingGuard(store, "2.0.0");
    const updated = new ReadingGuard(store, "2.0.1");
    expect(updated.skipped("A.notebook.md").size).toBe(0);
  });

  it("still skips a page that crashed the version before an update, as nothing says it is fixed", () => {
    const store = storage();
    new ReadingGuard(store, "2.0.0").begin(mark("p3"));
    const updated = new ReadingGuard(store, "2.0.1");
    expect(updated.crash).toEqual(mark("p3"));
    expect(updated.skipped("A.notebook.md")).toEqual(new Map([["p3", "h-p3"]]));
  });

  it("does not blame a page the app was reading in the background", () => {
    const store = storage();
    const guard = new ReadingGuard(store, "2.0.1");
    guard.begin(mark("p1"));
    guard.setHidden(true);
    guard.setHidden(true);
    // iPadOS ends the suspended app.
    expect(new ReadingGuard(storage(store.value), "2.0.1").crash).toBeNull();
    // Back in front, still reading: marked again.
    guard.setHidden(false);
    expect(new ReadingGuard(storage(store.value), "2.0.1").crash).toEqual(mark("p1"));
    // A reading that starts and ends while away leaves nothing.
    guard.end();
    guard.setHidden(true);
    guard.begin(mark("p4"));
    guard.end();
    guard.setHidden(false);
    expect(new ReadingGuard(storage(store.value), "2.0.1").crash).toBeNull();
  });

  it("skips a page that failed for the rest of the session only", () => {
    const store = storage();
    const guard = new ReadingGuard(store, "2.0.1");
    guard.fail(mark("p5"));
    guard.fail(mark("p5"));
    expect(guard.skipped("A.notebook.md")).toEqual(new Map([["p5", "h-p5"]]));
    expect(new ReadingGuard(store, "2.0.1").skipped("A.notebook.md").size).toBe(0);
  });

  it("keeps the latest crashed pages, and the same page once", () => {
    const store = storage();
    for (let i = 0; i < MAX_CRASHED + 5; i++) {
      new ReadingGuard(store, "2.0.1").begin(mark(`p${i}`));
    }
    new ReadingGuard(store, "2.0.1").begin(mark(`p${MAX_CRASHED + 4}`));
    const skipped = new ReadingGuard(store, "2.0.1").skipped("A.notebook.md");
    expect(skipped.size).toBe(MAX_CRASHED);
    expect(skipped.has("p4")).toBe(false);
    expect(skipped.has(`p${MAX_CRASHED + 4}`)).toBe(true);
  });

  it("starts afresh from storage it cannot read", () => {
    for (const bad of ["not json", "null", "[]", JSON.stringify({ reading: { path: 1 } })]) {
      const guard = new ReadingGuard(storage(bad), "2.0.1");
      expect(guard.crash).toBeNull();
      expect(guard.skipped("A.notebook.md").size).toBe(0);
    }
    const kept = JSON.stringify({ version: "2.0.1", reading: null, crashed: [mark("p1"), 7] });
    expect(new ReadingGuard(storage(kept), "2.0.1").skipped("A.notebook.md").size).toBe(1);
  });
});
