/**
 * `ModelRegistry.inBackground`: a download the user already chose, watched
 * without a card (a notice when it starts and when it is ready, the card only
 * if it fails). The real registry and stores over a vault kept in memory.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelAsset } from "../../src/downloads/model-manifest";
import { notices, resetFakes } from "./fake-obsidian";
import type { StubEl } from "./stub-dom";
import { installDomGlobals } from "./stub-dom";

const net = vi.hoisted(() => ({
  /** Held back until a test opens it. */
  gate: null as null | Promise<void>,
  status: 200,
}));

const BYTES = new TextEncoder().encode("a small stand-in for a model");

vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  requestUrl: async (request: { headers?: Record<string, string> }) => {
    if (net.gate) await net.gate;
    if (net.status !== 200) return { status: net.status, arrayBuffer: new ArrayBuffer(0) };
    const range = /bytes=(\d+)-(\d+)/.exec(request.headers?.Range ?? "");
    const piece = range ? BYTES.slice(Number(range[1]), Number(range[2]) + 1) : BYTES;
    return {
      status: range ? 206 : 200,
      arrayBuffer: piece.slice().buffer,
      headers: range
        ? {
            "content-range": `bytes ${range[1]}-${Number(range[1]) + piece.length - 1}/${BYTES.length}`,
          }
        : {},
    };
  },
}));

const { ModelRegistry } = await import("../../src/view/model-downloads");

const ASSET: ModelAsset = {
  id: "reader",
  label: "Test reader",
  purpose: "It reads.",
  version: "1.0",
  format: 1,
  folder: "reader",
  files: [
    {
      name: "reader-1.0.bin",
      url: "https://example.test/reader-1.0.bin",
      bytes: BYTES.length,
      sha256: createHash("sha256").update(BYTES).digest("hex"),
    },
  ],
};

/** A vault adapter over a map of paths to bytes. */
function fakeApp() {
  const files = new Map<string, ArrayBuffer>();
  const adapter = {
    exists: (p: string) => Promise.resolve(files.has(p) || p === "plug/reader"),
    list: () =>
      Promise.resolve({
        files: [...files.keys()],
        folders: [],
      }),
    readBinary: (p: string) => Promise.resolve(files.get(p) ?? new ArrayBuffer(0)),
    writeBinary: (p: string, d: ArrayBuffer) => {
      files.set(p, d.slice(0));
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
    rename: (a: string, b: string) => {
      files.set(b, files.get(a) ?? new ArrayBuffer(0));
      files.delete(a);
      return Promise.resolve();
    },
    remove: (p: string) => {
      files.delete(p);
      return Promise.resolve();
    },
  };
  return { vault: { adapter } };
}

let body: StubEl;
beforeEach(() => {
  resetFakes();
  const { document } = installDomGlobals(vi.stubGlobal.bind(vi));
  vi.stubGlobal("document", document);
  body = (document as unknown as { body: StubEl }).body;
  net.gate = null;
  net.status = 200;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const registry = new ModelRegistry(fakeApp() as never, () => "plug");
  const store = registry.register(ASSET);
  const cards = () => body.querySelectorAll(".goodobsidian-download-card");
  /** Listeners left on the store. */
  const listeners = () => (store as unknown as { listeners: Set<unknown> }).listeners.size;
  return { registry, store, cards, listeners };
}

const messages = () => notices.map((n) => n.message);

describe("ModelRegistry.inBackground", () => {
  it("shows no card, a notice when it starts and when the model is ready, and leaves nothing subscribed", async () => {
    const { registry, store, cards, listeners } = setup();
    registry.inBackground(ASSET.id);
    expect(messages()).toEqual(["Downloading Test reader"]);
    expect(listeners()).toBe(1);
    expect(await store.download()).toBe(true);
    expect(messages()).toEqual(["Downloading Test reader", "Test reader is ready"]);
    expect(cards()).toHaveLength(0);
    expect(listeners()).toBe(0);
  });

  it("shows the card with Try again when the download fails, and stops watching", async () => {
    net.status = 404;
    const { registry, store, cards, listeners } = setup();
    registry.inBackground(ASSET.id);
    expect(cards()).toHaveLength(0);
    expect(await store.download()).toBe(false);
    expect(store.state.kind).toBe("failed");
    expect(messages()).toEqual(["Downloading Test reader"]);
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.classes.has("is-failed")).toBe(true);
    const retry = () =>
      cards()[0]
        ?.querySelectorAll("button")
        .find((b) => b.textContent === "Try again");
    expect(retry()).toBeDefined();
    expect(listeners()).toBe(1); // the card's own
    // Try again downloads, and the card (not a notice) shows it.
    net.status = 200;
    retry()?.click();
    await vi.waitFor(() => expect(store.state.kind).toBe("ready"));
    expect(messages()).toEqual(["Downloading Test reader"]);
  });

  it("stops watching when the registry is disposed", async () => {
    let open = (): void => undefined;
    net.gate = new Promise((resolve) => (open = resolve));
    const { registry, store, cards, listeners } = setup();
    registry.inBackground(ASSET.id);
    const done = store.download();
    registry.dispose();
    expect(listeners()).toBe(0);
    open();
    await done;
    expect(messages()).toEqual(["Downloading Test reader"]);
    expect(cards()).toHaveLength(0);
  });

  it("does nothing extra when a card for the model is already up, or the model is ready", async () => {
    const { registry, store, cards, listeners } = setup();
    registry.offer(ASSET.id, "ask");
    registry.inBackground(ASSET.id);
    expect(messages()).toEqual([]);
    expect(cards()).toHaveLength(1);
    expect(listeners()).toBe(1);
    registry.dispose();
    await store.download();
    registry.inBackground(ASSET.id);
    expect(messages()).toEqual([]);
    expect(listeners()).toBe(0);
  });

  it("watches a model once, however often it is called", () => {
    const { registry, listeners } = setup();
    registry.inBackground(ASSET.id);
    registry.inBackground(ASSET.id);
    expect(messages()).toEqual(["Downloading Test reader"]);
    expect(listeners()).toBe(1);
  });
});
