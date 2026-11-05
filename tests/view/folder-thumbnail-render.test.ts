/**
 * A notebook's first page drawn small for the Folders library: what is drawn,
 * in what order, and whether the thumbnail says it is complete. The canvas is
 * a recorder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, resetFakes } from "./fake-obsidian";
import { installDomGlobals } from "./stub-dom";
import { deflateToBase64 } from "../../src/model/compress";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { renderNotebookThumbnail, fileAt } =
  await import("../../src/view/folder-sidebar/ink-thumbnail");

/** A 2D context that writes down every call and every property set. */
function recorder() {
  const log: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === "canvas") return canvas;
        return (...args: unknown[]) => {
          log.push(
            `${name}(${args.map((arg) => (typeof arg === "number" ? Math.round(arg * 100) / 100 : String(arg))).join(",")})`,
          );
        };
      },
      set: (_target, name: string, value: unknown) => {
        log.push(`${name}=${String(value)}`);
        return true;
      },
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: (type: string, quality: number) => `data:${type};q=${quality}`,
  };
  return { log, canvas };
}

const notebook = (page: unknown) =>
  `# T\n\n%%goodobsidian\nv2:${deflateToBase64(JSON.stringify({ pages: [page] }))}\n%%\n`;

let canvases: ReturnType<typeof recorder>;

beforeEach(() => {
  resetFakes();
  installDomGlobals(vi.stubGlobal.bind(vi));
  canvases = recorder();
  vi.stubGlobal("createEl", (tag: string) => {
    expect(tag).toBe("canvas");
    return canvases.canvas;
  });
});

afterEach(() => vi.unstubAllGlobals());

function appWith(text: string, files: Record<string, unknown> = {}) {
  return {
    vault: {
      cachedRead: () => Promise.resolve(text),
      getAbstractFileByPath: (path: string) => files[path] ?? null,
      readBinary: () => Promise.resolve(new ArrayBuffer(0)),
    },
  };
}

const file = new TFile("School/Bio.notebook.md");

describe("a notebook's thumbnail", () => {
  it("is 300 px wide and no taller than 95 % of that, and the canvas is let go of", async () => {
    const tall = notebook({ geometry: { width: 1000, height: 1000 } });
    const wide = notebook({ geometry: { width: 1000, height: 5000 } });
    await renderNotebookThumbnail(appWith(tall) as never, file as never, () =>
      Promise.reject(new Error()),
    );
    expect([canvases.canvas.width, canvases.canvas.height]).toEqual([0, 0]);
    canvases = recorder();
    const result = await renderNotebookThumbnail(appWith(wide) as never, file as never, () =>
      Promise.reject(new Error()),
    );
    expect(result).toEqual({ url: "data:image/jpeg;q=0.7", complete: true });
    // The canvas is let go of after the picture is taken.
    expect(canvases.canvas.width).toBe(0);
  });

  it("draws the paper, then the rules, then the ink with the highlighter last", async () => {
    const page = {
      geometry: { width: 600, height: 800 },
      backdrop: { kind: "ruled-narrow", paperColor: "#fffbe6", color: "#aabbcc" },
      strokes: [
        { pts: [100, 100, 255, 5000, 5000, 255], color: "#111111", size: 2, tool: "highlighter" },
        {
          pts: [100, 100, 255, 300, 300, 255, 500, 100, 255],
          color: "#ff0000",
          size: 3,
          tool: "pen",
        },
        { pts: [1000, 1000, 255], color: "#00ff00", size: 4, tool: "pen" },
      ],
    };
    await renderNotebookThumbnail(appWith(notebook(page)) as never, file as never, () =>
      Promise.reject(new Error()),
    );
    const log = canvases.log;
    expect(log[0]).toBe("fillStyle=#fffbe6");
    expect(log[1]).toBe("fillRect(0,0,300,285)");
    expect(log).toContain("strokeStyle=#aabbcc");
    // 24 units of spacing at half scale, rules from 1.5 spacings down.
    expect(log).toContain("moveTo(0,18)");
    expect(log).toContain("lineTo(300,18)");
    const pen = log.indexOf("strokeStyle=#ff0000");
    const dot = log.indexOf("fillStyle=#00ff00");
    const highlighter = log.indexOf("globalCompositeOperation=multiply");
    expect(pen).toBeGreaterThan(-1);
    expect(dot).toBeGreaterThan(-1);
    expect(highlighter).toBeGreaterThan(pen);
    expect(highlighter).toBeGreaterThan(dot);
    expect(log).toContain("globalAlpha=0.4");
    // A pen stroke is a curve through its points; a single point is a dot.
    expect(log).toContain("quadraticCurveTo(1.5,1.5,2,1)");
    expect(log.some((entry) => entry.startsWith("arc(5"))).toBe(true);
  });

  it("fills dots for dotted paper and draws squares for grids", async () => {
    const dotted = notebook({
      geometry: { width: 300, height: 300 },
      backdrop: { kind: "dotted" },
    });
    await renderNotebookThumbnail(appWith(dotted) as never, file as never, () =>
      Promise.reject(new Error()),
    );
    expect(canvases.log.filter((entry) => entry.startsWith("fillRect(")).length).toBeGreaterThan(
      50,
    );
    canvases = recorder();
    const grid = notebook({ geometry: { width: 300, height: 300 }, backdrop: { kind: "grid" } });
    await renderNotebookThumbnail(appWith(grid) as never, file as never, () =>
      Promise.reject(new Error()),
    );
    // Vertical lines too: a line from the top edge.
    expect(canvases.log.some((entry) => entry.startsWith("moveTo(28,0)"))).toBe(true);
  });

  it("draws a sticky note as a flat colour, and says so complete", async () => {
    const page = {
      geometry: { width: 300, height: 300 },
      images: [{ sticky: { color: "#ffee99" }, x: 10, y: 20, w: 100, h: 50 }],
    };
    const result = await renderNotebookThumbnail(
      appWith(notebook(page)) as never,
      file as never,
      () => Promise.reject(new Error()),
    );
    expect(canvases.log).toContain("fillStyle=#ffee99");
    expect(canvases.log).toContain("fillRect(-50,-25,100,50)");
    expect(result?.complete).toBe(true);
  });

  it("is not complete when a picture is missing, and still draws the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const page = {
      geometry: { width: 300, height: 300 },
      images: [{ path: "gone.png", x: 0, y: 0, w: 10, h: 10 }],
      strokes: [{ pts: [1, 1, 255, 2, 2, 255], color: "#123456", size: 1, tool: "pen" }],
    };
    const result = await renderNotebookThumbnail(
      appWith(notebook(page)) as never,
      file as never,
      () => Promise.reject(new Error()),
    );
    expect(result?.complete).toBe(false);
    expect(canvases.log).toContain("strokeStyle=#123456");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("FineNotes: picture gone.png"),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("is not complete when the PDF behind the page cannot be drawn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const page = {
      geometry: { width: 300, height: 300 },
      backdrop: { kind: "pdf", path: "a.pdf", page: 0 },
    };
    const result = await renderNotebookThumbnail(
      appWith(notebook(page)) as never,
      file as never,
      () => Promise.reject(new Error()),
    );
    expect(result?.complete).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("FineNotes: PDF a.pdf"),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("is nothing for a note that is not a notebook", async () => {
    const result = await renderNotebookThumbnail(appWith("just text") as never, file as never, () =>
      Promise.reject(new Error()),
    );
    expect(result).toBeNull();
  });

  it("saves a smaller JPEG when the first is too big", async () => {
    canvases.canvas.toDataURL = (type: string, quality: number) =>
      quality === 0.7 ? "x".repeat(70000) : `data:${type};q=${quality}`;
    const result = await renderNotebookThumbnail(
      appWith(notebook({})) as never,
      file as never,
      () => Promise.reject(new Error()),
    );
    expect(result?.url).toBe("data:image/jpeg;q=0.5");
  });
});

describe("fileAt", () => {
  it("finds a file by its path, with or without a leading slash, and nothing that is not a file", () => {
    const real = new TFile("a/b.png");
    const app = {
      vault: { getAbstractFileByPath: (path: string) => (path === "a/b.png" ? real : { path }) },
    };
    expect(fileAt(app as never, "a/b.png")).toBe(real);
    expect(fileAt(app as never, "/a/b.png")).toBe(real);
    expect(fileAt(app as never, "a")).toBeNull();
  });
});
