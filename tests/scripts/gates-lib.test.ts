import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STEPS,
  lastLines,
  noteLines,
  parseGateArgs,
  selectSteps,
  stepLine,
} from "../../scripts/gates-lib.mjs";

describe("the gates and CI", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  it("runs only npm scripts that exist", () => {
    for (const step of STEPS) expect(packageJson.scripts, step.name).toHaveProperty(step.script);
  });

  it("has every step in CI too, so green here means green there", () => {
    const runs = [...ci.matchAll(/^\s*run: npm run (\S+)/gm)].map((match) => match[1]);
    for (const step of STEPS)
      expect(runs, `CI lacks npm run ${step.script}`).toContain(step.script);
  });

  it("runs CI's steps in CI's order", () => {
    const runs = [...ci.matchAll(/^\s*run: npm run (\S+)/gm)].map((match) => match[1]);
    expect(STEPS.map((step) => step.script)).toEqual(runs);
  });

  it("names steps so that each can be a log file on Windows", () => {
    for (const step of STEPS) expect(step.name).toMatch(/^[a-z][a-z-]*$/);
    expect(new Set(STEPS.map((step) => step.name)).size).toBe(STEPS.length);
  });
});

describe("parseGateArgs", () => {
  it("runs everything, stopping at the first failure, with no options", () => {
    expect(parseGateArgs([])).toEqual({
      only: null,
      skip: [],
      keepGoing: false,
      list: false,
      help: false,
      errors: [],
    });
  });

  it("reads --only and --skip, spaced or with =", () => {
    expect(parseGateArgs(["--only", "lint,test"]).only).toEqual(["lint", "test"]);
    expect(parseGateArgs(["--only=lint, test"]).only).toEqual(["lint", "test"]);
    expect(parseGateArgs(["--skip", "build", "--skip=test"]).skip).toEqual(["build", "test"]);
    expect(parseGateArgs(["--keep-going", "--skip", "build"])).toMatchObject({
      keepGoing: true,
      skip: ["build"],
    });
  });

  it("refuses an option it does not know, and --only without names", () => {
    expect(parseGateArgs(["--fast"]).errors).toEqual(["unknown option --fast"]);
    expect(parseGateArgs(["--only"]).errors).toHaveLength(1);
    const options = parseGateArgs(["--only", "--keep-going"]);
    expect(options.errors).toHaveLength(1);
    expect(options.keepGoing).toBe(true);
  });
});

describe("selectSteps", () => {
  const steps = [
    { name: "format", script: "format:check" },
    { name: "lint", script: "lint" },
    { name: "test", script: "test" },
  ];
  const picked = (only: string[] | null, skip: string[] = []) =>
    selectSteps(steps, { only, skip }).steps.map((step) => step.name);

  it("keeps the gate order whatever order the names came in", () => {
    expect(picked(null)).toEqual(["format", "lint", "test"]);
    expect(picked(["test", "format"])).toEqual(["format", "test"]);
    expect(picked(null, ["lint"])).toEqual(["format", "test"]);
    expect(picked(["lint", "test"], ["test"])).toEqual(["lint"]);
  });

  it("takes a step's npm script for its name", () => {
    expect(picked(["format:check"])).toEqual(["format"]);
  });

  it("reports names that match nothing, rather than running less in silence", () => {
    expect(selectSteps(steps, { only: ["lnt", "test"], skip: ["bild"] }).unknown).toEqual([
      "lnt",
      "bild",
    ]);
  });
});

describe("what the gates print", () => {
  it("shows the end of a log, without its trailing blank lines", () => {
    expect(lastLines("one\r\ntwo\r\nthree\r\n\r\n", 2)).toBe("two\nthree");
    expect(lastLines("one\n", 40)).toBe("one");
  });

  it("picks out a step's notes", () => {
    expect(noteLines("css-classes: ok\nnote: skipped, shallow clone\n")).toEqual([
      "note: skipped, shallow clone",
    ]);
  });

  it("writes one aligned line per step", () => {
    expect(stepLine("lint", true, 12.34)).toBe("lint              ok        12.3s");
    expect(stepLine("typecheck", false, 3)).toBe("typecheck         FAILED     3.0s");
  });
});
