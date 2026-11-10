import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperTheme } from "../../src/canvas/backdrop";
import type { EmbedCreator } from "../../src/view/page-embed";

vi.mock("obsidian", () => import("./fake-obsidian"));

/** Each page painted, by its id, the width, the paper it was painted in and its cut. */
const painted: {
  id: string;
  cssWidth: number;
  dpr: number;
  night: boolean;
  crop?: { x: number; y: number; width: number; height: number };
}[] = [];
vi.mock("../../src/view/pdf-export", () => ({
  paintPagePreview: (
    canvas: { width: number; height: number },
    page: { id: string },
    sources: { paper: { night: boolean } },
    cssWidth: number,
    dpr: number,
    crop?: { x: number; y: number; width: number; height: number },
  ) => {
    canvas.width = cssWidth * dpr;
    canvas.height = cssWidth * dpr;
    painted.push({
      id: page.id,
      cssWidth,
      dpr,
      night: sources.paper.night,
      ...(crop ? { crop } : {}),
    });
    return Promise.resolve();
  },
}));
/** The pages every notebook file decodes to. */
let notebookPages: { id: string }[] = [];
/** Whether the notebook file is an endless board. */
let notebookEndless = false;
vi.mock("../../src/model/serialize", () => ({
  parseInkFile: () => ({
    doc: { pages: notebookPages, ...(notebookEndless ? { endless: true } : {}) },
    payload: "x",
  }),
}));
vi.mock("../../src/model/page-signature", () => ({
  pageSignature: (page: { id: string }) => page.id,
}));

const { TFile } = await import("./fake-obsidian");
const { PageEmbeds } = await import("../../src/view/page-embed");
const { LIGHT_PAPER } = await import("../../src/canvas/backdrop");

function page(id: string) {
  return { id, geometry: { width: 800, height: 1100 }, backdrop: { kind: "paper" }, images: [] };
}

/** Just enough of an element for the embed to build itself into. */
function fakeEl(): Record<string, unknown> {
  const el: Record<string, unknown> = {
    width: 300,
    height: 150,
    classes: new Set<string>(),
    attrs: new Map<string, string>(),
    addClass(...cls: string[]) {
      for (const c of cls) (el.classes as Set<string>).add(c);
    },
    removeClass(...cls: string[]) {
      for (const c of cls) (el.classes as Set<string>).delete(c);
    },
    setAttribute(k: string, v: string) {
      (el.attrs as Map<string, string>).set(k, v);
    },
    getAttribute(k: string) {
      return (el.attrs as Map<string, string>).get(k) ?? null;
    },
    setCssStyles() {},
    toggleClass() {},
    dataset: {},
    children: [] as unknown[],
    parent: null as unknown,
    /** Inside Export to PDF's layout. */
    inPrint: false,
    listeners: new Map<string, (event: unknown) => void>(),
    addEventListener(type: string, fn: (event: unknown) => void) {
      (el.listeners as Map<string, (event: unknown) => void>).set(type, fn);
    },
    closest(selector: string) {
      return selector === ".print" && el.inPrint ? {} : null;
    },
    getBoundingClientRect: () => ({ width: 640 }),
    remove() {
      const parent = el.parent as { children: unknown[] } | null;
      if (parent) parent.children = parent.children.filter((c) => c !== el);
    },
    createDiv: (options?: { cls?: string }) => child(options),
    createEl: (_tag: string, options?: { cls?: string }) => child(options),
  };
  const child = (options?: string | { cls?: string }) => {
    const c = fakeEl();
    const cls = typeof options === "string" ? options : options?.cls;
    for (const name of cls?.split(" ") ?? []) (c.classes as Set<string>).add(name);
    c.parent = el;
    (el.children as unknown[]).push(c);
    return c;
  };
  return el;
}

/** Obsidian's embed registry, as app.js has it, with its own Markdown creator. */
function registry(): {
  embedByExtension: Record<string, EmbedCreator | undefined>;
  registerExtension(ext: string, creator: EmbedCreator): void;
  unregisterExtension(ext: string): void;
} {
  return {
    embedByExtension: {},
    registerExtension(ext, creator) {
      if (Object.prototype.hasOwnProperty.call(this.embedByExtension, ext)) {
        throw new Error(
          `Attempting to register an embed for an already registered extension "${ext}"`,
        );
      }
      this.embedByExtension[ext] = creator;
    },
    unregisterExtension(ext) {
      delete this.embedByExtension[ext];
    },
  };
}

/** Obsidian's Markdown embed; `loaded` counts its `loadFile` calls. */
const markdownEmbed = {
  kind: "markdown",
  loaded: 0,
  loadFile() {
    this.loaded++;
  },
};

function setUp(app: Record<string, unknown> = {}, paper: PaperTheme = LIGHT_PAPER) {
  const reg = registry();
  const original = vi.fn(() => markdownEmbed as never);
  reg.registerExtension("md", original);
  const notebook = new TFile("Physics.notebook.md");
  const opened: string[] = [];
  const fullApp = {
    embedRegistry: reg,
    vault: {
      on: () => ({}),
      getFileByPath: (path: string) => (path === notebook.path ? notebook : null),
      cachedRead: () => Promise.resolve("notebook"),
    },
    workspace: {
      on: () => ({}),
      openLinkText: (link: string) => {
        opened.push(link);
        return Promise.resolve();
      },
    },
    ...app,
  };
  const embeds = new PageEmbeds({
    app: fullApp as never,
    isInkFile: (file) => file.name.endsWith(".notebook.md"),
    paperWidth: () => 1024,
    usePressure: () => true,
    highlighterAlpha: () => 0.35,
    paper: () => paper,
  });
  return { reg, original, embeds, notebook, opened, app: fullApp };
}

function ctx(linktext: string) {
  return { app: {} as never, containerEl: fakeEl() as never, linktext, sourcePath: "Note.md" };
}

describe("PageEmbeds' hook into Obsidian's embed registry", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes a notebook's page embeds and hands everything else on", () => {
    const { reg, original, embeds } = setUp();
    embeds.onload();
    const creator = reg.embedByExtension.md!;
    expect(creator).not.toBe(original);

    const notebook = new TFile("Physics.notebook.md") as never;
    const page = creator(ctx("Physics.notebook#page=3"), notebook, "#page=3");
    expect(page).not.toBe(markdownEmbed);
    expect(typeof page?.loadFile).toBe("function");
    expect(creator(ctx("Physics.notebook#Page 2"), notebook, "#Page 2")).not.toBe(markdownEmbed);
    expect(creator(ctx("Physics.notebook#p9"), notebook, "#p9")).not.toBe(markdownEmbed);
    expect(original).not.toHaveBeenCalled();

    // The whole notebook shows its pages.
    expect(creator(ctx("Physics.notebook"), notebook, "")).not.toBe(markdownEmbed);
    expect(original).not.toHaveBeenCalled();

    // Other text may name a region: the notebook is read to know (and hands it back if not).
    expect(creator(ctx("Physics.notebook#Intro"), notebook, "#Intro")).not.toBe(markdownEmbed);
    expect(original).not.toHaveBeenCalled();

    // A block, or an ordinary note, with or without a page: Obsidian's.
    expect(creator(ctx("Physics.notebook#^abc"), notebook, "#^abc")).toBe(markdownEmbed);
    const plain = new TFile("Plain.md") as never;
    expect(creator(ctx("Plain#page=2"), plain, "#page=2")).toBe(markdownEmbed);
    expect(creator(ctx("Plain#Intro"), plain, "#Intro")).toBe(markdownEmbed);
    expect(creator(ctx("Plain"), plain, "")).toBe(markdownEmbed);
    expect(original).toHaveBeenCalledTimes(4);
  });

  it("puts Obsidian's creator back when the plugin unloads", () => {
    const { reg, original, embeds } = setUp();
    embeds.onload();
    embeds.unload();
    embeds.onunload();
    expect(reg.embedByExtension.md).toBe(original);
  });

  it("stands aside without dropping a creator another plugin put in front of it", () => {
    const { reg, original, embeds } = setUp();
    embeds.onload();
    const ours = reg.embedByExtension.md!;
    const theirs: EmbedCreator = (c, f, s) => ours(c, f, s);
    reg.unregisterExtension("md");
    reg.registerExtension("md", theirs);
    embeds.unload();
    embeds.onunload();
    expect(reg.embedByExtension.md).toBe(theirs);
    // Ours now hands even a page embed straight to Obsidian's.
    const notebook = new TFile("Physics.notebook.md") as never;
    expect(theirs(ctx("Physics.notebook#page=1"), notebook, "#page=1")).toBe(markdownEmbed);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("does nothing where the registry is not the shape it was written for", () => {
    const { embeds } = setUp({ embedRegistry: { embedByExtension: {} } });
    expect(() => embeds.onload()).not.toThrow();
    const missing = setUp({ embedRegistry: undefined });
    expect(() => missing.embeds.onload()).not.toThrow();
    const noMarkdown = setUp();
    noMarkdown.reg.unregisterExtension("md");
    noMarkdown.embeds.onload();
    expect(noMarkdown.reg.embedByExtension.md).toBeUndefined();
  });

  it("watches an embed only once it is loaded", () => {
    const observed: unknown[] = [];
    class Observer {
      observe(el: unknown): void {
        observed.push(el);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    vi.stubGlobal("ResizeObserver", Observer);
    const { reg, embeds } = setUp();
    embeds.onload();
    const c = ctx("Physics.notebook#page=1");
    const page = reg.embedByExtension.md!(c, new TFile("Physics.notebook.md") as never, "#page=1");
    expect(observed).toHaveLength(0);
    void page?.loadFile();
    // Its page is seen by both observers: on screen, and its width.
    const box = (c.containerEl as unknown as { children: unknown[] }).children[0];
    expect(observed).toEqual([box, box]);
  });
});

describe("Notebook embeds' pages", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    painted.length = 0;
    notebookEndless = false;
    markdownEmbed.loaded = 0;
  });

  type Fake = ReturnType<typeof fakeEl>;
  const pagesOf = (el: unknown): Fake[] =>
    ((el as Fake).children as Fake[]).filter((c) =>
      (c.classes as Set<string>).has("goodobsidian-page-embed-page"),
    );
  const inPrint = <T extends { containerEl: unknown }>(c: T): T => {
    (c.containerEl as Fake).inPrint = true;
    return c;
  };

  /** Observers that hand the test the intersection callback. */
  function observers(observed: unknown[] = []) {
    const reports: ((entries: unknown[]) => void)[] = [];
    class Observer {
      constructor(callback: (entries: unknown[]) => void) {
        reports.push(callback);
      }
      observe(el: unknown): void {
        observed.push(el);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    vi.stubGlobal("ResizeObserver", Observer);
    vi.stubGlobal("window", { setTimeout, clearTimeout, devicePixelRatio: 1 });
    return (target: unknown, isIntersecting: boolean) => reports[0]?.([{ target, isIntersecting }]);
  }

  it("paints every page of a notebook embedded whole for Export to PDF, before loadFile resolves", async () => {
    notebookPages = [page("a"), page("b"), page("c")];
    const { reg, embeds, notebook } = setUp();
    embeds.onload();
    const c = inPrint(ctx("Physics.notebook"));
    await reg.embedByExtension.md!(c, notebook as never, "")?.loadFile();
    expect(painted.map((p) => p.id)).toEqual(["a", "b", "c"]);
    // Light paper, sharp for paper, at the box's width.
    expect(painted.every((p) => p.night !== true && p.dpr === 2 && p.cssWidth === 640)).toBe(true);
    expect(pagesOf(c.containerEl)).toHaveLength(3);
    expect((c.containerEl as unknown as Fake).classes).toContain("goodobsidian-notebook-embed");
  });

  it("paints only the page a link names for Export to PDF", async () => {
    notebookPages = [page("a"), page("b"), page("c")];
    const { reg, embeds, notebook } = setUp();
    embeds.onload();
    const c = inPrint(ctx("Physics.notebook#page=2"));
    await reg.embedByExtension.md!(c, notebook as never, "#page=2")?.loadFile();
    expect(painted.map((p) => p.id)).toEqual(["b"]);
    expect(pagesOf(c.containerEl)).toHaveLength(1);
  });

  it("prints dark pages light", async () => {
    notebookPages = [page("a")];
    const { reg, embeds, notebook } = setUp({}, { ...LIGHT_PAPER, night: true });
    embeds.onload();
    const c = inPrint(ctx("Physics.notebook"));
    await reg.embedByExtension.md!(c, notebook as never, "")?.loadFile();
    expect(painted).toHaveLength(1);
    expect(painted[0]?.night).toBeFalsy();
  });

  it("watches each page of a whole notebook on its own, and opens the page clicked", async () => {
    const observed: unknown[] = [];
    const report = observers(observed);
    notebookPages = [page("a"), page("b")];
    const { reg, embeds, notebook, opened, app } = setUp();
    embeds.onload();
    const c = { ...ctx("Physics.notebook"), app: app as never };
    void reg.embedByExtension.md!(c, notebook as never, "")?.loadFile();
    // One page until the notebook is read; it comes on screen.
    report(pagesOf(c.containerEl)[0], true);
    await vi.waitFor(() => expect(pagesOf(c.containerEl)).toHaveLength(2));
    await vi.waitFor(() => expect(painted.map((p) => p.id)).toEqual(["a"]));
    // The page the read added is watched too, and paints once on screen.
    const second = pagesOf(c.containerEl)[1];
    expect(observed).toContain(second);
    report(second, true);
    await vi.waitFor(() => expect(painted.map((p) => p.id)).toEqual(["a", "b"]));

    const click = (second!.listeners as Map<string, (e: unknown) => void>).get("click");
    click?.({ preventDefault() {}, stopPropagation() {} });
    expect(opened).toEqual(["Physics.notebook#page=2"]);
  });

  it("takes pages out when the notebook has fewer", async () => {
    const report = observers();
    notebookPages = [page("a"), page("b"), page("c")];
    const { reg, embeds, notebook } = setUp();
    embeds.onload();
    const c = ctx("Physics.notebook");
    void reg.embedByExtension.md!(c, notebook as never, "")?.loadFile();
    report(pagesOf(c.containerEl)[0], true);
    await vi.waitFor(() => expect(pagesOf(c.containerEl)).toHaveLength(3));

    // A page deleted in the notebook: the file's next version has two.
    notebookPages = [page("a"), page("c")];
    (notebook.stat as { mtime: number }).mtime = 1;
    report(pagesOf(c.containerEl)[0], true);
    await vi.waitFor(() => expect(pagesOf(c.containerEl)).toHaveLength(2));
  });
  it("prints a board cut to its drawing, not its whole grown page", async () => {
    notebookEndless = true;
    notebookPages = [
      {
        ...page("board"),
        geometry: { width: 5600, height: 5600 },
        strokes: [
          {
            id: "s1",
            color: "#000000",
            size: 4,
            tool: "pen",
            pts: [2000, 2000, 0.5, 2400, 2200, 0.5],
          },
        ],
        textBoxes: [],
      } as never,
    ];
    const { reg, embeds, notebook } = setUp();
    embeds.onload();
    const c = inPrint(ctx("Physics.notebook"));
    await reg.embedByExtension.md!(c, notebook as never, "")?.loadFile();
    const crop = painted[0]?.crop;
    expect(crop).toBeDefined();
    expect(crop!.width).toBeLessThan(1400);
    expect(crop!.x).toBeLessThan(2000);
    expect(crop!.x + crop!.width).toBeGreaterThan(2400);
  });

  it("prints a region alone, from whichever page has it", async () => {
    notebookPages = [
      page("a"),
      {
        ...page("b"),
        regions: [{ id: "rg1", name: "Krebs cycle", x: 50, y: 60, w: 400, h: 200 }],
      } as never,
    ];
    const { reg, embeds, notebook, original } = setUp();
    embeds.onload();
    const c = inPrint(ctx("Physics.notebook#Krebs cycle"));
    await reg.embedByExtension.md!(c, notebook as never, "#Krebs cycle")?.loadFile();
    expect(painted).toEqual([
      expect.objectContaining({ id: "b", crop: { x: 50, y: 60, width: 400, height: 200 } }),
    ]);
    expect(original).not.toHaveBeenCalled();
    expect((pagesOf(c.containerEl)[0]?.attrs as Map<string, string>).get("aria-label")).toBe(
      "Physics, Krebs cycle",
    );
  });

  it("hands a subpath that names no region back to Obsidian, which shows that heading", async () => {
    notebookPages = [page("a")];
    const { reg, embeds, notebook, original } = setUp();
    embeds.onload();
    const c = inPrint(ctx("Physics.notebook#Intro"));
    await reg.embedByExtension.md!(c, notebook as never, "#Intro")?.loadFile();
    // Obsidian's own embed, made in this place with the same link, and loaded.
    expect(original).toHaveBeenCalledWith(c, notebook, "#Intro");
    expect(markdownEmbed.loaded).toBe(1);
    expect(painted).toHaveLength(0);
    expect(pagesOf(c.containerEl)).toHaveLength(0);
    expect((c.containerEl as unknown as Fake).classes).not.toContain("goodobsidian-page-embed");
  });

  it("says a region shown before is gone, rather than turning into a heading embed", async () => {
    const report = observers();
    const krebs = { id: "rg1", name: "Krebs cycle", x: 0, y: 0, w: 100, h: 100 };
    notebookPages = [{ ...page("a"), regions: [krebs] } as never];
    const { reg, embeds, notebook, original } = setUp();
    embeds.onload();
    const c = ctx("Physics.notebook#Krebs cycle");
    void reg.embedByExtension.md!(c, notebook as never, "#Krebs cycle")?.loadFile();
    report(pagesOf(c.containerEl)[0], true);
    await vi.waitFor(() => expect(painted.map((p) => p.id)).toEqual(["a"]));

    // Deleted on the board: the next version of the file has none.
    notebookPages = [page("a")];
    (notebook.stat as { mtime: number }).mtime = 2;
    report(pagesOf(c.containerEl)[0], true);
    await vi.waitFor(() => expect((c.containerEl as unknown as Fake).classes).toContain("is-link"));
    expect(original).not.toHaveBeenCalled();
  });
});
