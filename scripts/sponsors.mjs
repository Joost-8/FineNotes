// Brings sponsors.json and the README's sponsor avatars up to date with
// FineNotes' public GitHub sponsors.
//
//   npm run sponsors                     fetch, add new sponsors (release "")
//   npm run sponsors -- --release 2.10.0 also stamp them with that release
//   npm run sponsors -- --offline        no fetch: only stamp and redraw
//
// Needs `gh`, signed in. Private sponsors are never fetched, so never named;
// GitHub's own welcome message thanks them. Someone who stops sponsoring
// stays listed: they were thanked once and keep their place.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mergeSponsors, readmeBlock, replaceBlock, stampRelease } from "./sponsors-lib.mjs";

const MAINTAINER = "Joost-8";
const LIST = "sponsors.json";
const README = "README.md";

const args = process.argv.slice(2);
const releaseAt = args.indexOf("--release");
const release = releaseAt >= 0 ? args[releaseAt + 1] : null;
const offline = args.includes("--offline");

function fetchSponsors() {
  const query = `query($login: String!, $after: String) {
    user(login: $login) {
      sponsors(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ... on User { login name } ... on Organization { login name } }
      }
    }
  }`;
  const sponsors = [];
  let after = null;
  for (;;) {
    const fields = ["-f", `query=${query}`, "-F", `login=${MAINTAINER}`];
    if (after) fields.push("-F", `after=${after}`);
    const out = execFileSync("gh", ["api", "graphql", ...fields], { encoding: "utf8" });
    const page = JSON.parse(out).data.user.sponsors;
    sponsors.push(...page.nodes.filter((node) => node && node.login));
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  // GitHub lists the newest first; the file keeps them oldest first.
  return sponsors.reverse();
}

let list = JSON.parse(readFileSync(LIST, "utf8"));
const before = list.length;
if (!offline) list = mergeSponsors(list, fetchSponsors());
if (release) list = stampRelease(list, release);
writeFileSync(LIST, JSON.stringify(list, null, 2) + "\n");
const readme = readFileSync(README, "utf8");
writeFileSync(README, replaceBlock(readme, readmeBlock(list)));

const waiting = list.filter((sponsor) => sponsor.release === "").length;
console.log(
  `${list.length} sponsors (${list.length - before} new)` +
    (release ? `, stamped ${release}` : `, ${waiting} waiting for a release`),
);
