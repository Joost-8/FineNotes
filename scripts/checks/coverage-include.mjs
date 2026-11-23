// A pure module that is not in vitest.config.mts's coverage `include` list is
// silently uncovered: its tests can vanish and no threshold notices.
//
//   npm run check:coverage-include                       the check
//   npm run check:coverage-include -- --write-baseline   record today's gaps
//
// coverage-include.baseline.json names the directories whose own .ts files
// must all be in the list (not their subfolders: name those too), and the
// files that were out of it when the check was added. It fails on a file that
// is in neither, on a baseline entry that is listed by now or gone, and on a
// coverage entry that names no file (a rename leaves one behind).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coverageGaps, fullyListedDirectories, parseCoverageInclude } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const baselinePath = path.join(here, "coverage-include.baseline.json");
const BASELINE = "scripts/checks/coverage-include.baseline.json";

const isSource = (name) => name.endsWith(".ts") && !name.endsWith(".d.ts");
const filesIn = (directory) =>
  existsSync(path.join(root, directory))
    ? readdirSync(path.join(root, directory), { withFileTypes: true })
        .filter((entry) => entry.isFile() && isSource(entry.name))
        .map((entry) => `${directory}/${entry.name}`)
    : [];
const walk = (directory) =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(`${directory}/${entry.name}`)
      : isSource(entry.name)
        ? [`${directory}/${entry.name}`]
        : [],
  );

const include = parseCoverageInclude(readFileSync(path.join(root, "vitest.config.mts"), "utf8"));
const allFiles = walk("src");
const saved = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, "utf8"))
  : { directories: fullyListedDirectories(allFiles, include), unlisted: [] };
const files = saved.directories.flatMap(filesIn);

if (process.argv.includes("--write-baseline")) {
  const { missing } = coverageGaps({ files, allFiles, include, baseline: [] });
  const next = { directories: [...saved.directories].sort(), unlisted: missing };
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `coverage-include: wrote ${BASELINE} (${next.directories.length} directories, ${missing.length} unlisted files)`,
  );
  process.exit(0);
}

const { missing, stale, dangling } = coverageGaps({
  files,
  allFiles,
  include,
  baseline: saved.unlisted,
});

if (missing.length + stale.length + dangling.length === 0) {
  console.log(
    `coverage-include: ok (${files.length} files in ${saved.directories.length} directories, ${include.length} coverage entries)`,
  );
  process.exit(0);
}

const list = (items) => items.map((item) => `    ${item}`).join("\n");
if (missing.length > 0) {
  console.error(
    `coverage-include: ${missing.length} file(s) not in the coverage list:\n${list(missing)}\n` +
      "  Their directory is one where every module is covered, so a module left out is\n" +
      "  silently untested. Add each path to `coverage.include` in vitest.config.mts, with\n" +
      '  tests. If a file cannot be unit-tested (a worker, DOM glue), add it to "unlisted" in\n' +
      `  ${BASELINE} in the same pull request, so the reviewer sees it.\n`,
  );
}
if (stale.length > 0) {
  console.error(
    `coverage-include: ${stale.length} baseline entry(ies) no longer needed:\n${list(stale)}\n` +
      `  Each is in the coverage list by now, or the file is gone. Remove it from "unlisted" in\n` +
      `  ${BASELINE}.\n`,
  );
}
if (dangling.length > 0) {
  console.error(
    `coverage-include: ${dangling.length} coverage entry(ies) name no file:\n${list(dangling)}\n` +
      "  A renamed or deleted module leaves its old path behind, and the new file is then\n" +
      "  uncovered. Fix the path in `coverage.include` in vitest.config.mts, or remove it.\n",
  );
}
process.exit(1);
