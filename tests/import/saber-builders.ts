/**
 * Synthetic Saber notes for the tests: a tiny BSON writer and builders for
 * the shapes of map Saber's loader reads (format version 19).
 */

/** A value the writer knows how to encode. */
export type BsonIn =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | Int64
  | Int32
  | BsonIn[]
  | { [key: string]: BsonIn };

/** Forces a number to be written as int64 (as Dart does for ARGB colours). */
export class Int64 {
  constructor(readonly value: number) {}
}

/** Forces a whole number to be written as int32. */
export class Int32 {
  constructor(readonly value: number) {}
}

const enc = new TextEncoder();

function i32(n: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return [...b];
}

function element(key: string, v: BsonIn): number[] {
  const name = [...enc.encode(key), 0];
  if (v === null) return [0x0a, ...name];
  if (typeof v === "boolean") return [0x08, ...name, v ? 1 : 0];
  if (v instanceof Int32) return [0x10, ...name, ...i32(v.value)];
  if (v instanceof Int64) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(v.value), true);
    return [0x12, ...name, ...b];
  }
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= -(2 ** 31) && v < 2 ** 31) return [0x10, ...name, ...i32(v)];
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    return [0x01, ...name, ...b];
  }
  if (typeof v === "string") {
    const s = [...enc.encode(v), 0];
    return [0x02, ...name, ...i32(s.length), ...s];
  }
  if (v instanceof Uint8Array) return [0x05, ...name, ...i32(v.length), 0, ...v];
  if (Array.isArray(v)) {
    const doc: { [key: string]: BsonIn } = {};
    v.forEach((item, i) => (doc[String(i)] = item));
    return [0x04, ...name, ...bsonBytes(doc)];
  }
  return [0x03, ...name, ...bsonBytes(v)];
}

function bsonBytes(doc: { [key: string]: BsonIn }): number[] {
  const body = Object.entries(doc).flatMap(([k, v]) => element(k, v));
  return [...i32(body.length + 5), ...body, 0];
}

/** Encode a document as BSON. */
export function bson(doc: { [key: string]: BsonIn }): Uint8Array {
  return new Uint8Array(bsonBytes(doc));
}

/** A raw BSON element, for types the writer has no value for. */
export function rawDoc(elements: number[][]): Uint8Array {
  const body = elements.flat();
  return new Uint8Array([...i32(body.length + 5), ...body, 0]);
}

/** A Saber point: float32 x, y and an optional pressure, as a binary. */
export function point(x: number, y: number, pressure?: number): Uint8Array {
  const values = pressure === undefined ? [x, y] : [x, y, pressure];
  return new Uint8Array(new Float32Array(values).buffer);
}

/** A version 19 note with the given pages and settings. */
export function note(
  pages: Array<{ [key: string]: BsonIn }>,
  settings: { [key: string]: BsonIn } = {},
): Uint8Array {
  return bson({ v: 19, ni: 0, b: null, p: "", l: 40, lt: 3, z: pages, c: 0, ...settings });
}

export const ascii = (s: string): number[] => [...enc.encode(s)];
