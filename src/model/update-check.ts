/**
 * "A newer FineNotes is out" (2.4.2). Once a day the plugin reads the
 * version in `manifest.json` on GitHub's `main`, the same file Obsidian's
 * own updater reads, so a beta (which never touches `main`) is never
 * announced. It only says so: updating stays Obsidian's, on FineNotes' page
 * under Community plugins, which every Update button opens. "Update
 * available" comes back every other day until then (2.5.1), unless the user
 * keeps to the dot alone (Settings › Advanced › Updates).
 *
 * What was last read is kept per device (`app.saveLocalStorage`), not in
 * the synced settings, so two devices never write the same file for it.
 *
 * PURE: no DOM, no Obsidian, no network.
 */

/** Where the released version is read: `main`'s manifest, as Obsidian's updater reads it. */
export const UPDATE_MANIFEST_URL =
  "https://raw.githubusercontent.com/Joost-8/FineNotes/main/manifest.json";

/** Obsidian's own page for the plugin, with its Update button. */
export const PLUGIN_PAGE_URL = "obsidian://show-plugin?id=finenotes";

/** How often the version is read at most. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** How long "Update available" stays away once shown, until the update is installed. */
export const UPDATE_REMIND_INTERVAL_MS = 2 * UPDATE_CHECK_INTERVAL_MS;

/**
 * What the last check found: when it ran (ms since 1970) and the version on
 * `main`; and the version whose "Update available" this device last showed,
 * and when.
 */
export interface UpdateRecord {
  checkedAt: number;
  latest: string;
  announced?: string;
  announcedAt?: number;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** A version as numbers and its pre-release tag, or null when it is not `x.y.z[-tag]`. */
function parse(version: string): { parts: number[]; pre: string | null } | null {
  const m = VERSION_RE.exec(version.trim());
  if (!m) return null;
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/**
 * Below, equal to or above zero as `a` is older than, the same as or newer
 * than `b`; a pre-release is older than its release (2.5.0-beta.1 < 2.5.0).
 * Null when either is not a version.
 */
export function compareVersions(a: string, b: string): number | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] - y.parts[i];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre.localeCompare(y.pre, "en", { numeric: true });
}

/** The version in a downloaded `manifest.json`, or null when it holds none. */
export function versionOfManifest(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const version = (json as Record<string, unknown>).version;
  return typeof version === "string" && parse(version) ? version.trim() : null;
}

/** A stored record as a record; anything else reads as "never checked". */
export function updateRecordOf(value: unknown): UpdateRecord {
  if (typeof value === "object" && value !== null) {
    const { checkedAt, latest, announced, announcedAt } = value as Record<string, unknown>;
    if (typeof checkedAt === "number" && Number.isFinite(checkedAt) && typeof latest === "string") {
      if (typeof announced !== "string") return { checkedAt, latest };
      return typeof announcedAt === "number" && Number.isFinite(announcedAt)
        ? { checkedAt, latest, announced, announcedAt }
        : { checkedAt, latest, announced };
    }
  }
  return { checkedAt: 0, latest: "" };
}

/** Whether it is time to read the version again: a day since, or a clock that went back. */
export function checkDue(record: UpdateRecord, now: number): boolean {
  return now - record.checkedAt >= UPDATE_CHECK_INTERVAL_MS || record.checkedAt > now;
}

/** The newer version to announce, or null when this one is as new (or nothing is known). */
export function newerVersion(record: UpdateRecord, current: string): string | null {
  const order = compareVersions(record.latest, current);
  return order !== null && order > 0 ? record.latest : null;
}

/**
 * The newer version whose "Update available" is due on this device, or
 * null: said at once for a new version, then again every other day until it
 * is installed (a record from before `announcedAt` counts as due). The dot
 * stays throughout.
 */
export function toAnnounce(record: UpdateRecord, current: string, now: number): string | null {
  const newer = newerVersion(record, current);
  if (newer === null) return null;
  if (record.announced !== newer || record.announcedAt === undefined) return newer;
  const since = now - record.announcedAt;
  // A clock that went back must not silence it for good.
  return since >= UPDATE_REMIND_INTERVAL_MS || since < 0 ? newer : null;
}
