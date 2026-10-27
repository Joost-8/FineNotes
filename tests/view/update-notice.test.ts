/**
 * `src/view/update-notice.ts`: the daily read of `main`'s manifest, and who
 * is told when a newer FineNotes turns up.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.fn();
vi.mock("obsidian", () => ({ requestUrl: (...args: unknown[]) => requestUrl(...args) }));

const { UpdateNotice } = await import("../../src/view/update-notice");
const { UPDATE_CHECK_INTERVAL_MS, UPDATE_MANIFEST_URL } =
  await import("../../src/model/update-check");

const DAY = UPDATE_CHECK_INTERVAL_MS;

function notice(
  stored: unknown,
  options: { enabled?: boolean; remind?: boolean; now?: number } = {},
) {
  let record = stored;
  let enabled = options.enabled ?? true;
  let remind = options.remind ?? true;
  let now = options.now ?? 10 * DAY;
  const saved: unknown[] = [];
  const n = new UpdateNotice({
    current: "2.4.1",
    enabled: () => enabled,
    remind: () => remind,
    load: () => record,
    save: (r) => {
      record = r;
      saved.push(r);
    },
    now: () => now,
  });
  return {
    n,
    saved,
    setEnabled: (on: boolean) => (enabled = on),
    setRemind: (on: boolean) => (remind = on),
    setNow: (ms: number) => (now = ms),
  };
}

const answer = (json: unknown, status = 200) => ({ status, json });

describe("UpdateNotice", () => {
  beforeEach(() => requestUrl.mockReset());

  it("reads main's manifest once a day, and tells its listeners of a newer version", async () => {
    requestUrl.mockResolvedValue(answer({ version: "2.4.2" }));
    const { n, saved } = notice(undefined);
    const heard = vi.fn();
    n.subscribe(heard);
    expect(n.available).toBeNull();
    await n.check();
    expect(requestUrl).toHaveBeenCalledWith({ url: UPDATE_MANIFEST_URL, throw: false });
    expect(n.available).toBe("2.4.2");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([{ checkedAt: 10 * DAY, latest: "2.4.2" }]);
    // The same day: no second request.
    await n.check();
    expect(requestUrl).toHaveBeenCalledTimes(1);
  });

  it("marks from what this device last read, before any request", () => {
    const { n } = notice({ checkedAt: 10 * DAY, latest: "2.5.0" });
    expect(n.available).toBe("2.5.0");
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("stays silent offline, on an error page or a page that is not a manifest, and tries next time", async () => {
    for (const fail of [
      () => requestUrl.mockRejectedValue(new Error("offline")),
      () => requestUrl.mockResolvedValue(answer({ message: "Not Found" }, 404)),
      () =>
        requestUrl.mockResolvedValue({
          status: 200,
          get json(): unknown {
            throw new SyntaxError("not JSON");
          },
        }),
    ]) {
      fail();
      const { n, saved } = notice(undefined);
      await n.check();
      expect(n.available).toBeNull();
      expect(saved).toEqual([]);
    }
  });

  it("neither reads nor marks while checking is off", async () => {
    requestUrl.mockResolvedValue(answer({ version: "2.4.2" }));
    const { n, setEnabled } = notice({ checkedAt: 10 * DAY, latest: "2.4.2" }, { enabled: false });
    expect(n.available).toBeNull();
    await n.check();
    expect(requestUrl).not.toHaveBeenCalled();
    setEnabled(true);
    expect(n.available).toBe("2.4.2");
  });

  it("does not announce the version running, or tell anyone twice", async () => {
    requestUrl.mockResolvedValue(answer({ version: "2.4.1" }));
    const { n } = notice({ checkedAt: 0, latest: "" });
    const heard = vi.fn();
    n.subscribe(heard);
    await n.check();
    expect(n.available).toBeNull();
    expect(heard).not.toHaveBeenCalled();
  });

  it('offers "Update available" until it is closed, a later check keeps that, and two days on it comes back', async () => {
    requestUrl.mockResolvedValue(answer({ version: "2.4.2" }));
    const { n, saved, setNow } = notice({ checkedAt: 0, latest: "2.4.2" });
    expect(n.pendingAnnouncement()).toBe("2.4.2");
    n.announced("2.4.2");
    expect(n.pendingAnnouncement()).toBeNull();
    await n.check();
    expect(saved.at(-1)).toEqual({
      checkedAt: 10 * DAY,
      latest: "2.4.2",
      announced: "2.4.2",
      announcedAt: 10 * DAY,
    });
    expect(n.pendingAnnouncement()).toBeNull();
    setNow(11 * DAY);
    expect(n.pendingAnnouncement()).toBeNull();
    setNow(12 * DAY);
    expect(n.pendingAnnouncement()).toBe("2.4.2");
  });

  it("offers nothing while checking is off", () => {
    const { n } = notice({ checkedAt: 0, latest: "2.4.2" }, { enabled: false });
    expect(n.pendingAnnouncement()).toBeNull();
  });

  it('offers nothing after "Don\'t show again", while the dot stays', () => {
    const { n, setRemind } = notice({ checkedAt: 0, latest: "2.4.2" }, { remind: false });
    expect(n.pendingAnnouncement()).toBeNull();
    expect(n.available).toBe("2.4.2");
    setRemind(true);
    expect(n.pendingAnnouncement()).toBe("2.4.2");
  });
});
