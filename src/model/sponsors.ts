// The sponsors Home's what's-new card thanks. Pure, so it is tested without
// Obsidian.
//
// `sponsors.json` at the repository's root lists every public GitHub sponsor
// FineNotes has had, oldest first. `npm run sponsors` (scripts/sponsors.mjs)
// adds new ones with `release: ""`, and the release routine stamps those with
// the version they ship in. A sponsor whose release is newer than the news
// the card counts from is new: the card thanks them first, then everyone
// before them. A release with no new sponsor thanks nobody.

import { compareVersions } from "../changelog";
import list from "../../sponsors.json";

export interface Sponsor {
  /** GitHub login: the profile is github.com/<login>. */
  login: string;
  /** The name on their profile, "" when they set none. */
  name: string;
  /** The first release that thanks them; "" until a release does. */
  release: string;
}

export interface SponsorThanks {
  /** Joined since the news began, newest first. */
  fresh: readonly Sponsor[];
  /** Everyone before them, newest first. */
  earlier: readonly Sponsor[];
}

export const SPONSORS: readonly Sponsor[] = list;

/** Where the card's heart goes: the same page as `fundingUrl` in manifest.json. */
export const SPONSOR_PAGE = "https://github.com/sponsors/Joost-8";

/** What the card calls a sponsor: their name, or their login without one. */
export function sponsorName(sponsor: Sponsor): string {
  return sponsor.name.trim() || sponsor.login;
}

/**
 * Who to thank in the news counted from `since` up to `current`, or null
 * when nobody joined in that span. `since` "" is no news at all. A sponsor
 * not yet stamped (`release` "") ships with this build, so counts as new.
 */
export function sponsorThanks(
  since: string,
  current: string,
  sponsors: readonly Sponsor[] = SPONSORS,
): SponsorThanks | null {
  if (since === "") return null;
  const isFresh = (sponsor: Sponsor): boolean =>
    sponsor.release === "" ||
    (compareVersions(sponsor.release, since) > 0 && compareVersions(sponsor.release, current) <= 0);
  const newestFirst = [...sponsors].reverse();
  const fresh = newestFirst.filter(isFresh);
  if (fresh.length === 0) return null;
  return { fresh, earlier: newestFirst.filter((sponsor) => !isFresh(sponsor)) };
}

/** Names as a list in the reader's language ("A, B and C"), when the platform can. */
export function joinNames(names: readonly string[], locale: string): string {
  // Intl.ListFormat is ES2021, past the lib this project targets; iPadOS has it from 14.5.
  const { ListFormat } = Intl as unknown as { ListFormat?: ListFormatConstructor };
  try {
    if (ListFormat)
      return new ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  } catch {
    // An unknown locale: fall through to commas.
  }
  return names.join(", ");
}

type ListFormatConstructor = new (
  locale: string,
  options: { style: string; type: string },
) => { format(names: readonly string[]): string };
