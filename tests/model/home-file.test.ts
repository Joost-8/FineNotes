import { describe, expect, it } from "vitest";
import { HOME_FILE, HOME_FILE_TEXT } from "../../src/model/home-file";

describe("the Home file", () => {
  it("sits at the vault's root and says what it does", () => {
    expect(HOME_FILE).toBe("Home.md");
    expect(HOME_FILE_TEXT).toContain("library");
  });
});
