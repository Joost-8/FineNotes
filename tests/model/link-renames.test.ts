/**
 * Pointing a notebook's links somewhere new (`renameTextLinks` in
 * `src/model/text-links.ts`, `renameLinkTargets` in `src/model/links.ts`):
 * what the notebook does with the renames Obsidian wrote into its links list.
 */

import { describe, expect, it } from "vitest";
import {
  type InkDocument,
  type Stroke,
  type TextBoxElement,
  emptyDocument,
} from "../../src/model/document";
import { linkStrokes, linkTargets, renameLinkTargets } from "../../src/model/links";
import { renameTextLinks, textSegments } from "../../src/model/text-links";

const rename =
  (map: Record<string, string>) =>
  (target: string): string | undefined =>
    map[target];

describe("renameTextLinks", () => {
  it("changes a wikilink's target and keeps its shown text", () => {
    const to = rename({ Signals: "DSP", "Signals#FIR": "DSP#FIR" });
    expect(renameTextLinks("see [[Signals]] and [[Signals#FIR|the FIR part]].", to)).toBe(
      "see [[DSP]] and [[DSP#FIR|the FIR part]].",
    );
  });

  it("matches the target as the notebook reads it, spaces closed up", () => {
    expect(renameTextLinks("[[  Signals ]]", rename({ Signals: "DSP" }))).toBe("[[DSP]]");
  });

  it("leaves plain text that happens to name the note, and other notes, alone", () => {
    const to = rename({ Signals: "DSP" });
    const raw = "Signals, [[Signals 2]], [[Signalsx]] and [[Physics|Signals]]";
    expect(renameTextLinks(raw, to)).toBe(raw);
  });

  it("renames a link whose shown text is another note's name by its target only", () => {
    const to = rename({ Physics: "Mechanics" });
    expect(renameTextLinks("[[Physics|Signals]]", to)).toBe("[[Mechanics|Signals]]");
  });

  it("keeps a markdown link a markdown link when it can, else makes it a wikilink", () => {
    expect(renameTextLinks("[notes](Signals.md)", rename({ "Signals.md": "DSP.md" }))).toBe(
      "[notes](DSP.md)",
    );
    const spaced = renameTextLinks("[notes](Signals)", rename({ Signals: "Digital signals" }));
    expect(spaced).toBe("[[Digital signals|notes]]");
    expect(textSegments(spaced)).toEqual([{ text: "notes", target: "Digital signals" }]);
  });

  it("never touches web addresses", () => {
    const raw = "[x](https://a.org/Signals) https://a.org/Signals www.signals.org.";
    expect(renameTextLinks(raw, () => "DSP")).toBe(raw);
  });
});

const stroke = (id: string): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen",
  pts: [10, 10, 0.5, 30, 10, 0.5],
});

const box = (id: string, text: string): TextBoxElement => ({
  id,
  x: 10,
  y: 10,
  w: 200,
  text,
  color: "#000",
  fontSize: 16,
});

function notebook(): InkDocument {
  const doc = emptyDocument();
  const page = doc.pages[0];
  page.strokes = [stroke("s1"), stroke("s2"), stroke("s3")];
  for (const c of linkStrokes(doc, page, ["s1"], "Signals")) c.apply(doc);
  for (const c of linkStrokes(doc, page, ["s2"], "Signals#FIR")) c.apply(doc);
  page.textBoxes = [box("t1", "[[Signals]] again"), box("t2", "nothing here")];
  return doc;
}

describe("renameLinkTargets", () => {
  it("renames ink links and text boxes that lead to the same note, and says how many", () => {
    const doc = notebook();
    const n = renameLinkTargets(doc, new Map([["Signals", "DSP"]]));
    expect(n).toBe(2);
    expect(doc.pages[0].links?.map((l) => l.target)).toEqual(["DSP", "Signals#FIR"]);
    expect(doc.pages[0].textBoxes.map((b) => b.text)).toEqual(["[[DSP]] again", "nothing here"]);
    expect(linkTargets(doc)).toEqual(["DSP", "Signals#FIR"]);
  });

  it("does nothing without renames", () => {
    const doc = notebook();
    expect(renameLinkTargets(doc, new Map())).toBe(0);
    expect(renameLinkTargets(doc, new Map([["Elsewhere", "X"]]))).toBe(0);
    expect(linkTargets(doc)).toEqual(["Signals", "Signals#FIR"]);
  });

  it("renames in place, so the undo history's link objects follow", () => {
    const doc = notebook();
    const link = doc.pages[0].links?.[1];
    renameLinkTargets(doc, new Map([["Signals#FIR", "DSP#FIR filters"]]));
    expect(link?.target).toBe("DSP#FIR filters");
  });
});
