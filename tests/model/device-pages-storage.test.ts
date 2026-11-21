/**
 * What an hour of steady writing costs in Obsidian Sync storage (#274),
 * before and after page files. Sync keeps every uploaded version whole for
 * a month, and uploads a changed file at most once per 10/20/30 s by size
 * (`canSyncLocalFile`, Obsidian 1.15.1; research/sync-design-2026-11.md).
 *
 * The hour: a 30-page notebook (about 1.6 MB), a stroke every 2 s on the
 * page being written, a new page every 2 minutes, a save after every 5 s
 * of writing (#278's rest), and Sync looking every second.
 * Measured 2026-11-21: 386 MB/h before (116 uploads of 3.3 MB), 0.4 MB/h after.
 */

import { describe, expect, it } from "vitest";
import { stressNotebook } from "../bench/scale-fixtures";
import { encodeDocument, inkFileText } from "../../src/model/serialize";
import { readDevicePagesNotebook } from "../../src/model/device-pages";
import { DevicePagesWriter, legacyPayload } from "../../src/model/device-pages-writer";
import { DotClock, attachDotClock, mintedId } from "../../src/model/dot-ids";
import type { InkDocument, Stroke } from "../../src/model/document";

/** Sync's throttle: the seconds a file waits after its last upload, by size. */
function wait(bytes: number): number {
  return bytes > 100 * 1024 ? 30 : bytes > 10 * 1024 ? 20 : 10;
}

/** A Sync that sees every file each second and uploads what changed, throttled. */
class SyncMeter {
  /** What each file holds now, made only when Sync reads it (a whole notebook is slow to make). */
  private readonly disk = new Map<string, { text: () => string; changed: boolean; size: number }>();
  private readonly last = new Map<string, number>();
  bytes = 0;
  uploads = 0;

  write(name: string, text: string | (() => string), size?: number): void {
    const make = typeof text === "string" ? () => text : text;
    const known = typeof text === "string" ? Buffer.byteLength(text) : (size ?? 0);
    this.disk.set(name, { text: make, changed: true, size: known });
  }

  tick(t: number): void {
    for (const [name, file] of this.disk) {
      if (!file.changed) continue;
      const at = this.last.get(name);
      if (at !== undefined && t - at <= wait(file.size)) continue;
      const size = Buffer.byteLength(file.text());
      file.size = size;
      file.changed = false;
      this.last.set(name, t);
      this.bytes += size;
      this.uploads++;
    }
  }
}

const HOUR = 3600;

/** One hour of writing, calling `save` after each 5 s of it; returns the bytes Sync stored. */
function hour(doc: InkDocument, sample: Stroke, save: () => void, meter: SyncMeter): void {
  let page = 0;
  for (let t = 1; t <= HOUR; t++) {
    if (t % 2 === 0) {
      const p = doc.pages[page];
      p.strokes.push({ ...sample, id: mintedId(doc) ?? `w${t}` });
    }
    if (t % 120 === 0) page = (page + 1) % doc.pages.length;
    if (t % 5 === 0) save();
    meter.tick(t);
  }
}

// About a minute (it encodes a 3 MB notebook a hundred times): run with FINENOTES_BENCH=1.
describe.skipIf(!process.env.FINENOTES_BENCH)("Sync storage for an hour of writing (#274)", () => {
  it("drops from about 90-190 MB to a few MB", () => {
    const sample = stressNotebook(1, { density: "typical" }).pages[0].strokes[0];

    // Before: the whole notebook file at every save.
    const before = new SyncMeter();
    const one = stressNotebook(30, { density: "typical" });
    const size = encodeDocument(one).length;
    // (Made when Sync uploads it; its size only decides the throttle, so the last one serves.)
    hour(
      one,
      sample,
      () => before.write("n.md", () => inkFileText("# N", encodeDocument(one)), size),
      before,
    );

    // After: this device's page file and meta.
    const after = new SyncMeter();
    const load = readDevicePagesNotebook(
      legacyPayload(stressNotebook(30, { density: "typical" }), "n7k2q9ab"),
      new Map(),
    );
    const clock = new DotClock("aaaa1111");
    attachDotClock(load.doc, clock);
    const writer = DevicePagesWriter.fromRead(
      "aaaa1111",
      clock,
      load.doc,
      load.sources,
      load.union,
    );
    let page = 0;
    let t = 0;
    hour(
      load.doc,
      sample,
      () => {
        t += 5;
        if (t % 120 === 0) page = (page + 1) % 30;
        for (const w of writer.save(load.doc, new Set([load.doc.pages[page].id]))) {
          after.write(w.name, w.text);
        }
      },
      after,
    );

    const mb = (n: number): string => (n / 1e6).toFixed(1);
    console.log(
      `notebook ${mb(size)} MB; before: ${before.uploads} uploads, ${mb(before.bytes)} MB/h; ` +
        `after: ${after.uploads} uploads, ${mb(after.bytes)} MB/h`,
    );
    expect(before.bytes).toBeGreaterThan(80e6);
    expect(after.bytes).toBeLessThan(10e6);
  }, 120_000);
});
