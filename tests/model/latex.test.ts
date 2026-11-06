import { describe, expect, it } from "vitest";
import { boxText } from "../../src/model/calc-display";
import { LATEX_MAX_CHARS, parseLatex, unwrapMath } from "../../src/model/latex";

const read = (tex: string): string => boxText(parseLatex(tex));

describe("typed LaTeX into the box tree", () => {
  it.each([
    ["\\frac{a}{b}", "[a/b]"],
    ["\\dfrac12", "[1/2]"],
    ["x^2", "x^{2}"],
    ["x^23", "x^{2}3"],
    ["x^{23}", "x^{23}"],
    ["a_{n+1}", "a_{n+1}"],
    ["x_i^2", "x_{i}^{2}"],
    ["x^2_i", "x_{i}^{2}"],
    ["f'(x)", "f^{′}(x)"],
    ["\\sqrt{x}", "√{x}"],
    ["\\sqrt[3]{8}", "root{3}{8}"],
    ["\\alpha+\\Omega", "α+Ω"],
    ["a \\le b \\ne c", "a≤b≠c"],
    ["a-b", "a−b"],
    ["\\sin x", "sinx"],
    ["\\sum_{i=1}^{n} i", "Σ_{i=1}^{n}i"],
    ["\\int_0^1 x\\,dx", "∫_{0}^{1}x dx"],
    ["\\lim_{x\\to 0}", "lim_{x→0}"],
    ["(a+b)", "(a+b)"],
    ["[0, 1)", "[0,1)"],
    ["\\left[ x \\right]", "[x]"],
    ["\\left. x \\right|", "x|"],
    ["(\\left[ x \\right] + 1)", "([x]+1)"],
    ["(\\begin{matrix} a & b \\end{matrix})", "(a & b)"],
    ["\\left( (a) \\right)", "((a))"],
    ["|x|", "|x|"],
    ["\\{1, 2\\}", "{1,2}"],
    ["\\langle u, v \\rangle", "⟨u,v⟩"],
    ["\\binom{n}{k}", "([n over k])"],
    ["\\text{if } x", "if x"],
    ["\\mathbb{R}", "ℝ"],
    ["\\vec{v}", "vec{v}"],
    ["\\overline{AB}", "bar{AB}"],
    ["\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "(a & b ; c & d)"],
    ["\\begin{cases} 1 & x>0 \\\\ 0 \\end{cases}", "{1 & x>0 ; 0"],
    ["\\begin{aligned} a &= b \\\\ &= c \\end{aligned}", "a & =b ;  & =c"],
  ])("%s", (tex, shown) => {
    expect(read(tex)).toBe(shown);
  });

  it("shows what it does not know as typed, and never throws", () => {
    expect(read("\\foo{x}")).toBe("\\foox");
    expect(read("\\begin{weird} x \\end{weird}")).toBe("\\begin{weird}x");
    for (const tex of [
      "{",
      "}",
      "\\",
      "^",
      "_",
      "x^",
      "\\frac{",
      "\\left(",
      "\\right)",
      "&",
      "\\\\",
    ]) {
      expect(() => parseLatex(tex)).not.toThrow();
    }
    expect(read("x}")).toBe("x");
    expect(read("{x")).toBe("x");
  });

  it("drops comments, keeps the matrix rows a trailing \\\\ leaves", () => {
    expect(read("x % a comment\n+ 1")).toBe("x+1");
    expect(read("\\begin{matrix} 1 \\\\ 2 \\\\ \\end{matrix}")).toBe("1 ; 2");
  });

  it("marks \\mathbf bold, and keeps one space of a run in \\text, as TeX does", () => {
    const bold = parseLatex("\\mathbf{v}");
    expect(bold).toEqual({ t: "text", s: "v", role: "fn", bold: true });
    expect(parseLatex("\\text{a  b}")).toEqual({ t: "text", s: "a b", role: "fn" });
    expect(parseLatex("\\mathbb{Rx}")).toEqual({ t: "text", s: "Rx", role: "fn", bold: true });
  });

  it("stays quick on brackets with no partner", () => {
    const started = Date.now();
    parseLatex("(".repeat(2000));
    parseLatex("\\left(".repeat(500));
    parseLatex("{".repeat(2000));
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reads at most LATEX_MAX_CHARS", () => {
    const long = "x".repeat(LATEX_MAX_CHARS + 50);
    const box = parseLatex(long);
    expect(boxText(box).length).toBe(LATEX_MAX_CHARS);
  });

  it("takes off the dollars a pasted formula carries", () => {
    expect(unwrapMath("$x$")).toBe("x");
    expect(unwrapMath("$$x$$")).toBe("x");
    expect(unwrapMath("\\[x\\]")).toBe("x");
    expect(unwrapMath("\\(x\\)")).toBe("x");
    expect(unwrapMath("x")).toBe("x");
    expect(read("$\\frac12$")).toBe("[1/2]");
  });
});
