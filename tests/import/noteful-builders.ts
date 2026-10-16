/**
 * Writes Noteful notebooks for tests, in the layout `src/import/noteful.ts`
 * reads (taken from a real Noteful 1.5 backup). Synthetic: no real notes.
 */

const enc = new TextEncoder();

class Bytes {
  readonly parts: number[] = [];
  u8(v: number): this {
    this.parts.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v >> 8).u8(v);
  }
  u32(v: number): this {
    return this.u16(Math.floor(v / 0x10000)).u16(v & 0xffff);
  }
  u64(v: number): this {
    return this.u32(Math.floor(v / 2 ** 32)).u32(v >>> 0);
  }
  f32(v: number): this {
    const b = new DataView(new ArrayBuffer(4));
    b.setFloat32(0, v);
    return this.raw(new Uint8Array(b.buffer));
  }
  f64(v: number): this {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, v);
    return this.raw(new Uint8Array(b.buffer));
  }
  raw(bytes: Uint8Array | number[]): this {
    for (const b of bytes) this.parts.push(b);
    return this;
  }
  get length(): number {
    return this.parts.length;
  }
  done(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

/** One field value: what kind it is, and how to write it. */
export type Value =
  | { u8: number }
  | { i64: number }
  | { f32: number }
  | { f64: number }
  | { str: string }
  | { bytes: Uint8Array }
  | { msg: Field[] }
  | { u16: number }
  | { u32: number }
  | { d: number }
  | { pair: [number, number] };

export interface Field {
  id: number;
  /** One value, or an array of values of the same kind. */
  value: Value | Value[];
  versioned?: boolean;
}

const KIND: Record<string, number> = {
  u8: 1,
  i64: 2,
  f32: 3,
  f64: 4,
  str: 5,
  bytes: 6,
  msg: 7,
  u16: 0x11,
  u32: 0x12,
  d: 0x20,
  pair: 0x21,
};

function writeValue(out: Bytes, v: Value): void {
  if ("u8" in v) out.u8(v.u8);
  else if ("i64" in v) out.u64(v.i64);
  else if ("f32" in v) out.f32(v.f32);
  else if ("f64" in v) out.f64(v.f64);
  else if ("u16" in v) out.u16(v.u16);
  else if ("u32" in v) out.u32(v.u32);
  else if ("d" in v) out.f64(v.d);
  else if ("pair" in v) out.f64(v.pair[0]).f64(v.pair[1]);
  else {
    const body = "str" in v ? enc.encode(v.str) : "bytes" in v ? v.bytes : message(v.msg);
    out.u32(body.length).raw(body);
  }
}

/** Fields as a message. */
export function message(fields: Field[]): Uint8Array {
  const out = new Bytes();
  for (const f of fields) {
    const list = Array.isArray(f.value) ? f.value : [f.value];
    const kind = KIND[Object.keys(list[0] ?? { u8: 0 })[0]];
    const flags = (Array.isArray(f.value) ? 0x04 : 0) | (f.versioned ? 0x08 : 0);
    out.u16(f.id).u16((flags << 8) | kind);
    if (Array.isArray(f.value)) out.u32(f.value.length);
    for (const v of list) writeValue(out, v);
    if (f.versioned) out.u64(12345);
  }
  return out.done();
}

/** A collection: ids, times, alive flags and items. */
export function collection(
  items: Array<{ id: string; alive?: boolean; fields: Field[] }>,
): Field[] {
  return [
    { id: 1, value: items.map((i) => ({ str: i.id })) },
    { id: 2, value: items.map(() => ({ i64: 1 })) },
    { id: 3, value: items.map((i) => ({ u8: i.alive === false ? 0 : 1 })) },
    { id: 0, value: items.map((i) => ({ msg: i.fields })) },
  ];
}

/** An element of a stroke block. */
export type InkElement =
  | { color: [number, number, number]; highlighter?: boolean }
  | {
      points: Array<[number, number]>;
      width?: number;
      /** Flag 1: a third value a point, interleaved. */
      values?: boolean;
      /** Flag 2: per-segment arrays before the points. */
      segments?: number;
      /** Flag 16: 8 more header bytes. */
      wide?: boolean;
      /** Force the float layout (only for under 4 points in Noteful). */
      quantized?: boolean;
      flags?: number;
    }
  | { tag: number };

/** A packed stroke block. */
export function strokeBlock(elements: InkElement[]): Uint8Array {
  const out = new Bytes();
  for (const e of elements) {
    if ("tag" in e) {
      out.u16(e.tag).raw(new Array(60).fill(0));
      continue;
    }
    if ("color" in e) {
      out.u16(0xf102);
      for (const c of e.color) out.f64(c);
      out
        .f64(1)
        .u8(0)
        .u8(e.highlighter ? 1 : 0)
        .raw(new Array(8).fill(0));
      continue;
    }
    const n = e.points.length;
    const flags =
      e.flags ?? (e.values ? 1 : 0) | (e.segments !== undefined ? 2 : 0) | (e.wide ? 16 : 0);
    out.u16(0xf101).u64(7).u16(flags).u64(1).u64(2).u64(3).u32(0);
    if (flags & 16) out.u64(0);
    out.f64(e.width ?? 2).u64(n);
    if (flags & 2) {
      const m = e.segments ?? 0;
      out.u64(m);
      for (let i = 0; i < 2 * m; i++) out.f32(1);
    }
    const extra = (flags & 1) !== 0;
    if (n < 4 && !e.quantized) {
      for (const [x, y] of e.points) {
        out.f32(x).f32(y);
        if (extra) out.f32(0.5);
      }
    } else {
      const xs = e.points.map((p) => p[0]);
      const ys = e.points.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const w = Math.max(...xs) - x0 || 1;
      const h = Math.max(...ys) - y0 || 1;
      out.f32(x0).f32(w).f32(y0).f32(h);
      if (extra) out.f32(0).f32(1);
      for (const [x, y] of e.points) {
        out.u16(Math.round(((x - x0) / w) * 0xffff)).u16(Math.round(((y - y0) / h) * 0xffff));
        if (extra) out.u16(0x8000);
      }
    }
  }
  return out.done();
}

/** An ink record: the stroke block, and the page's other objects. */
export function inkRecord(
  block: Uint8Array,
  objects: Array<{ id: string; alive?: boolean; fields: Field[] }> = [],
): Uint8Array {
  return message([
    { id: 1, value: { i64: 281 } },
    { id: 2, value: { bytes: block } },
    { id: 3, value: [] as Value[] },
    { id: 4, value: [] as Value[] },
    { id: 5, value: { msg: collection(objects) } },
  ]);
}

/** An object's frame: centre, size, rotation. */
export function frame(cx: number, cy: number, w: number, h: number, rotation = 0): Field {
  return {
    id: 2,
    versioned: true,
    value: { msg: [{ id: 1, value: [cx, cy, w, h, rotation].map((d) => ({ d })) }] },
  };
}

const rgba = (c: number[]): Field => ({ id: 0, value: c.map((f32) => ({ f32 })) });

export function pictureObject(
  id: string,
  image: string,
  box: [number, number, number, number],
  rotation = 0,
) {
  return {
    id,
    fields: [
      { id: 1, value: { str: id } },
      frame(...box, rotation),
      {
        id: 6,
        value: {
          msg: [
            { id: 1, value: { i64: 1 } },
            { id: 10, value: { str: image } },
          ],
        },
      },
    ] as Field[],
  };
}

export function textObject(
  id: string,
  text: string,
  box: [number, number, number, number],
  size = 20,
) {
  return {
    id,
    fields: [
      { id: 1, value: { str: id } },
      frame(...box),
      {
        id: 6,
        value: {
          msg: [
            { id: 1, value: { i64: 2 } },
            {
              id: 4,
              value: {
                msg: [
                  { id: 2, value: [{ str: text }] },
                  { id: 7, value: [{ msg: [rgba([1, 0, 0, 1])] }] },
                  { id: 10, value: [{ d: size }] },
                ],
              },
            },
          ],
        },
      },
    ] as Field[],
  };
}

export function pathObject(
  id: string,
  box: [number, number, number, number],
  coords: number[],
  commands: number[],
  kind = 20,
) {
  return {
    id,
    fields: [
      { id: 1, value: { str: id } },
      frame(...box),
      {
        id: 6,
        value: {
          msg: [
            { id: 1, value: { i64: kind } },
            {
              id: 7,
              value: {
                msg: [
                  { id: 7, value: { msg: [rgba([0, 0, 1, 1])] } },
                  { id: 2, value: { d: 3 } },
                ],
              },
            },
            {
              id: 13,
              value: {
                msg: [
                  { id: 1, value: coords.map((d) => ({ d })) },
                  { id: 2, value: commands.map((u32) => ({ u32 })) },
                ],
              },
            },
          ],
        },
      },
    ] as Field[],
  };
}

export function shapeObject(id: string, kind: number) {
  return {
    id,
    fields: [
      { id: 1, value: { str: id } },
      frame(100, 100, 50, 50),
      { id: 6, value: { msg: [{ id: 1, value: { i64: kind } }] } },
    ] as Field[],
  };
}

export interface NotefulPage {
  id: string;
  key: string;
  alive?: boolean;
  /** "paper": Noteful's own paper PDF; "pdf": a page of an imported PDF. */
  paper?: { kind: "paper"; pdf: string } | { kind: "pdf"; pdf: string; page: number } | null;
  size?: [number, number];
  ink?: string;
}

/** A whole `.noteful` file. */
export function notefulFile(spec: {
  title?: string;
  pages: NotefulPage[];
  records?: Record<string, Uint8Array>;
}): Uint8Array {
  const pageItems = spec.pages.map((p) => {
    const template: Field[] = [];
    if (p.paper?.kind === "paper") {
      template.push({ id: 0, value: { u16: 2 } }, { id: 3, value: { str: p.paper.pdf } });
    } else if (p.paper?.kind === "pdf") {
      template.push(
        { id: 0, value: { u16: 1 } },
        { id: 4, value: { str: p.paper.pdf } },
        { id: 5, value: { i64: p.paper.page } },
      );
    }
    if (p.size) template.push({ id: 1, value: { pair: p.size } });
    const fields: Field[] = [
      { id: 1, value: { str: p.id } },
      { id: 2, value: { msg: p.ink ? [{ id: 0, value: { str: p.ink } }] : [] } },
      { id: 5, versioned: true, value: { str: p.key } },
    ];
    if (template.length > 0) fields.push({ id: 4, versioned: true, value: { msg: template } });
    return { id: p.id, alive: p.alive, fields };
  });
  const records: Record<string, Uint8Array> = {
    "n:NB": message([
      { id: 1, value: { str: "NB" } },
      ...(spec.title === undefined
        ? []
        : [{ id: 3, versioned: true, value: { str: spec.title } } as Field]),
    ]),
    "d:NB": message([
      { id: 1, value: { str: "NB" } },
      { id: 2, value: { msg: collection(pageItems) } },
    ]),
    ...spec.records,
  };
  const out = new Bytes().u32(0xaabbccde);
  const names: string[] = [];
  const offsets: number[] = [];
  const lengths: number[] = [];
  for (const [name, bytes] of Object.entries(records)) {
    names.push(name);
    offsets.push(out.length);
    lengths.push(bytes.length);
    out.raw(bytes);
  }
  const index = message([
    { id: 1, value: { f32: 1.21 } },
    { id: 10, value: names.map((str) => ({ str })) },
    { id: 11, value: offsets.map((i64) => ({ i64 })) },
    { id: 12, value: lengths.map((i64) => ({ i64 })) },
  ]);
  const at = out.length;
  out.raw(index);
  out.u32(0xaabbccde).u64(at).u32(index.length);
  return out.done();
}
