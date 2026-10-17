/**
 * `src/model/gallery-share.ts` — the community gallery's submission form,
 * filled in: field ids and option labels must match the form on GitHub.
 */

import { describe, expect, it } from "vitest";
import { TEMPLATE_LICENCES } from "../../src/import/template-package";
import {
  GALLERY_REPOSITORY,
  SHARE_CATEGORIES,
  shareProblems,
  submissionUrl,
} from "../../src/model/gallery-share";

describe("submissionUrl", () => {
  it("opens the form with every field filled in", () => {
    const url = new URL(
      submissionUrl({
        name: " Weekly planner ",
        author: "Ana Reyes",
        category: "planner",
        licence: "cc-by",
        description: "Monday start & linked days",
        tags: "weekly, hyperlinked",
      }),
    );
    expect(url.origin + url.pathname).toBe(`https://github.com/${GALLERY_REPOSITORY}/issues/new`);
    const q = url.searchParams;
    expect(q.get("template")).toBe("submit-template.yml");
    expect(q.get("title")).toBe("Template: Weekly planner");
    expect(q.get("name")).toBe("Weekly planner");
    expect(q.get("author")).toBe("Ana Reyes");
    expect(q.get("category")).toBe("Planner");
    expect(q.get("licence")).toBe("CC BY 4.0 (share and adapt, with credit)");
    expect(q.get("description")).toBe("Monday start & linked days");
    expect(q.get("tags")).toBe("weekly, hyperlinked");
  });

  it("leaves out what was not given", () => {
    const q = new URL(
      submissionUrl({ name: "Dots", author: "Mo", category: "nonsense", licence: "cc0" }),
    ).searchParams;
    expect(q.has("category")).toBe(false);
    expect(q.has("description")).toBe(false);
    expect(q.has("tags")).toBe(false);
    expect(q.get("licence")).toBe("CC0 (no rights reserved)");
  });

  it("uses the form's own option labels", () => {
    // These are the dropdown options in submit-template.yml.
    expect(SHARE_CATEGORIES.map((c) => c.label)).toEqual([
      "Planner",
      "Study",
      "Journal",
      "Work",
      "Paper",
      "Other",
    ]);
    expect(TEMPLATE_LICENCES.map((l) => l.label)).toEqual([
      "Personal use only",
      "Personal and commercial use",
      "CC BY 4.0 (share and adapt, with credit)",
      "CC0 (no rights reserved)",
    ]);
  });
});

describe("shareProblems", () => {
  it("asks for a name and an author", () => {
    expect(
      shareProblems({ name: " ", author: "", category: "study", licence: "cc0" }),
    ).toHaveLength(2);
    expect(shareProblems({ name: "A", author: "B", category: "study", licence: "cc0" })).toEqual(
      [],
    );
  });
});
