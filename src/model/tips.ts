/**
 * Tips and What's new: the catalogue, and which card Home shows. PURE.
 *
 * Collections and the tips inside them are ordered by how much they help,
 * weighted towards what people do not find on their own.
 */

import { compareVersions } from "../changelog";
import type { TextKey } from "../i18n/translate";
import type { SceneId } from "./tip-scenes";

export interface Tip {
  id: string;
  title: TextKey;
  body: TextKey;
  scene: SceneId;
  /** A pad to try the gesture on. */
  tryIt?: "shape" | "scribble";
}

export interface TipCollection {
  id: string;
  title: TextKey;
  tips: Tip[];
}

/** The tips of one release, picked when it is cut (RELEASE.md). */
export interface ReleaseHighlights {
  version: string;
  tips: Tip[];
}

function tip(id: string, scene: SceneId, tryIt?: Tip["tryIt"]): Tip {
  return {
    id,
    scene,
    tryIt,
    title: `notebooks.tips.${id}.title` as TextKey,
    body: `notebooks.tips.${id}.body` as TextKey,
  };
}

export const TIP_COLLECTIONS: readonly TipCollection[] = [
  {
    id: "gestures",
    title: "notebooks.tips.collection.gestures",
    tips: [
      tip("hold", "hold", "shape"),
      tip("scribble", "scribble", "scribble"),
      tip("circleLasso", "circleLasso"),
      tip("holdResize", "holdResize"),
      tip("arrow", "arrow"),
    ],
  },
  {
    id: "study",
    title: "notebooks.tips.collection.study",
    tips: [
      tip("coverTape", "coverTape"),
      tip("hear", "hear"),
      tip("snap", "snap"),
      tip("holdWord", "holdWord"),
      tip("calc", "calc"),
    ],
  },
  {
    id: "find",
    title: "notebooks.tips.collection.find",
    tips: [
      tip("searchInk", "searchInk"),
      tip("homeSearch", "homeSearch"),
      tip("inkLink", "inkLink"),
    ],
  },
  {
    id: "hands",
    title: "notebooks.tips.collection.hands",
    tips: [tip("undo", "undo"), tip("pullPage", "pullPage"), tip("tapColour", "tapColour")],
  },
  {
    id: "writing",
    title: "notebooks.tips.collection.writing",
    tips: [
      tip("zoomBox", "zoomBox"),
      tip("eraseLine", "eraseLine"),
      tip("typedEquation", "typedEquation"),
      tip("typeInShape", "typeInShape"),
    ],
  },
  {
    id: "selecting",
    title: "notebooks.tips.collection.selecting",
    tips: [
      tip("turnIntoText", "turnIntoText"),
      tip("pasteHere", "pasteHere"),
      tip("pinchSelection", "pinchSelection"),
      tip("turnKnob", "turnKnob"),
      tip("correctWord", "correctWord"),
    ],
  },
  {
    id: "pages",
    title: "notebooks.tips.collection.pages",
    tips: [
      tip("reorder", "reorder"),
      tip("ribbon", "ribbon"),
      tip("scan", "scan"),
      tip("importBooks", "importBooks"),
    ],
  },
];

/** Newest first. Every release with something to show adds an entry. */
export const RELEASE_HIGHLIGHTS: readonly ReleaseHighlights[] = [
  {
    version: "2.8.3",
    tips: [
      tip("typedEquation", "typedEquation"),
      tip("textTurns", "textTurns"),
      tip("lineSpacing", "lineSpacing"),
    ],
  },
];

/** Most highlights Home's card and its pager will carry. */
export const MAX_HIGHLIGHTS = 6;
/** Pictures on Home's card; the rest are one swipe further in. */
export const HOME_CARD_PICTURES = 3;

/** The newest release the highlights cover, or null. */
export function latestHighlighted(
  since: string,
  current: string,
  releases: readonly ReleaseHighlights[] = RELEASE_HIGHLIGHTS,
): string | null {
  return inRange(since, current, releases)[0]?.version ?? null;
}

function inRange(
  since: string,
  current: string,
  releases: readonly ReleaseHighlights[],
): readonly ReleaseHighlights[] {
  if (since === "") return [];
  return releases.filter(
    (release) =>
      compareVersions(release.version, since) > 0 && compareVersions(release.version, current) <= 0,
  );
}

/** What is new after `since`, up to `current`: newest first, each tip once. */
export function highlightsSince(
  since: string,
  current: string,
  releases: readonly ReleaseHighlights[] = RELEASE_HIGHLIGHTS,
): Tip[] {
  const seen = new Set<string>();
  const tips: Tip[] = [];
  for (const release of inRange(since, current, releases)) {
    for (const item of release.tips) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      tips.push(item);
    }
  }
  return tips.slice(0, MAX_HIGHLIGHTS);
}

/** The version news should count from after an update, "" when there is none to wait for. */
export function nextNewsSince(input: {
  firstInstall: boolean;
  lastSeen: string;
  pending: string;
  current: string;
}): string {
  const { firstInstall, lastSeen, pending, current } = input;
  if (firstInstall) return "";
  // News still unread from an earlier update keeps its older starting point.
  if (pending !== "") return pending;
  return lastSeen !== current ? lastSeen : "";
}

/** The Simple look offer: once, to someone who has neither got it nor answered it. */
export function simpleOfferDue(settings: {
  simpleLook: boolean;
  simpleLookHinted: boolean;
}): boolean {
  return !settings.simpleLook && !settings.simpleLookHinted;
}

export type HomeCardKind = "news" | "simple";

/** One card at a time. An update's news comes first; the offer waits its turn. */
export function homeCardKind(hasNews: boolean, offerDue: boolean): HomeCardKind | null {
  if (hasNews) return "news";
  return offerDue ? "simple" : null;
}
