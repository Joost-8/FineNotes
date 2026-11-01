/**
 * The models FineNotes downloads on first use, through Obsidian: one
 * `AssetStore` per registered model (downloads/model-store.ts), in
 * `<plugin>/<model folder>/` (or, for a desktop-only model, on this device
 * outside the vault: downloads/device-folder.ts), and the card that offers a download the first
 * time a feature needs it.
 *
 * A feature registers its model once (`register`) and asks for it when it
 * needs it (`offer` shows the card). Settings › Models on this device lists every
 * registered model with its state, size, Download and Remove.
 *
 * - Files come with `requestUrl`: it follows GitHub's redirect to its file
 *   host, and is not blocked on the iPad as fetch is.
 * - "Not now" holds for the session, per model, for offers a feature makes
 *   by itself ("auto"); an offer the user asked for ("ask") always shows.
 */

import { type App, normalizePath, requestUrl, setIcon } from "obsidian";
import {
  type ModelAsset,
  failureText,
  formatSize,
  isBusy,
  percent,
  stateText,
  toHex,
  totalBytes,
} from "../downloads/model-manifest";
import { AssetStore, type AssetStoreDeps } from "../downloads/model-store";
import { deviceFolder } from "../downloads/device-folder";

/** A model's folder in the vault. */
export function modelFolder(pluginDir: string, asset: ModelAsset): string {
  return normalizePath(`${pluginDir}/${asset.folder}`);
}

/** The network, the hash and the clock, through Obsidian: the same wherever the files are kept. */
function networkDeps(
  formatOf: (data: ArrayBuffer) => number | null,
): Pick<AssetStoreDeps, "get" | "sha256" | "formatOf" | "sleep"> {
  return {
    get: async (url, range) => {
      const answer = await requestUrl({
        url,
        method: "GET",
        headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
        throw: false,
      });
      return { status: answer.status, body: answer.arrayBuffer };
    },
    sha256: async (data) => toHex(await crypto.subtle.digest("SHA-256", data)),
    formatOf,
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  };
}

/** The folder, the network and the hash, through Obsidian. */
export function vaultDeps(
  app: App,
  folder: () => string,
  formatOf: (data: ArrayBuffer) => number | null,
): AssetStoreDeps {
  const adapter = app.vault.adapter;
  const path = (name: string) => normalizePath(`${folder()}/${name}`);
  return {
    ...networkDeps(formatOf),
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
  };
}

export interface ModelOptions {
  /**
   * The format version a stored older main file is in, or null when it is
   * not this model. Without it, an older version counts as this format.
   */
  formatOf?: (data: ArrayBuffer) => number | null;
}

export class ModelRegistry {
  private readonly stores = new Map<string, AssetStore>();
  /** Models whose card got "Not now" this session. */
  private readonly declined = new Set<string>();
  private readonly cards = new Map<string, DownloadCard>();

  constructor(
    private readonly app: App,
    private readonly pluginDir: () => string,
  ) {}

  /** Register a model (once per id; a second call returns the first store). */
  register(asset: ModelAsset, options: ModelOptions = {}): AssetStore {
    const known = this.stores.get(asset.id);
    if (known) return known;
    const formatOf = options.formatOf ?? (() => asset.format);
    const store = new AssetStore(
      asset,
      asset.deviceOnly
        ? { ...deviceFolder(asset.folder), ...networkDeps(formatOf) }
        : vaultDeps(this.app, () => modelFolder(this.pluginDir(), asset), formatOf),
    );
    this.stores.set(asset.id, store);
    return store;
  }

  get(id: string): AssetStore | undefined {
    return this.stores.get(id);
  }

  /** Every registered model, in the order registered. */
  all(): AssetStore[] {
    return [...this.stores.values()];
  }

  /**
   * Show the download card for a model, unless it is up, the model is here,
   * or ("auto") Not now was tapped this session.
   */
  offer(id: string, how: "auto" | "ask"): void {
    const store = this.stores.get(id);
    if (!store || this.cards.has(id)) return;
    if (how === "auto" && this.declined.has(id)) return;
    if (store.state.kind === "ready") return;
    const card = new DownloadCard(store, {
      download: () => void store.download(),
      notNow: () => this.declined.add(id),
      closed: () => this.cards.delete(id),
    });
    this.cards.set(id, card);
  }

  dispose(): void {
    for (const card of [...this.cards.values()]) card.close();
  }
}

export interface DownloadCardActions {
  download: () => void;
  notNow: () => void;
  closed: () => void;
}

/** How long "is ready" stays up. */
const READY_MS = 2500;

/** The host a model comes from, for the card ("github.com"). */
function hostOf(asset: ModelAsset): string {
  try {
    return new URL(asset.files[0]?.url ?? "").hostname;
  } catch {
    return "the internet";
  }
}

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
    const size = formatSize(totalBytes(asset));
    this.actionsEl.empty();
    this.el.toggleClass("is-busy", isBusy(state));
    this.el.toggleClass("is-failed", state.kind === "failed");
    switch (state.kind) {
      case "downloading":
      case "verifying": {
        const done =
          state.kind === "verifying"
            ? 100
            : percent(state.received, state.total || totalBytes(asset));
        this.titleEl.setText(`Downloading ${asset.label}`);
        this.detailEl.setText(stateText(asset, state));
        this.barEl.setCssProps({ "--gob-download-progress": `${done}%` });
        this.button("Hide", () => this.close());
        return;
      }
      case "ready":
        this.titleEl.setText(`${asset.label} is ready`);
        this.detailEl.setText(`Version ${asset.version} is on this device.`);
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
        this.detailEl.setText(`${asset.purpose} It comes from ${hostOf(asset)} once.`);
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
