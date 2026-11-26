// Two branches that each introduce the same CSS class for different things
// merge without a conflict, and both sets of rules then apply to both things.
//
//   npm run check:css-classes                           against origin/main
//   npm run check:css-classes -- --base origin/other    against another branch
//   npm run check:css-classes -- --head <commit>        a commit's styles.css
//                                                       instead of the one on disk
//
// It compares the goodobsidian-* classes in styles.css selectors at three
// points: where this branch and the base parted (the merge-base), the base's
// tip, and here. A class that is new here and also new on the base since they
// parted fails, unless its rules are the same on both sides. It passes with a
// note when it cannot compare (a shallow clone, no such base).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classCollisions } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const base = option("--base", "origin/main");
const head = option("--head", null);

const git = (...gitArgs) => {
  const result = spawnSync("git", gitArgs, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
};
const pass = (message) => {
  console.log(message);
  process.exit(0);
};
// A stylesheet a commit does not have counts as empty.
const sheetAt = (commit) => git("show", `${commit}:styles.css`) ?? "";

const baseTip = git("rev-parse", "--verify", "--quiet", `${base}^{commit}`)?.trim();
if (!baseTip) {
  pass(
    `note: css-classes skipped: no ${base} here to compare with ` +
      "(git fetch origin, or name a branch with --base).",
  );
}
const mergeBase = git("merge-base", head ?? "HEAD", base)?.trim();
if (!mergeBase) {
  const shallow = git("rev-parse", "--is-shallow-repository")?.trim() === "true";
  pass(
    `note: css-classes skipped: no merge-base with ${base}` +
      (shallow ? " (this clone is shallow; git fetch --unshallow to compare)." : "."),
  );
}
if (mergeBase === baseTip) {
  pass(`css-classes: ok (nothing to compare: this branch already holds all of ${base})`);
}

const collisions = classCollisions({
  base: sheetAt(mergeBase),
  theirs: sheetAt(baseTip),
  ours: head ? sheetAt(head) : readFileSync(path.join(root, "styles.css"), "utf8"),
});
if (collisions.length === 0) {
  pass(`css-classes: ok (no class is new both here and on ${base})`);
}

const shown = (rules) =>
  rules
    .slice(0, 3)
    .map((rule) => `      ${rule.length > 160 ? `${rule.slice(0, 157)}...` : rule}`)
    .concat(rules.length > 3 ? [`      (and ${rules.length - 3} more)`] : [])
    .join("\n");
console.error(
  `css-classes: ${collisions.length} class(es) are new in this branch and new on ${base} too, with different rules:\n`,
);
for (const { name, ours, theirs } of collisions) {
  console.error(`  .${name}\n    here:\n${shown(ours)}\n    on ${base}:\n${shown(theirs)}\n`);
}
console.error(
  "  After a merge both sets of rules apply to both elements, and git reports no conflict.\n" +
    "  If the two mean different things, rename the class in this branch (styles.css and\n" +
    "  wherever src/ sets it). If they are the same thing, merge or rebase onto\n" +
    `  ${base} and settle the rules there; the check then has nothing to compare.\n`,
);
process.exit(1);
