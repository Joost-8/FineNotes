import { describe, expect, it } from "vitest";
import {
  HOME_FILE,
  HOME_FILE_FLAG,
  HOME_FILE_TEXT,
  isOwnHomeText,
} from "../../src/model/home-file";

describe("the Home file", () => {
  it("sits at the vault's root and says what it does", () => {
    expect(HOME_FILE).toBe("Home.md");
    expect(HOME_FILE_TEXT).toContain("library");
  });

  it("knows its own note by the flag in its frontmatter", () => {
    expect(isOwnHomeText(HOME_FILE_TEXT)).toBe(true);
    expect(isOwnHomeText(HOME_FILE_TEXT.replace(/\n/g, "\r\n"))).toBe(true);
    expect(isOwnHomeText(`---\ntags: [x]\n${HOME_FILE_FLAG}: true\n---\nmine`)).toBe(true);
  });

  it("leaves a Home note of the user's own alone", () => {
    expect(isOwnHomeText("# Home\n\nMy dashboard.\n")).toBe(false);
    expect(isOwnHomeText("---\ncssclasses: dashboard\n---\n# Home\n")).toBe(false);
    expect(isOwnHomeText(`---\n${HOME_FILE_FLAG}: false\n---\n`)).toBe(false);
    // The flag in the body is not frontmatter.
    expect(isOwnHomeText(`---\ntitle: Home\n---\n${HOME_FILE_FLAG}: true\n`)).toBe(false);
    expect(isOwnHomeText(`# Home\n${HOME_FILE_FLAG}: true\n`)).toBe(false);
    expect(isOwnHomeText("")).toBe(false);
  });
});
