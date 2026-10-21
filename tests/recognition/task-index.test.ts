/**
 * The notebook's checklist as Markdown tasks (`src/recognition/task-index.ts`):
 * what the note lists, how ticks made by the Tasks plugin come back, and that
 * the list sits between the page entries and the links list without
 * disturbing either.
 */

import { describe, expect, it } from "vitest";
import {
  type InkDocument,
  type Stroke,
  type TextBoxElement,
  emptyDocument,
} from "../../src/model/document";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { TASK_DONE, TASK_OPEN } from "../../src/model/text-list";
import {
  formatLinkIndex,
  parsePageTranscripts,
  readLinkIndex,
  splitTaskIndex,
  syncLinkIndex,
  updatePageTranscripts,
} from "../../src/recognition/page-transcripts";
import {
  adoptTaskStates,
  formatTaskIndex,
  notebookTasks,
  syncTaskIndex,
} from "../../src/recognition/task-index";
import { readTextSection, writeTextSection } from "../../src/recognition/text-layer";

function stroke(id: string): Stroke {
  return { id, color: "#000", size: 2, tool: "pen", pts: [0, 0, 0.5, 10, 0, 0.5] };
}

function box(id: string, text: string): TextBoxElement {
  return { id, x: 10, y: 10, w: 200, text, color: "#000", fontSize: 16 } as TextBoxElement;
}

/** A notebook: page 1 has a checklist box; page 2 a handwritten task. */
function notebook(): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].textBoxes.push(box("t1", `Shopping\n${TASK_OPEN}milk\n${TASK_DONE}eggs`));
  const second = structuredClone(doc.pages[0]);
  second.id = "p2";
  second.textBoxes = [];
  second.strokes = [stroke("s1"), stroke("s2")];
  second.tasks = [{ id: "ck1", strokes: ["s1", "s2"], text: "Call Anna" }];
  doc.pages.push(second);
  return doc;
}

describe("notebookTasks", () => {
  it("lists every item, text boxes' then handwriting's, with its page", () => {
    expect(
      notebookTasks(notebook()).map(({ id, text, done, page }) => [id, text, done, page]),
    ).toEqual([
      ["ft-t1-0", "milk", false, 1],
      ["ft-t1-1", "eggs", true, 1],
      ["ft-ck1", "Call Anna", false, 2],
    ]);
  });

  it("leaves out an empty item and a task whose ink is gone", () => {
    const doc = notebook();
    doc.pages[0].textBoxes[0].text = `${TASK_OPEN}\n${TASK_OPEN}milk`;
    doc.pages[1].strokes = [];
    expect(notebookTasks(doc).map((e) => e.id)).toEqual(["ft-t1-1"]);
  });
});

describe("formatTaskIndex", () => {
  it("writes one Markdown task per item, a link to its page and a block id", () => {
    expect(formatTaskIndex(notebookTasks(notebook()))).toBe(
      [
        "### Tasks",
        "<!--goodobsidian-tasks-->",
        "- [ ] milk [[#Page 1]] ^ft-t1-0",
        "- [x] eggs [[#Page 1]] ^ft-t1-1",
        "- [ ] Call Anna [[#Page 2]] ^ft-ck1",
      ].join("\n"),
    );
    expect(formatTaskIndex([])).toBe("");
  });

  it("keeps what the Tasks plugin added, and its own status while it agrees", () => {
    const entries = notebookTasks(notebook());
    const onDisk = [
      "- [x] milk [[#Page 1]] ✅ 2026-10-21 ^ft-t1-0",
      "- [/] Call Anna [[#Page 2]] ⏫ ^ft-ck1",
    ].join("\n");
    const out = formatTaskIndex(entries, onDisk).split("\n");
    // The notebook says milk is not done: the box follows it, the date stays.
    expect(out[2]).toBe("- [ ] milk [[#Page 1]] ✅ 2026-10-21 ^ft-t1-0");
    // In progress is not done, as the notebook says: kept.
    expect(out[4]).toBe("- [/] Call Anna [[#Page 2]] ⏫ ^ft-ck1");
  });

  it("keeps a task's words on one line, and out of the block id", () => {
    const [entry] = notebookTasks(notebook());
    const line = formatTaskIndex([{ ...entry, text: "a\nb ^x" }]).split("\n")[2];
    expect(line).toBe("- [ ] a b x [[#Page 1]] ^ft-t1-0");
  });
});

describe("adoptTaskStates", () => {
  it("ticks and unticks items the note says otherwise about, by block id", () => {
    const doc = notebook();
    let body = syncTaskIndex("Intro", notebookTasks(doc));
    body = body.replace("- [ ] milk", "- [x] milk").replace("- [x] eggs", "- [ ] eggs");
    body = body.replace("- [ ] Call Anna [[#Page 2]]", "- [x] Call Anna [[#Page 2]] ✅ 2026-10-21");
    expect(adoptTaskStates(doc, body)).toEqual(["p1", "p2"]);
    expect(doc.pages[0].textBoxes[0].text).toBe(`Shopping\n${TASK_DONE}milk\n${TASK_OPEN}eggs`);
    expect(doc.pages[1].tasks?.[0].done).toBe(true);
    // Nothing more to take the second time; and the date the Tasks plugin wrote stays.
    expect(adoptTaskStates(doc, body)).toEqual([]);
    expect(syncTaskIndex(body, notebookTasks(doc))).toBe(body);
  });

  it("takes nothing from a note without a checklist, or from lines without a block id", () => {
    const doc = notebook();
    expect(adoptTaskStates(doc, "Just prose\n- [x] milk")).toEqual([]);
  });
});

describe("the checklist inside the text block", () => {
  it("is written before the links list, and each is rewritten without the other", () => {
    const doc = notebook();
    let body = syncLinkIndex("Intro", ["Signals"]);
    body = syncTaskIndex(body, notebookTasks(doc));
    const section = readTextSection(body) ?? "";
    expect(section.indexOf("### Tasks")).toBeLessThan(section.indexOf("### Links"));
    expect(readLinkIndex(section).map((l) => l.target)).toEqual(["Signals"]);
    // A new link keeps the checklist; a new checklist keeps the links.
    const linked = syncLinkIndex(body, ["Signals", "Optics"]);
    expect(splitTaskIndex(readTextSection(linked) ?? "")).toBe(formatTaskIndex(notebookTasks(doc)));
    doc.pages[0].textBoxes = [];
    doc.pages[1].tasks = [];
    const untasked = syncTaskIndex(linked, notebookTasks(doc));
    expect(readTextSection(untasked)).not.toContain("### Tasks");
    expect(readLinkIndex(readTextSection(untasked)).map((l) => l.target)).toEqual([
      "Signals",
      "Optics",
    ]);
  });

  it("is no page's text, and survives a transcription being written", () => {
    const doc = notebook();
    const tasks = formatTaskIndex(notebookTasks(doc));
    const section = `${tasks}\n\n${formatLinkIndex(["Signals"])}`;
    expect(parsePageTranscripts(section).entries).toEqual([]);
    const after = updatePageTranscripts(
      section,
      ["p1", "p2"],
      [{ key: "p1", text: "Mitochondria", hash: "h" }],
    );
    expect(splitTaskIndex(after)).toBe(tasks);
    expect(parsePageTranscripts(after).entries.map((e) => e.text)).toEqual(["Mitochondria"]);
    expect(readLinkIndex(after).map((l) => l.target)).toEqual(["Signals"]);
  });

  it("leaves a note with no tasks exactly as it was", () => {
    const body = writeTextSection("Intro", "### Page 1\n<!--goodobsidian-page p1 h-->\nHi");
    expect(syncTaskIndex(body, [])).toBe(body);
    expect(syncTaskIndex("Intro", [])).toBe("Intro");
  });
});

describe("handwritten tasks in the file", () => {
  it("round-trip, and lose strokes that are gone", () => {
    const doc = notebook();
    doc.pages[1].tasks = [
      { id: "ck1", strokes: ["s1", "nope"], text: "  Call\n Anna ", done: true },
      { id: "ck1", strokes: ["s2"], text: "duplicate id" },
      { id: "ck2", strokes: ["gone"], text: "no ink" },
    ];
    const back = parseInkFile(buildInkFile("", doc)).doc;
    expect(back?.pages[1].tasks).toEqual([
      { id: "ck1", strokes: ["s1"], text: "Call Anna", done: true },
    ]);
  });
});
