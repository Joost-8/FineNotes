/**
 * Grape's language packs on the device (view/language-packs.ts): only packs
 * whose file is here are registered, their lists reach the word check, and
 * a download is offered for a language seen only once the packs are
 * published.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { LanguagePacks } = await import("../../src/view/language-packs");
const { writeLanguagePack } = await import("../../src/recognition/hwr/language-pack");

/** A pack's bytes, with Grape 2.0's own LM section standing in for a language's. */
function packBytes(language: string, words: string[], underline: boolean): ArrayBuffer {
  const bytes = readFileSync("models/grape-2.0.bin");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLength = view.getUint32(8, true);
  const meta = JSON.parse(bytes.subarray(12, 12 + metaLength).toString("utf8"));
  let o = 12 + metaLength;
  let payload = new Uint8Array();
  while (o + 8 <= bytes.byteLength) {
    const size = view.getUint32(o + 4, true);
    if (bytes.subarray(o, o + 4).toString("latin1") === "LM01") {
      payload = new Uint8Array(bytes.subarray(o + 8, o + 8 + size));
    }
    o += 8 + size + ((4 - (size % 4)) % 4);
  }
  const pack = writeLanguagePack(
    {
      format: "finenotes-language",
      language: language as "nl",
      name: "t",
      licence: "CC0",
      exported: "x",
      lm: meta.lm,
      words: words.length,
      underline,
    },
    payload,
    words,
  );
  return pack.buffer.slice(pack.byteOffset, pack.byteOffset + pack.byteLength) as ArrayBuffer;
}

function setup(present: Record<string, ArrayBuffer>, hosted = false) {
  const registered: string[] = [];
  const offered: string[] = [];
  const registry = {
    register: (asset: { id: string }) => {
      registered.push(asset.id);
      const language = asset.id.replace("grape-lang-", "");
      const bytes = present[language] ?? null;
      const store = {
        state: { kind: "unknown" as string },
        check: async () => {
          store.state = { kind: bytes ? "ready" : "missing" };
          return store.state;
        },
        bytes: async () => bytes,
      };
      return store;
    },
    offer: (id: string) => void offered.push(id),
  };
  const app = {
    vault: {
      adapter: {
        exists: async (path: string) =>
          Object.keys(present).some((l) => path.endsWith(`grape-lang-${l}-1.0.bin`)),
      },
    },
  };
  const packs = new LanguagePacks(app as never, () => "plug", registry as never, hosted);
  return { packs, registered, offered };
}

describe("the language packs on this device", () => {
  it("registers only the packs whose file is here, and hands them to the reader", async () => {
    const { packs, registered } = setup({ nl: packBytes("nl", ["tentamen"], false) });
    const ready = await packs.ready();
    expect(registered).toEqual(["grape-lang-nl"]);
    expect(ready.map((p) => p.key)).toEqual(["grape-lang-nl|1.0"]);
    expect((await ready[0].read()).byteLength).toBeGreaterThan(100_000);
  });

  it("gives the word check a pack's list and whether it underlines", async () => {
    const { packs } = setup({
      nl: packBytes("nl", ["tentamen", "college"], false),
      fr: packBytes("fr", ["examen"], true),
    });
    const nl = await packs.words("nl");
    expect([...(nl?.words ?? [])]).toEqual(["tentamen", "college"]);
    expect(nl?.underline).toBe(false);
    expect((await packs.words("fr"))?.underline).toBe(true);
    expect(await packs.words("de")).toBeNull();
    expect(await packs.words("en")).toBeNull();
  });

  it("offers a language's pack once a page in it is read, only once the packs are published", () => {
    const unpublished = setup({});
    unpublished.packs.seen("de");
    expect(unpublished.offered).toEqual([]);
    expect(unpublished.registered).toEqual([]);
    const published = setup({}, true);
    published.packs.seen("de");
    published.packs.seen("en");
    expect(published.offered).toEqual(["grape-lang-de"]);
  });
});
