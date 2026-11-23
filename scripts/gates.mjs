// Everything CI runs, in CI's order, as one command to run before a pull
// request.
//
//   npm run gates                          every step; stops at the first failure
//   npm run gates -- --only lint,test      just these steps
//   npm run gates -- --skip build          all but these
//   npm run gates -- --keep-going          run them all, then say which failed
//   npm run gates -- --list                the step names
//
// Each step's whole output goes to node_modules/.cache/gates/<step>.log; the
// console gets one line per step. A failure prints the end of that step's log
// and where the log is. The steps are in gates-lib.mjs.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS, lastLines, noteLines, parseGateArgs, selectSteps, stepLine } from "./gates-lib.mjs";

const TAIL = 40;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logDir = path.join(root, "node_modules", ".cache", "gates");
const stepNames = STEPS.map((step) => step.name).join(", ");

const options = parseGateArgs(process.argv.slice(2));
const { steps, unknown } = selectSteps(STEPS, options);
if (options.help) {
  console.log(
    "npm run gates [-- --only a,b] [-- --skip a,b] [-- --keep-going] [-- --list]\n" +
      `Steps, in order: ${stepNames}`,
  );
  process.exit(0);
}
if (options.list) {
  for (const step of STEPS) console.log(`${step.name.padEnd(18)}npm run ${step.script}`);
  process.exit(0);
}
if (options.errors.length > 0 || unknown.length > 0 || steps.length === 0) {
  for (const error of options.errors) console.error(`gates: ${error}`);
  if (unknown.length > 0) console.error(`gates: no step called ${unknown.join(", ")}`);
  if (steps.length === 0) console.error("gates: nothing left to run");
  console.error(`gates: the steps are ${stepNames}`);
  process.exit(2);
}

mkdirSync(logDir, { recursive: true });
const started = Date.now();
const failed = [];
for (const step of steps) {
  const logPath = path.join(logDir, `${step.name}.log`);
  const log = openSync(logPath, "w");
  const stepStarted = Date.now();
  // Through the shell, so `npm` resolves on Windows (npm.cmd) and Linux alike.
  const result = spawnSync(`npm run ${step.script}`, {
    cwd: root,
    shell: true,
    stdio: ["ignore", log, log],
  });
  if (result.error) writeSync(log, `\ngates: could not run the step: ${result.error.message}\n`);
  closeSync(log);
  const ok = result.status === 0 && !result.error;
  console.log(stepLine(step.name, ok, (Date.now() - stepStarted) / 1000));
  const output = readFileSync(logPath, "utf8");
  for (const note of noteLines(output)) console.log(`  ${note}`);
  if (ok) continue;
  failed.push({ step, logPath });
  if (options.keepGoing) continue;
  console.log(`\n--- last ${TAIL} lines of ${step.name} ---`);
  console.log(lastLines(output, TAIL));
  console.log(`--- full log: ${logPath} ---`);
  break;
}

const seconds = Math.round((Date.now() - started) / 1000);
if (failed.length > 0) {
  console.error(
    `\ngates: FAILED at ${failed.map(({ step }) => step.name).join(", ")} after ${seconds}s`,
  );
  if (options.keepGoing) {
    for (const { step, logPath } of failed) console.error(`  ${step.name}: ${logPath}`);
  }
  process.exit(1);
}
const left = STEPS.filter((step) => !steps.includes(step)).map((step) => step.name);
console.log(
  left.length === 0
    ? `\ngates: all ${steps.length} steps passed in ${seconds}s`
    : `\ngates: ${steps.length} of ${STEPS.length} steps passed in ${seconds}s (not run: ${left.join(", ")})`,
);
