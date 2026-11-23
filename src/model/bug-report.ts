/**
 * Reporting a bug: the GitHub form a report opens, filled in with what
 * FineNotes knows for certain (its own version, Obsidian's, the kind of
 * device), and what the guide already says about it.
 *
 * Nothing is sent by FineNotes: the link only opens GitHub's form, where the
 * reporter sees every filled-in field before posting.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import { type GuideEntry, searchGuide } from "./finenotes-guide";

const REPO_URL = "https://github.com/Joost-8/FineNotes";

/**
 * The bug form's Device choices (`.github/ISSUE_TEMPLATE/bug_report.yml`,
 * field `device`), exactly as written there: GitHub fills a dropdown only
 * from an option's own text.
 */
export const BUG_FORM_DEVICES = [
  "iPad with Apple Pencil",
  "iPad with another stylus",
  "iPad without a stylus",
  "iPhone",
  "Android tablet or phone",
  "Desktop (Windows)",
  "Desktop (macOS)",
  "Desktop (Linux)",
] as const;

export type BugFormDevice = (typeof BUG_FORM_DEVICES)[number];

/** What Obsidian's `Platform` says about the device. */
export interface DeviceFacts {
  isIosApp: boolean;
  isAndroidApp: boolean;
  isPhone: boolean;
  isMacOS: boolean;
  isWin: boolean;
  isLinux: boolean;
}

/**
 * The form's Device choice for this device, or null where FineNotes cannot
 * tell (an iPad: with or without a Pencil). A wrong guess is worse than none.
 */
export function bugFormDevice(device: DeviceFacts): BugFormDevice | null {
  if (device.isIosApp) return device.isPhone ? "iPhone" : null;
  if (device.isAndroidApp) return "Android tablet or phone";
  if (device.isWin) return "Desktop (Windows)";
  if (device.isMacOS) return "Desktop (macOS)";
  if (device.isLinux) return "Desktop (Linux)";
  return null;
}

/** What a report is filled in with. */
export interface BugReportFacts {
  /** What the reporter typed, as the report's title; may be empty. */
  title: string;
  /** FineNotes' version, from its manifest. */
  plugin: string;
  /** Obsidian's version (`apiVersion`). */
  obsidian: string;
  device: BugFormDevice | null;
  /** The system and its version ("iPadOS 26.6.1"), from `osName`; null when unknown. */
  os?: string | null;
}

/**
 * What the device says about its system, read where it is trustworthy: on
 * the iPad, iPhone and Android, Capacitor's Device plugin (the user agent of
 * an iPad claims "Mac OS X 10_15_7" whatever it runs); on a computer,
 * Electron's `process.getSystemVersion()`.
 */
export interface OsFacts {
  system: "ios" | "android" | "windows" | "macos" | "linux";
  /** As the platform gives it ("26.6.1", "10.0.26200", "15.1.0"); null when unread. */
  version: string | null;
  /** An iPad rather than an iPhone: iPadOS. */
  tablet?: boolean;
}

/** A version that is only numbers and dots, at most four parts: anything else is not trusted. */
const VERSION = /^\d{1,5}(\.\d{1,6}){0,3}$/;

/**
 * The system as the bug form's Versions field wants it: "iPadOS 26.6.1",
 * "Android 15", "Windows 11 (build 26200)", "macOS 15.1". The name alone when
 * the version is missing or does not look like one: never a wrong number.
 * Linux gives only its kernel's version, which says nothing about the
 * distribution, so it is the name alone.
 */
export function osName(facts: OsFacts): string {
  const version = facts.version?.trim() ?? "";
  const ok = VERSION.test(version);
  switch (facts.system) {
    case "ios": {
      const name = facts.tablet ? "iPadOS" : "iOS";
      return ok ? `${name} ${version}` : name;
    }
    case "android":
      return ok ? `Android ${version}` : "Android";
    case "windows": {
      // Windows 11 still says 10.0; its builds start at 22000.
      const [major, , build] = version.split(".").map(Number);
      if (!ok || major !== 10 || !Number.isFinite(build)) return "Windows";
      return `${build >= 22000 ? "Windows 11" : "Windows 10"} (build ${build})`;
    }
    case "macos":
      return ok ? `macOS ${version.replace(/\.0$/, "")}` : "macOS";
    case "linux":
      return "Linux";
  }
}

/**
 * The versions line, in the form's own example's shape
 * ("FineNotes 2.0.0, Obsidian 1.13.8, iPadOS 26.1").
 */
export function versionsLine(facts: Pick<BugReportFacts, "plugin" | "obsidian" | "os">): string {
  const os = facts.os ? `, ${facts.os}` : "";
  return `FineNotes ${facts.plugin}, Obsidian ${facts.obsidian}${os}`;
}

/**
 * GitHub's bug form, filled in: the template by name, then fields by their
 * `id` in the form. Empty values are left out, so the form shows its own
 * placeholder there.
 */
export function bugReportUrl(facts: BugReportFacts): string {
  const params = new URLSearchParams({ template: "bug_report.yml" });
  const title = facts.title.trim().replace(/\s+/g, " ").slice(0, 200);
  if (title) params.set("title", title);
  params.set("versions", versionsLine(facts));
  if (facts.device) params.set("device", facts.device);
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

/** Guide entries that only say where to report: the report row already is that. */
const ABOUT_REPORTING = new Set(["reportBug"]);

/** What `guideAnswers` needs to know of a feature: whether it exists, and its setting. */
export type FeatureLookup = (id: string) => { setting: string | null } | null;

/**
 * What the guide says about a problem typed into Tips' search, split by how
 * it is shown: entries that are a feature of the feature index (shown as
 * that feature's row, with its switch) unless the search already showed it,
 * and the rest (shown as a link to the guide page). An entry about a setting
 * whose switch is already shown says nothing new and is left out. At most
 * `limit` in all.
 */
export function guideAnswers(
  query: string,
  shownFeatures: ReadonlySet<string>,
  lookup: FeatureLookup,
  limit = 3,
  search: (query: string, limit: number) => GuideEntry[] = searchGuide,
): { features: string[]; entries: GuideEntry[] } {
  const features: string[] = [];
  const entries: GuideEntry[] = [];
  const switches = new Set<string>();
  const cover = (id: string): void => {
    const setting = lookup(id)?.setting;
    if (setting) switches.add(setting);
  };
  for (const id of shownFeatures) cover(id);
  const said = (entry: GuideEntry): boolean =>
    (entry.settings ?? []).some((key) => switches.has(key));
  // Enough candidates for the ones left out.
  for (const entry of search(query, limit * 3 + ABOUT_REPORTING.size)) {
    if (features.length + entries.length >= limit) break;
    if (ABOUT_REPORTING.has(entry.id)) continue;
    const feature = entry.feature;
    if (feature && lookup(feature)) {
      if (!shownFeatures.has(feature) && !features.includes(feature)) {
        features.push(feature);
        cover(feature);
      }
      continue;
    }
    if (said(entry)) continue;
    entries.push(entry);
  }
  return { features, entries };
}
