/**
 * Ask AI about a text note, in the notebook's own chat (`AskChat`, an
 * `AskSession`), in a window floating over the note that is moved by its
 * bar and sized from its corner (`FloatingWindow`, as the calculator's),
 * opened where it was left on this device. The note's text, and each handwriting section as a
 * picture, go with every question as the note is then
 * (`recognition/ask-note.ts`). Nothing is sent before the same one-time
 * consent a notebook asks for (`plugin.confirmAiSend`, which records it);
 * the chat shows what goes, and saved chats go to the note's `AI chats`
 * folder, linking back to it.
 */

import { type App, type TFile } from "obsidian";
import { t } from "../i18n/translate";
import { paintInk, penFor } from "../canvas/renderer";
import { drawSyntheticRules, paperTheme } from "../canvas/backdrop";
import { inkRuns } from "../ink/freehand";
import { INK_WIDTH, clampInkHeight, inkBottom, type TextNote } from "../model/text-note";
import { askAi, targetLabel } from "../recognition/ai-client";
import type { ChatImage, ChatTurn } from "../recognition/ai-chat";
import { buildNoteAskSystemPrompt, noteAskFile, withNoteContext } from "../recognition/ask-note";
import { AskSession } from "../recognition/ask-session";
import type GoodObsidianPlugin from "../main";
import type { AskAiHost } from "./ask-ai-modal";
import { AskChatWindow } from "./ask-window";
import { ensureFolder } from "./note-files";
import { readAttachment, trashChat, writeChat } from "./ask-chats-io";

export interface NoteAskHost {
  readonly app: App;
  plugin: GoodObsidianPlugin;
  file: () => TFile | null;
  /** The note as it is now. */
  note: () => TextNote;
  /** Where saved chats go. */
  chatsFolder: () => string;
  /** Put an answer's text in the note at the caret; false when it could not. */
  insert: (text: string) => boolean;
  /** Put an answer's drawing in the note as a picture. */
  insertDrawing: (svg: string) => Promise<boolean>;
  /** What the window floats over and stays inside: the note view's content. */
  container: () => HTMLElement;
  /** The window opened or closed (the bar's button shows it). */
  changed: () => void;
}

/** The handwriting sections' pictures are this many px a section unit: legible, and small. */
const ASK_SCALE = 1.5;

/** Each handwriting section that holds ink as a picture, on white, in the note's order. */
export function inkSectionImages(
  note: TextNote,
  options: { pressure: boolean; highlighterAlpha: number },
): ChatImage[] {
  const images: ChatImage[] = [];
  for (const block of note.blocks) {
    if (block.type !== "ink" || block.strokes.length === 0) continue;
    const height = Math.min(clampInkHeight(block.height), Math.ceil(inkBottom(block.strokes) + 16));
    const canvas = createEl("canvas");
    canvas.width = Math.round(INK_WIDTH * ASK_SCALE);
    canvas.height = Math.max(1, Math.round(height * ASK_SCALE));
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(ASK_SCALE, ASK_SCALE);
    if (block.paper && block.paper !== "blank") {
      drawSyntheticRules(
        ctx,
        { kind: block.paper },
        { width: INK_WIDTH, height },
        paperTheme(false),
      );
    }
    const ordered = [
      ...block.strokes.filter((s) => s.tool === "highlighter"),
      ...block.strokes.filter((s) => s.tool !== "highlighter"),
    ];
    for (const stroke of ordered) {
      const pen = penFor({
        size: stroke.size,
        tool: stroke.tool,
        usePressure: options.pressure,
        ...(stroke.nib !== undefined ? { nib: stroke.nib } : {}),
        ...(stroke.tip !== undefined ? { tip: stroke.tip } : {}),
      });
      const runs = inkRuns(stroke.pts, pen, stroke.shape !== undefined, stroke.tilt);
      if (runs.length === 0) continue;
      ctx.globalAlpha = stroke.tool === "highlighter" ? options.highlighterAlpha : 1;
      ctx.fillStyle = stroke.color;
      paintInk(ctx, runs);
    }
    ctx.globalAlpha = 1;
    const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
    canvas.width = 0;
    canvas.height = 0;
    if (base64) images.push({ base64, mimeType: "image/png" });
  }
  return images;
}

export class NoteAsk {
  private session: AskSession | null = null;
  private sessionFor = "";
  private window: AskChatWindow | null = null;

  constructor(private readonly host: NoteAskHost) {}

  get isOpen(): boolean {
    return this.window?.isOpen === true;
  }

  /**
   * Open the chat about this note as a window over it (`AskChatWindow`, as
   * a notebook's), or close it when it is open: a second tap on the bar's
   * button, as the calculator's. The same chat comes back while the note
   * stays open.
   */
  toggle(): void {
    const file = this.host.file();
    if (this.isOpen || !file) {
      this.close();
      return;
    }
    this.window ??= new AskChatWindow(this.host.app, this.host.container(), {
      host: () => this.askHost(this.host.file() ?? file),
      changed: () => this.host.changed(),
    });
    this.window.open();
  }

  close(): void {
    this.window?.close();
  }

  private conversation(file: TFile): AskSession {
    const { plugin } = this.host;
    if (this.session && this.sessionFor === file.path) return this.session;
    this.sessionFor = file.path;
    this.session = new AskSession(
      {
        notebookPath: () => this.host.file()?.path ?? "",
        // The one rule notebooks ask by: the same consent, recorded the same way.
        confirm: () =>
          plugin.confirmAiSend(
            plugin.textAiConfig(),
            t("view.ask.consentTitle"),
            t("notebooks.note.askConsentWhat"),
          ),
        preparePages: () => Promise.resolve({ images: [], pageNumbers: [], totalPages: 0 }),
        ask: (turns) => this.ask(turns),
        // Every chat is kept, in the note's AI chats folder (made with the folders above it).
        save: async (chat, path) => {
          const folder = this.host.chatsFolder();
          await ensureFolder(this.host.app, folder);
          return writeChat(this.host.app, chat, path, folder);
        },
        unsave: (path) => trashChat(this.host.app, path),
        readFile: (path) => readAttachment(this.host.app, path),
        now: () => new Date(),
      },
      { page: 0, totalPages: 0, save: true, attachPage: false },
    );
    return this.session;
  }

  /** The question goes with the note as it is now: its text, and its handwriting as pictures. */
  private ask(turns: readonly ChatTurn[]): ReturnType<typeof askAi> {
    const { plugin } = this.host;
    const note = this.host.note();
    const name = this.host.file()?.name ?? "Note.note.md";
    const sent = withNoteContext(turns, noteAskFile(name, note));
    const images = inkSectionImages(note, {
      pressure: plugin.settings.pressureWidth,
      highlighterAlpha: plugin.settings.highlighterAlpha,
    });
    const last = sent.length - 1;
    if (images.length > 0 && last >= 0) {
      sent[last] = { ...sent[last], images: [...(sent[last].images ?? []), ...images] };
    }
    return askAi(plugin.textAiConfig(), buildNoteAskSystemPrompt(), sent);
  }

  private askHost(file: TFile): AskAiHost {
    const { plugin } = this.host;
    const session = this.conversation(file);
    return {
      session,
      sourcePath: file.path,
      target: targetLabel(plugin.textAiConfig()),
      showCost: () => plugin.settings.askShowCost,
      openAppLink: (url) => plugin.openFinenotesLink(url),
      subject: {
        line: (saved) =>
          t(saved ? "notebooks.note.askLineSaved" : "notebooks.note.askLine", {
            target: targetLabel(plugin.textAiConfig()),
          }),
        empty: t("notebooks.note.askEmpty"),
        suggestions: [
          t("ai.ask.suggestScreen.summarise"),
          t("notebooks.note.askKeyPoints"),
          t("ai.ask.suggestScreen.check"),
          t("ai.ask.suggestScreen.quiz"),
        ],
      },
      currentPage: () => 0,
      pageHasContent: () => false,
      paintThumbnail: () => Promise.resolve(),
      insert: (text) => this.host.insert(text),
      insertDrawing: (svg) => this.host.insertDrawing(svg),
      notebookPdfs: () => [],
    };
  }
}
