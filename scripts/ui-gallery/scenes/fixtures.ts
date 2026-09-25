/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared fake data for the scenes: a notebook, the tool state, a fake App,
 * and callbacks that do nothing.
 */
import type { InkDocument, Page, Stroke } from "../../../src/model/document";
import { TFile, TFolder } from "obsidian";
import pencil from "../../../tests/ink/fixtures/real-pencil-ipad.json";

export const noop = (): void => undefined;

/** Every callback a component asks for, as a no-op (so every button shows). */
export function callbacks<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, key) {
      if (key in target) return (target as any)[key];
      if (typeof key === "symbol" || key === "then") return undefined;
      return noop;
    },
  });
}

export function blankPage(
  id: string,
  backdrop: Record<string, unknown>,
  extra: Partial<Page> = {},
): Page {
  return {
    id,
    kind: "page",
    geometry: { width: 1024, height: 1448 },
    backdrop,
    strokes: [],
    images: [],
    textBoxes: [],
    ...extra,
  } as unknown as Page;
}

/**
 * Pressure as the file format stores it (255ths): a notebook that went
 * through a save must paint the same ink as one that did not.
 */
const pressure = (p: number): number => Math.round(p * 255) / 255;

/** One of the real Pencil strokes from the recogniser's fixtures, placed and sized. */
function pencilStroke(
  index: number,
  x: number,
  y: number,
  size: number,
  extra: Partial<Stroke> = {},
): Stroke {
  const points = (pencil as any).strokes[index].points as Array<[number, number]>;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [px, py] of points) {
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px);
    y1 = Math.max(y1, py);
  }
  const k = size / Math.max(x1 - x0, y1 - y0);
  const pts = points.flatMap(([px, py], i) => [
    Math.round((x + (px - x0) * k) * 10) / 10,
    Math.round((y + (py - y0) * k) * 10) / 10,
    pressure(0.35 + 0.15 * Math.sin(i / 5)),
  ]);
  return {
    id: `s${index}-${x}-${y}`,
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pts,
    ...extra,
  } as Stroke;
}

function line(
  id: string,
  from: [number, number],
  to: [number, number],
  extra: Partial<Stroke>,
): Stroke {
  const pts: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const round = (v: number): number => Math.round(v * 100) / 100;
    pts.push(
      round(from[0] + (to[0] - from[0]) * t),
      round(from[1] + (to[1] - from[1]) * t + Math.sin(t * 6) * 1.2),
      pressure(0.5),
    );
  }
  return { id, tool: "pen", color: "#1a1a1a", size: 3, pts, ...extra } as Stroke;
}

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  text: string,
  fontSize: number,
  extra = {},
): any {
  return { id, x, y, w, text, fontSize, color: "#1a1a1a", fit: true, ...extra };
}

/** A lecture page: typed headings, a highlighted line, and a sketch in real Pencil ink. */
export function lecturePage(id: string): Page {
  return blankPage(
    id,
    { kind: "ruled-narrow" },
    {
      textBoxes: [
        box(`${id}-t1`, 96, 92, 700, "Cell biology · Lecture 3", 44, { bold: true }),
        box(
          `${id}-t2`,
          96,
          190,
          760,
          "Mitochondria — double membrane, their own DNA.\nATP is made by oxidative phosphorylation.",
          26,
        ),
        box(`${id}-t3`, 560, 560, 320, "inner membrane folds\n= cristae", 24, { color: "#1971c2" }),
      ],
      strokes: [
        line(`${id}-hl`, [92, 238], [690, 238], {
          tool: "highlighter",
          color: "#ffd43b",
          size: 22,
        }),
        pencilStroke(1, 150, 430, 330),
        pencilStroke(12, 210, 500, 190, { color: "#1971c2" }),
        line(`${id}-arrow`, [500, 600], [556, 590], { color: "#1971c2" }),
      ] as Stroke[],
    },
  );
}

function diagramPage(id: string): Page {
  return blankPage(
    id,
    { kind: "squared" },
    {
      textBoxes: [box(`${id}-t1`, 96, 92, 600, "Electron transport chain", 36, { bold: true })],
      strokes: [
        pencilStroke(5, 120, 220, 260),
        pencilStroke(11, 460, 250, 130, { color: "#e03131" }),
        pencilStroke(0, 700, 230, 160),
        line(`${id}-l1`, [390, 300], [455, 300], {}),
        line(`${id}-l2`, [600, 300], [690, 300], {}),
      ] as Stroke[],
    },
  );
}

/** A notebook: a terracotta cover, two written pages, then assorted blank paper. */
export function notebook(pageCount = 12): InkDocument {
  const rulings = ["ruled-narrow", "squared", "dotted", "ruled-wide", "blank"];
  const pages: Page[] = [
    blankPage("p1", { kind: "cover-plain", paperColor: "#c0643f" }),
    lecturePage("p2"),
    diagramPage("p3"),
  ];
  for (let i = pages.length; i < pageCount; i++)
    pages.push(blankPage(`p${i + 1}`, { kind: rulings[i % 5] }));
  return { version: 3, view: {}, pages: pages.slice(0, pageCount) } as unknown as InkDocument;
}

export function toolState(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pressureEnabled: true,
    penType: "fountain",
    recentColors: ["#8b5a2b", "#00a6a6", "#c0392b"],
    ...extra,
  };
}

const FOLDERS = [
  "",
  "Biology",
  "Biology/Attachments",
  "Chemistry",
  "Lectures",
  "Lectures/2026",
  "Scans",
].map((p) => new TFolder(p));

/** The App, as far as the views reach into it. */
export function fakeApp(): any {
  const files = ["Biology/cell.png", "Scans/whiteboard.jpg", "Lectures/2026/slide-12.png"].map(
    (p) => {
      const f = new TFile(p);
      f.stat.mtime = Date.now();
      return f;
    },
  );
  return {
    vault: {
      getFileByPath: () => null,
      getAbstractFileByPath: () => null,
      getFolderByPath: (p: string) => FOLDERS.find((f) => f.path === p) ?? null,
      getAllFolders: (root?: boolean) => (root ? FOLDERS : FOLDERS.slice(1)),
      getAllLoadedFiles: () => [...FOLDERS, ...files],
      getFiles: () => files,
      getMarkdownFiles: () => [],
      readBinary: () => Promise.reject(new Error("no vault")),
      read: () => Promise.resolve(""),
      cachedRead: () => Promise.resolve(""),
      getResourcePath: () => "",
      adapter: { exists: () => Promise.resolve(false) },
      getRoot: () => FOLDERS[0],
      on: () => ({}),
      config: {},
    },
    workspace: {
      on: () => ({}),
      getActiveFile: () => null,
      getActiveViewOfType: () => null,
      containerEl: document.body,
    },
    metadataCache: { on: () => ({}), getFileCache: () => null, getFirstLinkpathDest: () => null },
    fileManager: { getNewFileParent: () => FOLDERS[0] },
    loadLocalStorage: () => null,
    saveLocalStorage: noop,
    setting: { open: noop, openTabById: noop },
  };
}
