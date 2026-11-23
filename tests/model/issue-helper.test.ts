import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formAnswers,
  guideMatches,
  missingDiagnostics,
  problemText,
  similarIssues,
  summaryMarkdown,
} from "../../src/model/issue-helper";

/** #297 as GitHub has it: the bug form's answers, typos and all. */
const issue297 = JSON.parse(readFileSync("tests/model/fixtures/issue-297.json", "utf8")) as {
  title: string;
  body: string;
};

const form = (answers: Record<string, string>): string =>
  Object.entries(answers)
    .map(([label, value]) => `### ${label}\n\n${value}`)
    .join("\n\n");

describe("reading the bug form", () => {
  it("reads each answer under its label, an empty one as empty", () => {
    const answers = formAnswers(issue297.body);
    expect(answers.get("What is it about?")).toBe("Something else");
    expect(answers.get("Device")).toBe("Desktop (Windows)");
    expect(answers.get("Diagnostics")).toBe("");
    expect(answers.get("Recording, screenshots and files")).toBe("");
  });

  it("searches the title and what happened, not the form's own labels", () => {
    const text = problemText(issue297);
    expect(text).toContain("left handd panel");
    expect(text).not.toContain("Steps to reproduce");
    expect(problemText({ title: "t", body: "free text" })).toBe("t\nfree text");
  });
});

describe("what the helper finds", () => {
  it("answers #297 with the Simple look", () => {
    const ids = guideMatches(issue297).map((match) => match.id);
    expect(ids.some((id) => id === "settingSimpleLook" || id === "simpleLook")).toBe(true);
    const match = guideMatches(issue297)[0];
    expect(match.url).toMatch(/^https:\/\/github\.com\/Joost-8\/FineNotes\/blob\/main\/guide\//);
  });

  it("finds #187 as the earlier report of #297", () => {
    const earlier = [
      {
        number: 187,
        title: "Urgent: update kills side panels in mac, iPhone and iPad",
        closed: true,
      },
      { number: 247, title: "Erasor size does not stay cutom size", closed: false },
      { number: 109, title: ".goodnotes import not working properly", closed: true },
    ];
    expect(
      similarIssues({ title: "Side panels disappear after update", body: "" }, earlier),
    ).toEqual([earlier[0]]);
    expect(similarIssues({ title: "zzz", body: "" }, earlier)).toEqual([]);
  });

  it("asks for a recording for ink problems, and the device when it is missing", () => {
    expect(
      missingDiagnostics({
        title: "t",
        body: form({
          "What is it about?": "Writing, erasing or how the ink looks",
          Device: "",
          "Recording, screenshots and files": "_No response_",
        }),
      }),
    ).toEqual(["a screen recording with the input debug overlay on", "the device"]);
    expect(missingDiagnostics(issue297)).toEqual([]);
    expect(missingDiagnostics({ title: "t", body: "no form" })).toEqual([]);
  });
});

describe("the summary", () => {
  it("is three lines: guide links, similar issues, what is missing", () => {
    const similar = [{ number: 187, title: "Side panels gone", closed: true }];
    const text = summaryMarkdown(297, issue297, guideMatches(issue297), similar, ["the device"]);
    expect(text).toMatch(/^## #297 /);
    expect(text).toMatch(/\*\*Guide:\*\* \[Simple look/);
    expect(text).toContain("**Similar:** #187 Side panels gone (closed)");
    expect(text).toContain("**Missing:** the device");
    expect(summaryMarkdown(1, issue297, [], [], [])).toContain("**Guide:** nothing");
  });
});
