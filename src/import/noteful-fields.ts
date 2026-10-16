/**
 * Noteful's tagged field layout, as found in real `.noteful` files (2026-10,
 * Noteful 1.5, package format 1.21). Pure.
 *
 * A message is a run of fields, big-endian: a 2-byte field number, a 2-byte
 * type, then the value. The type's low byte is the kind of value; its high
 * byte holds two flags. `0x04` makes the field an array (a 4-byte count,
 * then that many values), and `0x08` follows the value with an 8-byte
 * version stamp, which Noteful uses for syncing and which is skipped here.
 *
 * Kinds: 1 byte, 2 64-bit integer, 3 32-bit float, 4 double, 5 UTF-8 string,
 * 6 raw bytes, 7 nested message (5, 6 and 7 carry a 4-byte length first),
 * 0x11 16-bit integer, 0x12 and 0x14 32-bit integers, 0x13 64-bit integer,
 * 0x20 double, 0x21 a pair of doubles (a size or a point).
 */

export class NotefulError extends Error {}

/** A nested message, string or raw block: where its bytes are. */
export interface NotefulSpan {
  start: number;
  end: number;
}

export type NotefulValue = number | bigint | NotefulSpan | readonly [number, number];

export interface NotefulField {
  id: number;
  kind: number;
  array: boolean;
  /** One value, or every value of an array. */
  values: NotefulValue[];
}

const FIXED_SIZE: Readonly<Record<number, number>> = {
  0x01: 1,
  0x02: 8,
  0x03: 4,
  0x04: 8,
  0x11: 2,
  0x12: 4,
  0x13: 8,
  0x14: 4,
  0x20: 8,
  0x21: 16,
};

const ARRAY = 0x04;
const VERSIONED = 0x08;

/** Every field of the message in `bytes[start, end)`. Throws when the bytes do not fit. */
export function readFields(bytes: Uint8Array, start: number, end: number): NotefulField[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: NotefulField[] = [];
  let at = start;
  const need = (n: number): void => {
    if (at + n > end) throw new NotefulError("a field runs past its message");
  };
  const value = (kind: number): NotefulValue => {
    const size = FIXED_SIZE[kind];
    if (size !== undefined) {
      need(size);
      const v = fixedValue(view, kind, at);
      at += size;
      return v;
    }
    if (kind === 0x05 || kind === 0x06 || kind === 0x07) {
      need(4);
      const len = view.getUint32(at);
      at += 4;
      need(len);
      const span = { start: at, end: at + len };
      at += len;
      return span;
    }
    throw new NotefulError(`unknown field type ${kind}`);
  };
  while (at < end) {
    need(4);
    const id = view.getUint16(at);
    const type = view.getUint16(at + 2);
    at += 4;
    const flags = type >> 8;
    const kind = type & 0xff;
    if (flags & ~(ARRAY | VERSIONED)) throw new NotefulError(`unknown field flags ${flags}`);
    const values: NotefulValue[] = [];
    if (flags & ARRAY) {
      need(4);
      const count = view.getUint32(at);
      at += 4;
      if (count > end - at) throw new NotefulError("an array is longer than its message");
      for (let i = 0; i < count; i++) values.push(value(kind));
    } else values.push(value(kind));
    if (flags & VERSIONED) {
      need(8);
      at += 8;
    }
    out.push({ id, kind, array: (flags & ARRAY) !== 0, values });
  }
  return out;
}

function fixedValue(view: DataView, kind: number, at: number): NotefulValue {
  switch (kind) {
    case 0x01:
      return view.getUint8(at);
    case 0x02:
    case 0x13:
      return view.getBigInt64(at);
    case 0x03:
      return view.getFloat32(at);
    case 0x11:
      return view.getUint16(at);
    case 0x12:
    case 0x14:
      return view.getUint32(at);
    case 0x21:
      return [view.getFloat64(at), view.getFloat64(at + 8)] as const;
    default:
      return view.getFloat64(at);
  }
}

/** Typed access to one message's fields. */
export class NotefulMessage {
  constructor(
    readonly bytes: Uint8Array,
    readonly fields: readonly NotefulField[],
  ) {}

  static parse(bytes: Uint8Array, span: NotefulSpan): NotefulMessage {
    return new NotefulMessage(bytes, readFields(bytes, span.start, span.end));
  }

  private field(id: number): NotefulField | undefined {
    return this.fields.find((f) => f.id === id);
  }

  number(id: number): number | undefined {
    const v = this.field(id)?.values[0];
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return Number(v);
    return undefined;
  }

  numbers(id: number): number[] {
    return (this.field(id)?.values ?? []).flatMap((v) =>
      typeof v === "number" ? [v] : typeof v === "bigint" ? [Number(v)] : [],
    );
  }

  pair(id: number): readonly [number, number] | undefined {
    const v = this.field(id)?.values[0];
    return Array.isArray(v) ? (v as readonly [number, number]) : undefined;
  }

  span(id: number): NotefulSpan | undefined {
    const v = this.field(id)?.values[0];
    return isSpan(v) ? v : undefined;
  }

  spans(id: number): NotefulSpan[] {
    return (this.field(id)?.values ?? []).filter(isSpan);
  }

  string(id: number): string | undefined {
    const s = this.span(id);
    return s ? decodeUtf8(this.bytes.subarray(s.start, s.end)) : undefined;
  }

  strings(id: number): string[] {
    return this.spans(id).map((s) => decodeUtf8(this.bytes.subarray(s.start, s.end)));
  }

  message(id: number): NotefulMessage | undefined {
    const s = this.span(id);
    return s ? NotefulMessage.parse(this.bytes, s) : undefined;
  }

  messages(id: number): NotefulMessage[] {
    return this.spans(id).map((s) => NotefulMessage.parse(this.bytes, s));
  }
}

function isSpan(v: NotefulValue | undefined): v is NotefulSpan {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "start" in v;
}

const utf8 = new TextDecoder("utf-8");

function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}
