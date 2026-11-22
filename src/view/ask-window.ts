/**
 * Ask as a window floating over the notebook or the text note: the chat
 * (`AskChat`) in a `FloatingWindow`, as the calculator's, so it is moved by
 * its bar, sized from its corner and stays inside the view. It opens where
 * it was left on this device, notebook or note alike, and the page behind
 * it stays usable. The notebook's other layout, the sidebar beside the page
 * (`AskChatPanel`), is unchanged.
 */

import type { App } from "obsidian";
import { t } from "../i18n/translate";
import { ASK_WINDOW_MIN, defaultAskWindowPlace, parseAskWindowPlace } from "../model/ask-window";
import { AskChat, type AskAiHost } from "./ask-ai-modal";
import { DialogKeyboard } from "./dialog-keyboard";
import { FloatingWindow } from "./floating-window";

/** Where the window's place is kept on this device. */
const PLACE_KEY = "finenotes-ask-window";

export class AskChatWindow {
  private frame: FloatingWindow | null = null;
  private chat: AskChat | null = null;

  constructor(
    private readonly app: App,
    private readonly container: HTMLElement,
    private readonly callbacks: {
      host: () => AskAiHost;
      /** The window opened or closed. */
      changed?: () => void;
      /** Show the same chat in the sidebar instead (a notebook's other layout). */
      switchLayout?: () => void;
    },
  ) {}

  get isOpen(): boolean {
    return this.frame !== null;
  }

  open(): void {
    if (this.frame) {
      this.frame.raise();
      return;
    }
    const { app } = this;
    const frame = new FloatingWindow({
      container: this.container,
      cls: "goodobsidian-ask-window",
      title: t("ai.ask.title"),
      label: t("ai.ask.title"),
      min: ASK_WINDOW_MIN,
      firstPlace: defaultAskWindowPlace,
      place: () => parseAskWindowPlace(app.loadLocalStorage(PLACE_KEY)),
      savePlace: (place) => app.saveLocalStorage(PLACE_KEY, JSON.stringify(place)),
      onClose: () => this.close(),
    });
    // The chat's own styles are scoped to the frames it is drawn in.
    frame.el.addClass("goodobsidian-ask-frame");
    // The reach pill (what Ask may read) goes right of the title; the title
    // itself is hidden from screen readers (the window is named), the pill is not.
    const title = frame.el.querySelector<HTMLElement>(".goodobsidian-ask-window-title");
    const reach = createSpan({ cls: "goodobsidian-ask-window-reach" });
    title?.after(reach);
    this.frame = frame;
    const switchLayout = this.callbacks.switchLayout;
    this.chat = new AskChat(app, this.callbacks.host(), {
      el: frame.el,
      title: reach,
      content: frame.body,
      keyboard: new DialogKeyboard(frame.el, { pad: true }),
      layout: "window",
      switchLayout: () => {
        this.close();
        switchLayout?.();
      },
    });
    this.chat.mount();
    this.callbacks.changed?.();
  }

  /** Take the window down; the conversation lives on in its session. */
  close(): void {
    if (!this.frame) return;
    this.chat?.destroy();
    this.chat = null;
    this.frame.destroy();
    this.frame = null;
    this.callbacks.changed?.();
  }
}
