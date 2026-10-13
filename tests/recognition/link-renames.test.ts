/**
 * The links list as the way back for renames (`src/recognition/page-transcripts.ts`):
 * Obsidian rewrites a renamed note's links in the list like any other, and
 * the notebook reads the new targets back by the key beside each one.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import { linkStrokes, linkTargets, renameLinkTargets } from "../../src/model/links";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import {
  LINKS_MARKER,
  formatLinkIndex,
  linkKey,
  readLinkIndex,
  renamedLinkTargets,
  syncLinkIndex,
} from "../../src/recognition/page-transcripts";
import { readTextSection } from "../../src/recognition/text-layer";

/** What Obsidian's link updater does to the list: each `[[from]]` becomes `[[to]]`, nothing else. */
function obsidianRenames(text: string, renames: Record<string, string>): string {
  let out = text;
  for (const [from, to] of Object.entries(renames))
    out = out.split(`[[${from}]]`).join(`[[${to}]]`);
  return out;
}

const renamed = (section: string, targets: string[]) =>
  Object.fromEntries(renamedLinkTargets(section, targets));

describe("readLinkIndex", () => {
  it("reads back what formatLinkIndex wrote, keys and web links included", () => {
    const targets = ["Signals#FIR filters", "https://x.org/a", "Folder/Note", "www.x.org"];
    expect(readLinkIndex(`### Page 1\nHello\n\n${formatLinkIndex(targets)}`)).toEqual([
      { target: "Signals#FIR filters", external: false, key: linkKey("Signals#FIR filters") },
      { target: "https://x.org/a", external: true },
      { target: "Folder/Note", external: false, key: linkKey("Folder/Note") },
      { target: "https://www.x.org", external: true },
    ]);
  });

  it("reads nothing from a section without a list, and skips lines that are no item", () => {
    expect(readLinkIndex(null)).toEqual([]);
    expect(readLinkIndex("### Page 1\n- [[Not in a list]]")).toEqual([]);
    const edited = `${LINKS_MARKER}\n- [[A|shown]] <!--abc-->\nsome words\n- [[]]\n* [[B]]`;
    expect(readLinkIndex(edited)).toEqual([{ target: "A", external: false, key: "abc" }]);
  });

  it("gives each target its own key, the same on every run", () => {
    expect(linkKey("Signals")).toBe(linkKey("Signals"));
    expect(linkKey("Signals")).not.toBe(linkKey("signals"));
    expect(linkKey("Signals")).toMatch(/^[0-9a-z]+$/);
  });
});

describe("renamedLinkTargets", () => {
  const targets = ["Signals", "Signals#FIR", "https://x.org", "Physics"];
  const list = formatLinkIndex(targets);

  it("finds nothing while the list is as the notebook wrote it", () => {
    expect(renamed(list, targets)).toEqual({});
    expect(renamed("", targets)).toEqual({});
  });

  it("adopts a renamed note, and its headings, by key", () => {
    const after = obsidianRenames(list, { Signals: "DSP", "Signals#FIR": "Courses/DSP#FIR" });
    expect(renamed(after, targets)).toEqual({ Signals: "DSP", "Signals#FIR": "Courses/DSP#FIR" });
  });

  it("adopts a renamed heading", () => {
    const after = obsidianRenames(list, { "Signals#FIR": "Signals#FIR filters" });
    expect(renamed(after, targets)).toEqual({ "Signals#FIR": "Signals#FIR filters" });
  });

  it("finds the item by key wherever it now is", () => {
    const after = obsidianRenames(formatLinkIndex([...targets].reverse()), {
      Physics: "Mechanics",
    });
    expect(renamed(after, targets)).toEqual({ Physics: "Mechanics" });
  });

  it("renames neither of two targets that share a key", () => {
    // Two different names with the same 32-bit hash.
    const twins = ["Note 75984", "Note 429730"];
    expect(linkKey(twins[0])).toBe(linkKey(twins[1]));
    const after = obsidianRenames(formatLinkIndex(twins), { "Note 75984": "Renamed" });
    expect(renamed(after, twins)).toEqual({});
  });

  it("trusts no key that two items carry with different targets", () => {
    const doubled = `${list}\n- [[Elsewhere]] <!--${linkKey("Physics")}-->`;
    expect(renamed(doubled, targets)).toEqual({});
    const same = `${list}\n- [[Physics]] <!--${linkKey("Physics")}-->`;
    expect(renamed(same, targets)).toEqual({});
  });

  it("ignores keys of links the notebook no longer has, and targets the list lacks", () => {
    const after = obsidianRenames(list, { Signals: "DSP" });
    expect(renamed(after, ["Physics", "New"])).toEqual({});
  });

  it("takes no target that cannot be written back as a link", () => {
    for (const to of ["https://x.org", "A[x", "A]]x"]) {
      const after = `${LINKS_MARKER}\n- [[${to}]] <!--${linkKey("Signals")}-->`;
      expect(renamed(after, ["Signals"])).toEqual({});
    }
  });

  describe("a list written by 2.0.0, without keys", () => {
    const old = ["### Links", LINKS_MARKER, "- [[Signals]]", "- <https://x.org>", "- [[Physics]]"];

    it("is read by position", () => {
      const after = old.join("\n").replace("[[Signals]]", "[[DSP]]");
      expect(renamed(after, ["Signals", "https://x.org", "Physics"])).toEqual({ Signals: "DSP" });
    });

    it("is not read at all when it does not line up with the notebook", () => {
      const after = old.join("\n").replace("[[Signals]]", "[[DSP]]");
      expect(renamed(after, ["Signals", "Physics"])).toEqual({});
      expect(renamed(after, ["Signals", "https://y.org", "Physics"])).toEqual({});
      expect(renamed(after, ["https://x.org", "Signals", "Physics"])).toEqual({});
    });
  });
});

const stroke = (id: string): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen",
  pts: [10, 10, 0.5, 30, 10, 0.5],
});

function notebook(): InkDocument {
  const doc = emptyDocument();
  const page = doc.pages[0];
  page.strokes = [stroke("s1"), stroke("s2"), stroke("s3")];
  for (const c of linkStrokes(doc, page, ["s1"], "Signals")) c.apply(doc);
  for (const c of linkStrokes(doc, page, ["s2"], "https://x.org")) c.apply(doc);
  page.textBoxes = [
    {
      id: "t1",
      x: 10,
      y: 40,
      w: 200,
      color: "#000",
      fontSize: 16,
      text: "[[Signals#FIR|FIR]] and Signals, [[Physics]]",
    },
  ];
  return doc;
}

/** A note as a save writes it: the prose, the links list in the block, the payload. */
function save(body: string, doc: InkDocument): string {
  return buildInkFile(syncLinkIndex(body, linkTargets(doc)), doc);
}

/** What the view does when it loads a note: adopt the list's renames, then save. */
function loadAndSave(file: string): { file: string; doc: InkDocument; changed: number } {
  const { body, doc } = parseInkFile(file);
  if (!doc) throw new Error("no notebook");
  const renames = renamedLinkTargets(readTextSection(body), linkTargets(doc));
  const changed = renameLinkTargets(doc, renames);
  return { file: save(body, doc), doc, changed };
}

describe("a rename, from the save before it to the save after it", () => {
  const PROSE = "---\nfinenotes: 1\n---\n\nAbout [[Signals]], in my own words.\n\n\n\nSignals!\n";

  it("carries the new targets into the notebook and touches nothing outside the block", () => {
    const first = save(PROSE, notebook());
    const section = readTextSection(parseInkFile(first).body) ?? "";
    expect(section).toContain(`- [[Signals]] <!--${linkKey("Signals")}-->`);

    // Obsidian renames "Signals" to "DSP" and updates the links in the list.
    const listStart = first.indexOf(LINKS_MARKER);
    const updated =
      first.slice(0, listStart) +
      obsidianRenames(first.slice(listStart), { Signals: "DSP", "Signals#FIR": "DSP#FIR" });

    const { file, doc, changed } = loadAndSave(updated);
    expect(changed).toBe(2);
    expect(doc.pages[0].links?.map((l) => l.target)).toEqual(["DSP", "https://x.org"]);
    expect(doc.pages[0].textBoxes[0].text).toBe("[[DSP#FIR|FIR]] and Signals, [[Physics]]");
    expect(linkTargets(doc)).toEqual(["DSP", "https://x.org", "DSP#FIR", "Physics"]);

    // The prose is byte for byte what it was, the old link in it included:
    // that one is Obsidian's to update, not ours.
    expect(file.startsWith(PROSE.trimEnd())).toBe(true);
    const after = readTextSection(parseInkFile(file).body);
    expect(after).toBe(formatLinkIndex(["DSP", "https://x.org", "DSP#FIR", "Physics"]));

    // And then it is settled: another load finds nothing, another save writes the same.
    const again = loadAndSave(file);
    expect(again.changed).toBe(0);
    expect(again.file).toBe(file);
  });

  it("changes nothing when Obsidian was told not to update the links", () => {
    // A note as it is on disk: saved once from a loaded notebook (a fresh
    // one is not yet in the stored precision).
    const first = loadAndSave(save(PROSE, notebook())).file;
    const { file, changed } = loadAndSave(first);
    expect(changed).toBe(0);
    expect(file).toBe(first);
  });

  it("brings a 2.0.0 list up to the keyed one at the next save, and adopts its renames", () => {
    const doc = notebook();
    const old = ["### Links", LINKS_MARKER, "- [[DSP]]", "- <https://x.org>"];
    old.push("- [[Signals#FIR]]", "- [[Physics]]");
    const body = `${PROSE}\n<!--goodobsidian-text-->\n${old.join("\n")}\n<!--/goodobsidian-text-->\n`;
    const { file, changed } = loadAndSave(buildInkFile(body, doc));
    expect(changed).toBe(1);
    expect(readTextSection(parseInkFile(file).body)).toBe(
      formatLinkIndex(["DSP", "https://x.org", "Signals#FIR", "Physics"]),
    );
    expect(file.startsWith(PROSE.trimEnd())).toBe(true);
  });
});
