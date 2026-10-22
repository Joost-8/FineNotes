import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type ModelAsset } from "../../src/downloads/model-manifest";
import { AssetStore, type AssetStoreDeps } from "../../src/downloads/model-store";

/** A 2,000-byte "model" with a 4-byte header naming its format. */
function makeFile(format = 1, size = 2000): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + 7 + format) & 255;
  new DataView(out.buffer).setUint32(0, format, true);
  return out;
}

const FILE = makeFile();
/** Bytes as `adopt` asks for them: on demand. */
const bytesOf = (data: ArrayBuffer) => (): Promise<ArrayBuffer> => Promise.resolve(data);
const sha = (data: ArrayBuffer | Uint8Array): string =>
  createHash("sha256").update(new Uint8Array(data)).digest("hex");

const ASSET: ModelAsset = {
  id: "grape",
  label: "Test model",
  purpose: "It tests.",
  version: "1.0",
  format: 1,
  folder: "handwriting",
  files: [
    {
      name: "grape-1.0.bin",
      url: "https://example.test/grape-1.0.bin",
      bytes: FILE.byteLength,
      sha256: sha(FILE),
    },
  ],
  prefix: "grape-",
  suffix: ".bin",
};

/** A model of two files, as Whisper's encoder and decoder might be. */
const SECOND = makeFile(9, 1500);
const PAIR: ModelAsset = {
  ...ASSET,
  id: "pair",
  files: [
    ASSET.files[0],
    { name: "dec-1.0.bin", url: "https://example.test/dec.bin", bytes: 1500, sha256: sha(SECOND) },
  ],
};

interface Server {
  /** Answer for each request, in turn; "fail" rejects (offline). "ok" and afterwards: the range asked for. */
  script: ("ok" | "fail" | number | "full" | "short")[];
  body: Uint8Array;
  /** Bodies of other URLs. */
  others: Map<string, Uint8Array>;
  requests: { start: number; end: number }[];
}

function fakes(server: Partial<Server> = {}) {
  const files = new Map<string, Uint8Array>();
  const srv: Server = { script: [], body: FILE, others: new Map(), requests: [], ...server };
  const writes: string[] = [];
  const deps: AssetStoreDeps = {
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => {
      const f = files.get(name);
      return f ? Promise.resolve(f.slice().buffer) : Promise.reject(new Error("no file"));
    },
    write: (name, data) => {
      writes.push(name);
      files.set(name, new Uint8Array(data.slice(0)));
      return Promise.resolve();
    },
    rename: (from, to) => {
      const f = files.get(from);
      if (!f) return Promise.reject(new Error("no file"));
      if (files.has(to)) return Promise.reject(new Error("target exists"));
      files.delete(from);
      files.set(to, f);
      return Promise.resolve();
    },
    remove: (name) => {
      files.delete(name);
      return Promise.resolve();
    },
    get: (url, range) => {
      const body = srv.others.get(url) ?? srv.body;
      const r = range ?? { start: 0, end: body.byteLength - 1 };
      srv.requests.push(r);
      const step = srv.script.shift();
      if (step === "fail") return Promise.reject(new Error("offline"));
      if (typeof step === "number")
        return Promise.resolve({ status: step, body: new ArrayBuffer(0) });
      if (step === "full") return Promise.resolve({ status: 200, body: body.slice().buffer });
      const piece = body.slice(r.start, r.end + 1);
      if (step === "short") return Promise.resolve({ status: 206, body: piece.slice(1).buffer });
      return Promise.resolve({ status: 206, body: piece.buffer });
    },
    sha256: (data) => Promise.resolve(sha(data)),
    formatOf: (data) => (data.byteLength >= 4 ? new DataView(data).getUint32(0, true) : null),
    sleep: () => Promise.resolve(),
  };
  return { files, srv, deps, writes };
}

describe("AssetStore", () => {
  it("is missing in an empty folder, and downloads, verifies and stores the file", async () => {
    const { deps, files, writes } = fakes();
    const store = new AssetStore(ASSET, deps);
    const seen: string[] = [];
    store.subscribe(() => {
      if (seen[seen.length - 1] !== store.state.kind) seen.push(store.state.kind);
    });
    expect((await store.check()).kind).toBe("missing");
    expect(await store.bytes()).toBeNull();
    expect(await store.download()).toBe(true);
    expect(store.state.kind).toBe("ready");
    expect(seen).toEqual(["missing", "downloading", "verifying", "ready"]);
    expect(writes).toEqual(["grape-1.0.bin.download"]);
    expect([...files.keys()]).toEqual(["grape-1.0.bin"]);
    expect(sha((await store.bytes()) ?? new ArrayBuffer(0))).toBe(ASSET.files[0].sha256);
  });

  it("never downloads when a verified file is there (as after vault sync)", async () => {
    const { deps, files, srv } = fakes();
    files.set("grape-1.0.bin", FILE.slice());
    const store = new AssetStore(ASSET, deps);
    expect((await store.check()).kind).toBe("ready");
    expect(await store.download()).toBe(true);
    expect(srv.requests).toHaveLength(0);
  });

  it("does not trust a file of the right name with the wrong bytes", async () => {
    const { deps, files } = fakes();
    files.set("grape-1.0.bin", makeFile(1, 10));
    const store = new AssetStore(ASSET, deps);
    expect((await store.check()).kind).toBe("missing");
    const tampered = FILE.slice();
    tampered[100] ^= 1;
    files.set("grape-1.0.bin", tampered);
    expect((await store.check(true)).kind).toBe("missing");
    // The download replaces it.
    expect(await store.download()).toBe(true);
    expect(sha(files.get("grape-1.0.bin") ?? new Uint8Array())).toBe(ASSET.files[0].sha256);
  });

  it("is offline when no answer comes, and a retry goes on from the bytes already in", async () => {
    const big = makeFile(1, 1_200_000);
    const asset = {
      ...ASSET,
      files: [{ ...ASSET.files[0], bytes: big.byteLength, sha256: sha(big) }],
    };
    // First range arrives, then the second range fails three times.
    const { deps, srv } = fakes({ body: big, script: ["ok", "fail", "fail", "fail"] });
    const store = new AssetStore(asset, deps);
    expect(await store.download()).toBe(false);
    expect(store.state).toMatchObject({ kind: "failed", reason: "offline" });
    expect(srv.requests.map((r) => r.start)).toEqual([0, 524288, 524288, 524288]);
    srv.requests.length = 0;
    expect(await store.download()).toBe(true);
    expect(srv.requests.map((r) => r.start)).toEqual([524288, 1048576]);
  });

  it("gives up on a 404 at once, and retries a 503", async () => {
    const a = fakes({ script: [404] });
    const store = new AssetStore(ASSET, a.deps);
    expect(await store.download()).toBe(false);
    expect(store.state).toMatchObject({ kind: "failed", reason: "http", detail: "HTTP 404" });
    expect(a.srv.requests).toHaveLength(1);
    const b = fakes({ script: [503] });
    expect(await new AssetStore(ASSET, b.deps).download()).toBe(true);
    expect(b.srv.requests).toHaveLength(2);
  });

  it("takes a whole-file answer to a range request", async () => {
    const { deps } = fakes({ script: ["full"] });
    expect(await new AssetStore(ASSET, deps).download()).toBe(true);
  });

  it("refuses a damaged download, stores nothing, and starts over next time", async () => {
    const wrong = FILE.slice();
    wrong[5] ^= 1;
    const { deps, files, srv } = fakes({ body: wrong });
    const store = new AssetStore(ASSET, deps);
    expect(await store.download()).toBe(false);
    expect(store.state).toMatchObject({ kind: "failed", reason: "damaged" });
    expect(files.size).toBe(0);
    srv.body = FILE;
    srv.requests.length = 0;
    expect(await store.download()).toBe(true);
    expect(srv.requests[0]?.start).toBe(0);
  });

  it("refuses a short piece", async () => {
    const { deps } = fakes({ script: ["short"] });
    const store = new AssetStore(ASSET, deps);
    expect(await store.download()).toBe(false);
    expect(store.state).toMatchObject({ kind: "failed", reason: "damaged" });
  });

  it("reports a write that fails", async () => {
    const { deps } = fakes();
    deps.write = () => Promise.reject(new Error("disk full"));
    const store = new AssetStore(ASSET, deps);
    expect(await store.download()).toBe(false);
    expect(store.state).toMatchObject({ kind: "failed", reason: "storage", detail: "disk full" });
  });

  it("joins a download already running", async () => {
    const { deps, srv } = fakes();
    const store = new AssetStore(ASSET, deps);
    const [a, b] = await Promise.all([store.download(), store.download()]);
    expect(a && b).toBe(true);
    expect(srv.requests).toHaveLength(1);
  });

  it("uses an older file in a readable format until the new one is in, then removes it", async () => {
    const { deps, files } = fakes({ script: ["fail", "fail", "fail"] });
    files.set("grape-0.9.bin", makeFile(1, 100));
    files.set("personal.bin", makeFile(1, 50));
    const store = new AssetStore(ASSET, deps);
    expect(await store.check()).toMatchObject({
      kind: "outdated",
      older: { version: "0.9", usable: true },
    });
    expect(await store.file()).toBe("grape-0.9.bin");
    expect(await store.download()).toBe(false);
    expect(await store.file()).toBe("grape-0.9.bin");
    expect(await store.download()).toBe(true);
    expect([...files.keys()].sort()).toEqual(["grape-1.0.bin", "personal.bin"]);
  });

  it("reads an older file in another format as needing the download", async () => {
    const { deps, files } = fakes();
    files.set("grape-0.5.bin", makeFile(0, 100));
    const store = new AssetStore(ASSET, deps);
    expect(await store.check()).toMatchObject({ kind: "outdated", older: { usable: false } });
    expect(await store.file()).toBeNull();
  });

  it("skips an older file that is not this kind of file or cannot be read", async () => {
    const { deps, files } = fakes();
    files.set("grape-0.8.bin", new Uint8Array(2));
    files.set("grape-0.7.bin", makeFile(1, 10));
    const read = deps.read;
    deps.read = (name) => (name === "grape-0.7.bin" ? Promise.reject(new Error("io")) : read(name));
    expect((await new AssetStore(ASSET, deps).check()).kind).toBe("missing");
  });

  it("is missing when the folder cannot be listed", async () => {
    const { deps } = fakes();
    deps.list = () => Promise.reject(new Error("no folder"));
    expect((await new AssetStore(ASSET, deps).check()).kind).toBe("missing");
  });

  it("removes and downloads again", async () => {
    const { deps, files, srv } = fakes();
    files.set("grape-1.0.bin", FILE.slice());
    files.set("grape-0.9.bin", makeFile(1, 10));
    const store = new AssetStore(ASSET, deps);
    await store.remove();
    expect(store.state.kind).toBe("missing");
    expect(files.size).toBe(0);
    expect(await store.redownload()).toBe(true);
    expect(srv.requests).toHaveLength(1);
    expect(store.state.kind).toBe("ready");
  });

  it("checks once unless asked again, and unsubscribes", async () => {
    const { deps, files } = fakes();
    const store = new AssetStore(ASSET, deps);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    expect((await store.check()).kind).toBe("missing");
    files.set("grape-1.0.bin", FILE.slice());
    expect((await store.check()).kind).toBe("missing");
    off();
    expect((await store.check(true)).kind).toBe("ready");
    expect(calls).toBe(1);
  });

  it("downloads every file of a model, skipping one already stored", async () => {
    const { deps, files, srv } = fakes({
      others: new Map([["https://example.test/dec.bin", SECOND]]),
    });
    files.set("grape-1.0.bin", FILE.slice());
    const store = new AssetStore(PAIR, deps);
    expect((await store.check()).kind).toBe("missing");
    const progress: number[] = [];
    store.subscribe(() => {
      if (store.state.kind === "downloading") progress.push(store.state.received);
    });
    expect(await store.download()).toBe(true);
    expect(srv.requests).toHaveLength(1);
    expect(progress[progress.length - 1]).toBe(FILE.byteLength + SECOND.byteLength);
    expect(sha((await store.bytes("dec-1.0.bin")) ?? new ArrayBuffer(0))).toBe(sha(SECOND));
    expect(await store.bytes("other.bin")).toBeNull();
    await store.remove();
    expect(files.size).toBe(0);
  });

  it("has only the main file of an older version", async () => {
    const { deps, files } = fakes();
    files.set("grape-0.9.bin", makeFile(1, 100));
    const store = new AssetStore(PAIR, deps);
    expect(await store.file()).toBe("grape-0.9.bin");
    expect(await store.bytes()).not.toBeNull();
    expect(await store.bytes("dec-1.0.bin")).toBeNull();
  });

  it("adopts the exact bundled bytes without a download, and removes an older version", async () => {
    const { deps, files, srv, writes } = fakes();
    files.set("grape-0.9.bin", makeFile(1, 100));
    const store = new AssetStore(ASSET, deps);
    expect(await store.adopt("grape-1.0.bin", bytesOf(FILE.slice().buffer))).toBe(true);
    expect(store.state.kind).toBe("ready");
    expect(writes).toEqual(["grape-1.0.bin.download"]);
    expect([...files.keys()]).toEqual(["grape-1.0.bin"]);
    expect(srv.requests).toHaveLength(0);
    // Once it is there, nothing is written again.
    expect(await store.adopt("grape-1.0.bin", bytesOf(FILE.slice().buffer))).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("refuses to adopt other bytes, an unknown file, or during a download", async () => {
    const { deps, files } = fakes();
    const store = new AssetStore(ASSET, deps);
    const wrong = FILE.slice();
    wrong[9] ^= 1;
    expect(await store.adopt("grape-1.0.bin", bytesOf(wrong.buffer))).toBe(false);
    expect(await store.adopt("grape-1.0.bin", bytesOf(FILE.slice(1).buffer))).toBe(false);
    expect(await store.adopt("other.bin", bytesOf(FILE.slice().buffer))).toBe(false);
    expect(files.size).toBe(0);
    const running = store.download();
    expect(await store.adopt("grape-1.0.bin", bytesOf(FILE.slice().buffer))).toBe(false);
    expect(await running).toBe(true);
  });

  it("asks for the bundled bytes only when the file is not stored", async () => {
    const { deps, files, writes } = fakes();
    files.set("grape-1.0.bin", FILE.slice());
    const store = new AssetStore(ASSET, deps);
    let asked = 0;
    const bundled = (): Promise<ArrayBuffer> => {
      asked++;
      return Promise.resolve(FILE.slice().buffer);
    };
    // Every start-up after the first: Grape is there, the bundle stays shut.
    expect(await store.adopt("grape-1.0.bin", bundled)).toBe(true);
    expect(asked).toBe(0);
    expect(writes).toHaveLength(0);
    // Gone (removed in the settings): now the bundle is opened.
    files.clear();
    await store.check(true);
    expect(await store.adopt("grape-1.0.bin", bundled)).toBe(true);
    expect(asked).toBe(1);
  });

  it("adopts nothing when the bundled bytes are missing or fail to load", async () => {
    const { deps, files } = fakes();
    const store = new AssetStore(ASSET, deps);
    expect(await store.adopt("grape-1.0.bin", () => Promise.resolve(null))).toBe(false);
    expect(await store.adopt("grape-1.0.bin", () => Promise.reject(new Error("bad")))).toBe(false);
    expect(files.size).toBe(0);
    expect(store.state.kind).toBe("missing");
  });

  it("reports a failed write while adopting as not adopted", async () => {
    const { deps } = fakes();
    deps.write = () => Promise.reject(new Error("read-only"));
    const store = new AssetStore(ASSET, deps);
    expect(await store.adopt("grape-1.0.bin", bytesOf(FILE.slice().buffer))).toBe(false);
    expect(store.state.kind).toBe("missing");
  });

  it("asks in the model's own chunk size when it sets one", async () => {
    const { deps, srv } = fakes();
    expect(await new AssetStore({ ...ASSET, chunkBytes: 700 }, deps).download()).toBe(true);
    expect(srv.requests).toEqual([
      { start: 0, end: 699 },
      { start: 700, end: 1399 },
      { start: 1400, end: 1999 },
    ]);
  });
});
