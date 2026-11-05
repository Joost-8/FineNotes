/**
 * The Folders sidebar and its library as Obsidian drives them: opened through
 * `view.open(container)` (which is where a view that overrides `open` goes
 * blank), drawn into the container, and following the vault; and the
 * controller they share: moves, remembered colours and pins, the one-tab rule
 * and the simple look.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Component,
  ItemView,
  type TFile,
  WorkspaceLeaf,
  notices,
  resetFakes,
} from "./fake-obsidian";
import { container, makeWorld } from "./folder-world";
import type { StubEl } from "./stub-dom";
import { installDomGlobals } from "./stub-dom";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { FolderSidebarController, SEARCH_START_DELAY_MS } =
  await import("../../src/view/folder-sidebar/controller");
const { FolderSidebarView } = await import("../../src/view/folder-sidebar/sidebar-view");
const { FolderLibraryView } = await import("../../src/view/folder-sidebar/folder-library-view");
const { VIEW_TYPE_FOLDERS, VIEW_TYPE_FOLDER_LIBRARY } = await import("../../src/constants");

type World = ReturnType<typeof makeWorld>;

/** A view as the tests see it: its elements are stand-ins, and `open` is Obsidian's. */
type Opened<V> = Omit<V, "contentEl" | "containerEl"> & {
  contentEl: StubEl;
  containerEl: StubEl;
  open(parent: StubEl): Promise<void>;
};

beforeEach(() => {
  resetFakes();
  installDomGlobals(vi.stubGlobal.bind(vi));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function controllerFor(world: World): InstanceType<typeof FolderSidebarController> {
  return new FolderSidebarController({
    app: world.app as never,
    owner: world.owner as never,
    pluginDir: ".obsidian/plugins/finenotes",
    host: world.host,
    data: () => world.data,
    save: () => {
      world.saves++;
      return Promise.resolve();
    },
  });
}

async function openSidebar(world: World, controller = controllerFor(world)) {
  const leaf = new WorkspaceLeaf(world.app);
  const view = new FolderSidebarView(leaf as never, controller) as unknown as Opened<
    InstanceType<typeof FolderSidebarView>
  >;
  const parent = container();
  await view.open(parent);
  return { view, parent, controller, leaf };
}

async function openLibrary(world: World, folder = "", controller = controllerFor(world)) {
  const leaf = new WorkspaceLeaf(world.app);
  const view = new FolderLibraryView(leaf as never, controller) as unknown as Opened<
    InstanceType<typeof FolderLibraryView>
  >;
  await view.setState({ folder }, {} as never);
  const parent = container();
  await view.open(parent);
  return { view, parent, controller, leaf };
}

const names = (rows: StubEl[]): string[] =>
  rows.map((row) => row.querySelector(".fs-title")?.textContent ?? "");

/** The Obsidian View/ItemView/Component methods a view must not replace. */
const OBSIDIAN_OWN = [
  "open",
  "close",
  "load",
  "unload",
  "onload",
  "onunload",
  "addChild",
  "removeChild",
  "register",
  "registerEvent",
  "registerDomEvent",
  "registerInterval",
  "getEphemeralState",
  "setEphemeralState",
  "onResize",
  "onPaneMenu",
  "onHeaderMenu",
  "focus",
];

describe.each([
  ["the Folders sidebar", () => FolderSidebarView],
  ["the Folders library", () => FolderLibraryView],
])("%s as a view", (_name, viewClass) => {
  it("defines none of Obsidian's lifecycle methods, only the hooks it is meant to", () => {
    const own = Object.getOwnPropertyNames(viewClass().prototype);
    expect(own.filter((name) => OBSIDIAN_OWN.includes(name))).toEqual([]);
    // Nor any other method of the base classes beyond the hooks a view overrides.
    const base = new Set([
      ...Object.getOwnPropertyNames(ItemView.prototype),
      ...Object.getOwnPropertyNames(Component.prototype),
    ]);
    const hooks = new Set([
      "constructor",
      "onOpen",
      "onClose",
      "getViewType",
      "getDisplayText",
      "getIcon",
      "getState",
      "setState",
    ]);
    expect(own.filter((name) => base.has(name) && !hooks.has(name))).toEqual([]);
  });

  it("has no member called open, close, load or unload anywhere up to ItemView", () => {
    for (
      let proto = viewClass().prototype as object;
      proto !== ItemView.prototype;
      proto = Object.getPrototypeOf(proto) as object
    ) {
      for (const name of ["open", "close", "load", "unload"]) {
        expect(Object.prototype.hasOwnProperty.call(proto, name), name).toBe(false);
      }
    }
  });
});

describe("the Folders sidebar", () => {
  it("is drawn inside the container it is opened in", async () => {
    const world = makeWorld(["Maths/Week 1/Notes.md", "Maths/Cells.md", "Physics/", "Inbox.md"]);
    const { view, parent } = await openSidebar(world);
    expect(parent.children).toContain(view.containerEl);
    expect(view.contentEl.hasClass("folder-sidebar-root")).toBe(true);
    expect(view.containerEl.contains(view.contentEl)).toBe(true);
    expect(view.contentEl.querySelector(".fs-pane")).not.toBeNull();
    expect(view.contentEl.querySelector(".fs-header-title")?.textContent).toBe("Folders");
    expect(names(view.contentEl.querySelectorAll(".fs-item"))).toEqual(["Maths", "Physics"]);
    expect(view.getViewType()).toBe(VIEW_TYPE_FOLDERS);
    expect(view.getViewType()).not.toBe("folder-sidebar-view");
    expect(view.getDisplayText()).toBe("Folders");
    expect(view.getIcon()).toBe("folder");
  });

  it("opens a folder in the library when it is tapped", async () => {
    const world = makeWorld(["Maths/Cells.md", "Physics/"]);
    const { view, controller } = await openSidebar(world);
    const row = view.contentEl.querySelectorAll(".fs-item")[1] as StubEl;
    row.click();
    await vi.waitFor(() => expect(controller.selectedFolderPath).toBe("Physics"));
    expect(world.app.workspace.leaves).toHaveLength(1);
    const leaf = world.app.workspace.leaves[0] as WorkspaceLeaf;
    expect(leaf.getViewState()).toMatchObject({
      type: VIEW_TYPE_FOLDER_LIBRARY,
      state: { folder: "Physics" },
    });
  });

  it("shows nested folders only when they are open, with the arrow, count and colour", async () => {
    const world = makeWorld(["Maths/Week 1/Notes.md", "Maths/Week 2/", "Maths/Cells.md", "Other/"]);
    world.data.folderColors.Maths = "#c4566f";
    const { view, controller } = await openSidebar(world);
    const rows = () => view.contentEl.querySelectorAll(".fs-item");
    expect(names(rows())).toEqual(["Maths", "Other"]);
    const maths = rows()[0] as StubEl;
    expect(maths.getAttribute("aria-expanded")).toBe("false");
    expect(maths.classes.has("has-color")).toBe(true);
    expect(maths.styles["--fs-color"]).toBe("#c4566f");
    expect(maths.querySelector(".fs-count")?.textContent).toBe("2");
    expect(rows()[1]?.querySelector(".fs-count")).toBeNull();
    controller.setExpanded("Maths", true);
    controller.notifyDataChanged();
    expect(names(rows())).toEqual(["Maths", "Week 1", "Week 2", "Other"]);
    expect((rows()[1] as StubEl).getAttribute("aria-level")).toBe("2");
  });

  it("lists files too when asked, and hides Attachments folders unless told not to", async () => {
    const world = makeWorld(["A/Note.md", "A/Attachments/pic.png", "A/B/"]);
    world.data.expanded.A = true;
    world.data.showFilesInSidebar = true;
    const { view, controller } = await openSidebar(world);
    const rows = () => view.contentEl.querySelectorAll(".fs-item");
    expect(names(rows())).toEqual(["A", "B", "Note"]);
    world.data.hideAttachmentFolders = false;
    controller.notifyDataChanged();
    expect(names(rows())).toEqual(["A", "Attachments", "B", "Note"]);
  });

  it("keeps pinned and recent folders on top, each once", async () => {
    const world = makeWorld(["A/", "B/", "C/", "D/", "E/"]);
    world.data.pinned = ["C", "Gone"];
    world.data.recent = ["C", "B", "D", "E", "A"];
    const { view } = await openSidebar(world);
    const labels = view.contentEl
      .querySelectorAll(".fs-section-label")
      .map((el) => el.textContent.trim());
    expect(labels).toEqual(["Pinned", "Recent", "All folders"]);
    const quick = view.contentEl.querySelectorAll(".fs-item.fs-quick");
    // Pinned first; then recent, minus the pinned one, three at most.
    expect(names(quick)).toEqual(["C", "B", "D", "E"]);
    expect(view.contentEl.querySelectorAll(".fs-item.fs-in-tree")).toHaveLength(5);
  });

  it("leaves out Pinned and Recent when they are turned off", async () => {
    const world = makeWorld(["A/", "B/"]);
    world.data.pinned = ["A"];
    world.data.recent = ["B"];
    world.data.showPinned = false;
    world.data.showRecent = false;
    const { view } = await openSidebar(world);
    expect(view.contentEl.querySelectorAll(".fs-section-label")).toHaveLength(0);
  });

  it("shows the tips card until it is dismissed, and remembers that", async () => {
    const world = makeWorld(["A/"]);
    const { view } = await openSidebar(world);
    expect(view.contentEl.querySelectorAll(".fs-intro-list li")).toHaveLength(4);
    (view.contentEl.querySelector(".fs-intro-ok") as StubEl).click();
    expect(world.data.seenIntro).toBe(true);
    expect(world.saves).toBeGreaterThan(0);
    expect(view.contentEl.querySelector(".fs-intro")).toBeNull();
  });

  it("filters folders by name and marks the match", async () => {
    const world = makeWorld(["Maths/Algebra/", "Maths/Cells/", "Physics/Optics/", "Chemistry/"]);
    const { view } = await openSidebar(world);
    const input = view.contentEl.querySelector(".fs-filter-input") as StubEl;
    input.value = "opt";
    input.dispatch("input");
    expect(names(view.contentEl.querySelectorAll(".fs-item"))).toEqual(["Physics", "Optics"]);
    expect(view.contentEl.querySelector(".fs-item mark")?.textContent).toBe("Opt");
    expect(view.contentEl.querySelector(".fs-search-label")?.textContent).toBe("In your notes");
    input.value = "zzzzzz";
    input.dispatch("input");
    expect(view.contentEl.querySelector(".fs-empty")?.textContent).toBe("No folder has that name.");
  });

  it("says no folder matches when searching inside notes is off", async () => {
    const world = makeWorld(["Maths/"]);
    world.data.searchInNotes = false;
    const { view } = await openSidebar(world);
    const input = view.contentEl.querySelector(".fs-filter-input") as StubEl;
    input.value = "xyz";
    input.dispatch("input");
    expect(view.contentEl.querySelector(".fs-empty")?.textContent).toBe('No folders match "xyz"');
    expect(view.contentEl.querySelector(".fs-search-label")).toBeNull();
  });

  it("asks for three letters before it searches inside notes", async () => {
    const world = makeWorld(["Maths/"]);
    const { view } = await openSidebar(world);
    const input = view.contentEl.querySelector(".fs-filter-input") as StubEl;
    input.value = "ma";
    input.dispatch("input");
    expect(view.contentEl.querySelector(".fs-search-note")?.textContent).toBe(
      "Type at least 3 letters to search inside notes.",
    );
  });

  it("shows the notes a search finds, and opens one", async () => {
    const world = makeWorld(["Notes/Cells.md"]);
    const controller = controllerFor(world);
    const hit = {
      path: "Notes/Cells.md",
      title: "Cells",
      kind: "note" as const,
      pages: [1],
      matchedPages: 1,
      snippet: "the powerhouse of the cell",
      score: 2,
      titleMatch: false,
    };
    vi.spyOn(controller.searchIndex, "search").mockResolvedValue({
      hits: [hit],
      tooShort: false,
      truncated: false,
    });
    const { view } = await openSidebar(world, controller);
    vi.useFakeTimers();
    const input = view.contentEl.querySelector(".fs-filter-input") as StubEl;
    input.value = "powerhouse";
    input.dispatch("input");
    expect(view.contentEl.querySelector(".fs-search-note")?.textContent).toBe("Searching…");
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();
    expect(view.contentEl.querySelector(".fs-hit-title")?.textContent).toBe("Cells");
    expect(view.contentEl.querySelector(".fs-hit-snippet")?.textContent).toBe(
      "the powerhouse of the cell",
    );
    expect(view.contentEl.querySelector(".fs-hit-meta")?.textContent).toBe("p. 1 · Notes");
    expect(view.contentEl.querySelector(".fs-hit")?.getAttribute("aria-label")).toBe("Open Cells");
  });

  it("makes a folder from the inline row, in the folder asked for", async () => {
    const world = makeWorld(["Maths/"]);
    const { view } = await openSidebar(world);
    view.beginCreate("Maths");
    const input = view.contentEl.querySelector(".fs-inline-row input") as StubEl;
    expect(input).not.toBeNull();
    expect(world.data.expanded.Maths).toBe(true);
    input.value = "Week 1";
    input.dispatch("keydown", { key: "Enter", isComposing: false });
    await vi.waitFor(() => expect(world.createdFolders).toEqual(["Maths/Week 1"]));
    expect(view.contentEl.querySelector(".fs-inline-row")).toBeNull();
  });

  it("gives a new folder a palette colour when it is set to", async () => {
    const world = makeWorld([]);
    world.data.autoColorNewFolders = true;
    const { view } = await openSidebar(world);
    view.beginCreate("");
    const row = view.contentEl.querySelector(".fs-inline-row") as StubEl;
    expect(row.classes.has("has-color")).toBe(true);
    (row.querySelector("input") as StubEl).value = "New";
    (row.querySelector("input") as StubEl).dispatch("keydown", { key: "Enter" });
    await vi.waitFor(() => expect(Object.keys(world.data.folderColors)).toEqual(["New"]));
  });

  it("refuses a name with a slash", async () => {
    const world = makeWorld([]);
    const { view } = await openSidebar(world);
    view.beginCreate("");
    const input = view.contentEl.querySelector(".fs-inline-row input") as StubEl;
    input.value = "a/b";
    input.dispatch("keydown", { key: "Enter" });
    await vi.waitFor(() =>
      expect(notices.map((n) => n.message)).toContain('Folder names cannot contain "/" or "\\".'),
    );
    expect(world.createdFolders).toEqual([]);
  });

  it("drops cancel on Escape", async () => {
    const world = makeWorld([]);
    const { view } = await openSidebar(world);
    view.beginCreate("");
    const input = view.contentEl.querySelector(".fs-inline-row input") as StubEl;
    input.value = "x";
    input.dispatch("keydown", { key: "Escape" });
    expect(view.contentEl.querySelector(".fs-inline-row")).toBeNull();
    expect(world.createdFolders).toEqual([]);
  });

  it("moves an item dropped on a folder, and not onto itself", async () => {
    const world = makeWorld(["A/", "B/", "B/C/"]);
    const { view } = await openSidebar(world);
    const rows = view.contentEl.querySelectorAll(".fs-item");
    const [a, b] = rows as [StubEl, StubEl];
    a.dispatch("dragstart");
    const over = b.dispatch("dragover", { dataTransfer: { dropEffect: "" } });
    expect(over.defaultPrevented).toBe(true);
    expect(b.classes.has("is-drop-target")).toBe(true);
    b.dispatch("drop", { dataTransfer: { getData: () => "" } });
    await vi.waitFor(() => expect(world.renamed).toEqual([["A", "B/A"]]));
    // Not onto itself.
    a.dispatch("dragstart");
    const self = a.dispatch("dragover", { dataTransfer: { dropEffect: "" } });
    expect(self.defaultPrevented).toBe(false);
  });

  it("moves an item dropped on the empty list to the root", async () => {
    const world = makeWorld(["A/B/", "A/C/"]);
    world.data.expanded.A = true;
    const { view } = await openSidebar(world);
    const rows = view.contentEl.querySelectorAll(".fs-item");
    (rows[1] as StubEl).dispatch("dragstart");
    const list = view.contentEl.querySelector(".fs-list") as StubEl;
    list.dispatch("drop", { dataTransfer: { getData: () => "" } });
    await vi.waitFor(() => expect(world.renamed).toEqual([["A/B", "B"]]));
  });

  it("takes a note dragged in from the library as text", async () => {
    const world = makeWorld(["A/", "Note.md"]);
    const { view } = await openSidebar(world);
    const row = view.contentEl.querySelector(".fs-item") as StubEl;
    const event = row.dispatch("dragover", {
      dataTransfer: { types: ["text/plain"], dropEffect: "" },
    });
    expect(event.defaultPrevented).toBe(true);
    row.dispatch("drop", { dataTransfer: { getData: () => "Note.md", types: ["text/plain"] } });
    await vi.waitFor(() => expect(world.renamed).toEqual([["Note.md", "A/Note.md"]]));
  });

  it("collapses every folder, and shows options on every folder in edit mode", async () => {
    const world = makeWorld(["A/B/C/"]);
    world.data.expanded = { A: true, "A/B": true };
    const { view } = await openSidebar(world);
    expect(view.contentEl.querySelectorAll(".fs-item")).toHaveLength(3);
    const buttons = view.contentEl.querySelectorAll(".fs-header-tools .fs-icon-button");
    (buttons[0] as StubEl).click();
    expect(world.data.expanded).toEqual({});
    expect(view.contentEl.querySelectorAll(".fs-item")).toHaveLength(1);
    const edit = buttons[3] as StubEl;
    edit.click();
    expect(view.contentEl.querySelector(".fs-pane")?.classes.has("is-edit")).toBe(true);
    expect(edit.getAttribute("aria-pressed")).toBe("true");
    edit.click();
    expect(view.contentEl.querySelector(".fs-pane")?.classes.has("is-edit")).toBe(false);
  });

  it("follows the vault: a new folder appears and a deleted one goes", async () => {
    const world = makeWorld(["A/"]);
    const { view } = await openSidebar(world);
    void (world.app.vault as { createFolder(path: string): Promise<void> }).createFolder("B");
    await vi.waitFor(() =>
      expect(names(view.contentEl.querySelectorAll(".fs-item"))).toEqual(["A", "B"]),
    );
  });

  it("shows the open folder as a path of buttons", async () => {
    const world = makeWorld(["A/B/C/"]);
    const { view, controller } = await openSidebar(world);
    controller.setSelectedFolder("A/B/C");
    const here = view.contentEl.querySelector(".fs-here") as StubEl;
    expect(here.classes.has("is-hidden")).toBe(false);
    expect(here.querySelectorAll(".fs-here-seg").map((seg) => seg.textContent)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(here.querySelector(".is-current")?.textContent).toBe("C");
  });
});

describe("the Folders library", () => {
  const stat = (world: World, path: string, ctime: number, mtime: number): void => {
    const file = world.node(path) as TFile;
    Object.assign(file.stat, { ctime, mtime });
  };

  it("is drawn inside the container it is opened in", async () => {
    const world = makeWorld(["School/Biology.notebook.md", "School/Cells.md", "School/Sub/"]);
    const { view, parent } = await openLibrary(world, "School");
    expect(parent.children).toContain(view.containerEl);
    expect(view.contentEl.hasClass("folder-library-root")).toBe(true);
    expect(view.contentEl.querySelector(".fl-title")?.textContent).toBe("School");
    expect(view.contentEl.querySelector(".fl-meta-counts")?.textContent).toBe(
      "2 notes · 1 subfolder",
    );
    expect(view.contentEl.querySelectorAll(".fl-card")).toHaveLength(2);
    expect(view.contentEl.querySelectorAll(".fl-folder-card")).toHaveLength(1);
    expect(view.getViewType()).toBe(VIEW_TYPE_FOLDER_LIBRARY);
    expect(view.getViewType()).not.toBe("folder-library-view");
    expect(view.getState()).toMatchObject({ folder: "School" });
    expect(view.getDisplayText()).toBe("School");
  });

  it("shows the whole vault at the root", async () => {
    const world = makeWorld(["Inbox.md", "School/A.md"]);
    const { view } = await openLibrary(world, "");
    expect(view.contentEl.querySelector(".fl-title")?.textContent).toBe("My Vault");
    expect(view.getDisplayText()).toBe("Library");
    expect(view.contentEl.querySelectorAll(".fl-card")).toHaveLength(1);
    expect(view.contentEl.querySelector(".fl-meta-counts")?.textContent).toBe(
      "2 notes · 1 subfolder",
    );
  });

  it("titles a note without its .notebook, and sorts by creation date, newest first", async () => {
    const world = makeWorld(["A.notebook.md", "B.md", "C.page.md"]);
    stat(world, "A.notebook.md", 1, 1);
    stat(world, "B.md", 3, 1);
    stat(world, "C.page.md", 2, 1);
    const { view } = await openLibrary(world);
    const titles = view.contentEl.querySelectorAll(".fl-card-title").map((el) => el.textContent);
    expect(titles).toEqual(["B.md".replace(".md", ""), "C", "A"].map((t) => t));
  });

  it("sorts by name when asked, and lists instead of a grid", async () => {
    const world = makeWorld(["b.md", "a.md", "c.md"]);
    world.data.librarySort = "name";
    world.data.librarySortDescending = false;
    world.data.libraryViewMode = "list";
    const { view } = await openLibrary(world);
    expect(view.contentEl.querySelectorAll(".fl-row-title").map((el) => el.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(view.contentEl.querySelector(".fl-list")).not.toBeNull();
    expect(view.contentEl.querySelector(".fl-grid")).toBeNull();
    expect(view.contentEl.querySelector(".fl-row-date")).not.toBeNull();
  });

  it("switches between grid and list from the toolbar", async () => {
    const world = makeWorld(["a.md"]);
    const { view, controller } = await openLibrary(world);
    expect(view.contentEl.querySelector("[data-fl-grid]")).not.toBeNull();
    const segments = view.contentEl.querySelectorAll(".fl-seg");
    expect(segments.map((s) => s.getAttribute("aria-label"))).toEqual(["Grid", "List"]);
    (segments[1] as StubEl).click();
    expect(world.data.libraryViewMode).toBe("list");
    expect(controller.data.libraryViewMode).toBe("list");
    expect(view.contentEl.querySelector(".fl-list")).not.toBeNull();
  });

  it("shows an empty folder with ways to fill it", async () => {
    const world = makeWorld(["Empty/"]);
    const { view } = await openLibrary(world, "Empty");
    expect(view.contentEl.querySelector(".fl-empty-text")?.textContent).toBe("No notes here yet");
    expect(view.contentEl.querySelectorAll(".fl-empty-actions .fl-text-button")).toHaveLength(2);
    expect(view.contentEl.querySelector(".fl-meta-counts")?.textContent).toBe("0 notes");
  });

  it("hides Attachments folders and dot files", async () => {
    const world = makeWorld(["Attachments/pic.png", ".hidden.md", "Real.md", "Real/"]);
    const { view } = await openLibrary(world);
    expect(view.contentEl.querySelectorAll(".fl-card")).toHaveLength(1);
    expect(
      view.contentEl
        .querySelectorAll(".fl-folder-card")
        .map((c) => c.querySelector(".fl-folder-title")?.textContent),
    ).toEqual(["Real"]);
    expect(view.contentEl.querySelector(".fl-meta-counts")?.textContent).toBe(
      "1 note · 1 subfolder",
    );
  });

  it("goes to another folder when told to, and starts at the top", async () => {
    const world = makeWorld(["A/x.md", "B/y.md", "B/z.md"]);
    const { view, controller } = await openLibrary(world, "A");
    view.setFolder("B");
    expect(view.contentEl.querySelector(".fl-title")?.textContent).toBe("B");
    expect(view.contentEl.querySelectorAll(".fl-card")).toHaveLength(2);
    expect(controller.selectedFolderPath).toBe("B");
    expect(view.getState()).toMatchObject({ folder: "B" });
  });

  it("follows its folder when it is renamed, and falls back when it is deleted", async () => {
    const world = makeWorld(["A/B/x.md"]);
    const { view } = await openLibrary(world, "A/B");
    world.rename("A/B", "A/C");
    expect(view.getState()).toMatchObject({ folder: "A/C" });
    expect(view.contentEl.querySelector(".fl-title")?.textContent).toBe("C");
    expect(view.contentEl.querySelectorAll(".fl-card")).toHaveLength(1);
    // Deleted, it falls back to the folder it was in.
    world.emit("delete", world.node("A/C"));
    (world.node("A") as { children: unknown[] }).children.length = 0;
    world.app.vault.getAbstractFileByPath = (path: string) =>
      path === "A" ? world.node("A") : null;
    world.emit("delete", world.node("A/C"));
    await vi.waitFor(() => expect(view.getState()).toMatchObject({ folder: "A" }));
  });

  it("selects notes and counts them", async () => {
    const world = makeWorld(["a.md", "b.md", "c.md"]);
    const { view } = await openLibrary(world);
    (view.contentEl.querySelector(".fl-toolbar .fl-text-button") as StubEl).click();
    expect(view.contentEl.querySelector(".fl-page")?.classes.has("is-selecting")).toBe(true);
    const bar = () => view.contentEl.querySelector(".fl-action-bar") as StubEl;
    expect(bar().querySelector(".fl-action-count")?.textContent).toBe("0 selected");
    const cards = view.contentEl.querySelectorAll(".fl-card");
    (cards[0] as StubEl).click();
    expect((cards[0] as StubEl).classes.has("is-selected")).toBe(true);
    expect(bar().querySelector(".fl-action-count")?.textContent).toBe("1 selected");
    const all = bar().querySelectorAll(".fl-action")[0] as StubEl;
    all.click();
    expect(bar().querySelector(".fl-action-count")?.textContent).toBe("3 selected");
    expect(bar().querySelectorAll(".fl-action")[0]?.textContent).toContain("Deselect all");
    expect(view.contentEl.querySelectorAll(".fl-card.is-selected")).toHaveLength(3);
  });

  it("opens a note in a tab of its own, never over the library", async () => {
    const world = makeWorld(["a.md"]);
    const opened: string[] = [];
    (world.app.workspace as Record<string, unknown>).getLeaf = () => {
      const leaf = new WorkspaceLeaf(world.app);
      leaf.view = { getViewType: () => VIEW_TYPE_FOLDER_LIBRARY };
      Object.assign(leaf, {
        openFile: (file: TFile) => {
          opened.push(file.path);
          leaf.view = { getViewType: () => "markdown", file };
          return Promise.resolve();
        },
      });
      return leaf;
    };
    const { view } = await openLibrary(world);
    (view.contentEl.querySelector(".fl-card") as StubEl).click();
    await vi.waitFor(() => expect(opened).toEqual(["a.md"]));
  });

  it("lets go of its thumbnails and observers when it closes", async () => {
    const world = makeWorld(["a.md"]);
    const { view } = await openLibrary(world);
    await view.onClose();
    expect(view.contentEl.querySelectorAll(".fl-card")).toHaveLength(1);
  });
});

describe("the controller", () => {
  it("keeps colours, open folders, pins and recents with a rename", () => {
    const world = makeWorld(["A/B/", "Z/"]);
    world.data.folderColors = { A: "red", "A/B": "blue" };
    world.data.expanded = { A: true, "A/B": true };
    world.data.pinned = ["A/B", "Z"];
    world.data.recent = ["A", "Z"];
    const controller = controllerFor(world);
    controller.followVault();
    controller.setSelectedFolder("A/B");
    world.rename("A", "Uni");
    expect(world.data.folderColors).toEqual({ Uni: "red", "Uni/B": "blue" });
    expect(world.data.expanded).toEqual({ Uni: true, "Uni/B": true });
    expect(world.data.pinned).toEqual(["Uni/B", "Z"]);
    // The folder the library showed went to the front of the recent ones, and was renamed with them.
    expect(world.data.recent).toEqual(["Uni/B", "Uni", "Z"]);
    expect(controller.selectedFolderPath).toBe("Uni/B");
    expect(world.saves).toBeGreaterThan(0);
  });

  it("forgets a deleted folder and what was in it, and steps the open folder up", () => {
    const world = makeWorld(["A/B/C/"]);
    world.data.folderColors = { "A/B": "blue", "A/B/C": "green", A: "red" };
    world.data.pinned = ["A/B/C", "A"];
    world.data.recent = ["A/B"];
    const controller = controllerFor(world);
    controller.followVault();
    controller.setSelectedFolder("A/B/C");
    world.emit("delete", world.node("A/B"));
    expect(world.data.folderColors).toEqual({ A: "red" });
    expect(world.data.pinned).toEqual(["A"]);
    // The folder the library falls back to is the latest one opened.
    expect(world.data.recent).toEqual(["A"]);
    expect(controller.selectedFolderPath).toBe("A");
  });

  it("tells the views when a colour or a pin changed, and saves", () => {
    const world = makeWorld(["A/"]);
    const controller = controllerFor(world);
    const changed = vi.fn();
    const stop = controller.onDataChange(changed);
    controller.setFolderColor("A", "#c4566f");
    controller.togglePinned("A");
    expect(controller.getFolderColor("A")).toBe("#c4566f");
    expect(controller.isPinned("A")).toBe(true);
    controller.togglePinned("A");
    controller.clearFolderColor("A");
    expect(controller.getFolderColor("A")).toBeNull();
    expect(changed).toHaveBeenCalledTimes(4);
    stop();
    controller.setFolderColor("A", "#fff");
    expect(changed).toHaveBeenCalledTimes(4);
    expect(world.saves).toBe(5);
  });

  it("keeps the last ten folders and the last six colours", () => {
    const world = makeWorld([]);
    const controller = controllerFor(world);
    for (let i = 0; i < 12; i++) controller.setSelectedFolder(`F${i}`);
    expect(world.data.recent).toEqual([
      "F11",
      "F10",
      "F9",
      "F8",
      "F7",
      "F6",
      "F5",
      "F4",
      "F3",
      "F2",
    ]);
    for (let i = 0; i < 8; i++) controller.addRecentColor(`#00000${i}`);
    expect(world.data.recentColors).toHaveLength(6);
    expect(world.data.recentColors[0]).toBe("#000007");
  });

  it("sorts: names go ascending, dates newest first", () => {
    const world = makeWorld([]);
    const controller = controllerFor(world);
    controller.setLibrarySort("name");
    expect(world.data).toMatchObject({ librarySort: "name", librarySortDescending: false });
    controller.setLibrarySort("modified");
    expect(world.data).toMatchObject({ librarySort: "modified", librarySortDescending: true });
    controller.setLibrarySortDescending(false);
    expect(world.data.librarySortDescending).toBe(false);
  });

  it("moves into a folder, opening it, and says when the name is taken", async () => {
    const world = makeWorld(["A/", "B/x.md", "x.md", "B/"]);
    const controller = controllerFor(world);
    await controller.moveItem("A", "B");
    expect(world.renamed).toEqual([["A", "B/A"]]);
    expect(world.data.expanded.B).toBe(true);
    await controller.moveItem("x.md", "B");
    expect(world.renamed).toHaveLength(1);
    expect(notices.map((n) => n.message)).toContain('"x.md" already exists in that folder.');
  });

  it("does not move the root, an item onto itself, or a folder into its own insides", async () => {
    const world = makeWorld(["A/B/"]);
    const controller = controllerFor(world);
    await controller.moveItem("", "A");
    await controller.moveItem("A", "A");
    await controller.moveItem("A", "A/B");
    await controller.moveItem("A/B", "A");
    await controller.moveItem("missing", "A");
    expect(world.renamed).toEqual([]);
  });

  it("says why a move failed", async () => {
    const world = makeWorld(["A/", "B/"]);
    (world.app.fileManager as { renameFile: unknown }).renameFile = () =>
      Promise.reject(new Error("locked"));
    await controllerFor(world).moveItem("A", "B");
    expect(notices.map((n) => n.message)).toContain('Could not move "A": locked');
  });

  describe("the simple look", () => {
    it("puts the Folders tab in the left split once, and takes it away when turned off", () => {
      const world = makeWorld([]);
      const controller = controllerFor(world);
      controller.syncSimpleLook(true);
      controller.syncSimpleLook(true);
      return vi
        .waitFor(() => {
          const leaves = world.app.workspace.leaves;
          expect(leaves).toHaveLength(1);
          expect(leaves[0]?.getViewState()).toMatchObject({
            type: VIEW_TYPE_FOLDERS,
            active: true,
          });
        })
        .then(() => {
          const [leaf] = world.app.workspace.leaves;
          controller.syncSimpleLook(false);
          expect(world.app.workspace.leaves).toEqual([]);
          expect((leaf as WorkspaceLeaf & { detached: number }).detached).toBe(1);
          controller.syncSimpleLook(false);
          expect(world.app.workspace.leaves).toEqual([]);
        });
    });

    it("starts the search index four seconds after it is turned on, and stops it when it is turned off", async () => {
      vi.useFakeTimers();
      const world = makeWorld([]);
      const controller = controllerFor(world);
      const start = vi.spyOn(controller.searchIndex, "start").mockResolvedValue();
      const stop = vi.spyOn(controller.searchIndex, "stop");
      controller.syncSimpleLook(true);
      await vi.advanceTimersByTimeAsync(SEARCH_START_DELAY_MS - 1);
      expect(start).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(start).toHaveBeenCalledTimes(1);
      controller.syncSimpleLook(false);
      expect(stop).toHaveBeenCalled();
      // Turned on again, it starts again.
      controller.syncSimpleLook(true);
      await vi.advanceTimersByTimeAsync(SEARCH_START_DELAY_MS);
      expect(start).toHaveBeenCalledTimes(2);
    });

    it("never starts the index when turned off before the delay is up", async () => {
      vi.useFakeTimers();
      const controller = controllerFor(makeWorld([]));
      const start = vi.spyOn(controller.searchIndex, "start").mockResolvedValue();
      controller.syncSimpleLook(true);
      await vi.advanceTimersByTimeAsync(1000);
      controller.syncSimpleLook(false);
      await vi.advanceTimersByTimeAsync(10000);
      expect(start).not.toHaveBeenCalled();
    });

    it("does not start the index while it has not been turned on", async () => {
      vi.useFakeTimers();
      const controller = controllerFor(makeWorld([]));
      const start = vi.spyOn(controller.searchIndex, "start").mockResolvedValue();
      controller.syncSimpleLook(false);
      await vi.advanceTimersByTimeAsync(10000);
      expect(start).not.toHaveBeenCalled();
    });

    it("stops the index and its timer when the plugin unloads", async () => {
      vi.useFakeTimers();
      const controller = controllerFor(makeWorld([]));
      const start = vi.spyOn(controller.searchIndex, "start").mockResolvedValue();
      const stop = vi.spyOn(controller.searchIndex, "stop");
      controller.syncSimpleLook(true);
      controller.dispose();
      await vi.advanceTimersByTimeAsync(10000);
      expect(start).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalled();
      // Nothing is brought back after that.
      controller.syncSimpleLook(true);
      await vi.advanceTimersByTimeAsync(10000);
      expect(start).not.toHaveBeenCalled();
    });
  });

  describe("one Folders tab", () => {
    async function withSidebar() {
      const world = makeWorld([]);
      const controller = controllerFor(world);
      controller.followVault();
      controller.syncSimpleLook(true);
      await vi.waitFor(() => expect(world.app.workspace.leaves).toHaveLength(1));
      return { world, controller };
    }

    /** A second tab, as Obsidian restores one a moment after the plugin was enabled. */
    function restoredLeaf(world: World): WorkspaceLeaf {
      const leaf = (world.app.workspace.getLeftLeaf as () => WorkspaceLeaf)();
      leaf.state = { type: VIEW_TYPE_FOLDERS, state: {} };
      return leaf;
    }

    it("keeps the first and closes the others when the layout changes", async () => {
      const { world } = await withSidebar();
      const first = world.app.workspace.leaves[0] as WorkspaceLeaf;
      const second = restoredLeaf(world);
      const third = restoredLeaf(world);
      world.trigger("layout-change");
      expect(world.app.workspace.leaves).toEqual([first]);
      expect((second as WorkspaceLeaf & { detached: number }).detached).toBe(1);
      expect((third as WorkspaceLeaf & { detached: number }).detached).toBe(1);
      world.trigger("layout-change");
      expect(world.app.workspace.leaves).toEqual([first]);
    });

    it("does not make a tab from a layout change, so one that was closed stays closed", async () => {
      const { world } = await withSidebar();
      (world.app.workspace.leaves[0] as WorkspaceLeaf).detach();
      expect(world.app.workspace.leaves).toEqual([]);
      world.trigger("layout-change");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(world.app.workspace.leaves).toEqual([]);
    });

    it("leaves tabs alone while the simple look is off", async () => {
      const { world, controller } = await withSidebar();
      controller.syncSimpleLook(false);
      const a = restoredLeaf(world);
      const b = restoredLeaf(world);
      world.trigger("layout-change");
      expect(world.app.workspace.leaves).toEqual([a, b]);
    });

    it("makes no second tab when turned on with one already there", () => {
      const world = makeWorld([]);
      const controller = controllerFor(world);
      const existing = restoredLeaf(world);
      controller.syncSimpleLook(true);
      return new Promise((resolve) => setTimeout(resolve, 20)).then(() => {
        expect(world.app.workspace.leaves).toEqual([existing]);
      });
    });
  });

  describe("the Folders tab at the front", () => {
    const type = (leaf: WorkspaceLeaf, viewType: string): WorkspaceLeaf => {
      leaf.state = { type: viewType, state: {} };
      return leaf;
    };
    const leftLeaf = (world: World) => world.app.workspace.getLeftLeaf as () => WorkspaceLeaf;
    /** A left split whose file explorer is in front and whose Folders tab was restored behind it. */
    function behindExplorer() {
      const world = makeWorld([]);
      const explorer = type(leftLeaf(world)(), "file-explorer");
      const folders = type(leftLeaf(world)(), VIEW_TYPE_FOLDERS);
      world.tabs.selected = explorer;
      const controller = controllerFor(world);
      controller.followVault();
      return { world, controller, explorer, folders };
    }
    const noJump = (world: World): void => {
      expect(world.revealLeaf).not.toHaveBeenCalled();
      expect(world.setActiveLeaf).not.toHaveBeenCalled();
      expect(world.leftSplit.expand).not.toHaveBeenCalled();
    };
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

    it("selects an existing Folders tab behind another one, without expanding or taking focus", async () => {
      const { world, controller, folders } = behindExplorer();
      controller.syncSimpleLook(true);
      await vi.waitFor(() => expect(world.tabs.selected).toBe(folders));
      expect(world.tabs.selectTab).toHaveBeenCalledTimes(1);
      expect(world.app.workspace.leaves).toHaveLength(2);
      noJump(world);
    });

    it("leaves a collapsed sidebar collapsed", async () => {
      const { world, controller, folders } = behindExplorer();
      world.leftSplit.collapsed = true;
      controller.syncSimpleLook(true);
      await vi.waitFor(() => expect(world.tabs.selected).toBe(folders));
      expect(world.leftSplit.collapsed).toBe(true);
      noJump(world);
    });

    it("does not take the tab back on a later layout change", async () => {
      const { world, controller, explorer, folders } = behindExplorer();
      controller.syncSimpleLook(true);
      await vi.waitFor(() => expect(world.tabs.selected).toBe(folders));
      // The person reveals another left panel with a command.
      world.tabs.selected = explorer;
      world.trigger("layout-change");
      world.trigger("layout-change");
      expect(world.tabs.selected).toBe(explorer);
      expect(world.tabs.selectTab).toHaveBeenCalledTimes(1);
    });

    it("selects a tab that arrives after the simple look turned on, once", async () => {
      const world = makeWorld([]);
      const controller = controllerFor(world);
      controller.followVault();
      const left = leftLeaf(world);
      const explorer = type(left(), "file-explorer");
      world.tabs.selected = explorer;
      // No tab can be made right now, and the saved Folders tab is not restored yet.
      world.app.workspace.getLeftLeaf = () => null;
      controller.syncSimpleLook(true);
      await settle();
      expect(world.tabs.selectTab).not.toHaveBeenCalled();
      const late = type(left(), VIEW_TYPE_FOLDERS);
      world.trigger("layout-change");
      expect(world.tabs.selected).toBe(late);
      world.tabs.selected = explorer;
      world.trigger("layout-change");
      expect(world.tabs.selected).toBe(explorer);
      expect(world.tabs.selectTab).toHaveBeenCalledTimes(1);
      noJump(world);
    });

    it("selects nothing once the simple look is off again", async () => {
      const world = makeWorld([]);
      const controller = controllerFor(world);
      controller.followVault();
      const left = leftLeaf(world);
      world.app.workspace.getLeftLeaf = () => null;
      controller.syncSimpleLook(true);
      await settle();
      controller.syncSimpleLook(false);
      type(left(), VIEW_TYPE_FOLDERS);
      world.trigger("layout-change");
      expect(world.tabs.selectTab).not.toHaveBeenCalled();
    });

    it("copes with a tab group that has no selectTab", async () => {
      const { world, controller, folders } = behindExplorer();
      (folders as { parent?: unknown }).parent = {};
      expect(() => controller.syncSimpleLook(true)).not.toThrow();
      await settle();
      expect(world.tabs.selectTab).not.toHaveBeenCalled();
    });

    it("does not bring back a Folders tab that was closed", async () => {
      const world = makeWorld([]);
      const controller = controllerFor(world);
      controller.followVault();
      controller.syncSimpleLook(true);
      await vi.waitFor(() => expect(world.app.workspace.leaves).toHaveLength(1));
      (world.app.workspace.leaves[0] as WorkspaceLeaf).detach();
      world.trigger("layout-change");
      await settle();
      expect(world.app.workspace.leaves).toEqual([]);
    });
  });

  describe("the library", () => {
    it("draws without making elements on the document, which Chromium refuses", async () => {
      const world = makeWorld(["A/x.notebook.md"]);
      expect(() => activeDocument.createDiv()).toThrow(/HierarchyRequestError/);
      expect(() => activeDocument.createEl("div")).toThrow(/HierarchyRequestError/);
      expect(() => activeDocument.createSpan()).toThrow(/HierarchyRequestError/);
      expect(createDiv({ cls: "x" }).isConnected).toBe(false);
      const { parent } = await openLibrary(world, "A");
      expect(parent.querySelector(".fl-section")).not.toBeNull();
    });

    it("opens in a tab of its own, at the folder asked for, and is reused after", async () => {
      const world = makeWorld(["A/", "B/"]);
      const controller = controllerFor(world);
      await controller.openFolderInLibrary("A");
      expect(world.app.workspace.leaves).toHaveLength(1);
      const leaf = world.app.workspace.leaves[0] as WorkspaceLeaf;
      expect(leaf.getViewState()).toMatchObject({
        type: VIEW_TYPE_FOLDER_LIBRARY,
        state: { folder: "A" },
      });
      // Its view takes the next folder.
      const view = new FolderLibraryView(leaf as never, controller);
      leaf.view = view;
      const setFolder = vi.spyOn(view, "setFolder");
      await controller.openFolderInLibrary("B");
      expect(world.app.workspace.leaves).toHaveLength(1);
      expect(setFolder).toHaveBeenCalledWith("B");
    });

    it("makes one tab when it is asked for twice at once", async () => {
      const world = makeWorld(["A/"]);
      const controller = controllerFor(world);
      await Promise.all([controller.openFolderInLibrary("A"), controller.openFolderInLibrary("A")]);
      expect(world.app.workspace.leaves).toHaveLength(1);
    });

    it("opens in the tab it was given when it is a new one", async () => {
      const world = makeWorld(["A/"]);
      const into = new WorkspaceLeaf(world.app);
      await controllerFor(world).openLibrary(into as never);
      expect(into.getViewState().type).toBe(VIEW_TYPE_FOLDER_LIBRARY);
      expect(world.app.workspace.leaves).toEqual([]);
    });

    it("opens at the folder last shown", async () => {
      const world = makeWorld(["A/"]);
      const controller = controllerFor(world);
      controller.setSelectedFolder("A");
      await controller.openLibrary();
      expect((world.app.workspace.leaves[0] as WorkspaceLeaf).getViewState().state).toEqual({
        folder: "A",
      });
    });
  });
});
