import { readFileSync } from "node:fs";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { english } from "../../src/i18n/translate";
import { GUIDE, type GuideEntry } from "../../src/model/finenotes-guide";
import {
  GUIDE_PAGES,
  GuidePageError,
  formatGuideData,
  formatGuidePage,
  formatTipsPage,
  parseGuidePage,
} from "../../src/model/guide-markdown";
import { tipRows } from "../../src/recognition/finenotes-help";

const page = (file: string): string => readFileSync(`guide/${file}`, "utf8");

describe("the guide's wiki (guide/*.md)", () => {
  it("is what Ask AI searches: run `npm run guide` after editing a page", () => {
    const fromPages = GUIDE_PAGES.flatMap((p) => parseGuidePage(page(p.file), p.file));
    expect(fromPages).toEqual(GUIDE);
  });

  it("lists every tip as it is now: run `npm run guide` after changing a tip", async () => {
    const options = (await prettier.resolveConfig("package.json")) ?? {};
    const expected = await prettier.format(formatTipsPage(tipRows(english), GUIDE), {
      ...options,
      parser: "markdown",
    });
    expect(page("tips.md")).toBe(expected);
  });

  it("reads back what it writes", () => {
    const entries: GuideEntry[] = [
      {
        id: "one",
        area: "toolbar",
        title: "One",
        words: "a, b",
        what: "Does one thing.",
        where: "Toolbar › One",
        notes: "iPad only.",
        settings: ["pressureWidth", "penGestures.circleLasso"],
        commands: ["zoom-in"],
        feature: "hold",
      },
      { id: "two", area: "toolbar", title: "Two", words: "c", what: "Two.", where: "There" },
    ];
    const toolbar = GUIDE_PAGES.find((p) => p.area === "toolbar");
    if (!toolbar) throw new Error("no toolbar page");
    expect(parseGuidePage(formatGuidePage(toolbar, entries))).toEqual(entries);
    expect(formatGuideData(entries)).toContain('{"id":"two","area":"toolbar"');
  });

  it("takes a field wrapped onto the next line", () => {
    const md = [
      "# T",
      "<!-- area: start -->",
      "### A",
      "- **Id:** `a`",
      "- **What:** one",
      "  two",
      "- **Where:** here",
      "- **Words:** w",
    ].join("\n");
    expect(parseGuidePage(md)[0].what).toBe("one two");
  });

  it("says what is wrong with a page, and where", () => {
    expect(() => parseGuidePage("# T\n### A")).toThrow(GuidePageError);
    expect(() => parseGuidePage("<!-- area: moon -->")).toThrow(/unknown area "moon"/);
    expect(() => parseGuidePage("<!-- area: start -->\n### A\n- **Id:** a\n- **What:** w")).toThrow(
      /"A" has no where/,
    );
    expect(() => parseGuidePage("<!-- area: start -->\n### A\n- **Colour:** red", "x.md")).toThrow(
      /x\.md:3: unknown field "Colour"/,
    );
  });
});
