import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VIEW_TYPE_FOLDERS, VIEW_TYPE_FOLDER_LIBRARY } from "../../src/constants";
import { SIMPLE_CLASS, simpleClasses } from "../../src/model/simple-mode";

describe("simpleClasses", () => {
  it("wears one class while the look is on, and none while it is off", () => {
    expect(simpleClasses(true)).toEqual([SIMPLE_CLASS]);
    expect(simpleClasses(false)).toEqual([]);
  });

  it("keeps the body class that is saved in people's themes and snippets", () => {
    expect(SIMPLE_CLASS).toBe("goodobsidian-simple");
  });
});

/** The style sheet, and the part of it that is the simple look. */
const css = readFileSync(join(__dirname, "../../styles.css"), "utf8");
const START = css.indexOf("/* --- The simple look (model/simple-mode.ts)");
const END = css.indexOf("/* --- Notebook library (src/view/library-view.ts)");
const look = css.slice(START, END);

/** The selectors of every rule in `text` that sets `display: none`. */
function hidden(text: string): string[] {
  const out: string[] = [];
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/display:\s*none/.test(rule[2] ?? "")) {
      out.push(
        ...(rule[1] ?? "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split(",")
          .map((selector) => selector.replace(/\s+/g, " ").trim()),
      );
    }
  }
  return out;
}

describe("what the simple look hides (styles.css)", () => {
  const body = `body.${SIMPLE_CLASS}`;
  const selectors = hidden(look);

  it("is a section of the style sheet", () => {
    expect(START).toBeGreaterThan(0);
    expect(END).toBeGreaterThan(START);
  });

  it("hides the status bar, the ribbon and the right sidebar with its drawer and toggle", () => {
    for (const hide of [
      ".status-bar",
      ".workspace-ribbon",
      ".workspace-split.mod-right-split",
      ".workspace-drawer.mod-right",
      ".sidebar-toggle-button.mod-right",
    ]) {
      expect(selectors, hide).toContain(`${body} ${hide}`);
    }
  });

  it("hides the left sidebar's tab strip, so the left side shows only Folders", () => {
    expect(selectors).toContain(
      `${body} .workspace-split.mod-left-split .workspace-tab-header-container`,
    );
  });

  it("keeps the left split, its drawer and its toggle on screen", () => {
    for (const keep of [
      ".workspace-split.mod-left-split",
      ".workspace-drawer",
      ".workspace-drawer.mod-left",
      ".sidebar-toggle-button",
      ".sidebar-toggle-button.mod-left",
    ]) {
      expect(selectors, keep).not.toContain(`${body} ${keep}`);
    }
  });

  it("hides the title bar of FineNotes' views, the Folders ones included", () => {
    const types = [
      "goodobsidian-view",
      "finenotes-library",
      VIEW_TYPE_FOLDERS,
      VIEW_TYPE_FOLDER_LIBRARY,
    ];
    const rule = /:is\(([^)]*)\)\s*>\s*\.view-header/.exec(look)?.[1] ?? "";
    for (const type of types) expect(rule, type).toContain(`[data-type="${type}"]`);
  });
});

describe("the Folders views' styles (styles.css)", () => {
  it("name FineNotes' view types, not the standalone plugin's, so both can be installed", () => {
    expect(VIEW_TYPE_FOLDERS).toBe("finenotes-folders");
    expect(VIEW_TYPE_FOLDER_LIBRARY).toBe("finenotes-folder-library");
    expect(css).toContain(
      `.workspace-leaf-content[data-type="${VIEW_TYPE_FOLDERS}"] .view-content`,
    );
    expect(css).toContain(
      `.workspace-leaf-content[data-type="${VIEW_TYPE_FOLDER_LIBRARY}"] .view-content`,
    );
    expect(css).not.toContain('data-type="folder-sidebar-view"');
    expect(css).not.toContain('data-type="folder-library-view"');
  });

  it("keep the plugin's class names", () => {
    for (const cls of [
      ".folder-sidebar-root",
      ".folder-library-root",
      ".fs-pane",
      ".fl-card",
      ".fl-grid",
    ]) {
      expect(css, cls).toContain(cls);
    }
  });
});
