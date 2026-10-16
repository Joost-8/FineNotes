/**
 * Writers for reMarkable `.rm` pages (versions 3, 5 and 6), so tests can
 * build pages from scratch. The v6 writer emits only the blocks the reader
 * needs, in the layout rmscene reads.
 */

export type Point = [x: number, y: number, width: number, pressure?: number];

const le32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const le16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function f32(v: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [...b];
}

function f64(v: number): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...b];
}

export function header(version: number): number[] {
  return ascii(`reMarkable .lines file, version=${version}`.padEnd(43, " "));
}

// --- versions 3 and 5 -------------------------------------------------------------

export interface OldStroke {
  pen: number;
  color: number;
  points: Point[];
}

/** A version 3 or 5 page: a list of layers, each a list of strokes. */
export function rmOld(version: 3 | 5, layers: OldStroke[][]): Uint8Array {
  const out = [...header(version), ...le32(layers.length)];
  for (const layer of layers) {
    out.push(...le32(layer.length));
    for (const s of layer) {
      out.push(...le32(s.pen), ...le32(s.color), ...le32(0), ...f32(2));
      if (version === 5) out.push(...le32(0));
      out.push(...le32(s.points.length));
      for (const [x, y, w, p = 0.5] of s.points) {
        out.push(...f32(x), ...f32(y), ...f32(1), ...f32(0), ...f32(w), ...f32(p));
      }
    }
  }
  return new Uint8Array(out);
}

// --- version 6 ----------------------------------------------------------------------

export function varuint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  do {
    let b = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
}

export type Id = [number, number];
const tag = (index: number, type: number): number[] => varuint(index * 16 + type);
export const fId = (index: number, [a, b]: Id): number[] => [...tag(index, 0xf), a, ...varuint(b)];
export const fInt = (index: number, n: number): number[] => [...tag(index, 4), ...le32(n)];
export const fFloat = (index: number, v: number): number[] => [...tag(index, 4), ...f32(v)];
export const fDouble = (index: number, v: number): number[] => [...tag(index, 8), ...f64(v)];
export const fByte = (index: number, v: number): number[] => [...tag(index, 1), v];
export const fSub = (index: number, body: number[]): number[] => [
  ...tag(index, 0xc),
  ...le32(body.length),
  ...body,
];
/** A last-writer-wins value: a timestamp id at 1, the value at 2. */
export const fLww = (index: number, value: number[]): number[] =>
  fSub(index, [...fId(1, [1, 1]), ...value]);

export function block(type: number, body: number[], version = 2): number[] {
  return [...le32(body.length), 0, version, version, type, ...body];
}

export interface V6Line {
  item: number;
  pen: number;
  color: number;
  points: Point[];
  parent?: Id;
  argb?: number;
  deleted?: boolean;
  /** Point layout: 1 is six float32s, 2 the compact one. */
  version?: 1 | 2;
}

export interface V6Layer {
  node: Id;
  parent?: Id;
  visible?: boolean;
  originX?: number;
  anchor?: Id;
}

export const ROOT: Id = [0, 1];
export const LAYER: Id = [0, 11];

/** A scene-tree block, a tree-node block and a group item for one node. */
export function v6Node(layer: V6Layer, groupItem: number): number[] {
  const parent = layer.parent ?? ROOT;
  const node = [
    ...fId(1, layer.node),
    ...fLww(2, fSub(2, [...varuint(5), 1, ...ascii("Layer")])),
    ...fLww(3, fByte(2, layer.visible === false ? 0 : 1)),
  ];
  if (layer.anchor) node.push(...fLww(7, fId(2, layer.anchor)));
  if (layer.originX !== undefined) node.push(...fLww(10, fFloat(2, layer.originX)));
  return [
    ...block(
      1,
      [...fId(1, layer.node), ...fId(2, [0, 0]), ...fByte(3, 1), ...fSub(4, fId(1, parent))],
      1,
    ),
    ...block(2, node, 1),
    ...block(
      4,
      [
        ...fId(1, parent),
        ...fId(2, [0, groupItem]),
        ...fId(3, [0, 0]),
        ...fId(4, [0, 0]),
        ...fInt(5, 0),
        ...fSub(6, [2, ...fId(2, layer.node)]),
      ],
      1,
    ),
  ];
}

export function v6LineBlock(line: V6Line): number[] {
  const version = line.version ?? 2;
  const pts: number[] = [];
  for (const [x, y, w, p = 0.5] of line.points) {
    if (version === 1) pts.push(...f32(x), ...f32(y), ...f32(1), ...f32(0), ...f32(w), ...f32(p));
    else
      pts.push(
        ...f32(x),
        ...f32(y),
        ...le16(4),
        ...le16(Math.round(w * 4)),
        0,
        Math.round(p * 255),
      );
  }
  const head = [
    ...fId(1, line.parent ?? LAYER),
    ...fId(2, [1, line.item]),
    ...fId(3, [0, 0]),
    ...fId(4, [0, 0]),
    ...fInt(5, line.deleted ? 1 : 0),
  ];
  if (line.deleted) return block(5, head, version);
  const value = [
    3,
    ...fInt(1, line.pen),
    ...fInt(2, line.color),
    ...fDouble(3, 1),
    ...fFloat(4, 0),
    ...fSub(5, pts),
    ...fId(6, [0, 1]),
  ];
  if (line.argb !== undefined) value.push(...fInt(8, line.argb));
  return block(5, [...head, ...fSub(6, value)], version);
}

/** An item block of another kind (3 glyph, 6 text) with a trivial value. */
export function v6Item(type: 3 | 6, item: number, value = true): number[] {
  const head = [
    ...fId(1, LAYER),
    ...fId(2, [1, item]),
    ...fId(3, [0, 0]),
    ...fId(4, [0, 0]),
    ...fInt(5, 0),
  ];
  return block(type, value ? [...head, ...fSub(6, [type === 3 ? 1 : 5])] : head);
}

export function v6Tombstone(item: number): number[] {
  return block(8, [
    ...fId(1, LAYER),
    ...fId(2, [1, item]),
    ...fId(3, [0, 0]),
    ...fId(4, [0, 0]),
    ...fInt(5, 1),
  ]);
}

export interface V6Page {
  lines: V6Line[];
  layers?: V6Layer[];
  /** Raw blocks appended after the lines. */
  extra?: number[][];
}

/** A version 6 page: one layer under the root unless `layers` says otherwise. */
export function rmV6(page: V6Page): Uint8Array {
  const out = [...header(6)];
  (page.layers ?? [{ node: LAYER }]).forEach((layer, i) => out.push(...v6Node(layer, 100 + i)));
  for (const line of page.lines) out.push(...v6LineBlock(line));
  for (const extra of page.extra ?? []) out.push(...extra);
  return new Uint8Array(out);
}

export const encodeJson = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));
