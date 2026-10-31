/**
 * Writers for the formats the importers read, so tests can build Goodnotes
 * and Notability files from scratch instead of shipping someone's notebook.
 */

import { zipSync } from "fflate";

// --- protobuf ---------------------------------------------------------------

export function varint(n: number | bigint): number[] {
  let v = BigInt(n);
  const out: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return out;
}

export type PbValue =
  | { int: number | bigint }
  | { f32: number }
  | { f64: number }
  | { str: string }
  | { bytes: Uint8Array }
  | { msg: PbField[] };
export type PbField = [number, PbValue];

export function pb(fields: PbField[]): Uint8Array {
  const out: number[] = [];
  for (const [field, value] of fields) {
    if ("int" in value) {
      out.push(...varint((field << 3) | 0), ...varint(value.int));
    } else if ("f32" in value) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, value.f32, true);
      out.push(...varint((field << 3) | 5), ...b);
    } else if ("f64" in value) {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, value.f64, true);
      out.push(...varint((field << 3) | 1), ...b);
    } else {
      const bytes =
        "str" in value
          ? new TextEncoder().encode(value.str)
          : "bytes" in value
            ? value.bytes
            : pb(value.msg);
      out.push(...varint((field << 3) | 2), ...varint(bytes.length), ...bytes);
    }
  }
  return new Uint8Array(out);
}

/** Messages each preceded by their length. */
export function delimited(messages: Uint8Array[]): Uint8Array {
  const out: number[] = [];
  for (const m of messages) out.push(...varint(m.length), ...m);
  return new Uint8Array(out);
}

// --- Apple LZ4 frames -------------------------------------------------------

const le32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Stored (`bv4-`) blocks: valid frames without writing a compressor. */
export function bv4Raw(data: Uint8Array): Uint8Array {
  return new Uint8Array([...ascii("bv4-"), ...le32(data.length), ...data, ...ascii("bv4$")]);
}

/** One `bv41` block from a hand-made LZ4 block. */
export function bv4Block(block: number[], rawSize: number): Uint8Array {
  return new Uint8Array([
    ...ascii("bv41"),
    ...le32(rawSize),
    ...le32(block.length),
    ...block,
    ...ascii("bv4$"),
  ]);
}

// --- Goodnotes stroke layout ------------------------------------------------

/**
 * A `tpl` block as Goodnotes writes a schema-24 stroke: ten arrays, the
 * second-last the pen samples, the last one u16 per sample. A pen sample is
 * five floats (x, y, half-width, two unused); the marker's is seven (x, y,
 * one unused, half-width, three unused).
 */
export function tplStroke(samples: Array<[number, number, number]>, stride: 5 | 7 = 5): Uint8Array {
  const sig = "vA(v)A(u)A(u)A(v)A(v)A(u)A(u)A(u)A(u)A(v)";
  const out: number[] = [...ascii("tpl\0"), 0, 0, 0, 0, ...ascii(sig), 0];
  const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
  const f32 = (v: number): number[] => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    return [...b];
  };
  out.push(...u16(2));
  const arrayU = (vals: number[]): void => {
    out.push(...le32(vals.length));
    for (const v of vals) out.push(...f32(v));
  };
  const arrayV = (vals: number[]): void => {
    out.push(...le32(vals.length));
    for (const v of vals) out.push(...u16(v));
  };
  // The centreline through the samples: a move to the first, then straight
  // curves (the control point halfway) to each next one; x, y, half-width.
  const [first, ...rest] = samples;
  arrayV(first ? [0, ...rest.map(() => 1)] : []);
  arrayU(first ? [...first] : []);
  arrayU(
    rest.flatMap(([x, y, h], i) => {
      const [px, py, ph] = samples[i];
      return [(px + x) / 2, (py + y) / 2, (ph + h) / 2, x, y, h];
    }),
  );
  arrayV([]);
  arrayV([]);
  arrayU([]);
  arrayU([]);
  arrayU([]);
  arrayU(
    samples.flatMap(([x, y, h]) =>
      stride === 7 ? [x, y, 1.8, h, 1.57, -1.57, 0] : [x, y, h, 0.5, -0.5],
    ),
  );
  arrayV(samples.map(() => 1));
  const bytes = new Uint8Array(out);
  new DataView(bytes.buffer).setUint32(4, bytes.length, true);
  return bytes;
}

/**
 * A stroke that is only its centreline, as most real strokes are: verbs (`0`
 * move, `1` curve; `2` and `3` the same with widths), the floats of their
 * moves and of their curves. As structs (`vuA(v)A(S(uu))A(S(uuuu))`, verbs 0
 * and 1 only) or as the flat ten arrays behind a width, the samples empty.
 * `tail` adds the newer `vA(f)` ending, empty.
 */
export function tplCentreline(spec: {
  width: number;
  structs: boolean;
  verbs: number[];
  moves: number[];
  curves: number[];
  tail?: boolean;
}): Uint8Array {
  const sig =
    (spec.structs ? "vuA(v)A(S(uu))A(S(uuuu))" : "vuA(v)A(u)A(u)A(v)A(v)A(u)A(u)A(u)A(u)A(v)") +
    (spec.tail ? "vA(f)" : "");
  const out: number[] = [...ascii("tpl\0"), 0, 0, 0, 0, ...ascii(sig), 0];
  const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
  const f32 = (v: number): number[] => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    return [...b];
  };
  out.push(...u16(1), ...f32(spec.width));
  out.push(...le32(spec.verbs.length), ...spec.verbs.flatMap(u16));
  const items = (floats: number[], per: number): number =>
    spec.structs ? floats.length / per : floats.length;
  out.push(...le32(items(spec.moves, 2)), ...spec.moves.flatMap(f32));
  out.push(...le32(items(spec.curves, 4)), ...spec.curves.flatMap(f32));
  if (!spec.structs) for (let i = 0; i < 7; i++) out.push(...le32(0));
  if (spec.tail) out.push(...u16(1), ...le32(0));
  const bytes = new Uint8Array(out);
  new DataView(bytes.buffer).setUint32(4, bytes.length, true);
  return bytes;
}

/**
 * A schema-25 stroke: a width, a start point and segments of two points
 * (each x, y, azimuth, altitude, force), behind one unused float.
 */
export function tplStroke25(points: Array<[number, number]>, width: number): Uint8Array {
  const sig = "vuA(v)A(S(uuuuu))A(S(uuuuuuuuuuu))A(S(uu))A(v)A(S(uu))A(S(uuuu))A(u)";
  const out: number[] = [...ascii("tpl"), 0, 0, 0, 0, 0, ...ascii(sig), 0];
  const f32 = (v: number): number[] => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    return [...b];
  };
  const point = ([x, y]: [number, number]): number[] => [x, y, -0.524, 1.047, 1].flatMap(f32);
  out.push(1, 0, ...f32(width));
  const [start, ...rest] = points;
  const segments: number[][] = [];
  for (let i = 0; i + 1 < rest.length; i += 2) {
    segments.push([...f32(0), ...point(rest[i]), ...point(rest[i + 1])]);
  }
  out.push(...le32(segments.length + 1), 0, 0, ...segments.flatMap(() => [1, 0]));
  out.push(...le32(start ? 1 : 0), ...(start ? point(start) : []));
  out.push(...le32(segments.length), ...segments.flat());
  for (let i = 0; i < 5; i++) out.push(...le32(0));
  const bytes = new Uint8Array(out);
  new DataView(bytes.buffer).setUint32(4, bytes.length, true);
  return bytes;
}

// --- Goodnotes package ------------------------------------------------------

export interface GnStroke {
  id: string;
  samples: Array<[number, number, number]>;
  rgba?: [number, number, number, number];
  /** Floats per sample in a schema-24 stroke: 5 for a pen, 7 for the marker. */
  stride?: 5 | 7;
  /** Write it in schema 25, at this width (the samples' half-widths are ignored). */
  schema25?: number;
  /** A lasso move: field 6. */
  offset?: [number, number];
  /** The stroke's data as it is, in place of a layout made from `samples`. */
  tpl?: Uint8Array;
}

/** A Goodnotes text box (kind 21) or comment (kind 20). */
export interface GnText {
  id: string;
  /** Runs of text; empty for a shape. */
  runs: Array<{
    text: string;
    rgba?: [number, number, number, number];
    size?: number;
    font?: string;
  }>;
  origin: [number, number];
  /** A fixed width (`21.2.1`); absent, the box grows with its text (`32.2.1` wide). */
  width?: number;
  /** The frame's height (`21.2.2`), beside a fixed width. */
  height?: number;
  textWidth?: number;
  fill?: [number, number, number, number];
  /** A border (`31`): its width (`31.1`) and colour (`31.3.1`). Text boxes only. */
  border?: { width: number; rgba: [number, number, number, number] };
  /** A rounded rectangle's corner radius (`22.1.1`). */
  radius?: number;
  comment?: boolean;
}

export interface GnImage {
  id: string;
  attachment: string;
  frame: [number, number, number, number];
  /** Deleted in Goodnotes: still in the file, its header marked `{3: 1}`. */
  removed?: boolean;
  /** Turned: field 3, its centre, its own size and the turn in radians (`frame` its bounds). */
  turned?: { centre: [number, number]; size: [number, number]; rotation: number };
}

/** An older text box (kind 8): its frame and its RTF. */
export interface GnRtfText {
  id: string;
  frame: [number, number, number, number];
  rtf: string;
  /** Field 7, the background. */
  fill?: [number, number, number, number];
}

export interface GnPage {
  id: string;
  template: string;
  order: string;
  /** Removed from the notebook (a 56 with the flag on). */
  deleted?: boolean;
  /** Bookmarked (a 57 with the flag on). */
  bookmarked?: boolean;
  /** Bookmarked once and the bookmark taken off again (a 57 with the flag off). */
  unbookmarked?: boolean;
  /** Removed and put back again (a 56 with the flag off). */
  restored?: boolean;
  /** Given another paper (a 3 each), at these clocks (the page itself is at 1). */
  paperChanges?: Array<{ template: string; clock: number }>;
  /** Moved: a 55 with a new order key. */
  moved?: { order: string; clock: number };
  strokes?: GnStroke[];
  images?: GnImage[];
  texts?: GnText[];
  rtfTexts?: GnRtfText[];
  /** Bodies of element kinds the importer does not know. */
  unknown?: number;
}

export interface GnTemplate {
  id: string;
  size: [number, number];
  attachment?: string;
  /** The PDF page, 1-based (field 5). */
  pdfPage?: number;
}

/** An outline entry (kind 62): `y` up from the bottom of the page. */
export interface GnOutline {
  id: string;
  page: string;
  title: string;
  order: string;
  x?: number;
  y?: number;
}

const clock = (n: number): PbValue => ({
  msg: [
    [1, { int: n }],
    [2, { int: 12345 }],
  ],
});

export function goodnotesFiles(spec: {
  title?: string;
  templates: GnTemplate[];
  pages: GnPage[];
  attachments?: Record<string, Uint8Array>;
  /** Attachment records (kind 6): record id → file id in `attachments/`. */
  records?: Record<string, string>;
  outline?: GnOutline[];
  /** Put every entry under this folder, as some zips do. */
  prefix?: string;
}): Record<string, Uint8Array> {
  const events: Uint8Array[] = [];
  const doc = "DOC";
  if (spec.title !== undefined) {
    events.push(
      pb([
        [1, { str: doc }],
        [
          30,
          {
            msg: [
              [1, { str: doc }],
              [
                2,
                {
                  msg: [
                    [1, { str: spec.title }],
                    [2, clock(1)],
                  ],
                },
              ],
            ],
          },
        ],
      ]),
    );
  }
  for (const [record, fileId] of Object.entries(spec.records ?? {})) {
    events.push(
      pb([
        [1, { str: record }],
        [
          6,
          {
            msg: [
              [1, { str: record }],
              [2, { str: fileId }],
              [6, { str: doc }],
            ],
          },
        ],
      ]),
    );
  }
  for (const t of spec.templates) {
    const body: PbField[] = [
      [1, { str: doc }],
      [2, { str: t.id }],
      [
        8,
        {
          msg: [
            [1, { f32: t.size[0] }],
            [2, { f32: t.size[1] }],
          ],
        },
      ],
    ];
    if (t.attachment) body.push([4, { str: t.attachment }]);
    if (t.pdfPage !== undefined) body.push([5, { int: t.pdfPage }]);
    events.push(
      pb([
        [1, { str: t.id }],
        [2, { msg: body }],
      ]),
    );
  }
  for (const p of spec.pages) {
    events.push(
      pb([
        [1, { str: p.id }],
        [
          54,
          {
            msg: [
              [1, { str: doc }],
              [2, { str: p.id }],
              [
                3,
                {
                  msg: [
                    [1, { str: p.template }],
                    [2, clock(1)],
                  ],
                },
              ],
              [
                4,
                {
                  msg: [
                    [1, { str: p.order }],
                    [2, clock(1)],
                  ],
                },
              ],
            ],
          },
        ],
      ]),
    );
  }
  // A page flag: `{3: {1: 1, 2: clock}}` sets it, `{3: {2: clock}}` clears it.
  const flag = (id: string, kind: number, on: boolean): Uint8Array =>
    pb([
      [1, { str: id }],
      [
        kind,
        {
          msg: [
            [1, { str: doc }],
            [2, { str: id }],
            [
              3,
              {
                msg: on
                  ? [
                      [1, { int: 1 }],
                      [2, clock(1)],
                    ]
                  : [[2, clock(4)]],
              },
            ],
            [4, { str: "030EAEC6-3B22-43F6-AEFE-3FCAAA554BAC" }],
          ],
        },
      ],
    ]);
  // A page's paper changed (3) or the page moved (55): `{3: {1: value, 2: clock}}`.
  const change = (id: string, kind: number, value: string, at: number): Uint8Array =>
    pb([
      [1, { str: id }],
      [
        kind,
        {
          msg: [
            [1, { str: doc }],
            [2, { str: id }],
            [
              3,
              {
                msg: [
                  [1, { str: value }],
                  [2, clock(at)],
                ],
              },
            ],
          ],
        },
      ],
    ]);
  for (const p of spec.pages) {
    for (const c of p.paperChanges ?? []) events.push(change(p.id, 3, c.template, c.clock));
    if (p.moved) events.push(change(p.id, 55, p.moved.order, p.moved.clock));
    if (p.deleted || p.restored) events.push(flag(p.id, 56, true));
    if (p.restored) events.push(flag(p.id, 56, false));
    if (p.bookmarked || p.unbookmarked) events.push(flag(p.id, 57, true));
    if (p.unbookmarked) events.push(flag(p.id, 57, false));
  }
  for (const o of spec.outline ?? []) {
    const point: PbField[] = [];
    if (o.x !== undefined) point.push([1, { f32: o.x }]);
    if (o.y !== undefined) point.push([2, { f32: o.y }]);
    events.push(
      pb([
        [1, { str: o.page }],
        [
          62,
          {
            msg: [
              [1, { str: o.page }],
              [2, { str: o.id }],
              [3, { msg: [[1, { msg: point }]] }],
              [5, { str: o.title }],
              [6, { str: o.order }],
            ],
          },
        ],
      ]),
    );
  }
  // An event of a kind the importer ignores, and a record that is not a message.
  events.push(
    pb([
      [1, { str: "X" }],
      [104, { msg: [[1, { str: doc }]] }],
    ]),
  );
  events.push(new Uint8Array([0xff]));

  const files: Record<string, Uint8Array> = {
    "index.events.pb": delimited(events),
    "schema.pb": pb([[1, { int: 24 }]]),
  };
  for (const p of spec.pages) {
    const records: Uint8Array[] = [];
    for (const s of p.strokes ?? []) {
      const rgba = s.rgba ?? [0, 0, 0, 1];
      records.push(
        pb([
          [1, { str: s.id }],
          [2, clock(2)],
          [9, { int: 100 }],
        ]),
      );
      records.push(
        pb([
          [
            7,
            {
              msg: [
                [1, { str: s.id }],
                [
                  2,
                  {
                    bytes: bv4Raw(
                      s.tpl ??
                        (s.schema25 !== undefined
                        ? tplStroke25(
                            s.samples.map(([x, y]): [number, number] => [x, y]),
                            s.schema25,
                          )
                        : tplStroke(s.samples, s.stride)),
                    ),
                  },
                ],
                [3, { int: 1 }],
                [4, { msg: rgba.map((v, i): PbField => [i + 1, { f32: v }]) }],
                ...(s.offset
                  ? [
                      [
                        6,
                        {
                          msg: [
                            [1, { f32: s.offset[0] }],
                            [2, { f32: s.offset[1] }],
                          ],
                        },
                      ] as PbField,
                    ]
                  : []),
                [21, { int: s.schema25 !== undefined ? 25 : 24 }],
              ],
            },
          ],
        ]),
      );
    }
    for (const im of p.images ?? []) {
      const [x, y, w, h] = im.frame;
      records.push(
        pb([
          [1, { str: im.id }],
          [2, clock(2)],
          ...(im.removed ? [[3, { int: 1 }] as PbField] : []),
          [4, { str: im.attachment }],
        ]),
      );
      records.push(
        pb([
          [
            1,
            {
              msg: [
                [1, { str: im.id }],
                [
                  2,
                  {
                    msg: [
                      [
                        1,
                        {
                          msg: [
                            [1, { f32: x }],
                            [2, { f32: y }],
                          ],
                        },
                      ],
                      [
                        2,
                        {
                          msg: [
                            [1, { f32: w }],
                            [2, { f32: h }],
                          ],
                        },
                      ],
                    ],
                  },
                ],
                ...(im.turned
                  ? [
                      [
                        3,
                        {
                          msg: [
                            [
                              1,
                              {
                                msg: [
                                  [1, { f32: im.turned.centre[0] }],
                                  [2, { f32: im.turned.centre[1] }],
                                ],
                              },
                            ],
                            [
                              2,
                              {
                                msg: [
                                  [1, { f32: im.turned.size[0] }],
                                  [2, { f32: im.turned.size[1] }],
                                ],
                              },
                            ],
                            [3, { f32: im.turned.rotation }],
                          ],
                        },
                      ] as PbField,
                    ]
                  : []),
                [4, { str: im.attachment }],
              ],
            },
          ],
        ]),
      );
    }
    for (const t of p.rtfTexts ?? []) {
      const [x, y, w, h] = t.frame;
      const pair = (a: number, b: number): PbValue => ({
        msg: [
          [1, { f32: a }],
          [2, { f32: b }],
        ],
      });
      records.push(
        pb([
          [1, { str: t.id }],
          [2, clock(2)],
        ]),
      );
      records.push(
        pb([
          [
            8,
            {
              msg: [
                [1, { str: t.id }],
                [
                  2,
                  {
                    msg: [
                      [1, pair(x, y)],
                      [2, pair(w, h)],
                    ],
                  },
                ],
                [6, { str: t.rtf }],
                [7, { msg: (t.fill ?? [1, 1, 1, 0]).map((v, i): PbField => [i + 1, { f32: v }]) }],
                [10, { f32: 10 }],
              ],
            },
          ],
        ]),
      );
    }
    for (const t of p.texts ?? []) {
      records.push(
        pb([
          [1, { str: t.id }],
          [2, clock(2)],
        ]),
      );
      const colour = (rgba: number[]): PbValue => ({
        msg: rgba.map((v, i): PbField => [i + 1, { f32: v }]),
      });
      const runs = t.runs.map((run): PbField => {
        const attrs: PbField[] = [[3, colour(run.rgba ?? [0, 0, 0, 1])]];
        if (run.font) attrs.push([30, { str: run.font }]);
        attrs.push([40, { f32: run.size ?? -404 }]);
        return [
          1,
          {
            msg: [
              [1, { str: run.text }],
              [2, { msg: attrs }],
            ],
          },
        ];
      });
      const font: PbField[] = [
        [30, { str: "Helvetica Neue" }],
        [40, { f32: 24 }],
      ];
      const store: PbField[] = [
        [1, { msg: [[2, { bytes: bv4Raw(pb(runs)) }]] }],
        [2, { msg: [[1, { f32: t.textWidth ?? 100 }]] }],
        [5, { msg: [[1, { msg: font }]] }],
      ];
      const origin: PbField[] = [
        [1, { f32: t.origin[0] }],
        [2, { f32: t.origin[1] }],
      ];
      const size: PbField[] =
        t.width !== undefined
          ? [
              [
                2,
                {
                  msg: [
                    [1, { f32: t.width }],
                    ...(t.height !== undefined ? [[2, { f32: t.height }] as PbField] : []),
                  ],
                },
              ],
            ]
          : [[3, { msg: [[1, { f32: 32 }]] }]];
      const body: PbField[] = [
        [1, { str: t.id }],
        [20, { msg: [[1, { msg: origin }]] }],
        [21, { msg: size }],
        [30, { msg: [[1, { msg: [[1, colour(t.fill ?? [1, 1, 1, 0])]] }]] }],
        [t.comment ? 31 : 32, { msg: store }],
      ];
      if (t.radius !== undefined) {
        body.push([22, { msg: [[1, { msg: [[1, { f32: t.radius }]] }]] }]);
      }
      if (t.border && !t.comment) {
        body.push([
          31,
          {
            msg: [
              [1, { f32: t.border.width }],
              [3, { msg: [[1, colour(t.border.rgba)]] }],
            ],
          },
        ]);
      }
      records.push(pb([[t.comment ? 20 : 21, { msg: body }]]));
    }
    for (let i = 0; i < (p.unknown ?? 0); i++)
      records.push(pb([[9, { msg: [[1, { str: `u${i}` }]] }]]));
    files[`notes/${layerIdOf(p.id)}`] = delimited(records);
  }
  for (const [id, bytes] of Object.entries(spec.attachments ?? {}))
    files[`attachments/${id}`] = bytes;
  if (!spec.prefix) return files;
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [`${spec.prefix}/${k}`, v]));
}

/** Page id → content file id: the last group plus one. */
export function layerIdOf(pageId: string): string {
  const dash = pageId.lastIndexOf("-");
  const tail = pageId.slice(dash + 1);
  return (
    pageId.slice(0, dash + 1) +
    (parseInt(tail, 16) + 1).toString(16).toUpperCase().padStart(tail.length, "0")
  );
}

export const zip = (files: Record<string, Uint8Array>): Uint8Array => zipSync(files, { level: 0 });

/** The first bytes of a JPEG, a PDF and a PNG: enough to be told apart. */
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
export const PDF = new Uint8Array(ascii("%PDF-1.7\n%%EOF"));
export const PNG = new Uint8Array([0x89, ...ascii("PNG"), 13, 10]);

// --- binary plists ----------------------------------------------------------

export class Uid {
  constructor(readonly index: number) {}
}
export type BpValue =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | Uid
  | { real: number }
  | { int64: bigint }
  | { utf16: string }
  | BpValue[]
  | { [key: string]: BpValue };

/** A binary plist with 1-byte object references, enough for test graphs. */
export function bplist(top: BpValue): Uint8Array {
  const objects: number[][] = [];
  const add = (v: BpValue): number => {
    const index = objects.length;
    objects.push([]);
    objects[index] = encode(v);
    return index;
  };
  const sized = (type: number, n: number): number[] =>
    n < 15 ? [(type << 4) | n] : [(type << 4) | 15, 0x11, (n >> 8) & 255, n & 255];
  function encode(v: BpValue): number[] {
    if (v === null) return [0x00];
    if (v === false) return [0x08];
    if (v === true) return [0x09];
    if (typeof v === "number") {
      if (Number.isInteger(v) && v >= 0 && v < 256) return [0x10, v];
      if (Number.isInteger(v) && v >= 0 && v < 65536) return [0x11, v >> 8, v & 255];
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, v);
      return [0x23, ...b];
    }
    if (typeof v === "string") return [...sized(5, v.length), ...ascii(v)];
    if (v instanceof Date) {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, (v.getTime() - Date.UTC(2001, 0, 1)) / 1000);
      return [0x33, ...b];
    }
    if (v instanceof Uint8Array) return [...sized(4, v.length), ...v];
    if (v instanceof Uid) return [0x80, v.index];
    if (Array.isArray(v)) {
      const refs = v.map(add);
      return [...sized(0xa, refs.length), ...refs];
    }
    if ("real" in v && typeof v.real === "number") {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, v.real);
      return [0x22, ...b];
    }
    if ("int64" in v && typeof v.int64 === "bigint") {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigInt64(0, v.int64);
      return [0x13, ...b];
    }
    if ("utf16" in v && typeof v.utf16 === "string") {
      const s = v.utf16;
      const out = sized(6, s.length);
      for (const c of s) out.push(c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255);
      return out;
    }
    const entries = Object.entries(v as { [key: string]: BpValue });
    const keys = entries.map(([k]) => add(k));
    const values = entries.map(([, x]) => add(x));
    return [...sized(0xd, entries.length), ...keys, ...values];
  }
  const topIndex = add(top);
  const body: number[] = [...ascii("bplist00")];
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(body.length);
    body.push(...o);
  }
  if (objects.length > 255) throw new Error("test plist too big");
  const tableAt = body.length;
  const offsetSize = body.length > 65535 ? 4 : 2;
  for (const off of offsets) {
    if (offsetSize === 2) body.push((off >> 8) & 255, off & 255);
    else body.push((off >>> 24) & 255, (off >> 16) & 255, (off >> 8) & 255, off & 255);
  }
  const be64 = (n: number): number[] => [
    0,
    0,
    0,
    0,
    (n >>> 24) & 255,
    (n >> 16) & 255,
    (n >> 8) & 255,
    n & 255,
  ];
  body.push(
    0,
    0,
    0,
    0,
    0,
    0,
    offsetSize,
    1,
    ...be64(objects.length),
    ...be64(topIndex),
    ...be64(tableAt),
  );
  return new Uint8Array(body);
}

/**
 * An NSKeyedArchiver plist from a tree of plain values: objects with a
 * `$class` become archived objects, arrays NSArrays.
 */
export function keyedArchive(root: { [key: string]: unknown }): Uint8Array {
  const objects: BpValue[] = ["$null"];
  const classes = new Map<string, number>();
  const classUid = (name: string): Uid => {
    let i = classes.get(name);
    if (i === undefined) {
      i = objects.length;
      objects.push({ $classname: name, $classes: [name, "NSObject"] });
      classes.set(name, i);
    }
    return new Uid(i);
  };
  const ref = (v: unknown): BpValue => {
    if (v === null || v === undefined) return new Uid(0);
    if (typeof v === "number" || typeof v === "boolean") return v;
    const i = objects.length;
    objects.push(null);
    if (typeof v === "string" || v instanceof Uint8Array) objects[i] = v;
    else if (Array.isArray(v))
      objects[i] = { "NS.objects": v.map(ref), $class: classUid("NSArray") };
    else {
      const o = v as { [key: string]: unknown };
      const out: { [key: string]: BpValue } = {};
      for (const [k, x] of Object.entries(o)) if (k !== "$class") out[k] = ref(x);
      out.$class = classUid(typeof o.$class === "string" ? o.$class : "NSObject");
      objects[i] = out;
    }
    return new Uid(i);
  };
  const top = ref(root);
  return bplist({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $top: { root: top },
    $objects: objects,
  });
}

export function f32bytes(values: number[]): Uint8Array {
  const b = new Uint8Array(values.length * 4);
  const v = new DataView(b.buffer);
  values.forEach((x, i) => v.setFloat32(i * 4, x, true));
  return b;
}

export function i32bytes(values: number[]): Uint8Array {
  const b = new Uint8Array(values.length * 4);
  const v = new DataView(b.buffer);
  values.forEach((x, i) => v.setInt32(i * 4, x, true));
  return b;
}
