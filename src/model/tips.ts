/**
 * Tips and What's new: the catalogue, and which card Home shows. PURE.
 *
 * "Start here" holds the simple tips that help most. After it come sections
 * by what you are doing, and inside each collection the easiest tips lead.
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

/** A labelled group of collections on the Tips page; the first has no label. */
export interface TipSection {
  id: string;
  title: TextKey | null;
  collections: TipCollection[];
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

export const TIP_SECTIONS: readonly TipSection[] = [
  {
    id: "start",
    title: null,
    collections: [
      {
        id: "essentials",
        title: "notebooks.tips.collection.essentials",
        tips: [
          tip("hold", "hold", "shape"),
          tip("scribble", "scribble", "scribble"),
          tip("undo", "undo"),
          tip("redoThree", "redoThree"),
          tip("circleLasso", "circleLasso"),
          tip("pullPage", "pullPage"),
          tip("fillScreen", "fillScreen"),
          tip("searchInk", "searchInk"),
          tip("tapColour", "tapColour"),
          tip("ribbon", "ribbon"),
        ],
      },
    ],
  },
  {
    id: "daily",
    title: "notebooks.tips.section.daily",
    collections: [
      {
        id: "gestures",
        title: "notebooks.tips.collection.gestures",
        tips: [
          tip("holdResize", "holdResize"),
          tip("arcsHearts", "arcsHearts"),
          tip("arrow", "arrow"),
          tip("scribbleFill", "scribbleFill"),
          tip("pathArrow", "pathArrow"),
        ],
      },
      {
        id: "hands",
        title: "notebooks.tips.collection.hands",
        tips: [
          tip("fingerPick", "fingerPick"),
          tip("fingerHoldMenu", "fingerHoldMenu"),
          tip("drawFinger", "drawFinger"),
          tip("stylusOnly", "stylusOnly"),
        ],
      },
      {
        id: "selecting",
        title: "notebooks.tips.collection.selecting",
        tips: [
          tip("pasteHere", "pasteHere"),
          tip("dragToPage", "dragToPage"),
          tip("turnIntoText", "turnIntoText"),
          tip("pinchSelection", "pinchSelection"),
          tip("turnKnob", "turnKnob"),
          tip("lassoFilter", "lassoFilter"),
          tip("copyStyle", "copyStyle"),
          tip("oneItem", "oneItem"),
          tip("correctWord", "correctWord"),
          tip("screenshotLasso", "screenshotLasso"),
          tip("saveSticker", "saveSticker"),
          tip("lockPicture", "lockPicture"),
          tip("pictureFront", "pictureFront"),
        ],
      },
    ],
  },
  {
    id: "notes",
    title: "notebooks.tips.section.notes",
    collections: [
      {
        id: "writing",
        title: "notebooks.tips.collection.writing",
        tips: [
          tip("checklist", "checklist"),
          tip("eyedropper", "eyedropper"),
          tip("widthMm", "widthMm"),
          tip("typedEquation", "typedEquation"),
          tip("zoomBox", "zoomBox"),
          tip("zoomFrame", "zoomFrame"),
          tip("zoomAdvance", "zoomAdvance"),
          tip("insertSpace", "insertSpace"),
          tip("stabilization", "stabilization"),
          tip("chisel", "chisel"),
          tip("hideOptions", "hideOptions"),
          tip("backToPen", "backToPen"),
        ],
      },
      {
        id: "pages",
        title: "notebooks.tips.collection.pages",
        tips: [
          tip("reorder", "reorder"),
          tip("scan", "scan"),
          tip("dropPdf", "dropPdf"),
          tip("importBooks", "importBooks"),
          tip("pageGrid", "pageGrid"),
          tip("moveToNotebook", "moveToNotebook"),
          tip("margins", "margins"),
          tip("darkDesk", "darkDesk"),
          tip("newBoard", "newBoard"),
          tip("joinedPages", "joinedPages"),
          tip("plainExport", "plainExport"),
          tip("pictureExport", "pictureExport"),
          tip("pageNumbers", "pageNumbers"),
          tip("saveTemplate", "saveTemplate"),
          tip("designPaper", "designPaper"),
          tip("readOnly", "readOnly"),
        ],
      },
      {
        id: "organize",
        title: "notebooks.tips.collection.organize",
        tips: [
          tip("homePreview", "homePreview"),
          tip("homeDrag", "homeDrag"),
          tip("folderColour", "folderColour"),
          tip("foldNote", "foldNote"),
          tip("inkTask", "inkTask"),
          tip("contentsHeading", "contentsHeading"),
          tip("pageTab", "pageTab"),
        ],
      },
    ],
  },
  {
    id: "learn",
    title: "notebooks.tips.section.learn",
    collections: [
      {
        id: "study",
        title: "notebooks.tips.collection.study",
        tips: [
          tip("coverTape", "coverTape"),
          tip("tapeEye", "tapeEye"),
          tip("snap", "snap"),
          tip("holdWord", "holdWord"),
          tip("hear", "hear"),
          tip("laser", "laser"),
          tip("tapeMagnet", "tapeMagnet"),
          tip("tapeExport", "tapeExport"),
          tip("copyHighlighted", "copyHighlighted"),
          tip("askSelection", "askSelection"),
          tip("pasteTranscript", "pasteTranscript"),
        ],
      },
      {
        id: "find",
        title: "notebooks.tips.collection.find",
        tips: [
          tip("homeSearch", "homeSearch"),
          tip("copyPageLink", "copyPageLink"),
          tip("linkTo", "linkTo"),
          tip("inkLink", "inkLink"),
          tip("embedPages", "embedPages"),
          tip("pdfLinks", "pdfLinks"),
          tip("learnWriting", "learnWriting"),
        ],
      },
      {
        id: "maths",
        title: "notebooks.tips.collection.maths",
        tips: [
          tip("calc", "calc"),
          tip("basicCalc", "basicCalc"),
          tip("graphFit", "graphFit"),
          tip("graphPin", "graphPin"),
          tip("graphPopOut", "graphPopOut"),
        ],
      },
    ],
  },
  {
    id: "draw",
    title: "notebooks.tips.section.draw",
    collections: [
      {
        id: "shapes",
        title: "notebooks.tips.collection.shapes",
        tips: [
          tip("typeInShape", "typeInShape"),
          tip("fillTool", "fillTool"),
          tip("linkedShapes", "linkedShapes"),
          tip("shapeSnap", "shapeSnap"),
          tip("cornerPoints", "cornerPoints"),
          tip("bendCurves", "bendCurves"),
          tip("tableTab", "tableTab"),
          tip("tableResize", "tableResize"),
        ],
      },
      {
        id: "tools",
        title: "notebooks.tips.collection.tools",
        tips: [
          tip("eraseHighlightOnly", "eraseHighlightOnly"),
          tip("eraseLine", "eraseLine"),
          tip("rulerUse", "rulerUse"),
          tip("rulerKinds", "rulerKinds"),
        ],
      },
      {
        id: "yours",
        title: "notebooks.tips.collection.yours",
        tips: [
          tip("savedPens", "savedPens"),
          tip("penOrder", "penOrder"),
          tip("colourOff", "colourOff"),
          tip("pillDock", "pillDock"),
          tip("customizeBar", "customizeBar"),
          tip("toolbarEdge", "toolbarEdge"),
          tip("dockOptions", "dockOptions"),
          tip("shortcutSheet", "shortcutSheet"),
          tip("spaceDrag", "spaceDrag"),
          tip("shiftErase", "shiftErase"),
          tip("altZoom", "altZoom"),
        ],
      },
    ],
  },
];

/** Every collection, in reading order: the pager runs on from one to the next. */
export const TIP_COLLECTIONS: readonly TipCollection[] = TIP_SECTIONS.flatMap((s) => s.collections);

/** Newest first. Every release with something to show adds an entry. */
export const RELEASE_HIGHLIGHTS: readonly ReleaseHighlights[] = [
  {
    version: "2.8.3",
    tips: [
      tip("typedEquation", "typedEquation"),
      tip("textTurns", "textTurns"),
      tip("lineSpacing", "lineSpacing"),
      tip("snap", "snap"),
      tip("homeSearch", "homeSearch"),
      tip("holdWord", "holdWord"),
      tip("tapeMagnet", "tapeMagnet"),
      tip("embedPages", "embedPages"),
    ],
  },
  {
    version: "2.8.2",
    tips: [
      tip("typeInShape", "typeInShape"),
      tip("linkedShapes", "linkedShapes"),
      tip("bendCurves", "bendCurves"),
      tip("margins", "margins"),
    ],
  },
];

/** Counts every release: Home's card shown again on request. */
export const EARLIEST_NEWS = "0.0.0";

/** Most highlights Home's sideways row and its pager will carry. */
export const MAX_HIGHLIGHTS = 12;

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
