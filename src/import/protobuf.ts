/**
 * A schema-less protocol-buffer reader: enough to walk Goodnotes' records by
 * field number. Pure.
 */

export class ProtobufError extends Error {}

export interface ProtoField {
  field: number;
  /** 0 varint, 1 fixed 64-bit, 2 length-delimited, 5 fixed 32-bit. */
  wire: number;
  /** The value of a varint field. */
  int?: bigint;
  /** The bytes of every other field. */
  bytes?: Uint8Array;
}

/** A varint at `at`: its value and the offset after it. */
export function readVarint(bytes: Uint8Array, at: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  for (;;) {
    if (at >= bytes.length) throw new ProtobufError("varint past end");
    const b = bytes[at++];
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [value, at];
    shift += 7n;
    if (shift > 63n) throw new ProtobufError("varint too long");
  }
}

/** The fields of one message. Throws {@link ProtobufError} unless the bytes are exactly a message. */
export function parseMessage(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let at = 0;
  while (at < bytes.length) {
    let key: bigint;
    [key, at] = readVarint(bytes, at);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) throw new ProtobufError("field 0");
    if (wire === 0) {
      let int: bigint;
      [int, at] = readVarint(bytes, at);
      fields.push({ field, wire, int });
      continue;
    }
    let length: number;
    if (wire === 1) length = 8;
    else if (wire === 5) length = 4;
    else if (wire === 2) {
      let n: bigint;
      [n, at] = readVarint(bytes, at);
      length = Number(n);
    } else throw new ProtobufError(`wire type ${wire}`);
    if (at + length > bytes.length) throw new ProtobufError("field past end");
    fields.push({ field, wire, bytes: bytes.subarray(at, at + length) });
    at += length;
  }
  return fields;
}

/** A stream of messages, each preceded by its length as a varint. */
export function splitDelimited(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < bytes.length) {
    let n: bigint;
    [n, at] = readVarint(bytes, at);
    const end = at + Number(n);
    if (end > bytes.length) throw new ProtobufError("record past end");
    out.push(bytes.subarray(at, end));
    at = end;
  }
  return out;
}

const utf8 = new TextDecoder();

/** Accessors over one message's fields. */
export class Message {
  constructor(readonly fields: ProtoField[]) {}

  static parse(bytes: Uint8Array): Message {
    return new Message(parseMessage(bytes));
  }

  has(field: number): boolean {
    return this.fields.some((f) => f.field === field);
  }

  bytes(field: number): Uint8Array | undefined {
    return this.fields.find((f) => f.field === field && f.wire === 2)?.bytes;
  }

  string(field: number): string | undefined {
    const b = this.bytes(field);
    return b ? utf8.decode(b) : undefined;
  }

  int(field: number): number | undefined {
    const f = this.fields.find((x) => x.field === field && x.wire === 0);
    return f?.int === undefined ? undefined : Number(f.int);
  }

  float(field: number): number | undefined {
    const b = this.fields.find((x) => x.field === field && x.wire === 5)?.bytes;
    return b ? new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true) : undefined;
  }

  double(field: number): number | undefined {
    const b = this.fields.find((x) => x.field === field && x.wire === 1)?.bytes;
    return b ? new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true) : undefined;
  }

  message(field: number): Message | undefined {
    const b = this.bytes(field);
    if (!b) return undefined;
    try {
      return Message.parse(b);
    } catch {
      return undefined;
    }
  }
}
