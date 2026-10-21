/**
 * Sending pages to another notebook from the notebook view (FineNotes#33):
 * the order of events (copy first, then remove), and what each failure
 * leaves behind. The view is built from its prototype, with the surface and
 * the plugin as stubs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notices, resetFakes } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { InkView } = await import("../../src/view/ink-view");
const { blankPage, emptyDocument } = await import("../../src/model/document");
const { History } = await import("../../src/model/history");
const { RemovePages } = await import("../../src/model/page-order");

type Command = { apply(doc: unknown): void; invert(doc: unknown): void };

/** The members a test reaches that TypeScript keeps private. */
interface Inside {
  sendPages(surface: unknown, pages: unknown[], choice: unknown): Promise<void>;
  undoTransfer(surface: unknown, removal: unknown, receipt: unknown): Promise<void>;
}

function setup(pageCount = 4) {
  const doc = emptyDocument();
  for (let i = 2; i <= pageCount; i++) doc.pages.push(blankPage(`p${i}`));
  const history = new History();
  const surface = {
    document: doc,
    applyCommand: (command: Command) => history.push(doc, command as never),
    isLatest: (command: Command) => history.isLatest(command as never),
    undo: () => history.undo(doc),
  };
  const undone = vi.fn(() => Promise.resolve());
  const plugin = {
    sendPages: vi.fn(() =>
      Promise.resolve({ path: "Maths.notebook.md", title: "Maths", undo: undone }),
    ),
    sendPagesToNewNotebook: vi.fn(() =>
      Promise.resolve({ path: "New.notebook.md", title: "New", undo: undone }),
    ),
    rememberTransferTarget: vi.fn(),
  };
  const saves = vi.fn();
  const view = Object.assign(Object.create(InkView.prototype) as object, {
    surface,
    plugin,
    requestSave: saves,
    sidebar: { flush: vi.fn() },
  });
  const maths = { path: "Maths.notebook.md", title: "Maths", mtime: 1 };
  return { view: view as unknown as Inside, doc, surface, plugin, saves, undone, maths };
}

beforeEach(() => {
  resetFakes();
  vi.stubGlobal("createFragment", (build: (fragment: unknown) => void) => {
    const fragment = {
      createSpan: () => ({}),
      createEl: () => ({ addEventListener: () => {} }),
    };
    build(fragment);
    return "fragment";
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("moving pages to another notebook", () => {
  it("copies first, then takes the pages out here as one undoable step", async () => {
    const { view, doc, surface, plugin, saves, maths } = setup();
    const moving = [doc.pages[1], doc.pages[2]];
    await view.sendPages(surface, moving, {
      destination: { kind: "notebook", target: maths },
      copy: false,
    });
    expect(plugin.sendPages).toHaveBeenCalledWith("Maths.notebook.md", moving);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p4"]);
    expect(saves).toHaveBeenCalled();
    expect(plugin.rememberTransferTarget).toHaveBeenCalledWith("Maths.notebook.md");
    expect(notices.at(-1)?.message).toBe("fragment");
  });

  it("keeps the pages here on a copy", async () => {
    const { view, doc, surface, maths } = setup();
    await view.sendPages(surface, [doc.pages[1]], {
      destination: { kind: "notebook", target: maths },
      copy: true,
    });
    expect(doc.pages).toHaveLength(4);
  });

  it("loses nothing when the other notebook refuses: the pages stay and a notice says why", async () => {
    const { view, doc, surface, plugin } = setup();
    plugin.sendPages.mockResolvedValueOnce("that notebook is read-only." as never);
    await view.sendPages(surface, [doc.pages[1]], {
      destination: { kind: "notebook", target: { path: "X.notebook.md", title: "X", mtime: 1 } },
      copy: false,
    });
    expect(doc.pages).toHaveLength(4);
    expect(notices.at(-1)?.message).toBe("FineNotes: that notebook is read-only.");
    expect(plugin.rememberTransferTarget).not.toHaveBeenCalled();
  });

  it("never empties this notebook: every page selected is only copied", async () => {
    const { view, doc, surface, maths } = setup(2);
    await view.sendPages(surface, [...doc.pages], {
      destination: { kind: "notebook", target: maths },
      copy: false,
    });
    expect(doc.pages).toHaveLength(2);
  });

  it("sends to a new notebook when asked", async () => {
    const { view, doc, surface, plugin } = setup();
    const page = doc.pages[1];
    await view.sendPages(surface, [page], {
      destination: { kind: "new", title: "Ideas" },
      copy: false,
    });
    expect(plugin.sendPagesToNewNotebook).toHaveBeenCalledWith("Ideas", [page]);
  });
});

describe("undoing a transfer", () => {
  it("puts the pages back here before taking them out there", async () => {
    const { view, doc, surface, undone } = setup();
    const removal = new RemovePages([doc.pages[1]]);
    surface.applyCommand(removal);
    const order: string[] = [];
    undone.mockImplementation(() => {
      order.push(`there:${doc.pages.length}`);
      return Promise.resolve();
    });
    await view.undoTransfer(surface, removal, { title: "Maths", undo: undone });
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(order).toEqual(["there:4"]);
  });

  it("leaves both copies alone when this notebook has changed since", async () => {
    const { view, doc, surface, undone } = setup();
    const removal = new RemovePages([doc.pages[1]]);
    surface.applyCommand(removal);
    surface.applyCommand(new RemovePages([doc.pages[1]]));
    await view.undoTransfer(surface, removal, { title: "Maths", undo: undone });
    expect(undone).not.toHaveBeenCalled();
    expect(notices.at(-1)?.message).toMatch(/stay in Maths as well/);
  });

  it("only takes the copy away after a plain copy", async () => {
    const { view, surface, undone } = setup();
    await view.undoTransfer(surface, null, { title: "Maths", undo: undone });
    expect(undone).toHaveBeenCalledOnce();
  });
});
