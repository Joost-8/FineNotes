/**
 * Grape (the handwriting recognizer model) and its word list, downloaded on
 * first use into `<plugin>/handwriting/` rather than built into main.js
 * (model-manifest.ts pins them, model-store.ts keeps them).
 *
 * The first time a handwriting feature needs the model, a small card offers
 * the one-time download (`DownloadCard`). "Not now" holds for the session;
 * the settings row (Settings › Handwriting) can always download, re-download
 * or remove it. Without the model the features stay quiet and everything
 * else works.
 *
 * The word list follows the model: once the user has taken the model, the
 * list (222 KB) is fetched alongside it, or on its own when the model came
 * by vault sync.
 */

import { type App, normalizePath, requestUrl, setIcon } from "obsidian";
import { bundleFormatOf } from "../recognition/hwr/bundle";
import {
  type Asset,
  GRAPE_MODEL,
  WORD_LIST,
  failureText,
  formatSize,
  isBusy,
  percent,
  stateText,
  toHex,
} from "../recognition/hwr/model-manifest";
import { AssetStore, type AssetStoreDeps } from "../recognition/hwr/model-store";

/** The plugin's folder for handwriting files (the model, words, learned models). */
export function handwritingFolder(pluginDir: string): string {
  return normalizePath(`${pluginDir}/handwriting`);
}

/** How long a "not ready" answer is trusted before the folder is looked at again (vault sync). */
const RECHECK_MS = 30_000;

/** The folder, the network and the hash, through Obsidian. */
export function vaultDeps(app: App, folder: () => string, asset: Asset): AssetStoreDeps {
  const adapter = app.vault.adapter;
  const path = (name: string) => normalizePath(`${folder()}/${name}`);
  return {
    list: async () => {
      if (!(await adapter.exists(folder()))) return [];
      const listed = await adapter.list(folder());
      return listed.files.map((file) => file.slice(file.lastIndexOf("/") + 1));
    },
    read: (name) => adapter.readBinary(path(name)),
    write: async (name, data) => {
      if (!(await adapter.exists(folder()))) await adapter.mkdir(folder());
      await adapter.writeBinary(path(name), data);
    },
    rename: (from, to) => adapter.rename(path(from), path(to)),
    remove: (name) => adapter.remove(path(name)),
    get: async (url, range) => {
      // requestUrl follows GitHub's redirect to its file host, and is not
      // blocked on the iPad as fetch is.
      const answer = await requestUrl({
        url,
        method: "GET",
        headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
        throw: false,
      });
      return { status: answer.status, body: answer.arrayBuffer };
    },
    sha256: async (data) => toHex(await crypto.subtle.digest("SHA-256", data)),
    formatOf: (data) => (asset.id === "grape" ? bundleFormatOf(data) : WORD_LIST.format),
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  };
}

export class GrapeFiles {
  readonly model: AssetStore;
  readonly words: AssetStore;
  /** "Not now" was tapped: no card again this session unless asked for. */
  private declined = false;
  private card: DownloadCard | null = null;
  private lastCheck = 0;

  constructor(app: App, pluginDir: () => string) {
    const folder = () => handwritingFolder(pluginDir());
    this.model = new AssetStore(GRAPE_MODEL, vaultDeps(app, folder, GRAPE_MODEL));
    this.words = new AssetStore(WORD_LIST, vaultDeps(app, folder, WORD_LIST));
  }

  /** Look at the folder again when the last look found nothing usable a while ago. */
  private async fresh(store: AssetStore): Promise<void> {
    const stale = store.state.kind !== "ready" && Date.now() - this.lastCheck > RECHECK_MS;
    if (stale) this.lastCheck = Date.now();
    await store.check(stale);
  }

  /**
   * The model to load, or null after offering the download (`how`: "auto"
   * for features that run by themselves, which stay quiet after Not now).
   */
  async source(
    how: "auto" | "ask" = "auto",
  ): Promise<{ key: string; read: () => Promise<ArrayBuffer> } | null> {
    await this.fresh(this.model);
    const file = await this.model.file();
    if (!file) {
      this.offer(how);
      return null;
    }
    // The model is here, so the user has it: the word list may follow.
    void this.wordsToo();
    return {
      key: `grape:${file}`,
      read: async () => {
        const bytes = await this.model.bytes();
        if (bytes) return bytes;
        // Gone since it was found: look again next time.
        await this.model.check(true);
        throw new Error("Grape is not on this device");
      },
    };
  }

  /** The downloaded word list's text, or null when it is not here (yet). */
  async wordList(): Promise<string | null> {
    await this.fresh(this.words);
    const bytes = await this.words.bytes();
    if (bytes) return new TextDecoder().decode(bytes);
    void this.wordsToo();
    return null;
  }

  /** Fetch the word list quietly once the model is here. */
  private async wordsToo(): Promise<void> {
    if (this.model.state.kind !== "ready") return;
    await this.words.check();
    if (this.words.state.kind === "missing" || this.words.state.kind === "outdated")
      await this.words.download();
  }

  /** Download the model, then the word list. True when the model is ready. */
  async downloadAll(): Promise<boolean> {
    const ok = await this.model.download();
    if (ok) await this.words.download();
    return ok;
  }

  /** Show the card, unless it is up, the model is here, or (for "auto") Not now was tapped. */
  offer(how: "auto" | "ask"): void {
    if (this.card) return;
    if (how === "auto" && this.declined) return;
    const state = this.model.state;
    if (state.kind === "ready") return;
    this.card = new DownloadCard(this.model, {
      download: () => void this.downloadAll(),
      notNow: () => {
        this.declined = true;
      },
      closed: () => {
        this.card = null;
      },
    });
  }

  dispose(): void {
    this.card?.close();
  }
}

export interface DownloadCardActions {
  download: () => void;
  notNow: () => void;
  closed: () => void;
}

/** How long "Grape is ready" stays up. */
const READY_MS = 2500;

/**
 * The one-time download offer, bottom centre over the workspace: Download
 * and Not now, then the progress, then "ready" (which hides by itself) or
 * what went wrong, with Try again.
 */
export class DownloadCard {
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly barEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private readonly unsubscribe: () => void;
  private hideTimer = 0;
  private closedOnce = false;

  constructor(
    private readonly store: AssetStore,
    private readonly actions: DownloadCardActions,
    parent: HTMLElement = document.body,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-download-card" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-live", "polite");
    setIcon(this.el.createDiv({ cls: "goodobsidian-download-card-icon" }), "download");
    const text = this.el.createDiv({ cls: "goodobsidian-download-card-text" });
    this.titleEl = text.createDiv({ cls: "goodobsidian-download-card-title" });
    this.detailEl = text.createDiv({ cls: "goodobsidian-download-card-detail" });
    const track = text.createDiv({ cls: "goodobsidian-download-card-track" });
    this.barEl = track.createDiv({ cls: "goodobsidian-download-card-bar" });
    this.actionsEl = this.el.createDiv({ cls: "goodobsidian-download-card-actions" });
    this.unsubscribe = store.subscribe(() => this.render());
    this.render();
  }

  private button(text: string, run: () => void, cta = false): void {
    const button = this.actionsEl.createEl("button", {
      cls: `goodobsidian-download-card-button clickable-icon${cta ? " is-cta" : ""}`,
      text,
    });
    button.addEventListener("click", run);
  }

  private render(): void {
    const { asset, state } = this.store;
    const size = formatSize(asset.bytes);
    this.actionsEl.empty();
    this.el.toggleClass("is-busy", isBusy(state));
    this.el.toggleClass("is-failed", state.kind === "failed");
    switch (state.kind) {
      case "downloading":
      case "verifying":
        this.titleEl.setText(`Downloading ${asset.label}`);
        this.detailEl.setText(stateText(asset, state));
        this.barEl.setCssProps({
          "--gob-download-progress": `${state.kind === "verifying" ? 100 : percent(state.received, state.total || asset.bytes)}%`,
        });
        this.button("Hide", () => this.close());
        return;
      case "ready":
        this.titleEl.setText(`${asset.label} is ready`);
        this.detailEl.setText("Handwriting is read on this device from now on.");
        this.barEl.setCssProps({ "--gob-download-progress": "100%" });
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => this.close(), READY_MS);
        return;
      case "failed":
        this.titleEl.setText(`${asset.label} did not download`);
        this.detailEl.setText(failureText(state.reason, state.detail));
        this.button("Not now", () => this.notNow());
        this.button("Try again", () => this.actions.download(), true);
        return;
      default:
        this.titleEl.setText(
          state.kind === "outdated"
            ? `${asset.label} needs an update: a ${size} download`
            : `${asset.label} needs a one-time ${size} download`,
        );
        this.detailEl.setText(
          "It reads your handwriting on this device for search, titles and links. It comes " +
            "from GitHub once; what you write never leaves the device.",
        );
        this.button("Not now", () => this.notNow());
        this.button("Download", () => this.actions.download(), true);
    }
  }

  private notNow(): void {
    this.actions.notNow();
    this.close();
  }

  close(): void {
    if (this.closedOnce) return;
    this.closedOnce = true;
    window.clearTimeout(this.hideTimer);
    this.unsubscribe();
    this.el.remove();
    this.actions.closed();
  }
}
