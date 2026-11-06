/**
 * Typed equations (discussion #166): a subset of LaTeX math read into the
 * calculator's box tree (`calc-display.ts`'s {@link MathBox}), which
 * `canvas/math-layout.ts` measures and the renderer paints into the page.
 *
 * What it reads: `\frac` (`\dfrac`, `\tfrac`, `\binom`), `\sqrt[n]{}`,
 * `^` and `_`, Greek letters and the common signs, `\sum` `\prod` `\int`
 * `\lim` and their kin with limits, brackets that grow (`( )`, `[ ]`,
 * `\{ \}`, `|x|`, `\left … \right`), matrices and `cases`, `aligned`,
 * function names, `\text`, `\mathrm`, `\mathbf`, `\mathbb`, accents
 * (`\vec`, `\hat`, …) and spaces.
 *
 * It never fails: a command it does not know stays as its own text
 * (`\foo`), a brace left open closes at the end, a stray one is dropped.
 * Pure: no DOM.
 */

import type { MathAccent, MathBox } from "./calc-display";

/** The longest source read; past it, the rest is not an equation anyone typed. */
export const LATEX_MAX_CHARS = 4000;
/** How deep groups may nest before the rest is read as plain text (a stack's guard). */
const MAX_DEPTH = 48;

type Role = "num" | "op" | "fn" | "var";
const text = (s: string, role: Role): MathBox => ({ t: "text", s, role });
const row = (items: MathBox[]): MathBox => (items.length === 1 ? items[0] : { t: "row", items });
const EMPTY: MathBox = { t: "row", items: [] };

/** Letters as print sets them: lowercase Greek italic, as Latin letters are; capitals upright. */
const GREEK: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  omicron: "ο",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
};
const GREEK_CAPITALS: Readonly<Record<string, string>> = {
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
};

/** Signs set between operands (spaced by the layout) and everything else upright. */
const SYMBOLS: Readonly<Record<string, string>> = {
  pm: "±",
  mp: "∓",
  times: "×",
  cdot: "·",
  div: "÷",
  ast: "∗",
  star: "⋆",
  circ: "∘",
  bullet: "•",
  oplus: "⊕",
  otimes: "⊗",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  wedge: "∧",
  land: "∧",
  vee: "∨",
  lor: "∨",
  neg: "¬",
  lnot: "¬",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  ll: "≪",
  gg: "≫",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  propto: "∝",
  coloneqq: "≔",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  supset: "⊃",
  subseteq: "⊆",
  supseteq: "⊇",
  perp: "⊥",
  parallel: "∥",
  mid: "∣",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  implies: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  iff: "⇔",
  mapsto: "↦",
  uparrow: "↑",
  downarrow: "↓",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  emptyset: "∅",
  varnothing: "∅",
  cdots: "⋯",
  ldots: "…",
  dots: "…",
  vdots: "⋮",
  ddots: "⋱",
  prime: "′",
  degree: "°",
  angle: "∠",
  triangle: "△",
  square: "□",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  therefore: "∴",
  because: "∵",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  vert: "|",
  Vert: "‖",
  lbrace: "{",
  rbrace: "}",
  backslash: "\\",
};

/** Upright names set as words, with the room print gives them. */
const FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "coth",
  "log",
  "ln",
  "lg",
  "exp",
  "det",
  "gcd",
  "deg",
  "dim",
  "ker",
  "arg",
  "hom",
  "Pr",
  "mod",
  "bmod",
]);

/** Big operators: the sign, and whether its limits go beside it (an integral). */
const BIG_OPS: Readonly<Record<string, { sym: string; side?: true }>> = {
  sum: { sym: "Σ" },
  prod: { sym: "Π" },
  coprod: { sym: "∐" },
  bigcup: { sym: "⋃" },
  bigcap: { sym: "⋂" },
  bigoplus: { sym: "⊕" },
  bigotimes: { sym: "⊗" },
  int: { sym: "∫", side: true },
  iint: { sym: "∬", side: true },
  iiint: { sym: "∭", side: true },
  oint: { sym: "∮", side: true },
  lim: { sym: "lim" },
  limsup: { sym: "lim sup" },
  liminf: { sym: "lim inf" },
  max: { sym: "max" },
  min: { sym: "min" },
  sup: { sym: "sup" },
  inf: { sym: "inf" },
};

const ACCENTS: Readonly<Record<string, MathAccent>> = {
  vec: "vec",
  overrightarrow: "vec",
  bar: "bar",
  overline: "bar",
  hat: "hat",
  widehat: "hat",
  tilde: "tilde",
  widetilde: "tilde",
  dot: "dot",
  ddot: "ddot",
  underline: "under",
};

const SPACES: Readonly<Record<string, number>> = {
  ",": 3 / 18,
  ":": 4 / 18,
  ">": 4 / 18,
  ";": 5 / 18,
  "!": -3 / 18,
  " ": 1 / 3,
  quad: 1,
  qquad: 2,
};

/** `\mathbb`'s letters that have their own sign in every font (the rest are set bold). */
const DOUBLE_STRUCK: Readonly<Record<string, string>> = {
  C: "ℂ",
  H: "ℍ",
  N: "ℕ",
  P: "ℙ",
  Q: "ℚ",
  R: "ℝ",
  Z: "ℤ",
};

/** Environments: their brackets and how their columns align. */
const ENVIRONMENTS: Readonly<
  Record<string, { open: string; close: string; align?: "l" | "rl"; args?: number }>
> = {
  matrix: { open: "", close: "" },
  smallmatrix: { open: "", close: "" },
  pmatrix: { open: "(", close: ")" },
  bmatrix: { open: "[", close: "]" },
  Bmatrix: { open: "{", close: "}" },
  vmatrix: { open: "|", close: "|" },
  Vmatrix: { open: "‖", close: "‖" },
  cases: { open: "{", close: "", align: "l" },
  aligned: { open: "", close: "", align: "rl" },
  align: { open: "", close: "", align: "rl" },
  "align*": { open: "", close: "", align: "rl" },
  gathered: { open: "", close: "" },
  gather: { open: "", close: "" },
  "gather*": { open: "", close: "" },
  split: { open: "", close: "", align: "rl" },
  array: { open: "", close: "", args: 1 },
};

/** Opening brackets read as a group when their partner follows, and that partner. */
const PAIRS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "|": "|",
  "‖": "‖",
  "⟨": "⟩",
  "⌊": "⌋",
  "⌈": "⌉",
};

type Token =
  | { k: "cmd"; name: string }
  | { k: "char"; c: string }
  | { k: "open" }
  | { k: "close" }
  | { k: "sup" }
  | { k: "sub" }
  | { k: "amp" }
  | { k: "newline" }
  | { k: "space" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const chars = Array.from(source.slice(0, LATEX_MAX_CHARS));
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "\\") {
      const next = chars[i + 1];
      if (next === undefined) {
        tokens.push({ k: "char", c: "\\" });
      } else if (next === "\\") {
        tokens.push({ k: "newline" });
        i++;
      } else if (/[A-Za-z]/.test(next)) {
        let name = "";
        while (i + 1 < chars.length && /[A-Za-z]/.test(chars[i + 1])) name += chars[++i];
        // `\begin{align*}`'s star belongs to the name it follows only inside \begin/\end.
        tokens.push({ k: "cmd", name });
      } else {
        tokens.push({ k: "cmd", name: next });
        i++;
      }
    } else if (c === "{") tokens.push({ k: "open" });
    else if (c === "}") tokens.push({ k: "close" });
    else if (c === "^") tokens.push({ k: "sup" });
    else if (c === "_") tokens.push({ k: "sub" });
    else if (c === "&") tokens.push({ k: "amp" });
    else if (c === "%") {
      // A comment runs to the end of the line.
      while (i + 1 < chars.length && chars[i + 1] !== "\n") i++;
    } else if (/\s/.test(c)) {
      if (tokens[tokens.length - 1]?.k !== "space") tokens.push({ k: "space" });
    } else tokens.push({ k: "char", c });
  }
  return tokens;
}

/** Where a row stops: the end, a closing brace, a cell or line break, a bracket's partner. */
interface Stop {
  brace?: boolean;
  cell?: boolean;
  /** `\right`, ending a `\left` group. */
  right?: boolean;
  /** This bracket character (a plain bracket's partner). */
  partner?: string;
  /** `\end`, ending an environment. */
  end?: boolean;
}

class Parser {
  private at = 0;
  private depth = 0;
  /** Brackets known to have no partner, as `<token index>:<partner>`. */
  private readonly unmatched = new Set<string>();

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private skipSpaces(): void {
    while (this.peek()?.k === "space") this.at++;
  }

  /** A row of atoms up to `stop` (not taken). */
  parseRow(stop: Stop): MathBox[] {
    const items: MathBox[] = [];
    for (;;) {
      const token = this.peek();
      if (!token) return items;
      // A bracket's partner is looked for inside its group only: whatever
      // would end the group ends the search too.
      const hard = stop.partner !== undefined;
      if (token.k === "close") {
        if (stop.brace || hard) return items;
        this.at++; // a stray brace: dropped
        continue;
      }
      if ((token.k === "amp" || token.k === "newline") && (stop.cell || hard)) return items;
      if (token.k === "cmd" && token.name === "right" && (stop.right || hard)) return items;
      if (token.k === "cmd" && token.name === "end" && (stop.end || hard)) return items;
      if (hard && closesWith(token, stop.partner as string)) return items;
      if (token.k === "space") {
        this.at++;
        continue;
      }
      if (token.k === "amp" || token.k === "newline") {
        // Outside a grid: an ampersand is nothing, a line break a space.
        this.at++;
        if (token.k === "newline") items.push({ t: "space", em: 1 });
        continue;
      }
      if (token.k === "sup" || token.k === "sub") {
        // A script with nothing before it hangs on an empty base.
        this.scripts(EMPTY, items);
        continue;
      }
      const atom = this.atom(stop);
      if (atom === null) continue;
      this.scripts(atom, items);
    }
  }

  /** `base` with any `^` and `_` that follow it, pushed onto `items`. */
  private scripts(base: MathBox, items: MathBox[]): void {
    let sup: MathBox | undefined;
    let sub: MathBox | undefined;
    for (;;) {
      const at = this.at;
      this.skipSpaces();
      const token = this.peek();
      if (token?.k === "char" && token.c === "'") {
        // Primes: raised, joined into the exponent.
        let primes = "";
        while (this.peek()?.k === "char" && (this.peek() as { c: string }).c === "'") {
          primes += "′";
          this.at++;
        }
        sup = sup ? row([sup, text(primes, "op")]) : text(primes, "op");
        continue;
      }
      if (token?.k === "cmd" && (token.name === "limits" || token.name === "nolimits")) {
        this.at++;
        if (base.t === "bigop") {
          if (token.name === "nolimits") base.side = true;
          else delete base.side;
        }
        continue;
      }
      if (token?.k !== "sup" && token?.k !== "sub") {
        this.at = at;
        break;
      }
      this.at++;
      const arg = this.argument();
      if (token.k === "sup") sup = sup ? row([sup, arg]) : arg;
      else sub = sub ? row([sub, arg]) : arg;
    }
    if (!sup && !sub) {
      items.push(base);
      return;
    }
    if (base.t === "bigop") {
      if (sup) base.hi = sup;
      if (sub) base.lo = sub;
      items.push(base);
    } else if (sub) {
      items.push(sup ? { t: "sub", base, sub, sup } : { t: "sub", base, sub });
    } else if (sup) items.push({ t: "sup", base, exp: sup });
  }

  /** One argument: a braced group, or a single token's atom. Missing: an empty box. */
  private argument(): MathBox {
    this.skipSpaces();
    const token = this.peek();
    if (!token || token.k === "close" || token.k === "amp" || token.k === "newline") return EMPTY;
    if (token.k === "sup" || token.k === "sub") return EMPTY;
    if (token.k === "char" && /[0-9]/.test(token.c)) {
      // `x^23` raises only the 2, as TeX does.
      this.at++;
      return text(token.c, "num");
    }
    return this.atom({}) ?? EMPTY;
  }

  /** A braced group's row; the opening brace not yet taken. */
  private group(): MathBox {
    this.at++;
    if (++this.depth > MAX_DEPTH) return this.rest();
    const items = this.parseRow({ brace: true });
    this.depth--;
    if (this.peek()?.k === "close") this.at++;
    return row(items);
  }

  /** Too deep: everything left, as its plain text. */
  private rest(): MathBox {
    let s = "";
    while (this.peek()) {
      const token = this.tokens[this.at++];
      s += tokenText(token);
    }
    return text(s, "fn");
  }

  /** Raw text up to the matching brace (`\text{…}`), braces inside kept. */
  private rawGroup(): string {
    this.skipSpaces();
    const token = this.peek();
    if (token?.k !== "open") {
      if (!token) return "";
      this.at++;
      return tokenText(token);
    }
    this.at++;
    let level = 0;
    let s = "";
    while (this.peek()) {
      const t = this.tokens[this.at++];
      if (t.k === "open") level++;
      if (t.k === "close" && level-- === 0) break;
      if (t.k === "cmd" && SPACES[t.name] !== undefined && t.name.length === 1) s += " ";
      else if (t.k === "cmd" && /^[{}$%&#_]$/.test(t.name)) s += t.name;
      else s += tokenText(t);
    }
    return s;
  }

  /** `[…]` after a command (`\sqrt[3]`), or null when there is none. */
  private optional(): MathBox | null {
    this.skipSpaces();
    const token = this.peek();
    if (token?.k !== "char" || token.c !== "[") return null;
    this.at++;
    const items = this.parseRow({ partner: "]" });
    if (this.peek()?.k === "char") this.at++;
    return row(items);
  }

  /** The next atom, or null when the token was used up making nothing. */
  private atom(stop: Stop): MathBox | null {
    const token = this.tokens[this.at];
    if (token.k === "open") return this.group();
    if (token.k === "char") return this.character(token.c, stop);
    if (token.k === "cmd") {
      this.at++;
      return this.command(token.name);
    }
    this.at++;
    return null;
  }

  private character(c: string, stop: Stop): MathBox {
    this.at++;
    if (/[0-9.]/.test(c)) {
      // A number's digits, as one run.
      let s = c;
      while (this.peek()?.k === "char" && /[0-9.]/.test((this.peek() as { c: string }).c)) {
        s += (this.tokens[this.at++] as { c: string }).c;
      }
      return text(s, "num");
    }
    if (/\p{L}/u.test(c)) return text(c, "var");
    if (PAIRS[c] !== undefined && !(c === "|" && stop.partner === "|")) {
      const grouped = this.bracketed(c, PAIRS[c]);
      if (grouped) return grouped;
    }
    if (c === "-") return text("−", "op");
    if (c === "*") return text("∗", "op");
    return text(c, "op");
  }

  /**
   * A bracket and what it holds as one growing group, when its partner
   * follows in this row; null (nothing taken) when it does not, so the
   * bracket is just a sign (`[0, 1)`).
   */
  private bracketed(open: string, close: string): MathBox | null {
    const start = this.at;
    // A bracket with no partner is looked for once: `((((` would otherwise
    // search again from every bracket inside every search.
    const key = `${start}:${close}`;
    if (this.unmatched.has(key)) return null;
    // A cheap look ahead first: with no partner before the group ends, there
    // is nothing to read (a page of `((((` stays linear per bracket).
    if (!this.partnerAhead(start, close)) {
      this.unmatched.add(key);
      return null;
    }
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      return null;
    }
    const items = this.parseRow({ partner: close });
    this.depth--;
    const end = this.peek();
    if (!end || !closesWith(end, close)) {
      this.unmatched.add(key);
      this.at = start;
      return null;
    }
    this.at++;
    const body = row(items);
    if (open === "|") return { t: "abs", body };
    if (open === "(") return { t: "paren", body };
    return { t: "paren", body, open, close };
  }

  /** Whether bracket `close` comes from token `from` on, before its group ends. */
  private partnerAhead(from: number, close: string): boolean {
    let level = 0;
    for (let i = from; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      // Braces, \left…\right and \begin…\end nest; the bracket's own group is level 0.
      const opens =
        token.k === "open" ||
        (token.k === "cmd" && (token.name === "left" || token.name === "begin"));
      const closes =
        token.k === "close" ||
        (token.k === "cmd" && (token.name === "right" || token.name === "end"));
      if (opens) {
        level++;
        // `\left(`'s own bracket is not this one's partner.
        if (token.k === "cmd" && token.name === "left") i++;
      } else if (closes) {
        if (level === 0) return false;
        level--;
        if (token.k === "cmd" && token.name === "right") i++;
      } else if (level === 0) {
        if (token.k === "amp" || token.k === "newline") return false;
        if (closesWith(token, close)) return true;
      }
    }
    return false;
  }

  private command(name: string): MathBox | null {
    if (GREEK[name]) return text(GREEK[name], "var");
    if (GREEK_CAPITALS[name]) return text(GREEK_CAPITALS[name], "fn");
    if (SPACES[name] !== undefined) return { t: "space", em: SPACES[name] };
    if (FUNCTIONS.has(name)) return text(name === "bmod" ? "mod" : name, "fn");
    const big = BIG_OPS[name];
    if (big) {
      const op: MathBox = { t: "bigop", sym: big.sym, body: EMPTY };
      if (big.side) op.side = true;
      return op;
    }
    const accent = ACCENTS[name];
    if (accent) return { t: "accent", mark: accent, body: this.argument() };
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac":
      case "cfrac":
        return { t: "frac", num: this.argument(), den: this.argument() };
      case "binom":
      case "dbinom":
      case "tbinom":
        return {
          t: "paren",
          body: { t: "frac", num: this.argument(), den: this.argument(), bar: false },
        };
      case "sqrt": {
        const index = this.optional();
        const body = this.argument();
        return index ? { t: "root", body, index } : { t: "root", body };
      }
      case "left":
        return this.leftRight();
      case "right":
        // A \right with no \left: its bracket, as a sign.
        return text(this.delimiter(), "op");
      case "begin":
        return this.environment();
      case "end":
        this.rawGroup();
        return null;
      case "text":
      case "textrm":
      case "textnormal":
      case "mathrm":
      case "operatorname":
      case "textup":
      case "mbox":
        return text(this.rawGroup(), "fn");
      case "textit":
      case "mathit":
        return text(this.rawGroup(), "var");
      case "textbf":
      case "mathbf":
      case "boldsymbol":
      case "bm":
        return { t: "text", s: this.rawGroup(), role: "fn", bold: true };
      case "mathbb": {
        const letters = this.rawGroup();
        const all = Array.from(letters).every((ch) => DOUBLE_STRUCK[ch] !== undefined);
        return all
          ? text(
              Array.from(letters)
                .map((ch) => DOUBLE_STRUCK[ch])
                .join(""),
              "fn",
            )
          : { t: "text", s: letters, role: "fn", bold: true };
      }
      case "mathcal":
      case "mathscr":
      case "mathsf":
      case "mathtt":
      case "mathfrak":
        return text(this.rawGroup(), "fn");
      case "displaystyle":
      case "textstyle":
      case "scriptstyle":
      case "limits":
      case "nolimits":
      case "big":
      case "Big":
      case "bigg":
      case "Bigg":
      case "bigl":
      case "bigr":
      case "Bigl":
      case "Bigr":
        return null;
      case "{":
      case "lbrace": {
        const grouped = this.bracketed("{", "}");
        return grouped ?? text("{", "op");
      }
      case "}":
        return text("}", "op");
      case "|":
        return text("‖", "op");
      case "%":
      case "$":
      case "#":
      case "&":
      case "_":
        return text(name, "op");
    }
    const sign = SYMBOLS[name];
    if (sign !== undefined) {
      if (PAIRS[sign] !== undefined && sign !== "{") {
        const grouped = this.bracketed(sign, PAIRS[sign]);
        if (grouped) return grouped;
      }
      return text(sign, "op");
    }
    // Not known: shown as typed.
    return text(`\\${name}`, "fn");
  }

  /** The bracket after `\left` or `\right`: "" for `.`. */
  private delimiter(): string {
    this.skipSpaces();
    const token = this.peek();
    if (!token) return "";
    this.at++;
    if (token.k === "char")
      return token.c === "." ? "" : token.c === "<" ? "⟨" : token.c === ">" ? "⟩" : token.c;
    if (token.k === "cmd") {
      if (token.name === "{" || token.name === "}") return token.name;
      if (token.name === "|") return "‖";
      return SYMBOLS[token.name] ?? "";
    }
    return "";
  }

  private leftRight(): MathBox {
    const open = this.delimiter();
    if (++this.depth > MAX_DEPTH) return this.rest();
    const items = this.parseRow({ right: true });
    this.depth--;
    let close = "";
    if (this.peek()?.k === "cmd") {
      this.at++;
      close = this.delimiter();
    }
    return { t: "paren", body: row(items), open, close };
  }

  private environment(): MathBox {
    const name = this.rawGroup().trim();
    const env = ENVIRONMENTS[name];
    if (!env) {
      // Unknown: its body as a row, its name shown so the gap is visible.
      const items = this.parseRow({ end: true });
      if (this.peek()?.k === "cmd") {
        this.at++;
        this.rawGroup();
      }
      return row([text(`\\begin{${name}}`, "fn"), ...items]);
    }
    for (let i = 0; i < (env.args ?? 0); i++) this.rawGroup();
    if (++this.depth > MAX_DEPTH) return this.rest();
    const rows: MathBox[][] = [];
    let cells: MathBox[] = [];
    for (;;) {
      cells.push(row(this.parseRow({ cell: true, end: true })));
      const token = this.peek();
      if (token?.k === "amp") {
        this.at++;
        continue;
      }
      if (token?.k === "newline") {
        this.at++;
        rows.push(cells);
        cells = [];
        continue;
      }
      if (token?.k === "cmd" && token.name === "end") {
        this.at++;
        this.rawGroup();
      }
      break;
    }
    this.depth--;
    // A trailing \\ leaves one empty cell: not a row.
    if (!(cells.length === 1 && isEmpty(cells[0]))) rows.push(cells);
    if (rows.length === 0) rows.push([EMPTY]);
    const box: MathBox = { t: "matrix", rows, open: env.open, close: env.close };
    if (env.align) box.align = env.align;
    return box;
  }
}

/** Whether `token` is the bracket `close` (`)`, `\}`, `\rangle`). */
function closesWith(token: Token, close: string): boolean {
  if (token.k === "char") return token.c === close;
  if (token.k === "cmd") return token.name === close || SYMBOLS[token.name] === close;
  return false;
}

function isEmpty(b: MathBox): boolean {
  return b.t === "row" && b.items.length === 0;
}

function tokenText(token: Token): string {
  switch (token.k) {
    case "cmd":
      return /^[A-Za-z]/.test(token.name) ? `\\${token.name}` : token.name;
    case "char":
      return token.c;
    case "open":
      return "{";
    case "close":
      return "}";
    case "sup":
      return "^";
    case "sub":
      return "_";
    case "amp":
      return "&";
    case "newline":
      return "\\\\";
    case "space":
      return " ";
  }
}

/**
 * `source` (LaTeX math, without `$`) as a box tree. Never throws; an empty
 * or blank source is an empty row. Surrounding `$…$`, `$$…$$`, `\[…\]` and
 * `\(…\)` are taken off, as pasted from a document.
 */
export function parseLatex(source: string): MathBox {
  const tokens = tokenize(unwrapMath(source));
  const items = new Parser(tokens).parseRow({});
  return row(items);
}

/** `source` without the math delimiters a pasted formula may carry. */
export function unwrapMath(source: string): string {
  const s = source.trim();
  for (const [open, close] of [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ]) {
    if (s.length >= open.length + close.length && s.startsWith(open) && s.endsWith(close)) {
      return s.slice(open.length, s.length - close.length);
    }
  }
  return s;
}
