/**
 * "Remove other OCR models" end to end: the real ModelRegistry and AssetStore
 * instances over a fake vault adapter (and a fake device storage for the
 * model kept off the vault), holding the real file names in the real folders.
 * The files' bytes are small stand-ins with their own sizes and hashes; every
 * name, folder and `shared` list is the product's.
 */

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  device: new Map<string, ArrayBuffer>(),
  /** Answers to requestUrl: set by a test, else the file's bytes. */
  net: {
    gate: null as null | Promise<void>,
    bodies: new Map<string, Uint8Array>(),
    requests: [] as string[],
  },
}));

vi.mock("obsidian", async () => ({
  ...(await import("../fakes/obsidian")),
  requestUrl: async (request: { url: string; headers?: Record<string, string> }) => {
    hoisted.net.requests.push(request.url);
    if (hoisted.net.gate) await hoisted.net.gate;
    const body = hoisted.net.bodies.get(request.url);
    if (!body) return { status: 404, arrayBuffer: new ArrayBuffer(0), headers: {} };
    const range = /bytes=(\d+)-(\d+)/.exec(request.headers?.Range ?? "");
    const piece = range ? body.slice(Number(range[1]), Number(range[2]) + 1) : body;
    return {
      status: range ? 206 : 200,
      arrayBuffer: piece.slice().buffer,
      headers: range
        ? {
            "content-range": `bytes ${range[1]}-${Number(range[1]) + piece.length - 1}/${body.length}`,
          }
        : {},
    };
  },
}));

// IndexedDB is not here: the device storage is a map with the same folder/name keys.
vi.mock("../../src/downloads/device-folder", () => ({
  deviceFolder: (folder: string) => ({
    list: () =>
      Promise.resolve(
        [...hoisted.device.keys()]
          .filter((k) => k.startsWith(`${folder}/`))
          .map((k) => k.slice(folder.length + 1)),
      ),
    read: (name: string) => {
      const v = hoisted.device.get(`${folder}/${name}`);
      return v ? Promise.resolve(v.slice(0)) : Promise.reject(new Error("not on this device"));
    },
    write: (name: string, data: ArrayBuffer) => {
      hoisted.device.set(`${folder}/${name}`, data.slice(0));
      return Promise.resolve();
    },
    rename: (from: string, to: string) => {
      const v = hoisted.device.get(`${folder}/${from}`);
      if (!v) return Promise.reject(new Error("not on this device"));
      hoisted.device.delete(`${folder}/${from}`);
      hoisted.device.set(`${folder}/${to}`, v);
      return Promise.resolve();
    },
    remove: (name: string) => {
      hoisted.device.delete(`${folder}/${name}`);
      return Promise.resolve();
    },
  }),
}));

import type { App } from "obsidian";
import type { ModelAsset } from "../../src/downloads/model-manifest";
import { versionOf, storedVersions } from "../../src/downloads/model-manifest";
import { OCR_TIERS } from "../../src/recognition/ocr/ocr-model";
import { ModelRegistry } from "../../src/view/model-downloads";
import { removeOtherOcrModels } from "../../src/view/ocr-models";

const PLUGIN = "plugins/finenotes";
const sha = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** The product's asset (id, folder, file names, urls, `shared`) with small files of its own. */
function standIn(asset: ModelAsset): { asset: ModelAsset; content: Map<string, Uint8Array> } {
  const content = new Map<string, Uint8Array>();
  const files = asset.files.map((file) => {
    const bytes = new TextEncoder().encode(`${file.name} of ${file.url}`.repeat(3));
    content.set(file.name, bytes);
    return { ...file, bytes: bytes.length, sha256: sha(bytes), chunk: undefined };
  });
  return {
    asset: { ...asset, files: files.map(({ chunk: _c, ...f }) => f), chunkBytes: 64 },
    content,
  };
}
const STAND_INS = OCR_TIERS.map((t) => standIn(t.asset));
const [FAST, ACCURATE, BEST] = STAND_INS;

/** A vault adapter over a map of paths to bytes: just what the stores and the cleanup use. */
function fakeVault() {
  const files = new Map<string, ArrayBuffer>();
  const mutations: string[] = [];
  const isDir = (p: string): boolean => [...files.keys()].some((k) => k.startsWith(`${p}/`));
  const adapter = {
    exists: (p: string) => Promise.resolve(files.has(p) || isDir(p)),
    list: (folder: string) =>
      Promise.resolve({
        files: [...files.keys()].filter(
          (k) => k.startsWith(`${folder}/`) && !k.slice(folder.length + 1).includes("/"),
        ),
        folders: [],
      }),
    readBinary: (p: string) => {
      const v = files.get(p);
      return v ? Promise.resolve(v.slice(0)) : Promise.reject(new Error(`no ${p}`));
    },
    writeBinary: (p: string, d: ArrayBuffer) => {
      mutations.push(`write ${p}`);
      files.set(p, d.slice(0));
      return Promise.resolve();
    },
    mkdir: (p: string) => {
      mutations.push(`mkdir ${p}`);
      return Promise.resolve();
    },
    rename: (a: string, b: string) => {
      mutations.push(`rename ${a} ${b}`);
      const v = files.get(a);
      if (!v) return Promise.reject(new Error(`no ${a}`));
      files.delete(a);
      files.set(b, v);
      return Promise.resolve();
    },
    remove: (p: string) => {
      mutations.push(`remove ${p}`);
      files.delete(p);
      return Promise.resolve();
    },
    rmdir: (p: string, recursive: boolean) => {
      mutations.push(`rmdir ${p}`);
      expect(recursive).toBe(true);
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
      return Promise.resolve();
    },
  };
  return { files, mutations, adapter, app: { vault: { adapter } } as unknown as App };
}

/** Put a model's files where the product keeps them: vault folder, or device storage. */
function install(
  vault: ReturnType<typeof fakeVault>,
  one: ReturnType<typeof standIn>,
  only?: string[],
): void {
  const { asset, content } = one;
  const shared = new Set(asset.shared?.files);
  for (const file of asset.files) {
    if (only && !only.includes(file.name)) continue;
    const bytes = (content.get(file.name) as Uint8Array).slice().buffer;
    if (shared.has(file.name))
      vault.files.set(`${PLUGIN}/${asset.shared?.folder}/${file.name}`, bytes);
    else if (asset.deviceOnly) hoisted.device.set(`${asset.folder}/${file.name}`, bytes);
    else vault.files.set(`${PLUGIN}/${asset.folder}/${file.name}`, bytes);
  }
}

const SENTINELS = [
  `${PLUGIN}/data.json`,
  `${PLUGIN}/main.js`,
  `${PLUGIN}/handwriting/grape-2.0.bin`,
  `${PLUGIN}/speech-base/ggml-base.bin`,
  `${PLUGIN}/ocr/${"ab".repeat(32)}.json`,
];

function world(installed = [FAST, ACCURATE, BEST]) {
  hoisted.device.clear();
  hoisted.net.gate = null;
  hoisted.net.requests.length = 0;
  const vault = fakeVault();
  for (const one of installed) install(vault, one);
  for (const p of SENTINELS) vault.files.set(p, new TextEncoder().encode(p).buffer as ArrayBuffer);
  for (const name of ["x.json", "y.json"])
    vault.files.set(`${PLUGIN}/ocr/ppocrv5/${name}`, new ArrayBuffer(4));
  const registry = new ModelRegistry(vault.app, () => PLUGIN);
  for (const one of STAND_INS) registry.register(one.asset);
  vault.mutations.length = 0;
  const run = (activeId: string) =>
    removeOtherOcrModels(activeId, {
      store: (id) => registry.get(id),
      folderExists: (f) => vault.adapter.exists(`${PLUGIN}/${f}`),
      removeFolder: (f) => vault.adapter.rmdir(`${PLUGIN}/${f}`, true),
    });
  const vaultPaths = (): string[] => [...vault.files.keys()].sort();
  return { vault, registry, run, vaultPaths };
}

const DET = "PP-OCRv5_mobile_det_infer.ort";
const WASM = "ort-wasm-simd-threaded.wasm";
const F = "ocr/ppocrv6-1";
const SMALL = "ocr/ppocrv6-small-1";

describe("Remove other OCR models, with the real stores", () => {
  beforeEach(() => hoisted.device.clear());

  it("with Accurate in use: Fast's own files go; the shared detector and wasm, and Accurate's files, stay", async () => {
    const w = world();
    const result = await w.run("ocr-ppocrv6-small");
    expect(result.models).toEqual(["ocr-ppocrv6", "ocr-ppocrv6-medium"]);
    expect(result.folders).toEqual(["ocr/ppocrv5"]);
    expect(w.vaultPaths()).toEqual(
      [
        ...SENTINELS,
        `${PLUGIN}/${F}/${DET}`,
        `${PLUGIN}/${F}/${WASM}`,
        `${PLUGIN}/${SMALL}/PP-OCRv6_small_rec.ort`,
        `${PLUGIN}/${SMALL}/ppocrv6_dict.txt`,
      ].sort(),
    );
    // The largest model lived off the vault: gone from device storage.
    expect([...hoisted.device.keys()]).toEqual([]);
    // Accurate is still usable, and Fast now reads as not downloaded.
    expect((await w.registry.get("ocr-ppocrv6-small")?.check(true))?.kind).toBe("ready");
    expect((await w.registry.get("ocr-ppocrv6")?.check(true))?.kind).toBe("missing");
  });

  it("with Fast in use: the small and medium folders' own files go, the shared ones are untouched", async () => {
    const w = world();
    const result = await w.run("ocr-ppocrv6");
    expect(result.models).toEqual(["ocr-ppocrv6-small", "ocr-ppocrv6-medium"]);
    expect(w.vaultPaths()).toEqual(
      [
        ...SENTINELS,
        `${PLUGIN}/${F}/${DET}`,
        `${PLUGIN}/${F}/${WASM}`,
        `${PLUGIN}/${F}/PP-OCRv6_tiny_rec.ort`,
        `${PLUGIN}/${F}/ppocrv6_tiny_dict.txt`,
      ].sort(),
    );
    expect([...hoisted.device.keys()]).toEqual([]);
    expect((await w.registry.get("ocr-ppocrv6")?.check(true))?.kind).toBe("ready");
  });

  it("removes the obsolete ocr/ppocrv5 folder, only there, and nothing outside ocr/ is touched", async () => {
    const w = world([FAST]);
    await w.run("ocr-ppocrv6");
    expect(w.vaultPaths().some((p) => p.includes("/ppocrv5/"))).toBe(false);
    expect(await w.vault.adapter.exists(`${PLUGIN}/ocr/ppocrv5`)).toBe(false);
    for (const p of SENTINELS) expect(w.vault.files.has(p)).toBe(true);
    // Every change the cleanup made is inside the plugin's ocr folder (device storage aside).
    expect(w.vault.mutations.length).toBeGreaterThan(0);
    for (const m of w.vault.mutations)
      expect(m).toMatch(new RegExp(`^(remove|rmdir|write|rename) ${PLUGIN}/ocr/`));
  });

  it("leaves a model that is downloading alone, and the download finishes", async () => {
    const w = world([FAST]);
    // Accurate's detector and wasm are in the shared folder already; its recogniser and dictionary come over the network.
    for (const [name, bytes] of ACCURATE.content) {
      const file = ACCURATE.asset.files.find((f) => f.name === name);
      if (file) hoisted.net.bodies.set(file.url, bytes);
    }
    let open!: () => void;
    hoisted.net.gate = new Promise<void>((resolve) => (open = resolve));
    const accurate = w.registry.get("ocr-ppocrv6-small");
    // A verified file of an earlier, interrupted run is in its folder.
    install(w.vault, ACCURATE, ["ppocrv6_dict.txt"]);
    await accurate?.check(true);
    const download = accurate?.download();
    await vi.waitFor(() => expect(accurate?.state.kind).toBe("downloading"));
    w.vault.mutations.length = 0;
    const before = w.vaultPaths();
    const result = await w.run("ocr-ppocrv6");
    expect(result.models).toEqual([]);
    expect(w.vaultPaths()).toEqual(before.filter((p) => !p.includes("/ppocrv5/")));
    expect(w.vault.mutations.filter((m) => m.includes(SMALL))).toEqual([]);
    open();
    expect(await download).toBe(true);
    expect(accurate?.state.kind).toBe("ready");
    expect(w.vault.files.has(`${PLUGIN}/${SMALL}/PP-OCRv6_small_rec.ort`)).toBe(true);
  });

  it("downloads a model's own files only when the shared ones are already there (no second detector)", async () => {
    const w = world([FAST]);
    for (const [name, bytes] of ACCURATE.content) {
      const file = ACCURATE.asset.files.find((f) => f.name === name);
      if (file) hoisted.net.bodies.set(file.url, bytes);
    }
    expect(await w.registry.get("ocr-ppocrv6-small")?.download()).toBe(true);
    const asked = new Set(hoisted.net.requests);
    for (const f of ACCURATE.asset.files.filter((f) => [DET, WASM].includes(f.name)))
      expect(asked.has(f.url)).toBe(false);
    expect(asked.size).toBe(2);
  });
});

describe("a tier's files and other versions", () => {
  const names = [...new Set(OCR_TIERS.flatMap((t) => t.asset.files.map((f) => f.name)))];

  it("no tier names other versions of its main file, so none can match another tier's or a shared file's name", () => {
    for (const { asset } of OCR_TIERS) {
      expect(asset.prefix).toBeUndefined();
      expect(asset.suffix).toBeUndefined();
      for (const name of names) expect(versionOf(asset, name)).toBeNull();
      expect(storedVersions(asset, names).others).toEqual([]);
    }
  });

  it("a tier is current only when all its own files are there, never because other tiers' files are", () => {
    for (const { asset } of OCR_TIERS) {
      const foreign = names.filter((n) => !asset.files.some((f) => f.name === n));
      expect(storedVersions(asset, foreign).current).toBe(false);
      const sharedOnly = asset.files
        .filter((f) => asset.shared?.files.includes(f.name))
        .map((f) => f.name);
      expect(storedVersions(asset, sharedOnly).current).toBe(false);
      expect(
        storedVersions(
          asset,
          asset.files.map((f) => f.name),
        ).current,
      ).toBe(true);
    }
  });

  it("even a prefix and suffix could not make one tier take another's files for another version", () => {
    // A tier that did name versions ("PP-OCRv6_small_rec-<v>.ort") would see only names of that shape.
    const probe: ModelAsset = {
      ...OCR_TIERS[1].asset,
      prefix: "PP-OCRv6_small_rec-",
      suffix: ".ort",
    };
    for (const name of names) expect(versionOf(probe, name)).toBeNull();
    expect(versionOf(probe, "PP-OCRv6_small_rec-0.9.ort")).toBe("0.9");
  });
});
