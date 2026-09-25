/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The panels the notebook view opens from its toolbar and page sidebar,
 * opened through the real view so they sit where they sit on the iPad.
 */
import { registerImageMenuEntry, VaultImageSuggestModal } from "../../../src/view/image-menu";
import { TemplatePickerModal } from "../../../src/view/template-picker";
import type { Scene } from "./types";
import { fakeApp, notebook, noop } from "./fixtures";
import { mountNotebook, tap } from "./view";

// The entries main.ts registers at load.
let registered = false;
function registerExtraImageEntries(): void {
  if (registered) return;
  registered = true;
  registerImageMenuEntry({
    id: "generate",
    icon: "sparkles",
    label: "Generate with AI",
    order: 50,
    run: noop,
  });
  registerImageMenuEntry({
    id: "scan",
    icon: "scan-line",
    label: "Scan document",
    order: 40,
    run: noop,
  });
  registerImageMenuEntry({
    id: "scan-pdf",
    icon: "file-text",
    label: "Scanned PDF from Files",
    order: 45,
    run: noop,
  });
}

const GEOMETRY = { width: 1024, height: 1448 };

export const PANEL_SCENES: Scene[] = [
  {
    id: "panel-add-page",
    title: "Add Page",
    group: "Pages",
    note: "Tier-1 “+”: before / after / last, recent templates that inherit this page's paper, more templates. src/view/template-picker.ts (AddPagePopover)",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(200);
      tap(m.button("Add page"));
    },
  },
  {
    id: "panel-templates",
    title: "Templates",
    group: "Pages",
    note: "“More from templates…”: paper size and colour, orientation, and the template grid by section. src/view/template-picker.ts (TemplatePickerModal)",
    settleMs: 400,
    render: () => {
      new TemplatePickerModal(fakeApp(), {
        mode: "add",
        initial: { kind: "ruled-narrow" } as never,
        geometry: GEOMETRY as never,
        onApply: noop,
      }).open();
    },
  },
  {
    id: "panel-templates-change",
    title: "Change template",
    group: "Pages",
    note: "The same picker, changing the current page's paper (adds “Current size”).",
    settleMs: 400,
    render: () => {
      new TemplatePickerModal(fakeApp(), {
        mode: "change",
        initial: { kind: "squared" } as never,
        geometry: GEOMETRY as never,
        onApply: noop,
      }).open();
    },
  },
  {
    id: "panel-cover",
    title: "Change cover",
    group: "Pages",
    note: "Cover designs and colours, from the ⋯ panel on a cover page. src/view/cover-picker.ts (CoverPopover)",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      await settle(200);
      m.view.openCoverPicker(m.button("More"), 0);
    },
  },
  {
    id: "panel-more",
    title: "More (⋯)",
    group: "Pages",
    note: "Tier-1 ⋯: this page's actions — bookmark, link, duplicate, template, go to page, clear, delete. src/view/more-panel.ts",
    settleMs: 400,
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(200);
      tap(m.button("More"));
    },
  },
  {
    id: "panel-page-menu",
    title: "Page menu (sidebar)",
    group: "Pages",
    note: "The chevron under a thumbnail in the page sidebar: Obsidian's own menu. src/view/page-sidebar.ts",
    settleMs: 300,
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      tap(m.button("Page thumbnails"));
      await settle(700);
      const more = m.root.querySelectorAll(".goodobsidian-thumb-more")[1];
      if (more) tap(more);
    },
  },
  {
    id: "panel-sidebar-filter",
    title: "Sidebar — bookmarks filter",
    group: "Pages",
    note: "The sidebar showing bookmarked pages only, none yet: the empty state.",
    settleMs: 400,
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      tap(m.button("Page thumbnails"));
      await settle(600);
      m.sidebar.setFilter("bookmarks");
    },
  },
  {
    id: "panel-image-menu",
    title: "Insert image",
    group: "Pictures",
    note: "Tier-1 image button: photos, camera, vault, scan, scanned PDF, generate. src/view/image-menu.ts",
    render: async ({ frame, settle }) => {
      registerExtraImageEntries();
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(200);
      tap(m.button("Insert image"));
    },
  },
  {
    id: "panel-vault-image",
    title: "Picture from the vault",
    group: "Pictures",
    note: "“From vault”: Obsidian's fuzzy finder over the vault's pictures.",
    render: () => {
      new VaultImageSuggestModal(fakeApp(), noop).open();
    },
  },
  {
    id: "panel-ai-menu",
    title: "AI menu — not set up",
    group: "AI",
    note: "Tier-1 sparkles before an API key is added: every entry says what it needs. src/view/ai-menu.ts",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(200);
      tap(m.button("AI"));
    },
  },
  {
    id: "panel-ai-menu-ready",
    title: "AI menu — ready",
    group: "AI",
    note: "The same menu with a key: transcribe, ask, generate an image.",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook(), aiReady: true });
      m.surface.goToPage(1);
      await settle(200);
      tap(m.button("AI"));
    },
  },
];
