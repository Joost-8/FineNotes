import { describe, expect, it } from "vitest";
import { stressNotebook } from "../bench/scale-fixtures";
import { DevicePagesWriter, legacyPayload } from "../../src/model/device-pages-writer";
import { readDevicePagesNotebook } from "../../src/model/device-pages";
import { DotClock, attachDotClock } from "../../src/model/dot-ids";

describe("the writer on a big notebook (#274)", () => {
  it("saves one changed page of 300 in well under a frame budget", () => {
    const load = readDevicePagesNotebook(
      legacyPayload(stressNotebook(300, { density: "typical" }), "n7k2q9ab"),
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
    const page = load.doc.pages[120];
    page.strokes[0] = { ...page.strokes[0], color: "#ff0000" };
    const began = performance.now();
    const writes = writer.save(load.doc, new Set([page.id]));
    const ms = performance.now() - began;
    expect(writes.map((w) => w.name)).toEqual([`${page.id}.aaaa1111.md`, "_meta.aaaa1111.md"]);
    console.log(`one page of 300 saved in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(150);
  }, 60_000);
});
