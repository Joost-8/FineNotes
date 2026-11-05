/**
 * When the reader download dialog may open (main.ts `offerOcrReader`), and
 * what its Download button does: the download carries on in the background.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const opened = vi.hoisted(() => ({
  modals: [] as Array<{
    actions: { download(id: string): void; notNow(): void };
  }>,
}));

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../CHANGELOG.md", () => ({ default: "" }));
vi.mock("../../src/view/ocr-offer", () => ({
  OcrOfferModal: class {
    constructor(
      _app: unknown,
      _tiers: unknown,
      _initial: unknown,
      readonly actions: { download(id: string): void; notNow(): void },
    ) {}
    open(): void {
      opened.modals.push(this);
    }
  },
}));

const { default: GoodObsidianPlugin } = await import("../../src/main");
const { DEFAULT_SETTINGS } = await import("../../src/settings");
const { OCR_TIERS } = await import("../../src/recognition/ocr/ocr-model");

const FAST = OCR_TIERS[0]!;

function pluginWith(store: { state: { kind: string }; running: boolean } | undefined) {
  const calls: string[] = [];
  const plugin = Object.create(GoodObsidianPlugin.prototype) as Record<string, unknown>;
  const target = store && {
    ...store,
    download: () => {
      calls.push("download");
      return Promise.resolve(true);
    },
  };
  Object.assign(plugin, {
    app: {},
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: () => Promise.resolve(),
    models: {
      get: () => target,
      inBackground: (id: string) => calls.push(`inBackground ${id}`),
      offer: (id: string) => calls.push(`offer ${id}`),
    },
    ocr: {
      modelChanged: () => calls.push("modelChanged"),
      settingsChanged: () => calls.push("settingsChanged"),
    },
  });
  const offer = (ask: boolean) =>
    (plugin.offerOcrReader as (ask: boolean) => void).call(plugin, ask);
  return { offer, calls };
}

beforeEach(() => {
  opened.modals.length = 0;
});

describe("offering the reader download", () => {
  it("opens the dialog when the reader is not here and nothing is running", () => {
    const { offer } = pluginWith({ state: { kind: "missing" }, running: false });
    offer(true);
    expect(opened.modals).toHaveLength(1);
  });

  it.each(["unknown", "missing"])(
    "does not open it while a download runs, even when the state is still %s",
    (kind) => {
      const { offer } = pluginWith({ state: { kind }, running: true });
      offer(true);
      offer(false);
      expect(opened.modals).toHaveLength(0);
    },
  );

  it("does not open it for a reader that is ready or downloading", () => {
    for (const kind of ["ready", "downloading", "verifying"]) {
      pluginWith({ state: { kind }, running: false }).offer(true);
    }
    expect(opened.modals).toHaveLength(0);
  });

  it("does not open it by itself after a failure (the card offers Try again), but opens an asked one", () => {
    const { offer } = pluginWith({ state: { kind: "failed" }, running: false });
    offer(false);
    expect(opened.modals).toHaveLength(0);
    offer(true);
    expect(opened.modals).toHaveLength(1);
  });

  it("starts the download in the background, before the download itself", () => {
    const { offer, calls } = pluginWith({ state: { kind: "missing" }, running: false });
    offer(true);
    opened.modals[0]?.actions.download(FAST.id);
    expect(calls).toEqual([`inBackground ${FAST.asset.id}`, "download", "modelChanged"]);
  });
});
