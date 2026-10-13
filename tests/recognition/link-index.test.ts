/**
 * The notebook's links list at the end of the managed text block
 * (`src/recognition/page-transcripts.ts`, FineNotes#20): written so
 * Obsidian's backlinks and graph see handwritten links, and kept out of the
 * page transcriptions.
 */

import { describe, expect, it } from "vitest";
import {
  LINKS_MARKER,
  formatLinkIndex,
  linkKey,
  parsePageTranscripts,
  splitLinkIndex,
  syncLinkIndex,
  updatePageTranscripts,
  writeLinkIndex,
} from "../../src/recognition/page-transcripts";
import { readTextSection } from "../../src/recognition/text-layer";

const PAGE = "### Page 1\n<!--goodobsidian-page p1 abc-->\nHello";
const LIST = formatLinkIndex(["Signals#FIR filters", "https://x.org/a b", "www.styluslabs.com"]);

describe("formatLinkIndex", () => {
  it("lists notes as keyed wikilinks and addresses as autolinks, under a heading", () => {
    expect(LIST).toBe(
      [
        "### Links",
        LINKS_MARKER,
        `- [[Signals#FIR filters]] <!--${linkKey("Signals#FIR filters")}-->`,
        "- <https://x.org/a b>",
        "- <https://www.styluslabs.com>",
      ].join("\n"),
    );
    expect(formatLinkIndex([])).toBe("");
  });
});

describe("splitLinkIndex and writeLinkIndex", () => {
  it("splits the list off the end, with or without its heading", () => {
    expect(splitLinkIndex(`${PAGE}\n\n${LIST}`)).toEqual({ rest: PAGE, links: LIST });
    const bare = `${LINKS_MARKER}\n- [[A]]`;
    expect(splitLinkIndex(`${PAGE}\n${bare}`)).toEqual({ rest: PAGE, links: bare });
    expect(splitLinkIndex(PAGE)).toEqual({ rest: PAGE, links: "" });
  });

  it("replaces the list, adds one, or takes it away", () => {
    expect(writeLinkIndex(PAGE, ["A"])).toBe(`${PAGE}\n\n${formatLinkIndex(["A"])}`);
    expect(writeLinkIndex(`${PAGE}\n\n${LIST}`, ["B"])).toBe(
      `${PAGE}\n\n${formatLinkIndex(["B"])}`,
    );
    expect(writeLinkIndex(`${PAGE}\n\n${LIST}`, [])).toBe(PAGE);
    expect(writeLinkIndex(null, ["A"])).toBe(formatLinkIndex(["A"]));
    expect(writeLinkIndex(null, [])).toBe("");
  });
});

describe("the list and the transcriptions", () => {
  it("is no page's text", () => {
    const parsed = parsePageTranscripts(`${PAGE}\n\n${LIST}`);
    expect(parsed.entries).toEqual([{ key: "p1", hash: "abc", text: "Hello" }]);
    expect(parsePageTranscripts(LIST)).toEqual({ preamble: "", entries: [], legacy: false });
  });

  it("stays at the end when a transcription is written", () => {
    const next = updatePageTranscripts(
      `${PAGE}\n\n${LIST}`,
      ["p1", "p2"],
      [{ key: "p2", text: "World", hash: "def" }],
    );
    expect(next.endsWith(LIST)).toBe(true);
    expect(parsePageTranscripts(next).entries.map((e) => e.text)).toEqual(["Hello", "World"]);
  });
});

describe("syncLinkIndex", () => {
  const PROSE = "---\nfinenotes: 1\n---\n\nMy own words.\n";

  it("leaves a body without links exactly as it is", () => {
    expect(syncLinkIndex(PROSE, [])).toBe(PROSE);
  });

  it("adds the list in the managed block, never touching the prose", () => {
    const body = syncLinkIndex(PROSE, ["Signals"]);
    expect(body.startsWith("---\nfinenotes: 1\n---\n\nMy own words.")).toBe(true);
    expect(readTextSection(body)).toBe(formatLinkIndex(["Signals"]));
    // The same targets again: the very same string back.
    expect(syncLinkIndex(body, ["Signals"])).toBe(body);
  });

  it("removes the block again when the last link goes and nothing else is in it", () => {
    const body = syncLinkIndex(PROSE, ["Signals"]);
    expect(syncLinkIndex(body, [])).toBe("---\nfinenotes: 1\n---\n\nMy own words.\n");
  });
});
