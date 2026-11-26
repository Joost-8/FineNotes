/**
 * The content hash in a Companion PDF's Subject: the same for the same
 * saved notebook, different when anything it prints changes, and a page
 * hashed once until its saved text changes.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CompanionHasher,
  canonicalJson,
  type CompanionHashSource,
} from "../../src/model/companion-hash";
import { DocumentEncoder, decodeDocument, encodeDocument } from "../../src/model/serialize";
import { SetTextBoxStyle } from "../../src/model/text-commands";
import { blankPage, emptyDocument } from "../../src/model/document";

const sha = async (text: string) => createHash("sha256").update(text).digest("hex");

function source(over: Partial<CompanionHashSource> = {}): CompanionHashSource {
  return {
    title: "Cell biology",
    furniture: null,
    pages: [
      { json: '{"id":"a"}', slot: 1 },
      { json: '{"id":"b"}', slot: 2 },
    ],
    resources: [{ path: "Slides.pdf", size: 100 }],
    ...over,
  };
}

describe("the content hash", () => {
  it("is 16 hex, and the same for the same content on any device", async () => {
    const a = await new CompanionHasher(sha).hash(source());
    const b = await new CompanionHasher(sha).hash(source());
    expect(a).toMatch(/^[a-f0-9]{16}$/);
    expect(a).toBe(b);
  });

  it("changes with a page, the order of pages, the title, the furniture and a source's size", async () => {
    const base = await new CompanionHasher(sha).hash(source());
    const variants = [
      source({
        pages: [
          { json: '{"id":"a","x":1}', slot: 3 },
          { json: '{"id":"b"}', slot: 2 },
        ],
      }),
      source({
        pages: [
          { json: '{"id":"b"}', slot: 2 },
          { json: '{"id":"a"}', slot: 1 },
        ],
      }),
      source({ title: "Cells" }),
      source({ furniture: { numbers: "center" } }),
      source({ resources: [{ path: "Slides.pdf", size: 101 }] }),
    ];
    for (const variant of variants) {
      expect(await new CompanionHasher(sha).hash(variant)).not.toBe(base);
    }
  });

  it("hashes a page again only when its saved text changed", async () => {
    const digest = vi.fn(sha);
    const hasher = new CompanionHasher(digest);
    await hasher.hash(source());
    expect(digest).toHaveBeenCalledTimes(3);
    digest.mockClear();
    await hasher.hash(
      source({
        pages: [
          { json: '{"id":"a"}', slot: 1 },
          { json: '{"id":"b2"}', slot: 4 },
        ],
      }),
    );
    // The changed page and the whole: the unchanged page is not hashed again.
    expect(digest).toHaveBeenCalledTimes(2);
  });

  it("is stable over the save cache's fragments of a real notebook", async () => {
    const doc = emptyDocument();
    doc.pages.push(blankPage("p2"));
    const encoder = new DocumentEncoder();
    const first = encoder.snapshot(doc);
    const again = encoder.snapshot(doc);
    const hash = (pages: typeof first.pages) =>
      new CompanionHasher(sha).hash(source({ pages, resources: [] }));
    expect(await hash(again.pages)).toBe(await hash(first.pages));
    // Another device reads the same notebook: a fresh cache, the same text.
    expect(await hash(new DocumentEncoder().snapshot(doc).pages)).toBe(await hash(first.pages));
    // Navigation is not in the pages' saved text: the view's scroll position.
    doc.view = { ...doc.view, scrollY: 999 } as typeof doc.view;
    expect(await hash(encoder.snapshot(doc).pages)).toBe(await hash(first.pages));
  });
});

describe("the same notebook after a reload, or on another device", () => {
  it("hashes the same though a command left its keys in another order", async () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    page.textBoxes.push({
      id: "t1",
      x: 10,
      y: 20,
      w: 200,
      text: "hi",
      color: "#000000",
      fontSize: 22,
      rotation: 0.3,
    } as (typeof page.textBoxes)[number]);
    // Bold is added after rotation here; the loader puts it before.
    new SetTextBoxStyle(page.id, "t1", { bold: true }).apply(doc);
    const live = new DocumentEncoder().snapshot(doc).pages;
    const saved = encodeDocument(doc);
    // Two devices read the same file.
    const deviceA = new DocumentEncoder().snapshot(decodeDocument(saved)).pages;
    const deviceB = new DocumentEncoder().snapshot(decodeDocument(saved)).pages;
    expect(live[0].json).not.toBe(deviceA[0].json);
    const hash = (pages: typeof live) =>
      new CompanionHasher(sha).hash(source({ pages, resources: [] }));
    expect(await hash(live)).toBe(await hash(deviceA));
    expect(await hash(deviceA)).toBe(await hash(deviceB));
    expect(canonicalJson('{"b":1,"a":{"d":[{"f":1,"e":2}],"c":3}}')).toBe(
      '{"a":{"c":3,"d":[{"e":2,"f":1}]},"b":1}',
    );
  });
});
