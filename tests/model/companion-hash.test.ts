/**
 * The content hash in a Companion PDF's Subject: the same for the same
 * saved notebook, different when anything it prints changes, and a page
 * hashed once until its saved text changes.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CompanionHasher, type CompanionHashSource } from "../../src/model/companion-hash";
import { DocumentEncoder } from "../../src/model/serialize";
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
