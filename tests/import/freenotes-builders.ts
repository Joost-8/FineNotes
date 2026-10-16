/**
 * Synthetic FreeNotes notebooks for the tests: the protocol-buffer shapes a
 * `.freenotes` zip holds, as read from a real export (2026), built from a
 * small spec instead of shipping someone's notebook.
 */

import { pb, type PbField, zip } from "./builders";

export interface FnPoint {
  x: number;
  y: number;
  /** The width drawn there, in points. */
  w?: number;
}

export interface FnStroke {
  points: FnPoint[];
  /** 0 a pen, 1 another pen, 2 the highlighter, 101 the eraser. */
  tool?: number;
  /** RGBA. */
  color?: number;
  /** a, b, c, d, tx, ty; `null` leaves the transform out. */
  transform?: [number, number, number, number, number, number] | null;
  /** Pixel-eraser paths that went over this stroke. */
  erasers?: FnPoint[][];
}

export interface FnPage {
  /** A ruled template's pattern (5 is lined); absent with `pdf`. */
  pattern?: number;
  paperColor?: number;
  lineColor?: number;
  /** A PDF template: its bytes and its page, counted from 1. */
  pdf?: { bytes: Uint8Array; page?: number; id?: string };
  width?: number;
  height?: number;
  /** Items on the page; `"other"` is an element that is not a stroke. */
  items?: Array<FnStroke | "other">;
  /** No ink file at all (a page never written on). */
  noInk?: boolean;
  /** Names an ink file that is not in the zip. */
  missingInk?: boolean;
  /** Its position field, when it should differ from its order. */
  position?: number;
}

const IDENTITY: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

function point(p: FnPoint, t: number): PbField[] {
  const w = p.w ?? 2.5;
  return [
    [
      1,
      {
        msg: [
          [1, { f64: p.x }],
          [2, { f64: p.y }],
        ],
      },
    ],
    [
      3,
      {
        msg: [
          [1, { f64: w }],
          [2, { f64: w }],
        ],
      },
    ],
    [4, { f64: -1774364007 + t }],
    [7, { f64: 1.8 }],
    [10, { f64: 1 }],
  ];
}

function item(id: string, s: FnStroke): PbField[] {
  const brush: PbField[] = [];
  if (s.tool) brush.push([1, { int: s.tool }]);
  brush.push(
    [2, { int: s.color ?? 0x000000ff }],
    [
      6,
      {
        msg: [
          [1, { f64: 80 }],
          [2, { f64: 80 }],
        ],
      },
    ],
  );
  brush.push([7, { int: 255 }], [9, { int: 1 }]);
  const fields: PbField[] = [
    [1, { str: id }],
    [2, { msg: brush }],
  ];
  const t = s.transform === undefined ? IDENTITY : s.transform;
  if (t) {
    const tf: PbField[] = [];
    // Protocol buffers leave zeros out, as FreeNotes does.
    t.forEach((v, i) => {
      if (v !== 0) tf.push([i + 1, { f64: v }]);
    });
    fields.push([3, { msg: tf }]);
  }
  fields.push([
    4,
    {
      msg: [
        [1, { str: `${id}-stroke` }],
        ...s.points.map((p, i): PbField => [2, { msg: point(p, i) }]),
        [
          3,
          {
            msg: [
              [1, { int: 1774529513 }],
              [2, { int: 368939000 }],
            ],
          },
        ],
        [6, { int: 3 }],
      ],
    },
  ]);
  (s.erasers ?? []).forEach((path, i) => {
    fields.push([5, { msg: item(`${id}-eraser${i}`, { points: path, tool: 101 }) }]);
  });
  return fields;
}

/** A `.freenotes` file: a zip around one `<id>.frnote/` folder. */
export function freenotes(spec: { title?: string; pages: FnPage[]; folder?: string }): Uint8Array {
  const folder = spec.folder ?? "57e660ab-12f1-4ca6-9d3c-2242f00be591.frnote/";
  const files: Record<string, Uint8Array> = {};
  const entries: PbField[] = [];
  const layout: PbField[] = [
    [1, { str: "notebook" }],
    [2, { f64: 595 }],
  ];
  spec.pages.forEach((page, index) => {
    const pageId = `page-${index}`;
    const entry: PbField[] = [[1, { str: pageId }]];
    const position = page.position ?? index;
    if (position !== 0) entry.push([3, { int: position }]);
    if (page.pdf) {
      const pdfId = page.pdf.id ?? `pdf-${index}`;
      files[`${folder}PDFs/${pdfId}.pdf`] = page.pdf.bytes;
      entry.push([
        5,
        {
          msg: [
            [1, { str: `paper-${index}` }],
            [
              4,
              {
                msg: [
                  [1, { int: 1 }],
                  [
                    3,
                    {
                      msg: [
                        [1, { str: "template" }],
                        [2, { str: pdfId }],
                        [9, { int: page.pdf.page ?? 1 }],
                      ],
                    },
                  ],
                ],
              },
            ],
          ],
        },
      ]);
    } else {
      const ruled: PbField[] = [[1, { int: 1 }]];
      if (page.pattern) ruled.push([2, { int: page.pattern }]);
      ruled.push(
        [3, { int: page.paperColor ?? 0xffffffff }],
        [4, { int: page.lineColor ?? 0xc9c9c9ff }],
      );
      entry.push([
        5,
        {
          msg: [
            [1, { str: `paper-${index}` }],
            [3, { msg: ruled }],
          ],
        },
      ]);
    }
    if (!page.noInk) {
      const inkId = `ink-${index}`;
      entry.push([6, { str: inkId }]);
      if (!page.missingInk) {
        const elements: PbField[] = [
          [1, { str: inkId }],
          [2, { str: pageId }],
        ];
        (page.items ?? []).forEach((it, i) => {
          const id = `el-${index}-${i}`;
          const inner: PbField[] =
            it === "other"
              ? [
                  [
                    1,
                    {
                      msg: [
                        [1, { str: id }],
                        [7, { str: "picture" }],
                      ],
                    },
                  ],
                ]
              : [[1, { msg: item(id, it) }]];
          inner.push([2, { str: pageId }], [3, { str: pageId }]);
          elements.push([
            3,
            {
              msg: [
                [1, { str: id }],
                [2, { msg: inner }],
              ],
            },
          ]);
        });
        files[`${folder}FNPages/${inkId}.dat`] = pb(elements);
      }
    }
    entries.push([1, { msg: entry }]);
    layout.push([
      3,
      {
        msg: [
          [
            1,
            {
              msg: [
                [1, { f64: page.width ?? 595 }],
                [2, { f64: page.height ?? 842 }],
              ],
            },
          ],
          [2, { f64: 1 }],
          [5, { str: pageId }],
        ],
      },
    ]);
  });
  files[`${folder}document.dat`] = pb([
    [1, { int: 2 }],
    [2, { str: "notebook" }],
    [4, { msg: [...entries, [5, { int: 1 }]] }],
  ]);
  files[`${folder}layout.dat`] = pb(layout);
  if (spec.title !== undefined) {
    files[`${folder}metadata.dat`] = pb([
      [1, { str: "notebook" }],
      [3, { str: spec.title }],
      [4, { str: spec.title }],
    ]);
  }
  return zip(files);
}
