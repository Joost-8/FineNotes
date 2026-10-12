/**
 * Apple binary property lists (`bplist00`), and the NSKeyedArchiver graphs
 * stored in them, as Notability's `Session.plist` is. Pure.
 *
 * Format: a header, the objects, an offset table, and a 32-byte trailer that
 * says where the table is, how wide its entries and object references are,
 * and which object is the top. Each object starts with a marker byte whose
 * high nibble is its type and low nibble its size (15 = "a size follows").
 */

/** A reference to another object of an NSKeyedArchiver graph (`CF$UID`). */
export class PlistUid {
  constructor(readonly index: number) {}
}

export type PlistValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | Uint8Array
  | PlistUid
  | PlistValue[]
  | { [key: string]: PlistValue };

export class PlistError extends Error {}

/** Whether `bytes` start like a binary plist. */
export function isBinaryPlist(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 8) === "bplist00";
}

/** Decode a binary plist into plain values. Throws {@link PlistError} on a malformed file. */
export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  if (!isBinaryPlist(bytes) || bytes.length < 40) throw new PlistError("not a binary plist");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6];
  const refSize = bytes[trailer + 7];
  const count = readUint(view, trailer + 8, 8);
  const top = readUint(view, trailer + 16, 8);
  const tableAt = readUint(view, trailer + 24, 8);
  if (count <= 0 || top >= count || tableAt + count * offsetSize > trailer) {
    throw new PlistError("bad trailer");
  }
  const offsets: number[] = [];
  for (let i = 0; i < count; i++)
    offsets.push(readUint(view, tableAt + i * offsetSize, offsetSize));

  const cache = new Map<number, PlistValue>();
  const active = new Set<number>();
  const read = (index: number): PlistValue => {
    if (index < 0 || index >= count) throw new PlistError(`object ${index} out of range`);
    const done = cache.get(index);
    if (done !== undefined || cache.has(index)) return done ?? null;
    if (active.has(index)) throw new PlistError("cyclic plist");
    active.add(index);
    const value = readObject(offsets[index]);
    active.delete(index);
    cache.set(index, value);
    return value;
  };

  /** The size in a marker's low nibble, or the integer object that follows it. */
  const sizeAt = (at: number): [number, number] => {
    const low = bytes[at] & 0x0f;
    if (low !== 0x0f) return [low, at + 1];
    const marker = bytes[at + 1];
    if (marker >> 4 !== 0x1) throw new PlistError("bad size");
    const width = 1 << (marker & 0x0f);
    return [readUint(view, at + 2, width), at + 2 + width];
  };

  const refs = (at: number, n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(readUint(view, at + i * refSize, refSize));
    return out;
  };

  function readObject(at: number): PlistValue {
    if (at < 8 || at >= trailer) throw new PlistError("object offset out of range");
    const marker = bytes[at];
    const type = marker >> 4;
    const low = marker & 0x0f;
    switch (type) {
      case 0x0:
        if (low === 0x8) return false;
        if (low === 0x9) return true;
        return null;
      case 0x1: {
        const width = 1 << low;
        if (width === 8) {
          const big = view.getBigInt64(at + 1);
          const n = Number(big);
          return Number.isSafeInteger(n) ? n : big;
        }
        if (width === 16) return Number(view.getBigInt64(at + 9));
        return readUint(view, at + 1, width);
      }
      case 0x2:
        return low === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
      case 0x3:
        return new Date(Date.UTC(2001, 0, 1) + view.getFloat64(at + 1) * 1000);
      case 0x4: {
        const [n, start] = sizeAt(at);
        return bytes.slice(start, start + n);
      }
      case 0x5: {
        const [n, start] = sizeAt(at);
        return ascii(bytes, start, start + n);
      }
      case 0x6: {
        const [n, start] = sizeAt(at);
        let s = "";
        for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint16(start + i * 2));
        return s;
      }
      case 0x8:
        return new PlistUid(readUint(view, at + 1, low + 1));
      case 0xa:
      case 0xc: {
        const [n, start] = sizeAt(at);
        return refs(start, n).map(read);
      }
      case 0xd: {
        const [n, start] = sizeAt(at);
        const keys = refs(start, n);
        const values = refs(start + n * refSize, n);
        const dict: { [key: string]: PlistValue } = {};
        keys.forEach((k, i) => {
          dict[keyText(read(k))] = read(values[i]);
        });
        return dict;
      }
      default:
        throw new PlistError(`unknown marker 0x${marker.toString(16)}`);
    }
  }

  return read(top);
}

function readUint(view: DataView, at: number, width: number): number {
  if (at + width > view.byteLength) throw new PlistError("read past end");
  let n = 0;
  for (let i = 0; i < width; i++) n = n * 256 + view.getUint8(at + i);
  return n;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < Math.min(end, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * An NSKeyedArchiver graph with its references followed: archived objects
 * become plain objects (their class name under `$class`), NSArray/NSSet
 * become arrays, NSDictionary a plain object, NSString/NSData their value.
 * A reference back to an object being resolved stays a {@link PlistUid}.
 */
export function unarchive(root: PlistValue): PlistValue {
  if (!isDict(root) || !Array.isArray(root.$objects)) throw new PlistError("not a keyed archive");
  const objects = root.$objects;
  const top = root.$top;
  const done = new Map<number, PlistValue>();
  const active = new Set<number>();

  const resolve = (value: PlistValue): PlistValue => {
    if (value instanceof PlistUid) return follow(value.index);
    if (Array.isArray(value)) return value.map(resolve);
    return value;
  };

  const follow = (index: number): PlistValue => {
    if (done.has(index)) return done.get(index) ?? null;
    if (active.has(index)) return new PlistUid(index);
    const raw = objects[index];
    if (raw === "$null") return null;
    if (!isDict(raw)) return raw ?? null;
    active.add(index);
    const cls = raw.$class instanceof PlistUid ? objects[raw.$class.index] : null;
    const className = isDict(cls) && Array.isArray(cls.$classes) ? keyText(cls.$classes[0]) : "";
    let out: PlistValue;
    if (Array.isArray(raw["NS.objects"]) && Array.isArray(raw["NS.keys"])) {
      const dict: { [key: string]: PlistValue } = {};
      const keys = raw["NS.keys"];
      raw["NS.objects"].forEach((v, i) => {
        dict[keyText(resolve(keys[i]))] = resolve(v);
      });
      out = dict;
    } else if (Array.isArray(raw["NS.objects"])) {
      out = raw["NS.objects"].map(resolve);
    } else if ("NS.key.0" in raw || (/Dictionary$/.test(className) && !("NS.keys" in raw))) {
      // An older dictionary encoding: NS.key.<i> / NS.object.<i> pairs.
      const dict: { [key: string]: PlistValue } = {};
      for (let i = 0; `NS.key.${i}` in raw; i++) {
        dict[keyText(resolve(raw[`NS.key.${i}`]))] = resolve(raw[`NS.object.${i}`] ?? null);
      }
      out = dict;
    } else if (/(Array|Set)$/.test(className)) {
      out = [];
    } else if (className === "NSDate" && typeof raw["NS.time"] === "number") {
      out = new Date(Date.UTC(2001, 0, 1) + raw["NS.time"] * 1000);
    } else if (typeof raw["NS.string"] === "string") {
      out = raw["NS.string"];
    } else if (raw["NS.bytes"] instanceof Uint8Array) {
      out = raw["NS.bytes"];
    } else if (raw["NS.data"] instanceof Uint8Array) {
      out = raw["NS.data"];
    } else {
      const obj: { [key: string]: PlistValue } = { $class: className };
      for (const [k, v] of Object.entries(raw)) if (k !== "$class") obj[k] = resolve(v);
      out = obj;
    }
    active.delete(index);
    done.set(index, out);
    return out;
  };

  if (isDict(top)) {
    const out: { [key: string]: PlistValue } = {};
    for (const [k, v] of Object.entries(top)) out[k] = resolve(v);
    return out;
  }
  return resolve(top ?? null);
}

/** A dictionary key or class name as text; anything else as an empty string. */
function keyText(v: PlistValue | undefined): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  return "";
}

export function isDict(v: PlistValue | undefined): v is { [key: string]: PlistValue } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Uint8Array) &&
    !(v instanceof Date) &&
    !(v instanceof PlistUid)
  );
}
