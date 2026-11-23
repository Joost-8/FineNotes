// The pure parts of scripts/gates.mjs: the steps, in order, and its options.
// tests/scripts/gates-lib.test.ts pins that CI runs every step listed here.

/**
 * What `npm run gates` runs, in this order. `name` is what --only and --skip
 * take and what the log file is called; `script` is the npm script.
 */
export const STEPS = [
  { name: "format", script: "format:check" },
  { name: "lint", script: "lint" },
  { name: "lint-review", script: "lint:review" },
  { name: "lint-css", script: "lint:css" },
  { name: "coverage-include", script: "check:coverage-include" },
  { name: "file-size", script: "check:file-size" },
  { name: "css-classes", script: "check:css-classes" },
  { name: "languages", script: "languages:check" },
  { name: "typecheck", script: "typecheck" },
  { name: "test", script: "test" },
  { name: "build", script: "build" },
];

const names = (value) =>
  value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

/**
 * The options of `npm run gates -- …`: `--only a,b`, `--skip a,b` (also
 * `--only=a,b`), `--keep-going`, `--list`, `--help`. Anything else is an error.
 */
export function parseGateArgs(argv) {
  const options = { only: null, skip: [], keepGoing: false, list: false, help: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (flag === "--only" || flag === "--skip") {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith("--")) {
        options.errors.push(`${flag} needs step names, such as ${flag} lint,test`);
        if (value !== undefined) i -= 1;
      } else if (flag === "--only") {
        options.only = [...(options.only ?? []), ...names(value)];
      } else {
        options.skip.push(...names(value));
      }
    } else if (flag === "--keep-going") {
      options.keepGoing = true;
    } else if (flag === "--list") {
      options.list = true;
    } else if (flag === "--help" || flag === "-h") {
      options.help = true;
    } else {
      options.errors.push(`unknown option ${argv[i]}`);
    }
  }
  return options;
}

/**
 * The steps to run, in gate order whatever order they were named in, and the
 * names that match no step. A step answers to its name and to its npm script.
 */
export function selectSteps(steps, { only, skip }) {
  const is = (step, name) => step.name === name || step.script === name;
  const unknown = [...(only ?? []), ...skip].filter(
    (name) => !steps.some((step) => is(step, name)),
  );
  const chosen = steps.filter(
    (step) =>
      (only === null || only.some((name) => is(step, name))) &&
      !skip.some((name) => is(step, name)),
  );
  return { steps: chosen, unknown: [...new Set(unknown)] };
}

/** The last `count` lines of a log, without the empty lines that end it. */
export function lastLines(text, count) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n");
  return lines.slice(-count).join("\n");
}

/** The lines of a log that a step wrote for the person running the gates. */
export function noteLines(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.startsWith("note:"));
}

/** One line per step: its name, ok or FAILED, and the seconds it took. */
export function stepLine(name, ok, seconds, width = 18) {
  return `${name.padEnd(width)}${ok ? "ok    " : "FAILED"}  ${seconds.toFixed(1).padStart(6)}s`;
}
