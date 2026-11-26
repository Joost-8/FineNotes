/**
 * Tensors as a writer kind hands them to its graphs (`kinds.ts`,
 * `pieces.ts`): the runner that reaches a model's graph by role, the slots a
 * kind declares, and small builders for the three types the graphs use.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { TensorType } from "./manifest";

/** A tensor going into or coming out of a graph. */
export interface Tensorish {
  type: TensorType;
  data: Float32Array | BigInt64Array | Uint8Array;
  dims: number[];
}

/** Runs the model's graph `role` on inputs given in the manifest's order; outputs in its order. */
export type GraphRunner = (role: string, inputs: Tensorish[]) => Promise<Tensorish[]>;

/** One input or output as a kind passes or reads it, by position. */
export interface Slot {
  role: string;
  type: TensorType;
}

export const slot = (role: string, type: TensorType): Slot => ({ role, type });

export const f32 = (data: Float32Array, dims: number[]): Tensorish => ({
  type: "float32",
  data,
  dims,
});

export const i64 = (v: ArrayLike<number>, dims: number[]): Tensorish => ({
  type: "int64",
  data: BigInt64Array.from(Array.from(v, (n) => BigInt(n))),
  dims,
});

export const bools = (v: ArrayLike<number>, dims: number[]): Tensorish => ({
  type: "bool",
  data: Uint8Array.from(v, (n) => (n ? 1 : 0)),
  dims,
});

export const ones = (n: number): Uint8Array => new Uint8Array(n).fill(1);

/** A section of a checked manifest a kind relies on; throws when it is missing. */
export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the model's manifest has no ${what}`);
  return value;
}
