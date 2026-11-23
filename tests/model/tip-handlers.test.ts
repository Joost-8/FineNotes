/**
 * Every tip names the code that does what it says (`Tip.handlers`,
 * src/model/tip-handlers.ts), and that code is still there: the file exists
 * and declares the name. Rename or delete a gesture's handler and this fails,
 * so the tip that describes it is read again against what the code now does.
 *
 * A name counts only where it is declared or defined: a function, a class, a
 * constant, a method, a property or a key, or (for a command's id) the string
 * a command is registered with. A comment that mentions it does not, and
 * neither does a call.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIP_HANDLERS } from "../../src/model/tip-handlers";
import { RELEASE_HIGHLIGHTS, TIP_COLLECTIONS, type Tip } from "../../src/model/tips";

const ROOT = join(__dirname, "../..");

/** `"src/view/toolbar.ts#penSwatch"`: a TypeScript file under src, then a name or a command's id. */
const HANDLER = /^(src\/[\w./-]+\.ts)#([\w$]+(?:[.-][\w$]+)*)$/;

/** Where a tip may not point: at itself, its picture or its words. */
const NOT_A_HANDLER = /^src\/(model\/(tips|tip-scenes|tip-handlers)\.ts|i18n\/)/;

/** Comments blanked out, line breaks kept, so a name in a comment is not found and lines still start where they did. */
function withoutComments(source: string): string {
  const blank = (comment: string): string => comment.replace(/[^\n]/g, " ");
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MODIFIERS =
  "(?:(?:export|public|private|protected|static|async|override|readonly|abstract|get|set)\\s+)*";

/** The index just past the bracket that closes the one at `open`, or -1. */
function afterClosing(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Whether `code` (comments already removed) declares or defines `name`:
 *
 * - `function name`, `class name`, `const name`, `interface name`, `type name`, `enum name`;
 * - a method or accessor at the start of a line, `private name(…) {` or
 *   `name(…): T {`, told from a call by what follows its closing bracket;
 * - a property, a field or a key at the start of a line, `name:`, `name?:`, `name =`;
 * - for a name that is no identifier (a command's id, `copy-page-link`): that
 *   string as an `id:` or as the first argument of a call.
 */
function declares(code: string, name: string): boolean {
  const n = escaped(name);
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    return new RegExp(`(?:\\bid:\\s*|\\(\\s*)(["'])${n}\\1`).test(code);
  }
  if (
    new RegExp(`\\b(?:function\\*?|class|interface|type|enum|const|let|var)\\s+${n}\\b`).test(code)
  ) {
    return true;
  }
  if (new RegExp(`^[ \\t]*${MODIFIERS}${n}\\??\\s*(?::|=(?![=>]))`, "m").test(code)) return true;
  const method = new RegExp(`^[ \\t]*${MODIFIERS}${n}\\??\\s*(?:<[^>\\n]*>)?\\(`, "gm");
  for (let found = method.exec(code); found; found = method.exec(code)) {
    const end = afterClosing(code, found.index + found[0].length - 1);
    if (end < 0) continue;
    const next = code.slice(end).match(/\S/)?.[0];
    if (next === "{" || next === ":") return true;
  }
  return false;
}

const sources = new Map<string, string | null>();
function codeOf(file: string): string | null {
  if (!sources.has(file)) {
    const path = join(ROOT, file);
    sources.set(file, existsSync(path) ? withoutComments(readFileSync(path, "utf8")) : null);
  }
  return sources.get(file) ?? null;
}

/** Every tip the app can show, each id once: the collections' and the releases'. */
function everyTip(): Tip[] {
  const byId = new Map<string, Tip>();
  const all = [
    ...TIP_COLLECTIONS.flatMap((c) => c.tips),
    ...RELEASE_HIGHLIGHTS.flatMap((r) => r.tips),
  ];
  for (const tip of all) if (!byId.has(tip.id)) byId.set(tip.id, tip);
  return [...byId.values()];
}

describe("what counts as declaring a name", () => {
  const sample = withoutComments(
    [
      "import {",
      "  importedName,",
      '} from "./elsewhere";',
      "// lostHandler( was here once",
      "/** See lostHandler: gone. */",
      "export function topLevel(a: number): number {",
      "  return helper(a);",
      "}",
      "function* steps() {}",
      "export const TABLE = { rowKey: 1,",
      "  otherKey: () => 2,",
      "};",
      "export class Widget {",
      "  private field = 3;",
      "  optional?: string;",
      "  private readonly arrow = (): void => {",
      "    calledAtLineStart(this.field);",
      "    chained(1)",
      "      .then(() => undefined);",
      "    this.viaThis();",
      "    if (compared === 3) return;",
      "  };",
      "  get shown(): boolean {",
      "    return true;",
      "  }",
      "  private async manyLines<T extends string>(",
      "    first: T,",
      "    second: (x: number) => void,",
      "  ): Promise<void> {",
      "    await wait(first, second);",
      "  }",
      "  bare() {",
      "    notebookCommand(",
      '      "copy-page-link",',
      "      () => undefined,",
      "    );",
      '    addCommand({ id: "show-tips" });',
      '    const label = "not-a-command";',
      "    return label;",
      "  }",
      "}",
      "interface Callbacks {",
      "  onTap?(x: number): void;",
      "  onHold: () => void;",
      "}",
    ].join("\n"),
  );

  it("takes functions, classes, constants, methods, accessors, fields and keys", () => {
    for (const name of [
      "topLevel",
      "steps",
      "TABLE",
      "otherKey",
      "Widget",
      "field",
      "optional",
      "arrow",
      "shown",
      "manyLines",
      "bare",
      "Callbacks",
      "onTap",
      "onHold",
    ]) {
      expect(declares(sample, name), name).toBe(true);
    }
  });

  it("takes a command's id where a command is registered with it", () => {
    expect(declares(sample, "copy-page-link")).toBe(true);
    expect(declares(sample, "show-tips")).toBe(true);
    expect(declares(sample, "not-a-command")).toBe(false);
  });

  it("refuses a name that is only imported, mentioned in a comment, called or compared", () => {
    for (const name of [
      "importedName",
      "lostHandler",
      "helper",
      "calledAtLineStart",
      "chained",
      "viaThis",
      "compared",
      "wait",
    ]) {
      expect(declares(sample, name), name).toBe(false);
    }
  });
});

describe("the code behind the tips", () => {
  const tips = everyTip();

  it("is named by every tip", () => {
    expect(tips.length).toBeGreaterThan(100);
    expect(tips.filter((tip) => tip.handlers.length === 0).map((tip) => tip.id)).toEqual([]);
  });

  it("is written as a source file and a name, never the tip's own picture or words", () => {
    const bad: string[] = [];
    for (const tip of tips) {
      for (const handler of tip.handlers) {
        const parts = HANDLER.exec(handler);
        if (!parts || NOT_A_HANDLER.test(parts[1])) bad.push(`${tip.id}: ${handler}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("is still there: the file exists and declares the name", () => {
    const gone: string[] = [];
    for (const tip of tips) {
      for (const handler of tip.handlers) {
        const parts = HANDLER.exec(handler);
        if (!parts) continue;
        const code = codeOf(parts[1]);
        if (code === null) gone.push(`${tip.id}: no file ${parts[1]}`);
        else if (!declares(code, parts[2])) gone.push(`${tip.id}: ${handler} is not declared`);
      }
    }
    expect(gone).toEqual([]);
  });

  it("lists no code for a tip that does not exist", () => {
    const ids = new Set(tips.map((tip) => tip.id));
    expect(Object.keys(TIP_HANDLERS).filter((id) => !ids.has(id))).toEqual([]);
  });
});
