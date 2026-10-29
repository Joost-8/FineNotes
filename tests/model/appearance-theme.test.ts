/**
 * The three appearance layers are independent: the workspace desk, the page
 * paper and how PDF pages are shown. These pin the pure resolution so a dark
 * theme cannot leak into a PDF that is set to stay as it is.
 */

import { describe, expect, it } from "vitest";
import {
  DARK_WORKSPACE,
  DEFAULT_CUSTOM_WORKSPACE,
  LIGHT_WORKSPACE,
  isPdfTheme,
  isWorkspaceBackground,
  pagesAreDark,
  pdfThemeOf,
  shownPaperTheme,
  themePresetOf,
  workspaceBackgroundOf,
} from "../../src/model/appearance-theme";
import {
  DARK_PAPER,
  LIGHT_PAPER,
  PAPER_PRESETS,
  pageLook,
  paperTheme,
} from "../../src/canvas/backdrop";

describe("workspace background", () => {
  it("follows Obsidian for auto, and honours fixed light and dark", () => {
    expect(workspaceBackgroundOf({ workspaceBackground: "auto" }, false)).toBe(LIGHT_WORKSPACE);
    expect(workspaceBackgroundOf({ workspaceBackground: "auto" }, true)).toBe(DARK_WORKSPACE);
    expect(workspaceBackgroundOf({ workspaceBackground: "light" }, true)).toBe(LIGHT_WORKSPACE);
    expect(workspaceBackgroundOf({ workspaceBackground: "dark" }, false)).toBe(DARK_WORKSPACE);
  });

  it("uses the picked custom colour, normalised, and rejects a bad value", () => {
    expect(
      workspaceBackgroundOf(
        { workspaceBackground: "custom", workspaceBackgroundColor: "#ABC" },
        true,
      ),
    ).toBe("#aabbcc");
    expect(
      workspaceBackgroundOf(
        { workspaceBackground: "custom", workspaceBackgroundColor: "not a colour" },
        true,
      ),
    ).toBe(DEFAULT_CUSTOM_WORKSPACE);
  });

  it("has no Blur choice: a stored one falls back to auto", () => {
    expect(isWorkspaceBackground("blur")).toBe(false);
    expect(workspaceBackgroundOf({ workspaceBackground: "blur" }, true)).toBe(DARK_WORKSPACE);
  });

  it("does not read the page theme, and falls back on unknown stored values", () => {
    expect(
      workspaceBackgroundOf(
        {
          workspaceBackground: "dark",
          workspaceBackgroundColor: "#ffffff",
          pageAppearance: "light",
        },
        false,
      ),
    ).toBe(DARK_WORKSPACE);
    expect(workspaceBackgroundOf({ workspaceBackground: "sepia" }, true)).toBe(DARK_WORKSPACE);
  });
});

describe("theme preset", () => {
  it("reads a uniform Auto, Light or Dark, and Custom for anything else", () => {
    const set = (workspaceBackground: string, pageAppearance: string, pdfTheme: string) =>
      themePresetOf({ workspaceBackground, pageAppearance, pdfTheme });
    expect(set("auto", "system", "auto")).toBe("auto");
    expect(set("light", "light", "as-is")).toBe("light");
    expect(set("dark", "dark", "dark")).toBe("dark");
    expect(set("auto", "system", "as-is")).toBe("custom");
    expect(set("dark", "light", "as-is")).toBe("custom");
    expect(set("custom", "dark", "dark")).toBe("custom");
  });
});

describe("page theme and PDF theme", () => {
  it("resolves the page paper from only its own theme", () => {
    expect(pagesAreDark("light", true)).toBe(false);
    expect(pagesAreDark("dark", false)).toBe(true);
    expect(pagesAreDark("system", true)).toBe(true);
    expect(pagesAreDark("system", false)).toBe(false);
    expect(pagesAreDark("sepia", true)).toBe(false);
    expect(shownPaperTheme({ pageAppearance: "light", pdfTheme: "dark" }, true)).toBe(LIGHT_PAPER);
    expect(shownPaperTheme({ pageAppearance: "dark", pdfTheme: "as-is" }, false).night).toBe(true);
  });

  it("reads the PDF choice independently of the page theme", () => {
    expect(pdfThemeOf({ pdfTheme: "as-is" })).toBe("as-is");
    expect(pdfThemeOf({ pdfTheme: "dark" })).toBe("dark");
    expect(pdfThemeOf({ pdfTheme: "other" })).toBe("dark");
    // A data.json from before the split used invertPdfPages.
    expect(pdfThemeOf({ invertPdfPages: false })).toBe("as-is");
    expect(pdfThemeOf({ invertPdfPages: true })).toBe("dark");
    expect(pdfThemeOf({})).toBe("dark");
  });

  it("does not invert a PDF opened in dark mode when PDFs stay as is", () => {
    const theme = shownPaperTheme(
      { pageAppearance: "dark", pdfTheme: "as-is", invertPdfPages: false },
      true,
    );
    expect(theme.night).toBe(true);
    expect(theme.keepPdf).toBe(true);
    const pdf = { kind: "pdf", path: "Slides/week1.pdf", page: 2 } as const;
    // The renderer's paint-time look: true PDF colours, and no night ink mapping.
    expect(pageLook(pdf, theme)).toEqual({
      paper: LIGHT_PAPER.paper,
      night: false,
      theme: LIGHT_PAPER,
    });
    // Non-PDF pages in the same document still use dark paper.
    expect(pageLook({ kind: "blank" }, theme).night).toBe(true);
    expect(pageLook({ kind: "blank", paperColor: PAPER_PRESETS.cream }, theme).night).toBe(true);
  });

  it("inverts PDFs when PDFs adapt to dark mode", () => {
    const theme = shownPaperTheme({ pageAppearance: "dark", pdfTheme: "dark" }, true);
    expect(theme).toBe(DARK_PAPER);
    expect(pageLook({ kind: "pdf", path: "a.pdf", page: 0 }, theme).night).toBe(true);
  });

  it("follows Obsidian for PDFs on Auto: dark only when Obsidian is dark", () => {
    const pdf = { kind: "pdf", path: "a.pdf", page: 0 } as const;
    const dark = shownPaperTheme({ pageAppearance: "dark", pdfTheme: "auto" }, true);
    expect(pageLook(pdf, dark).night).toBe(true);
    const light = shownPaperTheme({ pageAppearance: "dark", pdfTheme: "auto" }, false);
    expect(light.night).toBe(true);
    expect(pageLook(pdf, light).night).toBe(false);
  });

  it("leaves PDFs alone on light paper, whatever the PDF setting", () => {
    for (const pdfTheme of ["auto", "as-is", "dark"] as const) {
      const theme = shownPaperTheme({ pageAppearance: "light", pdfTheme }, false);
      expect(theme).toBe(LIGHT_PAPER);
      expect(pageLook({ kind: "pdf", path: "a.pdf", page: 0 }, theme).night).toBe(false);
    }
    // paperTheme's own keepPdf flag still behaves as it always did.
    expect(pageLook({ kind: "pdf", path: "a.pdf", page: 0 }, paperTheme(true, true)).night).toBe(
      false,
    );
  });
});

describe("stored appearance values", () => {
  it("recognises only the values the dropdowns can store", () => {
    for (const value of ["auto", "light", "dark", "custom"]) {
      expect(isWorkspaceBackground(value)).toBe(true);
    }
    for (const value of [undefined, null, "Auto", "sepia", 1]) {
      expect(isWorkspaceBackground(value)).toBe(false);
    }
    expect(isPdfTheme("auto")).toBe(true);
    expect(isPdfTheme("as-is")).toBe(true);
    expect(isPdfTheme("dark")).toBe(true);
    expect(isPdfTheme("light")).toBe(false);
  });
});
