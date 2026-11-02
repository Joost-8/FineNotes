/**
 * Synthetic Notability `.ntb` notes for the tests: a tiny FlatBuffers writer
 * and builders for the events `notability-ntb.ts` reads. Nothing here comes
 * from a real note.
 */

/** A value of a table's field: bytes stored in the table, or a table, vector or string it points to. */
type Field = Uint8Array | Node;

/** A table, a vector or a string, written after the thing that points to it. */
interface Node {
  /** The bytes of the vector or string; absent for a table. */
  bytes?: Uint8Array;
  /** A vector's items, each a table or a few bytes (a point, an id). */
  items?: Array<Uint8Array | Node>;
  /** A table's fields by slot. */
  fields?: Map<number, Field>;
}

/** A table with `fields` by slot. */
export function table(fields: Record<number, Field>): Node {
  return { fields: new Map(Object.entries(fields).map(([slot, v]) => [Number(slot), v])) };
}

/** A vector whose items are tables, or all `width` bytes long. */
export function vector(items: Array<Uint8Array | Node>): Node {
  return { items };
}

/** A string. */
export function text(value: string): Node {
  return { bytes: new TextEncoder().encode(value) };
}

export const u8 = (v: number): Uint8Array => Uint8Array.of(v);

export function u32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v, true));
  return out;
}

export function f32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return out;
}

/**
 * The bytes of a FlatBuffers file whose root is `root`. Parents are written
 * before what they point to, so every offset is forward, as the reader needs.
 */
export function flatbuffer(root: Node): Uint8Array {
  const out: number[] = [0, 0, 0, 0];
  const todo: Array<{ at: number; node: Node }> = [];
  const patch = (at: number, value: number): void => {
    out[at] = value & 0xff;
    out[at + 1] = (value >> 8) & 0xff;
    out[at + 2] = (value >> 16) & 0xff;
    out[at + 3] = (value >> 24) & 0xff;
  };
  const push = (...bytes: number[]): number => {
    const at = out.length;
    out.push(...bytes);
    return at;
  };
  /** Writes `node` and queues its children; returns where it starts. */
  const place = (node: Node): number => {
    if (node.fields) {
      const slots = [...node.fields.keys()].sort((a, b) => a - b);
      const count = (slots.length ? slots[slots.length - 1] : -1) + 1;
      const offsets: number[] = new Array<number>(count).fill(0);
      let size = 4;
      for (const slot of slots) {
        const field = node.fields.get(slot);
        offsets[slot] = size;
        size += field instanceof Uint8Array ? field.length : 4;
      }
      const vtable = 4 + count * 2;
      push(
        vtable & 0xff,
        vtable >> 8,
        size & 0xff,
        size >> 8,
        ...offsets.flatMap((o) => [o & 0xff, o >> 8]),
      );
      // The table starts with its distance from the vtable, which is just before it.
      const at = push(vtable & 0xff, (vtable >> 8) & 0xff, 0, 0);
      for (const slot of slots) {
        const field = node.fields.get(slot);
        if (field instanceof Uint8Array) push(...field);
        else {
          const here = push(0, 0, 0, 0);
          todo.push({ at: here, node: field as Node });
        }
      }
      return at;
    }
    if (node.items) {
      const at = push(...u32s(node.items.length));
      for (const item of node.items) {
        if (item instanceof Uint8Array) push(...item);
        else todo.push({ at: push(0, 0, 0, 0), node: item });
      }
      return at;
    }
    const bytes = node.bytes ?? new Uint8Array();
    const at = push(...u32s(bytes.length), ...bytes);
    push(0);
    return at;
  };
  const queue: Array<{ at: number; node: Node }> = [{ at: 0, node: root }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const where = place(next.node);
    patch(next.at, where - next.at);
    queue.push(...todo.splice(0));
  }
  return Uint8Array.from(out);
}

// --- Events -------------------------------------------------------------------

/** An event's id: two words, as the reader reads them. */
export const eventId = (n: number): Uint8Array => u32s(0, n);

/**
 * A page (the schema's `PageLocation`): the id of the CreatePage event that made it and its
 * place in that event's run, three words. A plain number is a page of the run of event 2,
 * which is where `createPageEvent(2, …)` puts its pages.
 */
export type PageRef = number | [run: number, index: number];
export const pageRef = (page: PageRef): Uint8Array =>
  typeof page === "number" ? u32s(0, 2, page) : u32s(0, page[0], page[1]);
const onPage = pageRef;

/** An event: its id, type and payload. */
export function event(id: number, type: number, payload: Node): Node {
  return table({ 0: eventId(id), 4: u8(type), 5: payload });
}

/** Margins as a struct of four float32s: top, bottom, left, right. */
export type Margins = [top: number, bottom: number, left: number, right: number];

/**
 * The document's paper size, and its first event. `margins` is the note-wide page margins its
 * pageBackground table sets (field 4).
 */
export function documentEvent(width: number, height: number, margins?: Margins): Node {
  const background: Record<number, Field> = { 0: table({ 3: f32s(width, height) }) };
  if (margins) background[4] = f32s(...margins);
  return event(1, 1, table({ 1: table(background), 5: f32s(12) }));
}

/** The hash the test notes' PDF asset (`assets/aaaa….pdf`) is named by. */
const PDF_HASH = new Uint8Array(64).fill(0xaa);

/**
 * A CreatePage event with the page's size. `pdf` makes its pages those of the note's PDF, from
 * the page `offset` on; `count` is the number of pages it makes (the schema's default is 1);
 * `after` is the page it goes after (the start of the note when absent).
 */
export function createPageEvent(
  id: number,
  width: number,
  height: number,
  o: { count?: number; after?: PageRef; pdf?: { offset?: number }; margins?: Margins } = {},
): Node {
  const background: Record<number, Field> = { 3: f32s(width, height) };
  if (o.margins) background[4] = f32s(...o.margins);
  if (o.pdf) {
    const asset: Record<number, Field> = { 0: table({ 0: PDF_HASH }) };
    if (o.pdf.offset !== undefined) asset[4] = u32s(o.pdf.offset);
    background[1] = table(asset);
  }
  const fields: Record<number, Field> = { 1: table(background) };
  if (o.after !== undefined) fields[0] = pageRef(o.after);
  if (o.count !== undefined) fields[2] = u32s(o.count);
  return event(id, 3, table(fields));
}

/** A line drawn with the shape tool (type 18); `tool` 2 is the highlighter. */
export function lineEvent(
  id: number,
  page: PageRef,
  from: [number, number],
  to: [number, number],
  tool: number,
  width: number,
  colour = [255, 221, 87, 107],
): Node {
  return event(
    id,
    18,
    table({
      0: onPage(page),
      1: f32s(...from),
      4: u8(1),
      5: table({ 3: f32s(to[0] - from[0], to[1] - from[1]) }),
      6: u8(tool),
      9: Uint8Array.from(colour),
      10: f32s(width),
    }),
  );
}

/** A block's fields with its `scale` (field 5) when it has one. */
function withScale(fields: Record<number, Field>, scale?: [number, number]): Record<number, Field> {
  return scale ? { ...fields, 5: f32s(...scale) } : fields;
}

/** A block with a paper and no picture (type 22): what the note calls a sticky note. */
export function stickyEvent(
  id: number,
  page: PageRef,
  at: [number, number],
  size: [number, number],
  scale?: [number, number],
): Node {
  return event(
    id,
    22,
    table(
      withScale(
        {
          2: onPage(page),
          3: f32s(...at),
          6: f32s(...size),
          15: table({ 4: Uint8Array.from([255, 244, 142, 255]) }),
        },
        scale,
      ),
    ),
  );
}

/** The hash the test notes' picture asset (`assets/bbbb….png`) is named by. */
export const PICTURE_HASH = new Uint8Array(64).fill(0xbb);

/** A picture block (type 22): a media block with an asset, shown at `size` times `scale`. */
export function pictureEvent(
  id: number,
  page: PageRef,
  at: [number, number],
  size: [number, number],
  scale?: [number, number],
): Node {
  return event(
    id,
    22,
    table(
      withScale(
        {
          2: onPage(page),
          3: f32s(...at),
          6: f32s(...size),
          10: table({ 0: table({ 0: PICTURE_HASH }) }),
        },
        scale,
      ),
    ),
  );
}

/**
 * A text box's block (type 22): a paper too, but one with no colour of its own. `margins` is
 * the block's own (field 19); without it Notability's default (3, 3, 5, 5) applies.
 */
export function textBoxEvent(
  id: number,
  page: PageRef,
  at: [number, number],
  size: [number, number],
  margins?: Margins,
): Node {
  const fields: Record<number, Field> = {
    2: onPage(page),
    3: f32s(...at),
    6: f32s(...size),
    15: table({ 1: f32s(0) }),
  };
  if (margins) fields[19] = f32s(...margins);
  return event(id, 22, table(fields));
}

/**
 * A DeleteEntities event naming the events `ids` made, and those `undeleted` brings back; and
 * the pages `pages` deletes and `pagesBack` brings back.
 */
export function deleteEvent(
  id: number,
  ids: number[],
  undeleted: number[] = [],
  pages: PageRef[] = [],
  pagesBack: PageRef[] = [],
): Node {
  const fields: Record<number, Field> = { 0: vector(ids.map(eventId)) };
  if (undeleted.length > 0) fields[1] = vector(undeleted.map(eventId));
  if (pages.length > 0) fields[2] = vector(pages.map(pageRef));
  if (pagesBack.length > 0) fields[3] = vector(pagesBack.map(pageRef));
  return event(id, 25, table(fields));
}

/** A character's id (the schema's `SeqId`): the operation that typed it and its place in the string. */
export const seqId = (op: number, index = 0): Uint8Array => u32s(0, op, index);

/** A style range's end (the schema's `Boundary`): a `SeqId` and a type, 0 before, 1 after, 2 start, 3 end. */
export const boundary = (op: number, index: number, type: number): Uint8Array =>
  Uint8Array.of(...seqId(op, index), type, 0, 0, 0);

/**
 * An InsertChar event (type 7): `char` goes after the character `after` (an
 * operation id, and a place in its string) or at the start of `container`.
 */
export function insertCharEvent(
  id: number,
  char: string,
  after: [number, number] | null,
  container: number | null,
): Node {
  const fields: Record<number, Field> = { 1: u32s(char.codePointAt(0) ?? 0) };
  if (after) fields[0] = seqId(after[0], after[1]);
  if (container !== null) fields[2] = eventId(container);
  return event(id, 7, table(fields));
}

/** An InsertString event (type 8): its characters have ids `id` at 0, 1, 2, ... */
export function insertStringEvent(
  id: number,
  value: string,
  after: [number, number] | null,
  container: number | null,
): Node {
  const fields: Record<number, Field> = { 1: text(value) };
  if (after) fields[0] = seqId(after[0], after[1]);
  if (container !== null) fields[2] = eventId(container);
  return event(id, 8, table(fields));
}

/** A RemoveChar event (type 9). */
export function removeCharEvent(id: number, target: [number, number]): Node {
  return event(id, 9, table({ 0: seqId(target[0], target[1]) }));
}

/** A RemoveChars (10) or ReviveChars (11) event: a vector of ids. */
export function removeCharsEvent(
  id: number,
  targets: Array<[number, number]>,
  revive = false,
): Node {
  return event(id, revive ? 11 : 10, table({ 0: vector(targets.map(([o, i]) => seqId(o, i))) }));
}

/** A ModifyStyle event (type 12) that makes the range bold. */
export function boldEvent(id: number, start: Uint8Array, end: Uint8Array): Node {
  return event(id, 12, table({ 0: start, 1: end, 3: table({ 0: u8(1) }) }));
}

/** A ModifyPositions event (type 24) that moves `target` to `at` on `page`. */
export function movePositionEvent(
  id: number,
  target: number,
  page: PageRef,
  at: [number, number],
): Node {
  return event(
    id,
    24,
    table({ 0: vector([table({ 0: eventId(target), 1: onPage(page), 2: f32s(...at) })]) }),
  );
}

/** A ModifyBlock event (type 23) that gives `target` a new size. */
export function resizeBlockEvent(id: number, target: number, size: [number, number]): Node {
  return event(id, 23, table({ 0: vector([eventId(target)]), 6: f32s(...size) }));
}

/** A ModifyBlock event (type 23) that gives `target` a new scale. */
export function scaleBlockEvent(id: number, target: number, scale: [number, number]): Node {
  return event(id, 23, table({ 0: vector([eventId(target)]), 5: table({ 0: f32s(...scale) }) }));
}

/** An `.ntb` note's `noteBundle` holding `events`. */
export function noteBundle(events: Node[]): Uint8Array {
  return flatbuffer(table({ 6: vector(events) }));
}
