/**
 * Moving real notebooks to one file per page per device (#274), round trip:
 * what the reader gives back must be the notebook as it was, element by
 * element, and stay so through edits on two devices.
 *
 * Runs on a folder of real notebooks named by FINENOTES_CORPUS (copies, never
 * a vault in use); skipped when it is not set, so CI runs none of it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeDocument, parseInkFile } from "../../src/model/serialize";
import { readDevicePagesNotebook } from "../../src/model/device-pages";
import { DevicePagesWriter, legacyPayload } from "../../src/model/device-pages-writer";
import { DotClock, attachDotClock, mintedId } from "../../src/model/dot-ids";
import type { InkDocument, Page, Stroke } from "../../src/model/document";

const CORPUS = process.env.FINENOTES_CORPUS;

function notebooks(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...notebooks(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Every element of a page, by list, as stored: what "element by element" compares. */
function elements(page: Page): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [list, value] of Object.entries(page)) {
    if (Array.isArray(value)) out[list] = value.map((e) => JSON.stringify(e));
  }
  return out;
}

function expectSame(back: InkDocument, original: InkDocument): void {
  expect(back.pages.map((p) => p.id)).toEqual(original.pages.map((p) => p.id));
  back.pages.forEach((page, i) => expect(elements(page)).toEqual(elements(original.pages[i])));
  expect(encodeDocument(back)).toBe(encodeDocument(original));
}

describe.skipIf(!CORPUS)("real notebooks moved to page files (#274)", () => {
  const files = CORPUS ? notebooks(CORPUS) : [];

  it.each(files.map((f) => [f.slice((CORPUS ?? "").length + 1), f]))(
    "%s reads back as it was, and through edits on two devices",
    (_name, file) => {
      const parsed = parseInkFile(readFileSync(file, "utf8"));
      if (!parsed.doc) return;
      const original = parsed.doc;
      const began = performance.now();
      const payload = legacyPayload(original, "n7k2q9ab");
      const converted = performance.now() - began;

      // Read back with no page files: the notebook as it was.
      const fresh = readDevicePagesNotebook(payload, new Map());
      expectSame(fresh.doc, original);

      // Two devices edit it; what both write reads back as what they hold.
      const folder = new Map<string, string>();
      const open = (device: string) => {
        const load = readDevicePagesNotebook(payload, folder);
        const clock = new DotClock(device);
        attachDotClock(load.doc, clock);
        return {
          doc: load.doc,
          writer: DevicePagesWriter.fromRead(device, clock, load.doc, load.sources, load.union),
        };
      };
      const a = open("aaaa1111");
      const b = open("bbbb2222");
      const last = a.doc.pages.length - 1;
      const stroke = (doc: InkDocument): Stroke => ({
        id: mintedId(doc) ?? "",
        tool: "pen",
        color: "#1a1a1a",
        size: 3,
        pts: [10, 20, 0.5, 30, 40, 0.5],
      });
      a.doc.pages[0].strokes.push(stroke(a.doc));
      if (a.doc.pages[last].strokes.length > 0) a.doc.pages[last].strokes.shift();
      b.doc.pages[last].strokes.push(stroke(b.doc));
      for (const w of a.writer.save(a.doc)) folder.set(w.name, w.text);
      for (const w of b.writer.save(b.doc)) folder.set(w.name, w.text);
      const both = readDevicePagesNotebook(payload, folder).doc;
      const ids = (doc: InkDocument) => doc.pages.flatMap((p) => p.strokes.map((s) => s.id));
      const expected = new Set([...ids(a.doc), ...ids(b.doc)]);
      // A's erase on the last page holds; B's stroke there stays.
      if (original.pages[last].strokes.length > 0) {
        expected.delete(original.pages[last].strokes[0].id);
      }
      expect(new Set(ids(both))).toEqual(expected);
      expect(ids(both).length).toBe(expected.size);
      console.log(
        `${_name}: ${original.pages.length} pages, ${(payload.length / 1e6).toFixed(2)} MB, encoded in ${converted.toFixed(0)} ms`,
      );
    },
    120_000,
  );
});
