/**
 * A minimal BSON reader, enough for the documents notes apps write. Pure.
 *
 * BSON (bsonspec.org) is a little-endian document: an int32 total length,
 * elements, and a closing 0. Each element is a type byte, a NUL-terminated
 * key and a value. Arrays are documents keyed "0", "1", …. Doubles, int32
 * and int64 become numbers (an int64 past 2^53 loses precision), binary
 * becomes a `Uint8Array` view of the input, and the types notes never use
 * (ObjectId, timestamps, decimal128, min/max key) are read past as `null`.
 */

export type BsonValue = null | boolean | number | string | Uint8Array | BsonDocument | BsonValue[];

/** A document's fields. Built without a prototype, so any key is safe to look up. */
export type BsonDocument = { [key: string]: BsonValue };

export class BsonError extends Error {}

/** Parse a whole BSON document. Throws a {@link BsonError} on anything malformed. */
export function readBson(bytes: Uint8Array): BsonDocument {
  if (bytes.length < 5) throw new BsonError("too short");
  const reader = new Reader(bytes);
  const doc = reader.document(0, 0);
  if (reader.end !== bytes.length) throw new BsonError("trailing bytes");
  return doc;
}

/**
 * Whether the bytes start like a BSON document: the length field matches
 * the file and it ends in a 0. Cheap; does not parse.
 */
export function looksLikeBson(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(0, true) === bytes.length && bytes[bytes.length - 1] === 0;
}

/** How deep documents may nest before the input is taken for hostile. */
const MAX_DEPTH = 64;

class Reader {
  private readonly view: DataView;
  /** Where the last document read ended. */
  end = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(at: number, n: number): void {
    if (at < 0 || at + n > this.bytes.length) throw new BsonError("value past end");
  }

  private int32(at: number): number {
    this.need(at, 4);
    return this.view.getInt32(at, true);
  }

  private cstring(at: number): [string, number] {
    const stop = this.bytes.indexOf(0, at);
    if (stop < 0) throw new BsonError("unterminated key");
    return [new TextDecoder().decode(this.bytes.subarray(at, stop)), stop + 1];
  }

  document(at: number, depth: number): BsonDocument {
    if (depth > MAX_DEPTH) throw new BsonError("nested too deep");
    const length = this.int32(at);
    if (length < 5) throw new BsonError("bad document length");
    this.need(at, length);
    const stop = at + length - 1;
    if (this.bytes[stop] !== 0) throw new BsonError("document not terminated");
    const out = Object.create(null) as BsonDocument;
    let p = at + 4;
    while (p < stop) {
      const type = this.bytes[p];
      const [key, next] = this.cstring(p + 1);
      if (next > stop) throw new BsonError("key past end");
      const [value, after] = this.value(type, next, depth);
      if (after > stop) throw new BsonError("value past end");
      out[key] = value;
      p = after;
    }
    this.end = at + length;
    return out;
  }

  private value(type: number, at: number, depth: number): [BsonValue, number] {
    switch (type) {
      case 0x01:
        this.need(at, 8);
        return [this.view.getFloat64(at, true), at + 8];
      case 0x02: {
        const n = this.int32(at);
        if (n < 1) throw new BsonError("bad string length");
        this.need(at + 4, n);
        const text = new TextDecoder().decode(this.bytes.subarray(at + 4, at + 4 + n - 1));
        return [text, at + 4 + n];
      }
      case 0x03:
        return [this.document(at, depth + 1), at + this.int32(at)];
      case 0x04: {
        const doc = this.document(at, depth + 1);
        return [Object.keys(doc).map((k) => doc[k]), at + this.int32(at)];
      }
      case 0x05: {
        const n = this.int32(at);
        if (n < 0) throw new BsonError("bad binary length");
        this.need(at + 5, n);
        let data = this.bytes.subarray(at + 5, at + 5 + n);
        // The old binary subtype 2 repeats the length inside the data.
        if (this.bytes[at + 4] === 0x02 && n >= 4) data = data.subarray(4);
        return [data, at + 5 + n];
      }
      case 0x06:
      case 0x0a:
      case 0x7f:
      case 0xff:
        return [null, at];
      case 0x07:
        this.need(at, 12);
        return [null, at + 12];
      case 0x08:
        this.need(at, 1);
        return [this.bytes[at] !== 0, at + 1];
      case 0x09:
      case 0x12: {
        this.need(at, 8);
        const lo = this.view.getUint32(at, true);
        const hi = this.view.getInt32(at + 4, true);
        return [hi * 2 ** 32 + lo, at + 8];
      }
      case 0x10:
        return [this.int32(at), at + 4];
      case 0x11:
        this.need(at, 8);
        return [null, at + 8];
      case 0x13:
        this.need(at, 16);
        return [null, at + 16];
      default:
        throw new BsonError(`unknown type 0x${type.toString(16)}`);
    }
  }
}
