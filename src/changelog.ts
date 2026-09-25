// "What's new": the release notes cut out of the bundled CHANGELOG.md. Pure,
// so it is tested without Obsidian.
//
// A release starts at a level-two heading naming a three-part version in
// brackets (`## [0.9.0] - 2026-09-24`) and runs to the next level-two
// heading of any kind. The preamble, `## [Unreleased]` and other level-two
// sections are not releases, and are left out with everything under them.

export interface ChangelogSection {
  version: string;
  /** The release's heading and its notes, trimmed. */
  markdown: string;
}

const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\]/;
const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

/** Every release in the file, in the order the file lists them (newest first). */
export function parseChangelogSections(markdown: string): ChangelogSection[] {
  const releases: Array<{ version: string; lines: string[] }> = [];
  // The lines of the release being read; null outside one.
  let open: string[] | null = null;
  markdown.split("\n").forEach((line) => {
    if (!line.startsWith("## ")) {
      open?.push(line);
      return;
    }
    const heading = RELEASE_HEADING.exec(line);
    const release = heading ? { version: heading[1], lines: [line] } : null;
    if (release) releases.push(release);
    open = release?.lines ?? null;
  });
  return releases.map(({ version, lines }) => ({ version, markdown: lines.join("\n").trim() }));
}

/**
 * Orders `x.y.z` versions: negative, zero or positive as `a` is older, the
 * same or newer. A missing part counts as 0; a fourth part is ignored.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  for (let part = 0; part < 3; part++) {
    const difference = Number(left[part] ?? 0) - Number(right[part] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The notes to show after an update: every release newer than `lastSeen`,
 * newest first, or "" if there is none. When the plugin has no usable
 * record of what was seen (a first run, or a malformed value), only the
 * newest release is shown, rather than the whole history.
 */
export function changelogSince(markdown: string, lastSeen: string | null): string {
  const releases = parseChangelogSections(markdown);
  const known = lastSeen !== null && PLAIN_VERSION.test(lastSeen);
  const fresh = known
    ? releases.filter((release) => compareVersions(release.version, lastSeen) > 0)
    : releases.slice(0, 1);
  return joinReleases(fresh);
}

/** Every release's notes, for the "What's new" command. */
export function releasedChangelog(markdown: string): string {
  return joinReleases(parseChangelogSections(markdown));
}

function joinReleases(releases: ChangelogSection[]): string {
  return releases.map((release) => release.markdown).join("\n\n");
}
