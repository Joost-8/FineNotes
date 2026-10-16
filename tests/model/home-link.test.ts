/** `src/model/home-link.ts` — the link that opens a notebook from the home screen. */

import { describe, expect, it } from "vitest";
import { obsidianOpenUri } from "../../src/model/home-link";

describe("obsidianOpenUri", () => {
  it("names the vault and the file", () => {
    expect(obsidianOpenUri("Notes", "Biology.notebook.md")).toBe(
      "obsidian://open?vault=Notes&file=Biology.notebook.md",
    );
  });

  it("encodes spaces, folders and characters a URL gives meaning to", () => {
    const uri = obsidianOpenUri("My vault", "School/Maths & physics #2.notebook.md");
    expect(uri).toBe(
      "obsidian://open?vault=My%20vault&file=School%2FMaths%20%26%20physics%20%232.notebook.md",
    );
    const params = new URL(uri).searchParams;
    expect(params.get("vault")).toBe("My vault");
    expect(params.get("file")).toBe("School/Maths & physics #2.notebook.md");
  });

  it("keeps names in other scripts", () => {
    const params = new URL(obsidianOpenUri("ノート", "Été/日記.notebook.md")).searchParams;
    expect(params.get("vault")).toBe("ノート");
    expect(params.get("file")).toBe("Été/日記.notebook.md");
  });
});
