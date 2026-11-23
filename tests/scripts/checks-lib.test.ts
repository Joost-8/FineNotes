import { describe, expect, it } from "vitest";
import {
  classCollisions,
  classRules,
  countLines,
  coverageGaps,
  cssClassNames,
  cssRules,
  fullyListedDirectories,
  globToRegExp,
  includeMatcher,
  overCaps,
  parseCoverageInclude,
} from "../../scripts/checks/lib.mjs";

describe("parseCoverageInclude", () => {
  const config = `
    export default defineConfig({
      test: {
        include: ["tests/**/*.test.ts"],
        coverage: {
          provider: "v8",
          // Pure modules, and "src/not/this.ts" in a comment.
          include: [
            "src/changelog.ts",
            'src/model/**/*.ts', /* "src/nor/this.ts" */
            "src/ink/freehand.ts",
          ],
          thresholds: { "src/canvas/zoom.ts": { lines: 100 } },
        },
      },
    });`;

  it("reads the coverage list, not the test list or the thresholds", () => {
    expect(parseCoverageInclude(config)).toEqual([
      "src/changelog.ts",
      "src/model/**/*.ts",
      "src/ink/freehand.ts",
    ]);
  });

  it("says what is wrong with a config it cannot read", () => {
    expect(() => parseCoverageInclude("export default {}")).toThrow(/no `coverage:` block/);
    expect(() => parseCoverageInclude("coverage: { provider: 'v8' }")).toThrow(/no `include: \[`/);
    expect(() => parseCoverageInclude('coverage: { include: ["a.ts", ')).toThrow(/never closes/);
  });
});

describe("globToRegExp", () => {
  it("lets ** cross folders and * stay inside one", () => {
    const deep = globToRegExp("src/model/**/*.ts");
    expect(deep.test("src/model/tips.ts")).toBe(true);
    expect(deep.test("src/model/algebra/solve.ts")).toBe(true);
    expect(deep.test("src/modelling/tips.ts")).toBe(false);
    expect(deep.test("src/model/tips.tsx")).toBe(false);
    const flat = globToRegExp("src/ink/*.ts");
    expect(flat.test("src/ink/freehand.ts")).toBe(true);
    expect(flat.test("src/ink/deep/freehand.ts")).toBe(false);
  });

  it("reads braces as a choice and a dot as a dot", () => {
    const either = globToRegExp("src/{canvas/zoom,view/keys}.ts");
    expect(either.test("src/canvas/zoom.ts")).toBe(true);
    expect(either.test("src/view/keys.ts")).toBe(true);
    expect(either.test("src/view/zoom.ts")).toBe(false);
    expect(globToRegExp("src/a.ts").test("src/axts")).toBe(false);
  });
});

describe("coverageGaps", () => {
  const include = ["src/model/**/*.ts", "src/ink/freehand.ts", "src/view/keys.ts"];
  const allFiles = [
    "src/model/tips.ts",
    "src/ink/freehand.ts",
    "src/ink/worker.ts",
    "src/ink/new.ts",
    "src/view/keys.ts",
  ];
  const files = allFiles.filter((file) => !file.startsWith("src/view/"));

  it("finds a file that is in neither the list nor the baseline", () => {
    const gaps = coverageGaps({ files, allFiles, include, baseline: ["src/ink/worker.ts"] });
    expect(gaps).toEqual({ missing: ["src/ink/new.ts"], stale: [], dangling: [] });
  });

  it("passes once the file is listed", () => {
    const gaps = coverageGaps({
      files,
      allFiles,
      include: [...include, "src/ink/new.ts"],
      baseline: ["src/ink/worker.ts"],
    });
    expect(gaps.missing).toEqual([]);
  });

  it("calls a baseline entry stale once it is listed, or its file is gone", () => {
    const gaps = coverageGaps({
      files,
      allFiles,
      include: [...include, "src/ink/new.ts"],
      baseline: ["src/ink/new.ts", "src/ink/deleted.ts", "src/ink/worker.ts"],
    });
    expect(gaps.stale).toEqual(["src/ink/deleted.ts", "src/ink/new.ts"]);
  });

  it("finds a listed path that names no file, as a rename leaves behind", () => {
    const gaps = coverageGaps({
      files,
      allFiles,
      include: [...include, "src/ink/renamed-away.ts", "src/nothing/**/*.ts"],
      baseline: ["src/ink/worker.ts", "src/ink/new.ts"],
    });
    expect(gaps.dangling).toEqual(["src/ink/renamed-away.ts"]);
  });
});

describe("fullyListedDirectories", () => {
  it("names a directory only when each of its own files is listed", () => {
    const include = ["src/model/**/*.ts", "src/ink/freehand.ts", "src/view/keys.ts"];
    const files = [
      "src/model/tips.ts",
      "src/model/algebra/solve.ts",
      "src/ink/freehand.ts",
      "src/view/keys.ts",
      "src/view/toolbar.ts",
    ];
    expect(fullyListedDirectories(files, include)).toEqual([
      "src/ink",
      "src/model",
      "src/model/algebra",
    ]);
    expect(includeMatcher(include)("src/view/toolbar.ts")).toBe(false);
  });
});

describe("countLines", () => {
  it("counts as wc -l does, and a last line without a newline too", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\r\nb\r\n")).toBe(2);
  });
});

describe("overCaps", () => {
  const caps = { "src/main.ts": 100, "styles.css": 500, "src/gone.ts": 50 };

  it("passes a file at its cap and fails one line past it", () => {
    expect(overCaps(caps, { "src/main.ts": 100, "styles.css": 500 })).toEqual([]);
    expect(overCaps(caps, { "src/main.ts": 101, "styles.css": 500 })).toEqual([
      { file: "src/main.ts", cap: 100, lines: 101, over: 1 },
    ]);
  });

  it("puts the largest overrun first", () => {
    const over = overCaps(caps, { "src/main.ts": 110, "styles.css": 900 });
    expect(over.map((entry) => entry.file)).toEqual(["styles.css", "src/main.ts"]);
  });
});

describe("cssClassNames", () => {
  it("takes goodobsidian classes from selectors only", () => {
    const css = `
      /* .goodobsidian-in-a-comment { } */
      .goodobsidian-toolbar button.goodobsidian-pen:hover,
      .is-tablet .goodobsidian-pill > .other-class { color: red; }
      .plain { background: url("x.goodobsidian-in-a-url.png"); }
      .goodobsidian-note::after { content: ".goodobsidian-in-a-string { }"; }
      [class*="goodobsidian-attr"] { color: blue; }
    `;
    expect([...cssClassNames(css)].sort()).toEqual([
      "goodobsidian-note",
      "goodobsidian-pen",
      "goodobsidian-pill",
      "goodobsidian-toolbar",
    ]);
  });

  it("reads inside @media and @supports, and skips keyframes", () => {
    const css = `
      @media (max-width: 600px) {
        @supports (backdrop-filter: blur(1px)) {
          .goodobsidian-frosted { backdrop-filter: blur(8px); }
        }
        .goodobsidian-narrow { width: 100%; }
      }
      @keyframes goodobsidian-spin { from { rotate: 0deg; } to { rotate: 360deg; } }
      .goodobsidian-after { animation: goodobsidian-spin 1s; }
    `;
    expect([...cssClassNames(css)].sort()).toEqual([
      "goodobsidian-after",
      "goodobsidian-frosted",
      "goodobsidian-narrow",
    ]);
  });

  it("reads the selectors of nested rules", () => {
    const css = `.goodobsidian-card { color: red; .goodobsidian-card-title { font-weight: 600; } }`;
    expect([...cssClassNames(css)].sort()).toEqual([
      "goodobsidian-card",
      "goodobsidian-card-title",
    ]);
  });
});

describe("cssRules and classRules", () => {
  it("keeps the at-rules around a rule, and squeezes whitespace", () => {
    const css = `@media (max-width: 600px) {\n  .goodobsidian-a,\n  .goodobsidian-b {\n    color:   red;\n  }\n}`;
    expect(cssRules(css)).toEqual([
      {
        selector: ".goodobsidian-a, .goodobsidian-b",
        context: ["@media (max-width: 600px)"],
        body: "color: red;",
      },
    ]);
    const text = "@media (max-width: 600px) { .goodobsidian-a, .goodobsidian-b { color: red; } }";
    expect(classRules(css).get("goodobsidian-a")).toEqual([text]);
    expect(classRules(css).get("goodobsidian-b")).toEqual([text]);
  });

  it("lists every rule that names a class", () => {
    const css = `.goodobsidian-a { color: red; } .x .goodobsidian-a.is-on { color: blue; }`;
    expect(classRules(css).get("goodobsidian-a")).toHaveLength(2);
  });
});

describe("classCollisions", () => {
  const base = `.goodobsidian-old { color: black; }`;
  const picker = `.goodobsidian-table-cell { width: 24px; height: 24px; }`;
  const editor = `.goodobsidian-table-cell { position: absolute; outline: 2px solid; }`;

  it("finds a class both sides introduced for different things", () => {
    const collisions = classCollisions({
      base,
      theirs: `${base}\n${picker}`,
      ours: `${base}\n${editor}`,
    });
    expect(collisions).toEqual([
      {
        name: "goodobsidian-table-cell",
        ours: [".goodobsidian-table-cell { position: absolute; outline: 2px solid; }"],
        theirs: [".goodobsidian-table-cell { width: 24px; height: 24px; }"],
      },
    ]);
  });

  it("passes a class only one side introduced", () => {
    const ours = `${base}\n.goodobsidian-mine { color: red; }`;
    const theirs = `${base}\n.goodobsidian-theirs { color: blue; }`;
    expect(classCollisions({ base, theirs, ours })).toEqual([]);
  });

  it("passes a class that was there before the branches parted, whatever each did to it", () => {
    const ours = `.goodobsidian-old { color: red; }`;
    const theirs = `.goodobsidian-old { color: blue; }`;
    expect(classCollisions({ base, theirs, ours })).toEqual([]);
  });

  it("passes the same rules on both sides, in any order and layout", () => {
    const one = `.goodobsidian-new { color: red; }`;
    const two = `.is-mobile .goodobsidian-new { color: blue; }`;
    const collisions = classCollisions({
      base,
      theirs: `${base}\n${one}\n${two}`,
      ours: `${two}\n${base}\n.goodobsidian-new {\n  color: red;\n}`,
    });
    expect(collisions).toEqual([]);
  });

  it("fails when one side then changed the rules it shares", () => {
    const collisions = classCollisions({
      base,
      theirs: `${base}\n.goodobsidian-new { color: red; }`,
      ours: `${base}\n.goodobsidian-new { color: red; margin: 0; }`,
    });
    expect(collisions.map((collision) => collision.name)).toEqual(["goodobsidian-new"]);
  });

  it("names every collision, in order", () => {
    const collisions = classCollisions({
      base: "",
      theirs: `.goodobsidian-b { color: red; } .goodobsidian-a { color: red; }`,
      ours: `.goodobsidian-b { color: blue; } .goodobsidian-a { color: blue; }`,
    });
    expect(collisions.map((collision) => collision.name)).toEqual([
      "goodobsidian-a",
      "goodobsidian-b",
    ]);
  });
});
