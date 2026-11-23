// The pure parts of the merge checks in this folder: no file system, no git.
// The scripts beside this file do the reading; tests/scripts/checks-lib.test.ts
// covers what is here.

// ---------------------------------------------------------------------------
// coverage-include: the hand-kept coverage list in vitest.config.mts
// ---------------------------------------------------------------------------

/**
 * The strings of `coverage.include` in the text of vitest.config.mts, in the
 * order they are written. Comments inside the list are skipped.
 */
export function parseCoverageInclude(configText) {
  const coverageAt = configText.search(/\bcoverage\s*:/);
  if (coverageAt < 0) throw new Error("vitest.config.mts has no `coverage:` block");
  const opener = /\binclude\s*:\s*\[/.exec(configText.slice(coverageAt));
  if (!opener) throw new Error("vitest.config.mts has no `include: [` list under `coverage:`");
  const entries = [];
  let i = coverageAt + opener.index + opener[0].length;
  while (i < configText.length) {
    const ch = configText[i];
    if (ch === "]") return entries;
    if (ch === "/" && configText[i + 1] === "/") {
      const end = configText.indexOf("\n", i);
      i = end < 0 ? configText.length : end + 1;
    } else if (ch === "/" && configText[i + 1] === "*") {
      const end = configText.indexOf("*/", i + 2);
      i = end < 0 ? configText.length : end + 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const end = configText.indexOf(ch, i + 1);
      if (end < 0) break;
      entries.push(configText.slice(i + 1, end));
      i = end + 1;
    } else {
      i += 1;
    }
  }
  throw new Error("the coverage `include` list in vitest.config.mts never closes");
}

/** True when a coverage entry is a pattern, not one file's path. */
export function isGlob(entry) {
  return /[*?{[]/.test(entry);
}

/** A coverage glob (`**`, `*`, `?`, `{a,b}`) as a regular expression over posix paths. */
export function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (ch === "*") {
      source += "[^/]*";
    } else if (ch === "?") {
      source += "[^/]";
    } else if (ch === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) {
        source += "\\{";
      } else {
        const options = glob.slice(i + 1, end).split(",");
        source += `(?:${options.map((option) => globToRegExp(option).source.slice(1, -1)).join("|")})`;
        i = end;
      }
    } else {
      source += /[.+^$()|[\]\\}]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return new RegExp(`^${source}$`);
}

/** A function that says whether a posix path is in the coverage list. */
export function includeMatcher(include) {
  const exact = new Set(include.filter((entry) => !isGlob(entry)));
  const globs = include.filter(isGlob).map(globToRegExp);
  return (file) => exact.has(file) || globs.some((glob) => glob.test(file));
}

/**
 * What the coverage list misses.
 *
 * - `files`: every source file under the watched directories (posix paths).
 * - `allFiles`: every source file there is, to find entries that name nothing.
 * - `baseline`: files known to be out of the list when the check was added.
 *
 * Returns the files that are in neither list (`missing`), baseline entries
 * that are listed by now or no longer exist (`stale`), and coverage entries
 * that name no file (`dangling`: a renamed module leaves one behind).
 */
export function coverageGaps({ files, allFiles, include, baseline }) {
  const listed = includeMatcher(include);
  const known = new Set(baseline);
  const present = new Set(files);
  const everything = new Set(allFiles);
  return {
    missing: files.filter((file) => !listed(file) && !known.has(file)).sort(),
    stale: baseline.filter((file) => !present.has(file) || listed(file)).sort(),
    dangling: include.filter((entry) => !isGlob(entry) && !everything.has(entry)).sort(),
  };
}

/**
 * The directories (posix, no trailing slash) whose own `.ts` files are all in
 * the coverage list: where a new file is expected to be listed too.
 */
export function fullyListedDirectories(allFiles, include) {
  const listed = includeMatcher(include);
  const byDirectory = new Map();
  for (const file of allFiles) {
    const directory = file.slice(0, file.lastIndexOf("/"));
    byDirectory.set(directory, (byDirectory.get(directory) ?? true) && listed(file));
  }
  return [...byDirectory]
    .filter(([, all]) => all)
    .map(([directory]) => directory)
    .sort();
}

// ---------------------------------------------------------------------------
// file-size: line caps on the largest files
// ---------------------------------------------------------------------------

/** Lines in a file's text, as `wc -l` counts them (a last line without a newline counts). */
export function countLines(text) {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/** The files over their cap, largest overrun first. `counts` may lack a file that is gone. */
export function overCaps(caps, counts) {
  return Object.entries(caps)
    .filter(([file, cap]) => (counts[file] ?? 0) > cap)
    .map(([file, cap]) => ({ file, cap, lines: counts[file], over: counts[file] - cap }))
    .sort((a, b) => b.over - a.over);
}

// ---------------------------------------------------------------------------
// css-classes: one class name introduced on two branches
// ---------------------------------------------------------------------------

const CLASS_NAME = /\.(goodobsidian-[a-z0-9-]+)/g;
// At-rules whose block holds style rules. Any other at-rule (keyframes,
// font-face, property) defines no class.
const GROUPING = /^@(media|supports|container|layer|scope|starting-style|document)\b/;

const squeeze = (text) => text.replace(/\s+/g, " ").trim();

/** CSS with every comment replaced by a space; strings are left alone. */
export function stripCssComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? css.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      const end = stringEnd(css, i);
      out += css.slice(i, end);
      i = end;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

// The index just past the string that opens at `start`.
function stringEnd(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) i += text[i] === "\\" ? 2 : 1;
  return Math.min(i + 1, text.length);
}

// The index of the `}` that closes the `{` at `open`.
function blockEnd(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = stringEnd(text, i);
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}" && --depth === 0) return i;
    i += 1;
  }
  return text.length;
}

function collectRules(text, context, rules) {
  let i = 0;
  let start = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = stringEnd(text, i);
    } else if (ch === ";") {
      i += 1;
      start = i;
    } else if (ch === "{") {
      const prelude = squeeze(text.slice(start, i));
      const end = blockEnd(text, i);
      const inner = text.slice(i + 1, end);
      if (prelude.startsWith("@")) {
        if (GROUPING.test(prelude)) collectRules(inner, [...context, prelude], rules);
      } else {
        rules.push({ selector: prelude, context, body: squeeze(inner) });
        // Nested rules: their selectors count too.
        if (inner.includes("{")) collectRules(inner, [...context, prelude], rules);
      }
      i = end + 1;
      start = i;
    } else {
      i += 1;
    }
  }
}

/**
 * Every style rule of a stylesheet: its selector, the at-rules (and parent
 * rules) around it, and its declarations, each with whitespace squeezed.
 */
export function cssRules(css) {
  const rules = [];
  collectRules(stripCssComments(css), [], rules);
  return rules;
}

/** The `goodobsidian-*` classes a selector names. */
export function selectorClasses(selector) {
  return [...new Set([...selector.matchAll(CLASS_NAME)].map((match) => match[1]))];
}

/** The `goodobsidian-*` classes that selectors in this stylesheet name. */
export function cssClassNames(css) {
  return new Set(cssRules(css).flatMap((rule) => selectorClasses(rule.selector)));
}

/** Per class, the text of every rule whose selector names it, in file order. */
export function classRules(css) {
  const byClass = new Map();
  for (const rule of cssRules(css)) {
    const open = [...rule.context, rule.selector].join(" { ");
    const text = `${open} { ${rule.body} }${" }".repeat(rule.context.length)}`;
    for (const name of selectorClasses(rule.selector)) {
      if (!byClass.has(name)) byClass.set(name, []);
      byClass.get(name).push(text);
    }
  }
  return byClass;
}

const sameRules = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * Classes two branches both introduced since they parted, with different
 * rules. `base` is the stylesheet where they parted (the merge-base), `theirs`
 * the other branch's now, `ours` this branch's. A class both sides added with
 * identical rules (the same commit on both) is not a collision.
 */
export function classCollisions({ base, theirs, ours }) {
  const before = cssClassNames(base);
  const theirRules = classRules(theirs);
  const ourRules = classRules(ours);
  const collisions = [];
  for (const [name, mine] of ourRules) {
    if (before.has(name)) continue;
    const other = theirRules.get(name);
    if (!other || sameRules(mine, other)) continue;
    collisions.push({ name, ours: mine, theirs: other });
  }
  return collisions.sort((a, b) => a.name.localeCompare(b.name));
}
