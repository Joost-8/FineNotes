/**
 * The save cache (DocumentEncoder's per-page JSON) against the plain encoder:
 * after any sequence of edits, reported the way the view reports them, the
 * JSON put together from the cached pages is the very string the whole
 * document stringifies to, and the payload is the very payload the encoder
 * always made. Random sequences cover strokes, erasing, selection edits,
 * undo and redo, page add / delete / move / duplicate, an import whose page
 * id clashes, and relinking moved files in place.
 */

import { describe, expect, it } from "vitest";
import { AddPage, InsertImage, RemovePage, SetBackdrop } from "../../src/model/commands";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { SetPageTitle } from "../../src/model/contents";
import {
  type ImageElement,
  type InkDocument,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { ReplaceStrokesOnPage } from "../../src/model/erase-commands";
import { FragmentStore } from "../../src/model/fragment-store";
import { History } from "../../src/model/history";
import { relinkDocument } from "../../src/model/moved-files";
import {
  MovePage,
  MoveStrokesOnPage,
  RemoveStrokesFromPage,
  SetPageBookmark,
  duplicatePageAfter,
  nextPageId,
} from "../../src/model/page-commands";
import { addStrokesTimed } from "../../src/model/recording-commands";
import {
  AddElements,
  RecolorStrokes,
  RemoveElements,
  TranslateElements,
} from "../../src/model/selection-commands";
import { DocumentEncoder, assembleJson, encodeDocument, runSteps } from "../../src/model/serialize";

/** What the encoder always wrote: the whole document stringified at once. */
function plainJson(doc: InkDocument): string {
  return inflateFromBase64(encodeDocument(doc).slice(3));
}

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * A notebook under edit, and the save cache told about each edit the way
 * InkView tells it: the surface names the page of a stroke, an erase or a
 * selection's edit; everything else (undo, redo, page commands, the host's
 * own edits) counts as every page; relinking touches every page.
 */
class Session {
  readonly doc: InkDocument = emptyDocument(800);
  readonly history = new History();
  readonly encoder = new DocumentEncoder();
  private strokeSeq = 0;
  private imageSeq = 0;

  constructor(private readonly rand: () => number) {
    for (let i = 0; i < 3; i++) this.doc.pages.push(blankPage(`p${i + 2}`));
  }

  private int(n: number): number {
    return Math.floor(this.rand() * n);
  }

  private page(): Page {
    return this.doc.pages[this.int(this.doc.pages.length)];
  }

  private stroke(): Stroke {
    const pts: number[] = [];
    const n = 2 + this.int(6);
    for (let i = 0; i < n; i++) pts.push(this.rand() * 700, this.rand() * 900, this.rand());
    return { id: `s${++this.strokeSeq}`, color: "#1a1a1a", size: 2, tool: "pen", pts };
  }

  private image(): ImageElement {
    return {
      id: `i${++this.imageSeq}`,
      path: `pics/${this.int(3)}.png`,
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    };
  }

  /** Apply a command as the surface does, and report it named or not. */
  private push(command: Parameters<History["push"]>[1], named?: string[]): void {
    this.history.push(this.doc, command);
    if (named) this.encoder.touchIds(this.doc, named);
    else this.encoder.touchAll();
  }

  /** One random edit; returns its name, for failure messages. */
  step(): string {
    const page = this.page();
    const some = (): Stroke[] => page.strokes.filter(() => this.rand() < 0.5);
    switch (this.int(17)) {
      case 0:
      case 1:
      case 2:
        this.push(addStrokesTimed(page, [this.stroke()], 1_700_000_000_000 + this.int(5000)), [
          page.id,
        ]);
        return "stroke";
      case 3: {
        if (page.strokes.length === 0) return "erase (nothing)";
        const ids = new Set(some().map((s) => s.id));
        this.push(new RemoveStrokesFromPage(page.id, ids), [page.id]);
        return "erase";
      }
      case 4: {
        const original = page.strokes[0];
        if (!original) return "cut (nothing)";
        const pieces = [this.stroke(), this.stroke()];
        this.push(new ReplaceStrokesOnPage(page.id, [{ original, pieces }]), [page.id]);
        return "cut";
      }
      case 5: {
        const strokes = some();
        const sel = { strokes, images: page.images.slice(0, 1), textBoxes: [] };
        this.push(new TranslateElements(page.id, sel, 5, -3), [page.id]);
        return "drag selection";
      }
      case 6:
        this.push(new RecolorStrokes(page.id, some(), this.rand() < 0.5 ? "#ff0000" : "#00f"), [
          page.id,
        ]);
        return "recolour";
      case 7: {
        const sel = { strokes: some(), images: [], textBoxes: [] };
        if (this.rand() < 0.5) this.push(new RemoveElements(page.id, sel, "Delete"), [page.id]);
        else {
          const copies = { strokes: [this.stroke()], images: [], textBoxes: [] };
          this.push(new AddElements(page.id, copies, "Paste"), [page.id]);
        }
        return "selection delete / paste";
      }
      case 8:
        if (this.history.undo(this.doc)) this.encoder.touchAll();
        return "undo";
      case 9:
        if (this.history.redo(this.doc)) this.encoder.touchAll();
        return "redo";
      case 10: {
        const at = this.int(this.doc.pages.length + 1);
        this.push(new AddPage(at, blankPage(nextPageId(this.doc))));
        return "add page";
      }
      case 11:
        if (this.doc.pages.length > 1) this.push(new RemovePage(this.int(this.doc.pages.length)));
        return "delete page";
      case 12:
        this.push(new MovePage(this.int(this.doc.pages.length), this.int(this.doc.pages.length)));
        return "move page";
      case 13: {
        const index = this.doc.pages.indexOf(page);
        const copy = duplicatePageAfter(this.doc, index);
        if (copy) this.push(new AddPage(copy.index, copy.page));
        return "duplicate page";
      }
      case 14: {
        // An import whose page id clashes: commands naming that id act on
        // the first page with it, and the cache must take both as touched.
        const imported = structuredClone(page);
        imported.strokes.push(this.stroke());
        this.push(new AddPage(this.int(this.doc.pages.length + 1), imported));
        return "import (clashing id)";
      }
      case 15: {
        const which = this.int(4);
        if (which === 0) this.push(new InsertImage(page.id, this.image()));
        else if (which === 1) {
          this.push(new SetBackdrop(page.id, { kind: "pdf", path: "old/lecture.pdf", page: 1 }));
        } else if (which === 2) this.push(new SetPageBookmark(page, page.bookmarked !== true));
        else this.push(new SetPageTitle(page, this.rand() < 0.5 ? `Topic ${this.int(9)}` : null));
        return "page settings";
      }
      default: {
        // Files moved in the vault: paths rewritten in place, on any page.
        const moved = relinkDocument(this.doc, (path) =>
          path.startsWith("old/") || path.startsWith("pics/") ? `moved/${path}` : undefined,
        );
        if (moved > 0) this.encoder.touchAll();
        // The head is never cached: a view change needs no report at all.
        this.doc.view.scrollY = this.int(1000);
        return "relink + scroll";
      }
    }
  }
}

describe("the save cache", () => {
  it("puts together exactly the JSON the plain encoder writes, after any edits", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const session = new Session(random(seed));
      const done: string[] = [];
      for (let i = 0; i < 60; i++) {
        done.push(session.step());
        // A save after some edits, not after every one.
        if (session.encoder.edits % 3 !== 0 && i < 59) continue;
        const snapshot = runSteps(session.encoder.snapshotSteps(session.doc));
        const expected = plainJson(session.doc);
        expect(assembleJson(snapshot), `seed ${seed}: ${done.join(", ")}`).toBe(expected);
        expect(session.encoder.snapshot(session.doc)).toEqual(snapshot);
      }
      // Encoding afresh, as the closing save does, found no page the cache had missed.
      session.encoder.encode(session.doc);
      expect(session.encoder.missed, `seed ${seed}`).toBe(0);
    }
  });

  it("makes the payload the encoder always made, on the main thread or in the worker", () => {
    for (let seed = 100; seed < 110; seed++) {
      const session = new Session(random(seed));
      const store = new FragmentStore();
      for (let i = 0; i < 30; i++) {
        session.step();
        const snapshot = session.encoder.snapshot(session.doc);
        store.put(
          snapshot.pages.map((page) => page.slot),
          snapshot.pages.map((page) => page.json),
        );
        const old = `v2:${deflateToBase64(plainJson(session.doc), 1)}`;
        const fromWorker = store.compress(
          snapshot.head,
          snapshot.pages.map((page) => page.slot),
        );
        expect(fromWorker).toBe(old);
        expect(new DocumentEncoder().encode(session.doc)).toBe(old);
        expect(session.encoder.encode(session.doc)).toBe(old);
      }
    }
  });

  it("serialises only the pages a named edit touched", () => {
    const session = new Session(random(7));
    const { doc, encoder } = session;
    const before = encoder.snapshot(doc);
    const page = doc.pages[2];
    page.strokes.push({ id: "x", color: "#000", size: 1, tool: "pen", pts: [1, 2, 0.5] });
    encoder.touch([page]);
    const fresh = [
      ...(function* () {
        const steps = encoder.snapshotSteps(doc);
        for (let step = steps.next(); !step.done; step = steps.next()) yield step.value;
      })(),
    ];
    expect(fresh).toHaveLength(1);
    const after = encoder.snapshot(doc);
    after.pages.forEach((fragment, i) => {
      if (i === 2) expect(fragment.slot).not.toBe(before.pages[i].slot);
      else expect(fragment).toBe(before.pages[i]);
    });
  });

  it("keeps a page's slot when a touch changed nothing in its JSON", () => {
    const { doc, encoder } = new Session(random(3));
    const before = encoder.snapshot(doc);
    encoder.touchAll();
    const after = encoder.snapshot(doc);
    expect(after.pages.map((p) => p.slot)).toEqual(before.pages.map((p) => p.slot));
    expect(after.pages[0].json).toBe(before.pages[0].json);
  });

  it("misses a change made in place and not reported, and the full encode finds it", () => {
    // The trap the conservative default exists for: MoveStrokesOnPage
    // shifts points inside the arrays the cache serialised.
    const session = new Session(random(5));
    const { doc, encoder } = session;
    const page = doc.pages[0];
    page.strokes.push({ id: "m", color: "#000", size: 1, tool: "pen", pts: [10, 10, 0.5] });
    encoder.touchAll();
    encoder.snapshot(doc);
    new MoveStrokesOnPage(page.id, new Set(["m"]), 40, 0).apply(doc);
    expect(assembleJson(encoder.snapshot(doc))).not.toBe(plainJson(doc));
    const payload = encoder.encode(doc);
    expect(encoder.missed).toBe(1);
    expect(inflateFromBase64(payload.slice(3))).toBe(plainJson(doc));
    // …and the cache holds the truth again.
    expect(assembleJson(encoder.snapshot(doc))).toBe(plainJson(doc));
  });

  it("matches a payload read from disk piece by piece, and reuses it", () => {
    const { doc } = new Session(random(11));
    const onDisk = encodeDocument(doc);
    const encoder = new DocumentEncoder();
    encoder.remember(onDisk);
    const snapshot = encoder.snapshot(doc);
    expect(runSteps(encoder.matchesKnown(snapshot))).toBe(true);
    expect(encoder.encode(doc)).toBe(onDisk);
    // One character different in one page, the same length: no match.
    const other = new DocumentEncoder();
    const json = plainJson(doc).replace('"p3"', '"p9"');
    other.remember(onDisk, json);
    expect(runSteps(other.matchesKnown(other.snapshot(doc)))).toBe(false);
    other.remember(onDisk, `${plainJson(doc).slice(0, -2)},{}]}`);
    expect(runSteps(other.matchesKnown(other.snapshot(doc)))).toBe(false);
  });

  it("takes every page with a repeated id as touched", () => {
    const doc = emptyDocument(800);
    const twin = structuredClone(doc.pages[0]);
    doc.pages.push(twin);
    const encoder = new DocumentEncoder();
    encoder.snapshot(doc);
    twin.strokes.push({ id: "t", color: "#000", size: 1, tool: "pen", pts: [1, 1, 1] });
    encoder.touchIds(doc, [twin.id]);
    expect(assembleJson(encoder.snapshot(doc))).toBe(plainJson(doc));
  });
});

describe("FragmentStore", () => {
  it("forgets slots a compression does not list, and refuses one never sent", () => {
    const store = new FragmentStore();
    store.put([1, 2, 3], ["{}", "[]", "1"]);
    expect(store.size).toBe(3);
    const payload = store.compress('{"pages":[', [3, 1]);
    expect(inflateFromBase64(payload.slice(3))).toBe('{"pages":[1,{}]}');
    expect(store.size).toBe(2);
    expect(() => store.compress('{"pages":[', [2])).toThrow(/never sent/);
    expect(inflateFromBase64(store.compress('{"pages":[', []).slice(3))).toBe('{"pages":[]}');
  });

  it("keeps text outside ASCII as the encoder writes it", () => {
    const doc = emptyDocument(800);
    doc.pages[0].title = "Über 😀 Größe";
    const encoder = new DocumentEncoder();
    const snapshot = encoder.snapshot(doc);
    const store = new FragmentStore();
    store.put([snapshot.pages[0].slot], [snapshot.pages[0].json]);
    expect(store.compress(snapshot.head, [snapshot.pages[0].slot])).toBe(encoder.encode(doc));
  });
});
