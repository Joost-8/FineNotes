/** `src/view/id-sequence.ts` — the `s<N>` / `t<N>` ids the surface mints. */

import { describe, expect, it } from "vitest";
import { type InkDocument, type Page, blankPage } from "../../src/model/document";
import { IdSequence, highestIdNumber, strokeIdsOf, textBoxIdsOf } from "../../src/view/id-sequence";

function pageWith(id: string, strokeIds: string[], textBoxIds: string[] = []): Page {
  const page = blankPage(id);
  page.strokes = strokeIds.map((sid) => ({
    id: sid,
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [],
  }));
  page.textBoxes = textBoxIds.map(
    (tid) => ({ id: tid, x: 0, y: 0, w: 80, text: "" }) as Page["textBoxes"][number],
  );
  return page;
}

const doc = (...pages: Page[]): InkDocument => ({ pages }) as unknown as InkDocument;

describe("highestIdNumber", () => {
  it("reads only ids spelled exactly prefix-then-digits", () => {
    const ids = ["s3", "s12", "s", "s1x", "S40", "t99", "s-5", "ss7", " s8", "s9 "];
    expect(highestIdNumber(ids, "s")).toBe(12);
  });

  it("is 0 when nothing matches", () => {
    expect(highestIdNumber([], "s")).toBe(0);
    expect(highestIdNumber(["t1", "x"], "s")).toBe(0);
  });

  it("takes leading zeros as the number they spell", () => {
    expect(highestIdNumber(["s007", "s5"], "s")).toBe(7);
  });

  it("works for a longer prefix too", () => {
    expect(highestIdNumber(["img4", "img10", "i99"], "img")).toBe(10);
  });
});

describe("IdSequence", () => {
  it("counts on from the highest id, not from how many there are", () => {
    const ids = new IdSequence("s");
    ids.restart(["s1", "s10", "s4"]);
    expect([ids.next(), ids.next()]).toEqual(["s11", "s12"]);
  });

  it("starts at 1 on an empty document", () => {
    const ids = new IdSequence("t");
    ids.restart([]);
    expect(ids.next()).toBe("t1");
  });

  it("forgets what it handed out when restarted on another document", () => {
    const ids = new IdSequence("s");
    ids.restart(["s50"]);
    ids.next();
    ids.restart(["s2"]);
    expect(ids.next()).toBe("s3");
  });

  it("catches up with ids that arrived from elsewhere, and never goes back", () => {
    const ids = new IdSequence("s");
    ids.restart(["s3"]);
    ids.next();
    ids.catchUp(["s1", "s2"]);
    expect(ids.next()).toBe("s5");
    ids.catchUp(["s20"]);
    expect(ids.next()).toBe("s21");
  });
});

describe("the document's ids", () => {
  it("lists stroke and text box ids page by page", () => {
    const d = doc(pageWith("p1", ["s1", "s2"], ["t1"]), pageWith("p2", ["s7"], ["t4", "t2"]));
    expect(strokeIdsOf(d)).toEqual(["s1", "s2", "s7"]);
    expect(textBoxIdsOf(d)).toEqual(["t1", "t4", "t2"]);
  });
});
