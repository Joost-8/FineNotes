/**
 * Page embeds of a notebook kept as one file per page per device (#274):
 * its pages are joined from its page folder, and a change to one of its
 * files reads the notebook again.
 */
import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { PageEmbeds } = await import("../../src/view/page-embed");
const { blankPage, emptyDocument } = await import("../../src/model/document");
const { buildInkFile, encodeDocumentWith, inkFileText } = await import("../../src/model/serialize");
const { pageFileText } = await import("../../src/model/device-pages");
const { deflateToBase64 } = await import("../../src/model/compress");

const NOTEBOOK = "Physics/Physics.notebook.md";
const FOLDER = "Physics/Pages/n7k2q9ab";
const BODY = "# Physics";

/** The members a test reaches that TypeScript keeps private. */
interface Inside {
  notebook(
    file: TFile,
    version: number,
  ): Promise<{ pages: { id: string; strokes: unknown[] }[] } | null>;
  live: Set<{ file: TFile; version: number }>;
  devicePageChanged(path: string): void;
}

/** Embeds over a vault of `texts` by path; the notebook's frontmatter names its id. */
function embedsOver(texts: Map<string, string>) {
  const files = new Map([...texts.keys()].map((path) => [path, new TFile(path)]));
  const children = [...files.values()].filter((file) => file.path.startsWith(`${FOLDER}/`));
  const app = {
    vault: {
      on: () => ({}),
      getFileByPath: (path: string) => files.get(path) ?? null,
      getAbstractFileByPath: (path: string) =>
        files.get(path) ??
        (path === FOLDER ? Object.assign(new TFolder(FOLDER), { children }) : null),
      cachedRead: (file: TFile) => Promise.resolve(texts.get(file.path) ?? ""),
    },
    metadataCache: { getFileCache: () => null },
    workspace: { on: () => ({}) },
  };
  const embeds = new PageEmbeds({
    app: app as never,
    isInkFile: (file) => file.name.endsWith(".notebook.md"),
    paperWidth: () => 1024,
    usePressure: () => true,
    highlighterAlpha: () => 0.35,
    paper: () => ({}) as never,
  });
  return { embeds, inside: embeds as unknown as Inside, file: files.get(NOTEBOOK) as TFile };
}

/** A two-page notebook moved to the layout; device a1 wrote a stroke on p2. */
function devicePagesNotebook(): Map<string, string> {
  const doc = emptyDocument(1024);
  doc.pages = [blankPage("p1"), blankPage("p2")];
  const page = {
    dev: "a1",
    page: "p2",
    rev: 1,
    strokes: [{ id: "a1.1", tool: "pen", color: "#1a1a1a", size: 3, pts: [1, 2, 128] }],
  };
  return new Map([
    [
      NOTEBOOK,
      inkFileText(
        BODY,
        encodeDocumentWith(doc, ["device-pages"]).replace(
          "+device-pages:",
          "+device-pages=n7k2q9ab:",
        ),
      ),
    ],
    [`${FOLDER}/p2.a1.md`, pageFileText(`v2:${deflateToBase64(JSON.stringify(page))}`)],
  ]);
}

describe("page embeds of a notebook kept as one file per page per device (#274)", () => {
  it("show its pages joined from its files", async () => {
    const { inside, file } = embedsOver(devicePagesNotebook());
    const notebook = await inside.notebook(file, 1);
    expect(notebook?.pages.map((page) => page.id)).toEqual(["p1", "p2"]);
    expect(notebook?.pages[1].strokes).toHaveLength(1);
  });

  it("still show a one-file notebook as before", async () => {
    const doc = emptyDocument(1024);
    doc.pages.push(blankPage("p2"));
    const { inside, file } = embedsOver(new Map([[NOTEBOOK, buildInkFile(BODY, doc)]]));
    expect((await inside.notebook(file, 1))?.pages).toHaveLength(2);
  });

  it("read the notebook again when one of its files changes, and only its own", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    try {
      const { inside, file } = embedsOver(devicePagesNotebook());
      const embed = { file, version: 5, slots: [], isLink: false };
      inside.live.add(embed);
      inside.devicePageChanged("Physics/Pages/q3x9/p2.a1.md");
      inside.devicePageChanged(`${FOLDER}/notes.md`);
      vi.advanceTimersByTime(5000);
      expect(embed.version).toBe(5);
      // Read again even at the same stamp: a page file gone leaves the newest change.
      inside.devicePageChanged(`${FOLDER}/p2.a1.md`);
      vi.advanceTimersByTime(5000);
      expect(embed.version).toBe(-1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
