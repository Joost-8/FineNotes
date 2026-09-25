/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component } from "obsidian";
import { NewNotebookModal } from "../../../src/view/new-notebook-modal";
import { NoteSettingsModal } from "../../../src/view/note-settings-modal";
import { ExportPdfModal } from "../../../src/view/export-modal";
import { NotebookSearchModal } from "../../../src/view/search-modal";
import { AskAiModal } from "../../../src/view/ask-ai-modal";
import { GenerateImageModal } from "../../../src/view/generate-image-modal";
import { ScanSheet } from "../../../src/view/scan-sheet";
import { FolderSuggestModal } from "../../../src/view/folder-suggest";
import { RecordingSuggestModal } from "../../../src/view/audio-ui";
import { VaultBackdropRenderer } from "../../../src/view/backdrop-renderer";
import { ConfirmModal } from "../../../src/ui/confirm-modal";
import { ApiKeyModal } from "../../../src/ui/api-key-modal";
import { WhatsNewModal } from "../../../src/ui/whats-new-modal";
import { DEFAULT_NOTEBOOK_CHOICES } from "../../../src/model/new-notebook";
import { renderPageThumbnail } from "../../../src/canvas/renderer";
import { LIGHT_PAPER } from "../../../src/canvas/backdrop";
import { changelogSince } from "../../../src/changelog";
import changelog from "../../../CHANGELOG.md";
import type { Scene } from "./types";
import { fakeApp, notebook, noop } from "./fixtures";

const later = <T>(v: T, ms = 0): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));
const painter = new VaultBackdropRenderer(null);

function exportModal(pageCount: number): ExportPdfModal {
  const doc = notebook(pageCount);
  return new ExportPdfModal(fakeApp(), {
    noun: pageCount > 1 ? "notebook" : "page",
    pageCount,
    currentPage: Math.min(1, pageCount - 1),
    pageSize: (i: number) => doc.pages[i].geometry,
    folder: null,
    paintPreview: (canvas: HTMLCanvasElement, i: number, css: number) => {
      renderPageThumbnail(canvas, doc.pages[i], painter, css, 2, {
        usePressure: true,
        paper: LIGHT_PAPER,
      });
      return Promise.resolve();
    },
    fileNameFor: (pages: number[]) =>
      pages.length === pageCount
        ? "Biology.pdf"
        : `Biology, p. ${pages.map((p) => p + 1).join(", ")}.pdf`,
    export: () =>
      later({ path: "Biology/Biology.pdf", name: "Biology.pdf", bytes: new ArrayBuffer(8) }),
    open: noop,
  } as any);
}

const ANSWER = [
  "**Oxidative phosphorylation** is how the mitochondrion makes most of the cell's ATP.",
  "",
  "- The electron transport chain pumps protons across the inner membrane.",
  "- ATP synthase lets them flow back, and uses that flow to make ATP.",
  "",
  "Your sketch on page 3 shows the chain; the cristae you noted on page 2 are where it sits.",
].join("\n");

function askHost(): any {
  return {
    scope: "page",
    multiPage: true,
    sourcePath: "Biology/Biology.notebook.md",
    describe: (scope: string) =>
      scope === "page"
        ? "Sends an image of page 2 with your question."
        : "Sends images of all 12 pages with your question.",
    confirm: () => later(true),
    prepare: () => later({ images: [], pageNumbers: [2], totalPages: 12 }),
    ask: () => later(ANSWER, 30),
    insert: () => true,
  };
}

export const DIALOG_SCENES: Scene[] = [
  {
    id: "dialog-new-notebook",
    title: "New notebook",
    group: "Dialogs",
    note: "Title, notebook or single page, cover, paper, folder. src/view/new-notebook-modal.ts",
    settleMs: 400,
    render: () => {
      new NewNotebookModal(fakeApp(), {
        choices: { ...DEFAULT_NOTEBOOK_CHOICES },
        folder: "Biology",
        onCreate: noop,
      } as any).open();
    },
  },
  {
    id: "dialog-new-page",
    title: "New page (single page)",
    group: "Dialogs",
    note: "The same dialog set to a single page: no cover section.",
    settleMs: 400,
    render: () => {
      new NewNotebookModal(fakeApp(), {
        choices: { ...DEFAULT_NOTEBOOK_CHOICES, type: "single" },
        folder: "Biology",
        onCreate: noop,
      } as any).open();
    },
  },
  {
    id: "dialog-note-settings",
    title: "Notebook settings",
    group: "Dialogs",
    note: "Tier-1 gear: scroll direction, and where pictures, recordings and PDF exports are saved. src/view/note-settings-modal.ts",
    render: () => {
      new NoteSettingsModal(fakeApp(), {
        single: false,
        folders: () => ({ images: "Biology/Attachments" }),
        setFolder: noop,
        scrollDirection: () => "vertical",
        setScrollDirection: noop,
      } as any).open();
    },
  },
  {
    id: "dialog-export",
    title: "Export as PDF",
    group: "Dialogs",
    note: "Tier-1 share: all pages, this page, or chosen pages. src/view/export-modal.ts",
    settleMs: 600,
    render: () => exportModal(12).open(),
  },
  {
    id: "dialog-export-choose",
    title: "Export as PDF — choosing pages",
    group: "Dialogs",
    note: "“Choose pages”: tap thumbnails to pick them, in order, or type a range.",
    settleMs: 600,
    render: async ({ frame, settle }) => {
      exportModal(12).open();
      await settle(200);
      const choose = Array.from(
        frame.querySelectorAll<HTMLElement>(".goodobsidian-segmented button"),
      ).find((b) => /choose/i.test(b.textContent ?? ""));
      choose?.click();
      await settle(200);
      frame.querySelectorAll<HTMLElement>(".goodobsidian-export-tile")[1]?.click();
      frame.querySelectorAll<HTMLElement>(".goodobsidian-export-tile")[2]?.click();
    },
  },
  {
    id: "dialog-export-done",
    title: "Export as PDF — saved",
    group: "Dialogs",
    note: "After the export: where it was saved, Open, Done.",
    settleMs: 400,
    render: async ({ frame, settle }) => {
      exportModal(12).open();
      await settle(200);
      frame.querySelector<HTMLElement>(".goodobsidian-export-modal button.mod-cta")?.click();
      await settle(300);
    },
  },
  {
    id: "dialog-search",
    title: "Search this notebook",
    group: "Dialogs",
    note: "Tier-1 search over typed text and transcribed handwriting. src/view/search-modal.ts",
    settleMs: 300,
    render: () => {
      new NotebookSearchModal(fakeApp(), {
        index: [
          {
            pageIndex: 1,
            sources: [
              {
                kind: "text",
                text: "Mitochondria — double membrane, their own DNA. ATP is made by oxidative phosphorylation.",
              },
            ],
          },
          {
            pageIndex: 2,
            sources: [
              {
                kind: "handwriting",
                text: "Electron transport chain: complexes I–IV pump protons into the intermembrane space",
              },
            ],
          },
          {
            pageIndex: 6,
            sources: [
              {
                kind: "handwriting",
                text: "Exam: mitochondria and chloroplasts both came from bacteria",
              },
            ],
          },
        ],
        initial: "mito",
        onQuery: noop,
        goTo: noop,
      } as any).open();
    },
  },
  {
    id: "dialog-search-empty",
    title: "Search — nothing found",
    group: "Dialogs",
    note: "The search box when nothing matches.",
    settleMs: 300,
    render: () => {
      new NotebookSearchModal(fakeApp(), {
        index: [],
        initial: "ribosome",
        onQuery: noop,
        goTo: noop,
      } as any).open();
    },
  },
  {
    id: "dialog-ask-ai",
    title: "Ask AI",
    group: "AI",
    note: "Ask about this page or the whole notebook. src/view/ask-ai-modal.ts",
    render: () => new AskAiModal(fakeApp(), askHost()).open(),
  },
  {
    id: "dialog-ask-ai-answer",
    title: "Ask AI — an answer",
    group: "AI",
    note: "A question and its answer, with Copy and Insert as text box.",
    settleMs: 400,
    render: async ({ frame, settle }) => {
      new AskAiModal(fakeApp(), askHost()).open();
      await settle(100);
      const input = frame.querySelector<HTMLTextAreaElement>(".goodobsidian-ask-composer textarea");
      if (input) {
        input.value = "How does the cell make ATP here?";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      frame.querySelector<HTMLElement>(".goodobsidian-ask-composer button.mod-cta")?.click();
      await settle(300);
    },
  },
  {
    id: "dialog-generate-image",
    title: "Generate an image",
    group: "AI",
    note: "Describe a picture; it is placed on the page. src/view/generate-image-modal.ts",
    render: () =>
      new GenerateImageModal(fakeApp(), {
        target: "OpenAI",
        pageNumber: 2,
        aspect: "landscape",
        generate: () => later(true),
      } as any).open(),
  },
  {
    id: "dialog-scan",
    title: "Scan document",
    group: "Pictures",
    note: "Before a photo is taken: take a photo, or choose one or a PDF. src/view/scan-sheet.ts",
    render: () =>
      new ScanSheet(fakeApp(), { multiPage: true, insert: () => later(true) } as any).open(),
  },
  {
    id: "dialog-folder",
    title: "Choose a folder",
    group: "Dialogs",
    note: "The folder picker the dialogs open (Obsidian's fuzzy finder). src/view/folder-suggest.ts",
    settleMs: 300,
    render: () => new FolderSuggestModal(fakeApp(), noop, "Choose a folder…", "").open(),
  },
  {
    id: "dialog-recordings",
    title: "Pick a recording",
    group: "Dialogs",
    note: "Choosing which recording to transcribe (Obsidian's fuzzy finder).",
    settleMs: 300,
    render: () =>
      new RecordingSuggestModal(
        fakeApp(),
        [
          {
            id: "r1",
            path: "Biology/Attachments/Lecture 3.m4a",
            start: Date.UTC(2026, 8, 22, 9, 15),
            duration: 2_892_000,
          },
          {
            id: "r2",
            path: "Biology/Attachments/Lab briefing.m4a",
            start: Date.UTC(2026, 8, 23, 14, 0),
            duration: 400_000,
          },
        ] as any,
        noop,
      ).open(),
  },
  {
    id: "dialog-confirm",
    title: "Confirm — send to a cloud AI service",
    group: "Small dialogs",
    note: "The one-time consent before anything is sent. src/ui/confirm-modal.ts",
    render: () =>
      new ConfirmModal(fakeApp(), {
        title: "Send to a cloud AI service?",
        message:
          "Transcribing this page sends an image of the page (its ink, typed text and paper) to Anthropic using your API key. It leaves your device for that request only. GoodObsidian asks once per vault: after this, the AI features you start send what they need without asking again. Nothing is sent unless you start it, and manual transcription never uses the network.",
        cta: "Send",
      }).open(),
  },
  {
    id: "dialog-api-key",
    title: "Add an API key",
    group: "Small dialogs",
    note: "Settings → Add key. src/ui/api-key-modal.ts",
    render: () =>
      new ApiKeyModal(fakeApp(), {
        title: "Anthropic API key",
        placeholder: "sk-ant-…",
        where:
          "Create one at console.anthropic.com under API keys. It is kept in this device's keychain, never in the vault.",
        onSave: noop,
      } as any).open(),
  },
  {
    id: "dialog-whats-new",
    title: "What's new",
    group: "Small dialogs",
    note: "Shown once after an update. src/ui/whats-new-modal.ts",
    settleMs: 300,
    render: () => {
      const component = new Component();
      component.load();
      new WhatsNewModal(fakeApp(), changelogSince(changelog, "0.7.0"), component as never).open();
    },
  },
];
