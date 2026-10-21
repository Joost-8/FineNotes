/**
 * The calculator's symbolic side, in one call: given what was typed, either
 * an answer with its working (Symbolab's "steps") or null, which means the
 * calculator works it in numbers as before. Pure: no DOM.
 *
 * - `solve(f = g)` or a bare equation `f = g`: every x (`solve.ts`).
 * - `d/dx(f)`: the derivative; `d/dx(f, a)`: its value at a, exactly.
 * - `∫(f)`: the antiderivative + C; `∫(f, a, b)`: F(b) − F(a) exactly when
 *   an antiderivative is found and agrees with the numerical integral.
 * - Anything else with x in it: simplified (a polynomial multiplied out).
 */

import type { AngleMode, CalcNode } from "../calculator";
import { evaluate as evaluateNumber, parseExpression } from "../calculator";
import { fromNode } from "./convert";
import { deriveSteps } from "./derive";
import {
  AlgebraError,
  type Expr,
  X,
  add,
  evaluate,
  free,
  nodes,
  print,
  replace,
  sub,
  sym,
} from "./expr";
import { integrateSteps } from "./integrate";
import { expand, toPoly } from "./poly";
import { solveEquation } from "./solve";

/** A line of working: what was done, then the expressions it left (several are joined by "or"). */
export interface WorkedStep {
  rule: string;
  /** Each in the calculator's syntax, laid out by the natural display. */
  math: string[];
}

export type Worked =
  | {
      ok: true;
      /** The answer, a line each (x = 2, x = 3), in the calculator's syntax. */
      answer: string[];
      steps: WorkedStep[];
      /** Found in numbers: shown with ≈. */
      approx: boolean;
      /** A short line under the answer: "k is any whole number", "No real solution". */
      note?: string;
      /** The answer as one number, for Ans, when it is one. */
      value?: number;
    }
  | { ok: false; error: string };

const TRIG = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan"]);

function hasTrig(e: Expr): boolean {
  return nodes(e).some((n) => n.t === "fn" && TRIG.has(n.name));
}

/** What was typed, worked symbolically; null when it is a plain calculation. */
export function work(expression: string, angle: AngleMode = "rad"): Worked | null {
  const parsed = parseExpression(expression, 10, { relations: true });
  if (!parsed.ok) return null;
  try {
    return dispatch(parsed.node, expression, angle);
  } catch (error) {
    if (error instanceof AlgebraError) return null;
    throw error;
  }
}

function dispatch(node: CalcNode, expression: string, angle: AngleMode): Worked | null {
  if (node.k === "rel") {
    if (node.op !== "=") return null;
    return solved(node, angle);
  }
  if (node.k === "call" && node.fn === "solve" && node.args.length === 1) {
    const rel = node.args[0];
    if (rel.k !== "rel") return { ok: false, error: "solve needs an equation" };
    return solved(rel, angle);
  }
  if (node.k === "call" && node.fn === "deriv") return derived(node, angle);
  if (node.k === "call" && node.fn === "integral") return integrated(node, expression, angle);
  // Anything else with x in it: simplified.
  const e = fromNode(node);
  if (free(e, "x")) return null;
  return simplified(e);
}

function solved(rel: Extract<CalcNode, { k: "rel" }>, angle: AngleMode): Worked {
  const lhs = fromNode(rel.a);
  const rhs = fromNode(rel.b);
  try {
    const s = solveEquation(lhs, rhs, { angle });
    const answer = s.values.map((v) =>
      s.approx ? `x ≈ ${decimal(evaluate(v))}` : `x = ${print(v)}`,
    );
    const note = s.message ?? (s.integer ? `${s.integer} is any whole number` : undefined);
    const single = s.values.length === 1 && !s.integer ? evaluate(s.values[0]) : undefined;
    return {
      ok: true,
      answer,
      steps: s.steps,
      approx: s.approx,
      ...(note ? { note } : {}),
      ...(single !== undefined && Number.isFinite(single) ? { value: single } : {}),
    };
  } catch (error) {
    if (error instanceof AlgebraError) return { ok: false, error: error.message };
    throw error;
  }
}

function calculusAngle(e: Expr, angle: AngleMode): Worked | null {
  if (angle === "deg" && hasTrig(e))
    return { ok: false, error: "Calculus with trig works in radians: switch to RAD" };
  return null;
}

function derived(node: Extract<CalcNode, { k: "call" }>, angle: AngleMode): Worked | null {
  const f = fromNode(node.args[0]);
  const refused = calculusAngle(f, angle);
  if (refused) return refused;
  const { result, steps } = deriveSteps(f);
  const shown = steps.map((s) => ({ rule: s.rule, math: [print(s.expr)] }));
  if (node.args.length === 1) {
    return { ok: true, answer: [print(result)], steps: shown, approx: false };
  }
  // d/dx(f, a): the derivative, then its value at a.
  const at = fromNode(node.args[1]);
  if (!free(at, "x")) return null;
  const value = replace(result, X, at);
  const number = evaluate(value);
  if (!Number.isFinite(number)) return null;
  shown.push({ rule: `Substitute x = ${print(at)}`, math: [print(value)] });
  return { ok: true, answer: [print(value)], steps: shown, approx: false, value: number };
}

function integrated(
  node: Extract<CalcNode, { k: "call" }>,
  expression: string,
  angle: AngleMode,
): Worked | null {
  const f = fromNode(node.args[0]);
  const refused = calculusAngle(f, angle);
  if (refused) return refused;
  let worked: { result: Expr; steps: Array<{ rule: string; expr: Expr }> };
  try {
    worked = integrateSteps(f);
  } catch (error) {
    if (!(error instanceof AlgebraError)) throw error;
    // Without limits there is no number to fall back on.
    if (node.args.length < 3)
      return { ok: false, error: "No antiderivative found with the usual rules" };
    return null;
  }
  const steps = worked.steps.map((s) => ({ rule: s.rule, math: [print(s.expr)] }));
  if (node.args.length < 3) {
    const withC = add(worked.result, sym("C"));
    steps.push({ rule: "Add the constant of integration", math: [print(withC)] });
    return { ok: true, answer: [print(withC)], steps, approx: false };
  }
  // ∫(f, a, b) = F(b) − F(a), checked against the numerical integral.
  const a = fromNode(node.args[1]);
  const b = fromNode(node.args[2]);
  if (!free(a, "x") || !free(b, "x")) return null;
  const Fb = replace(worked.result, X, b);
  const Fa = replace(worked.result, X, a);
  const exact = sub(Fb, Fa);
  const number = evaluate(exact);
  const numeric = evaluateNumber(expression, { angle });
  if (!numeric.ok || !Number.isFinite(number)) return null;
  const check =
    typeof numeric.value === "number"
      ? numeric.value
      : Number(numeric.value.n) / Number(numeric.value.d);
  if (Math.abs(check - number) > 1e-6 * Math.max(1, Math.abs(number))) return null;
  steps.push({
    rule: `Evaluate from ${print(a)} to ${print(b)}: F(b) − F(a)`,
    math: [`(${print(Fb)}) - (${print(Fa)})`],
  });
  steps.push({ rule: "Simplify", math: [print(exact)] });
  return { ok: true, answer: [print(exact)], steps, approx: false, value: number };
}

function simplified(e: Expr): Worked {
  const poly = toPoly(e);
  const result = poly ? expand(e) : e;
  const steps: WorkedStep[] =
    print(result) !== print(e) ? [{ rule: "Multiply out", math: [print(result)] }] : [];
  return { ok: true, answer: [print(result)], steps, approx: false };
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
};

/**
 * Calculator text as it reads in a text box on the page: x², √, ·, −, |x|,
 * ∫ … dx and d/dx. What has no plain form (a fraction's bar) stays as `/`.
 */
export function readable(text: string): string {
  return text
    .replace(/\^\((-?[0-9]+)\)/g, (_m, d: string) =>
      [...d].map((c) => SUPERSCRIPT[c] ?? c).join(""),
    )
    .replace(/\^([0-9]+)/g, (_m, d: string) => [...d].map((c) => SUPERSCRIPT[c] ?? c).join(""))
    .replace(/\^x\b/g, "ˣ")
    .replace(/\bconstant\b/g, "C")
    .replace(/\babs\(([^()]*)\)/g, "|$1|")
    .replace(/\bsqrt\(/g, "√(")
    .replace(/∫\(([^,]*)\)$/, "∫ $1 dx")
    .replace(/\*/g, "·")
    .replace(/ - /g, " − ")
    .replace(/(^|[(=\s])-/g, "$1−");
}

/** A float as the display writes it: ten significant digits, no float noise. */
function decimal(v: number): string {
  if (v === 0) return "0";
  return `${Number(v.toPrecision(10))}`;
}
