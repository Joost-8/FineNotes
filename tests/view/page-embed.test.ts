import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedCreator } from "../../src/view/page-embed";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { TFile } = await import("./fake-obsidian");
const { PageEmbeds } = await import("../../src/view/page-embed");

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
    removeClass(c: string) {
      (el.classes as Set<string>).delete(c);
    },
    setAttribute(k: string, v: string) {
      (el.attrs as Map<string, string>).set(k, v);
    },
    getAttribute(k: string) {
      return (el.attrs as Map<string, string>).get(k) ?? null;
    },
    setCssStyles() {},
    createDiv: () => fakeEl(),
    createEl: () => fakeEl(),
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

const markdownEmbed = { kind: "markdown", loadFile: () => undefined };

function setUp(app: Record<string, unknown> = {}) {
  const reg = registry();
  const original = vi.fn(() => markdownEmbed as never);
  reg.registerExtension("md", original);
  const fullApp = {
    embedRegistry: reg,
    vault: { on: () => ({}) },
    workspace: {},
    ...app,
  };
  const embeds = new PageEmbeds({
    app: fullApp as never,
    isInkFile: (file) => file.name.endsWith(".notebook.md"),
    paperWidth: () => 1024,
    usePressure: () => true,
    highlighterAlpha: () => 0.35,
  });
  return { reg, original, embeds };
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

    // The whole notebook shows its first page.
    expect(creator(ctx("Physics.notebook"), notebook, "")).not.toBe(markdownEmbed);
    expect(original).not.toHaveBeenCalled();

    // A heading, a block, or an ordinary note, with or without a page: Obsidian's.
    expect(creator(ctx("Physics.notebook#Intro"), notebook, "#Intro")).toBe(markdownEmbed);
    expect(creator(ctx("Physics.notebook#^abc"), notebook, "#^abc")).toBe(markdownEmbed);
    const plain = new TFile("Plain.md") as never;
    expect(creator(ctx("Plain#page=2"), plain, "#page=2")).toBe(markdownEmbed);
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
    // Seen by both observers: on screen, and its width.
    expect(observed).toEqual([c.containerEl, c.containerEl]);
  });
});
