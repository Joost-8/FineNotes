/* eslint-disable @typescript-eslint/no-explicit-any */
import { RecordingPill, AudioPlayerBar } from "../../../src/view/audio-ui";
import type { InkDocument } from "../../../src/model/document";
import type { Scene } from "./types";
import { blankPage, notebook, noop } from "./fixtures";
import { mountNotebook, tap, wake } from "./view";

const NOTE =
  "The notebook view as it opens on the iPad: Obsidian's view header, tier-1 toolbar, the tool's options pill floating over the page, the page on its desk.";

function withRecordings(doc: InkDocument): InkDocument {
  (doc as any).recordings = [
    {
      id: "r1",
      path: "Biology/Attachments/Lecture 3.m4a",
      start: Date.UTC(2026, 8, 22, 9, 15),
      duration: 48 * 60_000 + 12_000,
      transcript: "Biology/Lecture 3 transcript.md",
    },
    {
      id: "r2",
      path: "Biology/Attachments/Lab briefing.m4a",
      start: Date.UTC(2026, 8, 23, 14, 0),
      duration: 400_000,
    },
  ];
  return doc;
}

export const NOTEBOOK_SCENES: Scene[] = [
  {
    id: "notebook",
    title: "Notebook — reading a page",
    group: "Notebook view",
    note: NOTE,
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(300);
      wake(m.root, ".goodobsidian-pageindicator");
    },
  },
  {
    id: "notebook-portrait",
    title: "Notebook — portrait",
    group: "Notebook view",
    note: "The same view with the iPad upright (820 × 1180).",
    size: { width: 820, height: 1180 },
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(300);
      wake(m.root, ".goodobsidian-pageindicator");
    },
  },
  {
    id: "notebook-sidebar",
    title: "Notebook — page sidebar",
    group: "Notebook view",
    note: "The thumbnails panel (tier-1 button at far left). Tabs: Pages and Audio. src/view/page-sidebar.ts",
    settleMs: 900,
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      tap(m.button("Page thumbnails"));
      await settle(700);
    },
  },
  {
    id: "notebook-sidebar-audio",
    title: "Notebook — sidebar, Audio tab",
    group: "Notebook view",
    note: "Recordings made in this note, with play, transcribe and delete. src/view/audio-ui.ts (RecordingsPanel)",
    settleMs: 900,
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: withRecordings(notebook()) });
      m.surface.goToPage(1);
      tap(m.button("Page thumbnails"));
      await settle(500);
      m.sidebar.showTab("audio");
      m.view.audio?.attachPanel?.(m.root.querySelector(".goodobsidian-pagesidebar-audio"));
      await settle(300);
    },
  },
  {
    id: "notebook-new",
    title: "Notebook — a new, empty notebook",
    group: "Notebook view",
    note: "What a new notebook looks like on first open: one blank page, the text tool's first-use hint.",
    render: async ({ frame, settle }) => {
      const doc = {
        version: 3,
        view: {},
        pages: [blankPage("p1", { kind: "ruled-narrow" })],
      } as unknown as InkDocument;
      const m = await mountNotebook(frame, { doc, file: "Untitled notebook.notebook.md" });
      await settle(200);
      m.surface.showTextHint("Tap to add a text box. It grows as you type.", noop);
      wake(m.root, ".goodobsidian-pageindicator");
    },
  },
  {
    id: "notebook-recording",
    title: "Notebook — recording audio",
    group: "Notebook view",
    note: "While the microphone records: the mic button turns to Stop, a pill shows the time. src/view/audio-ui.ts (RecordingPill)",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(200);
      m.toolbar.setRecording(true);
      const pill = new RecordingPill(m.surface.surfaceEl, noop, noop);
      pill.update(4 * 60_000 + 17_000);
    },
  },
  {
    id: "notebook-player",
    title: "Notebook — playing a recording",
    group: "Notebook view",
    note: "The player bar at the foot of the page, with its standing hint. src/view/audio-ui.ts (AudioPlayerBar)",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: withRecordings(notebook()) });
      m.surface.goToPage(1);
      await settle(200);
      const bar = new AudioPlayerBar(m.surface.surfaceEl, noop);
      bar.load((m.surface.document as any).recordings[0], "");
    },
  },
  {
    id: "notebook-pull-add",
    title: "Notebook — pull to add a page",
    group: "Notebook view",
    note: "Pulling past the last page arms 'Release to add page'. src/view/pull-add-indicator.ts",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook(4) });
      m.surface.goToPage(3);
      await settle(300);
      m.surface.pullAdd.update("vertical", 90, 1);
    },
  },
  {
    id: "notebook-offpage",
    title: "Notebook — ink outside the page",
    group: "Notebook view",
    note: "The toast after a stroke that left the page, with Undo. It is frosted: the page shows through.",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(200);
      m.root.querySelector(".goodobsidian-offpage")?.classList.remove("is-hidden");
    },
  },
  {
    id: "notebook-zoomed",
    title: "Notebook — zoomed in",
    group: "Notebook view",
    note: "Pinch-zoomed: the zoom readout and the scroll thumbs appear, then fade.",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook() });
      m.surface.goToPage(1);
      await settle(200);
      m.surface.zoomIn();
      m.surface.zoomIn();
      await settle(600);
      wake(
        m.root,
        ".goodobsidian-zoomreadout",
        ".goodobsidian-scrollthumb",
        ".goodobsidian-pageindicator",
      );
    },
  },
  {
    id: "notebook-lasso",
    title: "Lasso — a selection and its action bar",
    group: "Selection",
    note: "Ink circled with the lasso: the selection frame and the dark action bar above it. src/view/selection-bar.ts",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, {
        doc: notebook(),
        settings: { defaultTool: "select" },
      });
      m.surface.goToPage(1);
      await settle(300);
      const page = m.surface.document.pages[1];
      m.surface.select(page.id, { strokes: page.strokes.slice(1, 4), images: [], textBoxes: [] });
      await settle(200);
    },
  },
  {
    id: "notebook-lasso-menu",
    title: "Lasso — the selection's ⋯ menu",
    group: "Selection",
    note: "The action bar's ⋯: tiles, rows and ink colours for the selection.",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, {
        doc: notebook(),
        settings: { defaultTool: "select" },
      });
      m.surface.goToPage(1);
      await settle(300);
      const page = m.surface.document.pages[1];
      m.surface.select(page.id, { strokes: page.strokes.slice(1, 4), images: [], textBoxes: [] });
      await settle(200);
      const more = m.root.querySelector(".goodobsidian-selection-bar .is-more");
      if (more) tap(more);
      await settle(200);
    },
  },
  {
    id: "notebook-image",
    title: "Picture — selected, with handles",
    group: "Selection",
    note: "A picture on the page, selected: resize and rotate handles, and its action bar.",
    render: async ({ frame, settle }) => {
      const doc = notebook();
      const page = doc.pages[1] as any;
      page.images = [
        { id: "img1", path: "Biology/cell.png", x: 560, y: 760, w: 360, h: 260, rotation: 0 },
      ];
      const m = await mountNotebook(frame, { doc });
      m.surface.goToPage(1);
      await settle(300);
      m.surface.selectImage(page.id, "img1");
      await settle(200);
    },
  },
  {
    id: "notebook-text-editing",
    title: "Text — editing a text box",
    group: "Selection",
    note: "A text box being typed in: its move and resize handles, and the text tool's pill with the box's style.",
    render: async ({ frame, settle }) => {
      const m = await mountNotebook(frame, { doc: notebook(), settings: { defaultTool: "text" } });
      m.surface.goToPage(1);
      await settle(300);
      const input = m.root.querySelector<HTMLTextAreaElement>(".goodobsidian-page-textbox-input");
      if (input) {
        m.surface.focusTextBox(input);
        // A background browser pane fires no focus event for focus(); send it.
        input.dispatchEvent(new FocusEvent("focus"));
        input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      }
      await settle(200);
    },
  },
];
