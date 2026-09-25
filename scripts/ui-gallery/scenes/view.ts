/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The real notebook view (InkView) mounted in a frame, with a fake leaf, app
 * and plugin. Scenes then drive it the way a user would: click a toolbar
 * button, open the sidebar, start a recording.
 */
import { TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { InkView } from "../../../src/view/ink-view";
import { DEFAULT_SETTINGS } from "../../../src/settings";
import { LLM_PROVIDER_ID } from "../../../src/recognition/llm-request";
import { buildInkFile } from "../../../src/model/serialize";
import type { InkDocument } from "../../../src/model/document";
import { fakeApp, noop } from "./fixtures";
import { registerSurface } from "./surface-export";

export interface Mounted {
  view: any;
  root: HTMLElement;
  surface: any;
  toolbar: any;
  sidebar: any;
  audio: any;
  /** A toolbar button by its aria-label (prefix match). */
  button(label: string): HTMLElement;
}

export interface MountOptions {
  doc: InkDocument;
  file?: string;
  settings?: Record<string, unknown>;
  /** AI set up with a key, so the AI menu is live. */
  aiReady?: boolean;
  /** An Obsidian view header above the notebook, as on the iPad. */
  header?: boolean;
}

export function fakePlugin(
  app: any,
  opts: { settings?: Record<string, unknown>; aiReady?: boolean } = {},
): any {
  const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const known: Record<string, unknown> = {
    app,
    settings,
    manifest: { id: "finenotes", name: "FineNotes", version: "0.8.0" },
    keys: { secure: true },
    providers: new Map([
      ["manual", { id: "manual", name: "None" }],
      [LLM_PROVIDER_ID, { id: LLM_PROVIDER_ID, name: "AI with your own key" }],
    ]),
    aiSetup: () => ({
      vendor: "anthropic",
      baseUrl: "",
      imageVendor: "openai",
      hasKey: () => opts.aiReady === true,
    }),
    aiTranscriber: () => ({ requiresNetwork: true }),
    activeProvider: () => ({ id: "manual", requiresNetwork: false }),
    apiKeyFor: () => (opts.aiReady ? "sk-…" : ""),
    maybeShowScribbleNotice: () => Promise.resolve(),
    confirmAiSend: () => Promise.resolve(false),
  };
  return new Proxy(known, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (typeof key === "symbol" || key === "then") return undefined;
      return noop;
    },
  });
}

function addHeader(view: any, title: string): void {
  const header = view.containerEl.querySelector(".view-header") as HTMLElement;
  header.empty();
  const nav = header.createDiv({ cls: "view-header-left" });
  const navButtons = nav.createDiv({ cls: "view-header-nav-buttons" });
  for (const icon of ["arrow-left", "arrow-right"]) {
    const b = navButtons.createEl("button", { cls: "clickable-icon" });
    setIcon(b, icon);
  }
  const titleBox = header.createDiv({ cls: "view-header-title-container mod-at-start" });
  titleBox.createDiv({ cls: "view-header-title", text: title });
  const actions = header.createDiv({ cls: "view-actions" });
  const more = actions.createEl("button", {
    cls: "clickable-icon view-action",
    attr: { "aria-label": "More options" },
  });
  setIcon(more, "more-vertical");
}

export async function mountNotebook(frame: HTMLElement, opts: MountOptions): Promise<Mounted> {
  const app = fakeApp();
  const plugin = fakePlugin(app, opts);
  const leaf = new WorkspaceLeaf(app);
  const view: any = new InkView(leaf as never, plugin);
  const path = opts.file ?? "Biology/Biology.notebook.md";
  const file = new TFile(path);
  file.stat.size = 1;
  view.file = file;
  const shell = view.containerEl as HTMLElement;
  shell.setCssStyles({
    position: "absolute",
    inset: "0",
    display: "flex",
    flexDirection: "column",
  });
  (view.contentEl as HTMLElement).setCssStyles({
    flex: "1 1 auto",
    position: "relative",
    minHeight: "0",
  });
  if (opts.header === false) shell.querySelector(".view-header")?.remove();
  else addHeader(view, file.basename.replace(/\.(notebook|page|ink)$/, ""));
  frame.appendChild(shell);
  await view.onOpen();
  view.setViewData(buildInkFile("", opts.doc), true);
  registerSurface(view.surface);
  await new Promise((r) => setTimeout(r, 100));
  const root = view.contentEl as HTMLElement;
  return {
    view,
    root,
    surface: view.surface,
    toolbar: view.toolbar,
    sidebar: view.sidebar,
    audio: view.audio,
    button(label: string): HTMLElement {
      const all = Array.from(root.querySelectorAll<HTMLElement>("[aria-label]"));
      const el =
        all.find((b) => b.getAttribute("aria-label") === label) ??
        all.find((b) => (b.getAttribute("aria-label") ?? "").startsWith(label));
      if (!el) throw new Error(`no button "${label}"`);
      return el;
    },
  };
}

/** Click as a finger would: pointer down/up then click, at the element's centre. */
export function tap(el: Element): void {
  const r = el.getBoundingClientRect();
  const at = {
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(
    new PointerEvent("pointerdown", { ...at, pointerId: 9, pointerType: "touch", isPrimary: true }),
  );
  el.dispatchEvent(
    new PointerEvent("pointerup", { ...at, pointerId: 9, pointerType: "touch", isPrimary: true }),
  );
  el.dispatchEvent(new MouseEvent("click", { ...at, detail: 1 }));
}

/** Show the chrome that fades when idle (page counter, zoom readout). */
export function wake(root: HTMLElement, ...selectors: string[]): void {
  for (const s of selectors)
    root.querySelectorAll(s).forEach((el) => el.classList.remove("is-idle"));
}
