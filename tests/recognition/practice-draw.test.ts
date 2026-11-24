import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_GEOMETRY } from "../../src/model/document";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import {
  DRAWN_SET,
  PRACTICE_SETS,
  askedTexts,
  buildDrawnFile,
  isDrawnSet,
  practiceLines,
  practiceSetOfDoc,
  promptCount,
} from "../../src/recognition/practice";
import {
  ANCHOR_LINES,
  PRACTICE_POOL_VERSION,
  TARGET,
  countFeatures,
  drawSheet,
  lineGain,
  lineShape,
  pairCoverage,
  poolLine,
  sheetQuota,
} from "../../src/recognition/practice-draw";
import { PRACTICE_POOL } from "../../src/recognition/practice-pool";

describe("the line pool", () => {
  it("holds only characters a sheet can print, each line short enough for one line", () => {
    for (const [kind, lines] of Object.entries(PRACTICE_POOL)) {
      expect(lines.length).toBeGreaterThan(200);
      expect(new Set(lines).size).toBe(lines.length);
      for (const line of lines) {
        expect(line.length, `${kind}: ${line}`).toBeLessThanOrEqual(44);
        expect(line.trim()).toBe(line);
      }
    }
    // Prose and notes stay inside Grape's alphabet (printable ASCII);
    // only the signs kind goes beyond it, on purpose.
    for (const line of [...PRACTICE_POOL.prose, ...PRACTICE_POOL.notes, ...PRACTICE_POOL.sums]) {
      expect(/^[\x20-\x7e]+$/.test(line), line).toBe(true);
    }
    expect(PRACTICE_POOL.signs.some((l) => /[√π≤≥≠±→]/.test(l))).toBe(true);
    // Only signs people write by hand in everyday notes.
    for (const line of PRACTICE_POOL.signs) expect(/[∑∫∈∞Σφωλμσ]/.test(line), line).toBe(false);
  });

  it("has sums that are right", () => {
    for (const line of PRACTICE_POOL.sums) {
      const plain = /^([\d\s+\-*/^().]+) = (-?[\d.]+)$/.exec(line);
      if (!plain) continue;
      const value = Function(`return (${plain[1].replace(/\^/g, "**")})`)() as number;
      expect(Math.abs(value - Number(plain[2])), line).toBeLessThan(0.006);
    }
  });

  it("has no sum nobody would write, and no office hours that end before they start", () => {
    for (const line of PRACTICE_POOL.sums) {
      expect(/= 0\b|[*/^] 1\b|\b1 [*/]|\b1\^|\b(\d+)(\^\d)? - \1\2\b/.test(line), line).toBe(false);
    }
    for (const line of PRACTICE_POOL.notes) {
      const hours = /^Office hours \w+ (\d+)-(\d+),/.exec(line);
      if (hours) expect(Number(hours[1]), line).toBeLessThan(Number(hours[2]));
    }
  });

  it("finds every line by its id", () => {
    expect(poolLine("a1")?.text).toBe(ANCHOR_LINES[0]);
    expect(poolLine("p0")?.text).toBe(PRACTICE_POOL.prose[0]);
    expect(poolLine("g3")?.text).toBe(PRACTICE_POOL.signs[3]);
    expect(poolLine("p99999")).toBeNull();
    expect(poolLine("z1")).toBeNull();
  });
});

describe("drawing a sheet", () => {
  it("splits a sheet across the kinds, prose taking what rounding leaves", () => {
    expect(sheetQuota(30)).toEqual({ prose: 13, caps: 6, notes: 6, sums: 4, signs: 1 });
    expect(Object.values(sheetQuota(20)).reduce((a, b) => a + b, 0)).toBe(20);
  });

  it("opens with every capital, and no rare signs", () => {
    const anchor = ANCHOR_LINES.join(" ");
    expect(new Set(anchor.match(/[A-Z]/g)).size).toBe(26);
    expect(/[{}\\`~[\]#^]/.test(anchor)).toBe(false);
    for (const line of ANCHOR_LINES) expect(line.length).toBeLessThanOrEqual(44);
  });

  it("takes one line of each made shape per sheet", () => {
    expect(lineShape("Hugo flew from Galway to Nairobi.")).toBe(
      lineShape("Ravi flew from Zagreb to Brno."),
    );
    expect(lineShape("#todo: redo networks sheet 9")).toBe(
      lineShape("#todo: redo geography sheet 5"),
    );
    const sheet = drawSheet([], 30, 5, false).filter((l) => !l.id.startsWith("p"));
    const shapes = sheet.map((l) => lineShape(l.text));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("opens the first sheet with the anchor, and never repeats what was asked", () => {
    const first = drawSheet([], 20, 1, true);
    expect(first.slice(0, 10).map((l) => l.text)).toEqual([...ANCHOR_LINES]);
    expect(first).toHaveLength(30);
    const asked = first.map((l) => l.text);
    const second = drawSheet(asked, 30, 2, false);
    expect(second).toHaveLength(30);
    expect(second.some((l) => asked.includes(l.text))).toBe(false);
    expect(new Set(second.map((l) => l.text)).size).toBe(30);
    // Each id names the line it holds.
    for (const line of second) expect(poolLine(line.id)?.text).toBe(line.text);
  });

  it("is the same for the same history and seed, and puts a 1 beside a 7", () => {
    const a = drawSheet(PRACTICE_SETS[0], 30, 42, false);
    expect(drawSheet(PRACTICE_SETS[0], 30, 42, false)).toEqual(a);
    expect(
      a.some((l) => l.id.startsWith("s") && l.text.includes("1") && l.text.includes("7")),
    ).toBe(true);
  });

  it("covers more letter pairs than the old fixed sets did", () => {
    const old = PRACTICE_SETS.flat();
    let asked: string[] = [];
    for (let sheet = 0; sheet < 3; sheet++) {
      asked = [
        ...asked,
        ...drawSheet(asked, sheet === 0 ? 20 : 30, sheet + 1, sheet === 0).map((l) => l.text),
      ];
    }
    // Same number of lines to copy as the three old sets (90 against 90).
    expect(asked).toHaveLength(90);
    expect(pairCoverage(asked)).toBeGreaterThan(pairCoverage(old) + 0.15);
  });

  it("values a line by what the writer still lacks", () => {
    const have = countFeatures([]);
    const fresh = lineGain("Jacqueline quizzed six boxers", have);
    const saturated = countFeatures(Array(TARGET).fill("Jacqueline quizzed six boxers"));
    expect(lineGain("Jacqueline quizzed six boxers", saturated)).toBe(0);
    expect(fresh).toBeGreaterThan(0);
  });
});

describe("a drawn sheet's file", () => {
  it("prints its lines as prompts with pool ids, and says where they came from", () => {
    const lines = drawSheet([], 20, 3, true);
    const doc = buildDrawnFile(
      DEFAULT_PAGE_GEOMETRY,
      lines,
      { pool: PRACTICE_POOL_VERSION, seed: 3 },
      1,
    );
    expect(isDrawnSet(practiceSetOfDoc(doc))).toBe(true);
    expect(doc.practice).toEqual({
      format: 1,
      set: DRAWN_SET,
      draw: { pool: PRACTICE_POOL_VERSION, seed: 3 },
    });
    expect(promptCount(doc)).toBe(30);
    expect(askedTexts(doc)).toEqual(lines.map((l) => l.text));
    const prompts = doc.pages.flatMap((p) =>
      p.backdrop.kind === "pdf" ? [] : (p.backdrop.printed ?? []).filter((t) => t.prompt),
    );
    expect(prompts[0].prompt).toBe("practice-200-a1");
    expect(prompts[12].prompt).toBe(`practice-200-${lines[12].id}`);

    // Saved and read back, the draw survives.
    const back = parseInkFile(buildInkFile("", doc), DEFAULT_PAGE_GEOMETRY.width).doc;
    if (!back) throw new Error("the drawn sheet did not read back");
    expect(back.practice?.draw).toEqual({ pool: PRACTICE_POOL_VERSION, seed: 3 });
    // Nothing written yet: nothing to learn from.
    expect(practiceLines(back)).toEqual([]);
  });
});
