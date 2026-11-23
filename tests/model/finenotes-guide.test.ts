import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
import { DEFAULT_PEN_GESTURES } from "../../src/ink/pen-gestures";
import { featureById } from "../../src/model/feature-index";
import {
  COMMAND_NAMES,
  GUIDE,
  SETTING_PLACES,
  guideEntry,
  guideWords,
  questionTerms,
  searchGuide,
  stem,
  withinEdits,
} from "../../src/model/finenotes-guide";

/** The command ids `main.ts` registers: the first string argument of each command call. */
function registeredCommands(): Set<string> {
  const main = readFileSync("src/main.ts", "utf8");
  const ids = new Set<string>();
  for (const match of main.matchAll(/id: "([a-z0-9-]+)"/g)) ids.add(match[1]);
  for (const match of main.matchAll(/Command\(\s*"([a-z0-9-]+)"/g)) ids.add(match[1]);
  return ids;
}

/** Every key of the stored settings, optional ones too, from their interface. */
const SETTING_KEYS = (() => {
  const source = readFileSync("src/settings-data.ts", "utf8");
  const start = source.indexOf("export interface GoodObsidianSettings");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  return new Set([...body.matchAll(/^ {2}([a-zA-Z0-9]+)\??:/gm)].map((match) => match[1]));
})();
const GESTURES = new Set(Object.keys(DEFAULT_PEN_GESTURES));

function settingExists(key: string): boolean {
  if (key.startsWith("penGestures.")) return GESTURES.has(key.slice("penGestures.".length));
  return SETTING_KEYS.has(key);
}

describe("FineNotes' guide stays true to the app", () => {
  it("has unique ids and every field filled", () => {
    const ids = new Set<string>();
    for (const entry of GUIDE) {
      expect(ids.has(entry.id), entry.id).toBe(false);
      ids.add(entry.id);
      expect(entry.title.trim(), entry.id).not.toBe("");
      expect(entry.words.trim(), entry.id).not.toBe("");
      expect(entry.what.trim(), entry.id).not.toBe("");
      expect(entry.where.trim(), entry.id).not.toBe("");
    }
    expect(GUIDE.length).toBeGreaterThan(300);
    expect(guideEntry("aboutFineNotes")?.area).toBe("start");
    expect(guideEntry("nothing")).toBeNull();
  });

  it("names only settings that exist", () => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) expect(SETTING_KEYS.has(key), key).toBe(true);
    for (const entry of GUIDE) {
      for (const key of entry.settings ?? []) {
        expect(settingExists(key), `${entry.id}: setting ${key}`).toBe(true);
      }
    }
  });

  it("names only commands that main.ts registers, and knows each one's name", () => {
    const registered = registeredCommands();
    for (const entry of GUIDE) {
      for (const id of entry.commands ?? []) {
        expect(registered.has(id), `${entry.id}: command ${id}`).toBe(true);
        expect(COMMAND_NAMES[id], `${entry.id}: name of ${id}`).toBeDefined();
      }
    }
    for (const id of Object.keys(COMMAND_NAMES)) {
      expect(registered.has(id), `COMMAND_NAMES: ${id}`).toBe(true);
    }
  });

  it("links only features that exist", () => {
    for (const entry of GUIDE) {
      if (entry.feature) expect(featureById(entry.feature), `${entry.id}: feature`).not.toBeNull();
    }
  });

  it("says where each settings row is", () => {
    expect(SETTING_PLACES.get("pressureWidth")).toBe(
      "Settings › Writing › Pressure-sensitive pens",
    );
    expect(SETTING_PLACES.get("calcNotes")).toBe(
      "Settings › Reading and voice › Calculate lines that end in =",
    );
    for (const place of SETTING_PLACES.values()) expect(place).toMatch(/^Settings › /);
  });

  it("speaks to people, not in code", () => {
    // A settings key or a file name in what the AI reads would end up in its answer.
    const code = /\b[a-z]+[A-Z][a-zA-Z]+\b|\.ts\b|src\/|Platform\./;
    const allowed =
      /^(iPad|iPads|iPhone|iPadOS|iOS|macOS|iCloud|LaTeX|reMarkable|OpenRouter|OpenAI|LocalAI)$/;
    for (const entry of GUIDE) {
      for (const text of [entry.what, entry.where, entry.notes ?? ""]) {
        const words = (text.match(new RegExp(code.source, "g")) ?? []).filter(
          (w) => !allowed.test(w),
        );
        expect(words, `${entry.id}: ${text}`).toEqual([]);
      }
    }
  });
});

describe("searching the guide", () => {
  it("reads a question's words without the common ones", () => {
    expect(questionTerms("How do I make a calculation?")).toEqual(["calculation"]);
    expect(stem("calculation")).toBe(stem("calculate"));
    expect(stem("erasing")).toBe(stem("erase"));
    expect(guideWords("Café-Boxes")).toEqual(["cafe", "boxes"]);
    expect(searchGuide("the a of")).toEqual([]);
  });

  /** Real questions, and the entry (or one of the entries) that must be among the first three found. */
  const SAMPLES: readonly [string, string | readonly string[]][] = [
    ["how do I make a calculation", "settingCalcNotes"],
    ["can it do maths for me", "settingCalcNotes"],
    ["where is the ruler", "ruler"],
    ["how do I erase", "eraserTool"],
    ["how do I use the rubber", "eraserTool"],
    ["can I select only the pictures with the lasso", "lassoFilter"],
    ["how do I import my Goodnotes notebooks", "importGoodnotes"],
    ["I'm coming from Goodnotes, where is everything", "fromGoodnotes"],
    ["does apple pencil double tap work", "pencilDoubleTap"],
    ["can I make flashcards", "flashcards"],
    ["how do I export a notebook as PDF", "exportPdf"],
    ["how do I annotate a PDF", "importPdf"],
    ["how do I record audio", "recordAudio"],
    ["transcribe my recording to text", "transcribeRecordingOnDevice"],
    ["how do I add a page", "addPage"],
    ["how do I change the paper template of a page", "changeTemplate"],
    ["how do I hide tools on the toolbar", "customizeToolbar"],
    ["move the toolbar to the side", "toolbarEdge"],
    ["dark mode for pages", "settingPageAppearance"],
    ["how do I sync my notebooks to my other iPad", "syncDevices"],
    ["does it work on android", "platforms"],
    ["how do I set up the AI with my API key", "aiSetup"],
    ["draw a perfect circle", "holdToSnap"],
    ["straight line", ["holdToSnap", "ruler", "makeShapes"]],
    ["undo with fingers", "settingFingerUndo"],
    ["my palm makes marks on the page", "stylusOnly"],
    ["strokes go missing when I write fast", "scribbleOff"],
    ["search my handwriting", "searchNotebook"],
    ["insert a picture", "insertImage"],
    ["add a text box", "textTool"],
    ["draw a graph of a function", "insertGraph"],
    ["keyboard shortcuts", "keyboardShortcuts"],
    ["I found a bug", "reportBug"],
    ["infinite canvas whiteboard", "newBoard"],
    ["rename a notebook", "homeCardMenu"],
    ["put notebooks in folders", ["homeFolders", "homeDrag"]],
    ["link to a page from a markdown note", "pageLink"],
    ["change the pen colour", "penColourRow"],
    ["make the pen thicker", "penWidthPresets"],
    ["highlight text in a PDF", ["highlighter", "highlightSnap"]],
    ["laser pointer for presenting", "laserPointer"],
    ["turn handwriting into typed text", "turnIntoText"],
    ["change the language", "settingLanguage"],
    ["where are the settings", "openSettings"],
    ["delete a page", "deletePage"],
    ["reorder pages", "reorderPages"],
    ["is FineNotes free", "aboutFineNotes"],
    ["hide Obsidian's sidebars", "settingSimpleLook"],
    ["where did my toolbar go", ["toolbarEdge", "customizeToolbar", "fullScreen"]],
    ["go back to the library", "homeButton"],
    ["can I use it without internet", "privacy"],
    ["scan a paper document", "scanDocument"],
    ["move a selection to another page", "dragToPage"],
    ["duplicate a page", ["duplicatePage", "moreDuplicate"]],
    ["ask AI about my notes", "askAi"],
    ["generate an image", "generateImage"],
    ["make a table", ["shapeTable", "tables"]],
    ["add a sticky note", "stickyNotes"],
    ["why is my notebook read only", "readOnly"],
    ["export as png", "exportPictures"],
    ["can I write with my finger", "drawWithFinger"],
    ["change the cover of a notebook", "notebookCover"],
    ["bookmark a page", ["bookmarks", "moreBookmark"]],
    ["solve an equation for x", "solveLetter"],
    ["open the calculator", ["calculatorButton", "calculator"]],
    ["zoom out of the page to see a grid of pages", "pinchOverview"],
    ["grid view of my pages", ["pageGrid", "pinchOverview"]],
    ["how do I see all my pages at once", ["pinchOverview", "pageGrid"]],
  ];

  it.each(SAMPLES)("“%s” finds %s", (question, wanted) => {
    const ids = typeof wanted === "string" ? [wanted] : wanted;
    for (const id of ids) expect(guideEntry(id), `${id} exists`).not.toBeNull();
    const found = searchGuide(question, 3).map((entry) => entry.id);
    expect(
      found.some((id) => ids.includes(id)),
      `${question} → ${found.join(", ")}`,
    ).toBe(true);
  });

  /**
   * Real issue titles, typos and all, and the entry that answers them: a bug
   * report describes what it looks like ("Seen as"), not the feature's name.
   */
  const REPORTS: readonly [string, string | readonly string[]][] = [
    ["Left Panel compeltely dissapers on latest release", "settingSimpleLook"], // #297
    ["Urgent: update kills side panels in mac, iPhone and iPad", "settingSimpleLook"], // #187
    ["sidebars disappeared", ["settingSimpleLook", "simpleLook"]],
    ["Erasor size does not stay cutom size", "eraserSize"], // #247
    ["Sync problem makes the data lost", "syncDevices"], // #246
    ["Two-finger double-tap doesn't work", ["settingFingerUndo", "fingerTapUndo"]], // #218
    ["S-Pen side button don't erase", ["settingStylusButton", "barrelButton"]], // #149
    ["shapes on hold way too fast", ["holdToSnap", "snapOnLift"]], // #36
    ["Custom pen cursor does not show when hovering", ["settingPenCursor", "penCursor"]], // #266
    ["my finger draws lines instead of scrolling", "stylusOnly"],
  ];

  it.each(REPORTS)("report “%s” finds %s", (title, wanted) => {
    const ids = typeof wanted === "string" ? [wanted] : wanted;
    const found = searchGuide(title, 3).map((entry) => entry.id);
    expect(
      found.some((id) => ids.includes(id)),
      `${title} → ${found.join(", ")}`,
    ).toBe(true);
  });

  it("forgives a typo only in a long word that starts alike", () => {
    expect(withinEdits("compeltely", "completely", 1)).toBe(true);
    expect(withinEdits("erasor", "eraser", 1)).toBe(true);
    expect(withinEdits("eraser", "easer", 0)).toBe(false);
    expect(withinEdits("abcdef", "uvwxyz", 2)).toBe(false);
    // Short words stay exact: "page" is not "pane".
    expect(searchGuide("pane").map((entry) => entry.id)).not.toContain("addPage");
  });
});
