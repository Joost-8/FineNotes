/**
 * The one Companion PDF export queue: one export at a time across every
 * notebook, the newest request per notebook, nothing in the caller's own
 * turn, and nothing while the pen is down.
 */
import { describe, expect, it, vi } from "vitest";
import { CompanionQueue, type CompanionQueueIO } from "../../src/model/companion-queue";

function setup(over: Partial<CompanionQueueIO> = {}) {
  const failed = vi.fn();
  const queue = new CompanionQueue({
    paused: () => false,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
    failed,
    ...over,
  });
  return { queue, failed };
}

/** A job that runs until released, and says when it started. */
function held() {
  let release = () => {};
  const started = vi.fn();
  const job = vi.fn(
    (force: boolean) =>
      new Promise<void>((resolve) => {
        started(force);
        release = resolve;
      }),
  );
  return { job, started, release: () => release() };
}

describe("the export queue", () => {
  it("never starts in the caller's own turn", async () => {
    const { queue } = setup();
    const job = vi.fn(async () => {});
    const done = queue.request("a", job);
    expect(job).not.toHaveBeenCalled();
    expect(queue.busy("a")).toBe(true);
    await done;
    expect(job).toHaveBeenCalledTimes(1);
    expect(queue.busy("a")).toBe(false);
  });

  it("runs one export at a time across notebooks", async () => {
    const { queue } = setup();
    const a = held();
    const b = held();
    const doneA = queue.request("a", a.job);
    const doneB = queue.request("b", b.job);
    await vi.waitFor(() => expect(a.started).toHaveBeenCalled());
    expect(b.started).not.toHaveBeenCalled();
    a.release();
    await doneA;
    await vi.waitFor(() => expect(b.started).toHaveBeenCalled());
    b.release();
    await doneB;
  });

  it("keeps only the newest waiting request of a notebook, forced if any was", async () => {
    const { queue } = setup();
    const a = held();
    const first = queue.request("x", a.job);
    await vi.waitFor(() => expect(a.started).toHaveBeenCalled());
    const older = vi.fn(async () => {});
    const newer = vi.fn(async () => {});
    const p1 = queue.request("y", older, true);
    const p2 = queue.request("y", newer, false);
    a.release();
    await Promise.all([first, p1, p2]);
    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledWith(true);
  });

  it("waits while the pen is down", async () => {
    let pen = true;
    const { queue } = setup({ paused: () => pen });
    const job = vi.fn(async () => {});
    const done = queue.request("a", job);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(job).not.toHaveBeenCalled();
    pen = false;
    await done;
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("reports a failure and goes on to the next", async () => {
    const { queue, failed } = setup();
    const boom = new Error("boom");
    const next = vi.fn(async () => {});
    await Promise.all([
      queue.request("a", async () => {
        throw boom;
      }),
      queue.request("b", next),
    ]);
    expect(failed).toHaveBeenCalledWith("a", boom);
    expect(next).toHaveBeenCalled();
  });

  it("drops what waits when stopped (the plugin unloads)", async () => {
    const { queue } = setup();
    const job = vi.fn(async () => {});
    const done = queue.request("a", job);
    queue.stop();
    await done;
    await queue.idle();
    expect(job).not.toHaveBeenCalled();
    await queue.request("b", job);
    expect(job).not.toHaveBeenCalled();
  });
});

describe("after a close", () => {
  it("waits its start delay before the first export", async () => {
    const slept: number[] = [];
    const queue = new CompanionQueue({
      paused: () => false,
      sleep: async (ms) => void slept.push(ms),
      startDelay: 3000,
      failed: vi.fn(),
    });
    await queue.request("a", async () => {});
    expect(slept[0]).toBe(3000);
  });
});
