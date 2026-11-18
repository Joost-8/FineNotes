// Pure parts of `npm run sponsors` (scripts/sponsors.mjs), tested in
// tests/scripts/sponsors-lib.test.ts.

export const README_START = "<!-- sponsors:start -->";
export const README_END = "<!-- sponsors:end -->";

/**
 * The list after a fetch: everyone already listed stays, in their place,
 * with the name their profile shows now (a sponsor who stopped keeps theirs);
 * new sponsors are added at the end, waiting for a release (`release: ""`).
 * `fetched` holds public sponsors only: the query never asks for private ones.
 */
export function mergeSponsors(list, fetched) {
  const now = new Map(fetched.map((sponsor) => [sponsor.login.toLowerCase(), sponsor]));
  const known = new Set(list.map((sponsor) => sponsor.login.toLowerCase()));
  const kept = list.map((sponsor) => {
    const current = now.get(sponsor.login.toLowerCase());
    return current ? { ...sponsor, name: current.name ?? "" } : sponsor;
  });
  const added = fetched
    .filter((sponsor) => !known.has(sponsor.login.toLowerCase()))
    .map((sponsor) => ({ login: sponsor.login, name: sponsor.name ?? "", release: "" }));
  return [...kept, ...added];
}

/** Stamp everyone still waiting with the release that first thanks them. */
export function stampRelease(list, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a release version: ${version}`);
  return list.map((sponsor) =>
    sponsor.release === "" ? { ...sponsor, release: version } : sponsor,
  );
}

/** The README's sponsor avatars, newest first, each linking to the profile. */
export function readmeBlock(list) {
  if (list.length === 0) return "";
  const avatars = [...list].reverse().map((sponsor) => {
    const name = escapeHtml(sponsor.name.trim() || sponsor.login);
    const login = encodeURIComponent(sponsor.login);
    return (
      `<a href="https://github.com/${login}" title="${name}">` +
      `<img src="https://github.com/${login}.png?size=96" width="48" height="48" alt="${name}"></a>`
    );
  });
  return `**Thank you, sponsors!**\n\n${avatars.join("\n")}`;
}

/** `readme` with the text between the two markers replaced by `block`. */
export function replaceBlock(readme, block) {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start < 0 || end < start) throw new Error("README.md has no sponsors markers");
  // The blank line after the marker is Prettier's: Markdown after an HTML comment.
  const inner = block === "" ? "\n" : `\n\n${block}\n`;
  return readme.slice(0, start + README_START.length) + inner + readme.slice(end);
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}
