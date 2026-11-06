import { describe, expect, it } from "vitest";
import {
  type MathGlyph,
  type MathLayout,
  layoutMath,
  mathFont,
} from "../../src/canvas/math-layout";
import { parseLatex } from "../../src/model/latex";
import type { MathBox } from "../../src/model/calc-display";

/** Every character half its font's size wide: enough to check where things go. */
const measure = (s: string, font: string): number => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  return Array.from(s).length * px * 0.5;
};
const lay = (tex: string, size = 20): MathLayout => layoutMath(parseLatex(tex), size, measure);
const glyphs = (l: MathLayout): MathGlyph[] =>
  l.ops.filter((op): op is MathGlyph => op.k === "glyph");
const glyph = (l: MathLayout, s: string): MathGlyph => {
  const g = glyphs(l).find((op) => op.s === s);
  if (!g) throw new Error(`no glyph ${s}`);
  return g;
};

describe("laying out a formula", () => {
  it("sets letters italic and numbers, signs and words upright", () => {
    const l = lay("2x + \\sin y");
    expect(glyph(l, "x").italic).toBe(true);
    expect(glyph(l, "2").italic).toBe(false);
    expect(glyph(l, "+").italic).toBe(false);
    expect(glyph(l, "sin").italic).toBe(false);
  });

  it("gives a binary sign room on both sides, but not a leading minus", () => {
    const spaced = lay("a+b");
    const tight = lay("ab");
    expect(spaced.w).toBeGreaterThan(tight.w + measure("+", "20px") + 4);
    const minus = lay("-a");
    expect(minus.w).toBeCloseTo(measure("−a", "20px"), 5);
  });

  it("stacks a fraction about the axis, the bar between", () => {
    const l = lay("\\frac{a}{b}");
    const a = glyph(l, "a");
    const b = glyph(l, "b");
    expect(a.y).toBeLessThan(0);
    expect(b.y).toBeGreaterThan(0);
    const bar = l.ops.find((op) => op.k === "rule");
    expect(bar).toBeDefined();
    if (bar?.k === "rule") {
      expect(bar.y).toBeLessThan(0);
      expect(bar.y).toBeGreaterThan(a.y);
    }
    expect(l.a).toBeGreaterThan(20 * 0.72);
    // A binomial has no bar.
    expect(lay("\\binom{n}{k}").ops.some((op) => op.k === "rule")).toBe(false);
  });

  it("raises a power and lowers an index, both smaller", () => {
    const l = lay("x_i^2");
    const two = glyph(l, "2");
    const i = glyph(l, "i");
    expect(two.y).toBeLessThan(0);
    expect(i.y).toBeGreaterThan(0);
    expect(two.size).toBeCloseTo(14);
    expect(two.x).toBeGreaterThan(glyph(l, "x").x);
    // A fraction inside a fraction is set smaller still.
    const nested = lay("\\frac{\\frac{a}{b}}{c}");
    expect(glyph(nested, "a").size).toBeLessThan(glyph(nested, "c").size);
  });

  it("draws a root's sign as a path, its index over the tick", () => {
    const l = lay("\\sqrt[3]{x}");
    const sign = l.ops.find((op) => op.k === "path");
    expect(sign?.k === "path" && sign.d.length).toBe(5);
    expect(glyph(l, "3").size).toBeCloseTo(10);
    expect(glyph(l, "3").y).toBeLessThan(0);
  });

  it("grows brackets round a tall body, and uses glyphs round a short one", () => {
    const short = lay("(x)");
    expect(glyphs(short).map((g) => g.s)).toEqual(["(", "x", ")"]);
    const tall = lay("\\left( \\frac{a}{b} \\right)");
    expect(glyphs(tall).map((g) => g.s)).toEqual(["a", "b"]);
    expect(tall.ops.filter((op) => op.k === "path")).toHaveLength(2);
    for (const c of ["[", "\\{", "|", "\\langle", "\\lfloor", "\\lceil", "\\|"]) {
      const close = {
        "[": "]",
        "\\{": "\\}",
        "|": "|",
        "\\langle": "\\rangle",
        "\\lfloor": "\\rfloor",
        "\\lceil": "\\rceil",
        "\\|": "\\|",
      }[c];
      const l = lay(`\\left${c} \\frac{a}{b} \\right${close}`);
      expect(l.ops.filter((op) => op.k === "path").length).toBeGreaterThanOrEqual(2);
    }
    // \left. draws nothing on its side.
    const half = lay("\\left. \\frac{a}{b} \\right|");
    expect(half.ops.filter((op) => op.k === "path")).toHaveLength(1);
  });

  it("puts Σ's limits above and below, and ∫'s beside it", () => {
    const sum = lay("\\sum_{i=1}^{n} i");
    const n = glyph(sum, "n");
    const sigma = glyph(sum, "Σ");
    expect(n.y).toBeLessThan(sigma.y - sigma.size * 0.5);
    expect(sigma.size).toBeGreaterThan(20);
    const int = lay("\\int_0^1 x");
    const one = glyph(int, "1");
    expect(one.x).toBeGreaterThan(glyph(int, "∫").x);
    expect(glyph(int, "∫").italic).toBe(true);
    // lim is a word with its limit under it.
    const lim = lay("\\lim_{x \\to 0} f");
    expect(glyph(lim, "lim").italic).toBe(false);
    expect(glyph(lim, "0").y).toBeGreaterThan(0);
    // A limit is set beside the sign with \nolimits.
    const side = lay("\\sum\\nolimits_{i} x");
    expect(glyph(side, "i").x).toBeGreaterThan(glyph(side, "Σ").x);
  });

  it("lays a matrix out in rows and columns between tall brackets", () => {
    const l = lay("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}");
    const [a, b, c, d] = ["a", "b", "c", "d"].map((s) => glyph(l, s));
    expect(a.y).toBe(b.y);
    expect(c.y).toBeGreaterThan(a.y);
    expect(b.x).toBeGreaterThan(a.x);
    expect(d.x).toBeCloseTo(b.x);
    expect(l.ops.filter((op) => op.k === "path")).toHaveLength(2);
    // cases: a brace on the left only, its columns to the left.
    const cases = lay("\\begin{cases} 1 & x \\\\ 22 & y \\end{cases}");
    expect(cases.ops.filter((op) => op.k === "path")).toHaveLength(1);
    expect(glyph(cases, "1").x).toBeCloseTo(glyph(cases, "22").x);
    // aligned: right then left, so the = signs line up.
    const aligned = lay("\\begin{aligned} xx &= 1 \\\\ y &= 2 \\end{aligned}");
    const eqs = glyphs(aligned).filter((g) => g.s === "=");
    expect(eqs[0].x).toBeCloseTo(eqs[1].x);
  });

  it("marks accents over their letter, and a line under", () => {
    for (const tex of ["\\vec{v}", "\\bar{x}", "\\hat{x}", "\\tilde{x}", "\\dot{x}", "\\ddot{x}"]) {
      const l = lay(tex);
      expect(l.ops.length).toBeGreaterThan(1);
      expect(l.a).toBeGreaterThan(lay("x").a);
    }
    const under = lay("\\underline{x}");
    expect(under.d).toBeGreaterThan(lay("x").d);
  });

  it("makes room for spaces, and nothing of an empty source", () => {
    expect(lay("a\\quad b").w).toBeGreaterThan(lay("ab").w + 19);
    expect(lay("").ops).toHaveLength(0);
    expect(lay("").w).toBe(0);
  });

  it("lays out the calculator's own boxes too", () => {
    const box: MathBox = {
      t: "row",
      items: [
        { t: "slot" },
        { t: "caret" },
        { t: "abs", body: { t: "text", s: "x", role: "var" } },
        { t: "bigop", sym: "∫", body: { t: "text", s: "x", role: "var" }, tail: "dx" },
      ],
    };
    const l = layoutMath(box, 20, measure);
    expect(glyphs(l).map((g) => g.s)).toContain("dx");
    expect(l.ops.some((op) => op.k === "path")).toBe(true);
  });

  it("names the font a glyph is set in", () => {
    expect(mathFont({ size: 20, italic: true, bold: false })).toBe(
      'italic 20px "Times New Roman", Times, serif',
    );
    expect(mathFont({ size: 14.256, italic: false, bold: true })).toBe(
      'bold 14.26px "Times New Roman", Times, serif',
    );
  });

  it("lays out the design note's examples without anything outside its box", () => {
    for (const tex of [
      "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
      "\\int_a^b u\\,dv = uv\\Big|_a^b - \\int_a^b v\\,du",
      "e^{i\\pi} + 1 = 0",
      "\\sum_{k=0}^{\\infty} \\frac{x^k}{k!}",
    ]) {
      const l = lay(tex);
      for (const g of glyphs(l)) {
        expect(g.x).toBeGreaterThanOrEqual(-0.01);
        expect(g.x).toBeLessThanOrEqual(l.w);
        expect(g.y).toBeGreaterThanOrEqual(-l.a);
        expect(g.y).toBeLessThanOrEqual(l.d);
      }
    }
  });
});
