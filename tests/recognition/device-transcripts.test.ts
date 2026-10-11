/**
 * Pages read by the on-device recogniser, in the text layer
 * (`src/recognition/page-transcripts.ts`): marked as such, kept searchable,
 * and not counted as transcribed.
 */

import { describe, expect, it } from "vitest";
import {
  parsePageTranscripts,
  transcriptHashes,
  transcriptSources,
  updatePageTranscripts,
} from "../../src/recognition/page-transcripts";

const keys = ["p1", "p2"];

describe("device readings in the text layer", () => {
  const section = updatePageTranscripts(null, keys, [
    { key: "p1", text: "Transcribed by AI", hash: "aaa" },
    { key: "p2", text: "Read on the iPad", hash: "bbb", device: true },
  ]);

  it("mark the page comment, and read back as device readings", () => {
    expect(section).toContain("<!--goodobsidian-page p1 aaa-->");
    expect(section).toContain("<!--goodobsidian-page p2 bbb device-->");
    expect(parsePageTranscripts(section).entries).toEqual([
      { key: "p1", hash: "aaa", text: "Transcribed by AI" },
      { key: "p2", hash: "bbb", device: true, text: "Read on the iPad" },
    ]);
  });

  it("are not counted as transcribed, but are known with their hash", () => {
    expect([...transcriptHashes(section)]).toEqual([["p1", "aaa"]]);
    expect([...transcriptSources(section)]).toEqual([
      ["p1", { hash: "aaa", device: false }],
      ["p2", { hash: "bbb", device: true }],
    ]);
  });

  it("give way to a transcription of the same page", () => {
    const next = updatePageTranscripts(section, keys, [
      { key: "p2", text: "Transcribed now", hash: "ccc" },
    ]);
    expect(parsePageTranscripts(next).entries[1]).toEqual({
      key: "p2",
      hash: "ccc",
      text: "Transcribed now",
    });
  });

  it("survive another page's update unchanged", () => {
    const next = updatePageTranscripts(section, keys, [{ key: "p1", text: "Again", hash: "ddd" }]);
    expect(next).toContain("<!--goodobsidian-page p2 bbb device-->\nRead on the iPad");
  });
});
