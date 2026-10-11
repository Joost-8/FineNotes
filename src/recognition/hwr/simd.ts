/**
 * The network's hot loops as WebAssembly SIMD (float32, four lanes):
 *
 * - `affine(w, n, x, b, out, rows)`: `out[r] = b[r] + Σ_j w[r·n + j] · x[j]`,
 *   four rows at a time (the input projections, the recurrent products and
 *   the output layer);
 * - `cell(z, c, h, out, H)`: one LSTM step's gates from the summed `z`
 *   (input, forget, cell, output blocks of H): updates the cell state `c`,
 *   writes the hidden state to `h` and to `out`. Sigmoid and tanh use
 *   Cephes' float32 exp (relative error about 1e-7, as float32 itself).
 *
 * The module is assembled here byte by byte, so there is no binary file and
 * no build step. `simdKernel` returns null where WebAssembly or its SIMD is
 * missing (iOS Lockdown Mode, older WebKit), and the caller keeps the plain
 * JavaScript path. Speeds: research/handwriting-rig/PORT.md.
 *
 * PURE: no DOM, no Obsidian.
 */

/** Unsigned LEB128. */
function u32(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

/** Signed LEB128 (small constants only). */
function s32(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    const byte = n & 0x7f;
    n >>= 7;
    if ((n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

const vec = (items: number[][]): number[] => [...u32(items.length), ...items.flat()];
const section = (id: number, body: number[]): number[] => [id, ...u32(body.length), ...body];
const str = (s: string): number[] => [...u32(s.length), ...Array.from(s, (c) => c.charCodeAt(0))];

const I32 = 0x7f;
const V128 = 0x7b;

// Instructions.
const get = (i: number): number[] => [0x20, ...u32(i)];
const set = (i: number): number[] => [0x21, ...u32(i)];
const tee = (i: number): number[] => [0x22, ...u32(i)];
const i32c = (v: number): number[] => [0x41, ...s32(v)];
const ADD = [0x6a];
const SHL = [0x74];
const GE_U = [0x4f];
const block = (body: number[]): number[] => [0x02, 0x40, ...body, 0x0b];
const loop = (body: number[]): number[] => [0x03, 0x40, ...body, 0x0b];
const br = (depth: number): number[] => [0x0c, ...u32(depth)];
const brIf = (depth: number): number[] => [0x0d, ...u32(depth)];
const f32Load = (offset: number): number[] => [0x2a, 2, ...u32(offset)];
const f32Store = (offset: number): number[] => [0x38, 2, ...u32(offset)];
const F32_ADD = [0x92];
const simd = (op: number, ...imm: number[]): number[] => [0xfd, ...u32(op), ...imm];
const V128_LOAD = simd(0x00, 4, 0);
const V128_ZERO = simd(0x0c, ...new Array<number>(16).fill(0));
const lane = (i: number): number[] => simd(0x1f, i);
const F32X4_ADD = simd(0xe4);
const F32X4_MUL = simd(0xe6);
const F32X4_SUB = simd(0xe5);
const F32X4_DIV = simd(0xe7);
const F32X4_MIN = simd(0xe8);
const F32X4_MAX = simd(0xe9);
const F32X4_NEG = simd(0xe1);
const F32X4_NEAREST = simd(0x6a);
const I32X4_TRUNC_SAT_F32X4_S = simd(0xf8);
const I32X4_ADD = simd(0xae);
const I32X4_SHL = simd(0xab);
const V128_STORE = simd(0x0b, 4, 0);

/** A v128 constant of four equal float32 (or int32) lanes. */
function splat(value: number, int = false): number[] {
  const view = new DataView(new ArrayBuffer(16));
  for (let i = 0; i < 4; i++) {
    if (int) view.setInt32(i * 4, value, true);
    else view.setFloat32(i * 4, value, true);
  }
  return simd(0x0c, ...new Uint8Array(view.buffer));
}

// --- affine(w, n, x, b, out, rows) ---------------------------------------------

// Locals: the six parameters, then the kernel's own.
const [W, N, X, B, OUT, ROWS] = [0, 1, 2, 3, 4, 5];
const [R, J, ROW_BYTES, P0, P1, P2, P3, OB, BB] = [6, 7, 8, 9, 10, 11, 12, 13, 14];
const [A0, A1, A2, A3, XV] = [15, 16, 17, 18, 19];

/** `acc += load(p + j) · xv` */
const madd = (acc: number, p: number): number[] => [
  ...get(acc),
  ...get(p),
  ...get(J),
  ...ADD,
  ...V128_LOAD,
  ...get(XV),
  ...F32X4_MUL,
  ...F32X4_ADD,
  ...set(acc),
];

/** `out[r + k] = b[r + k] + ((a0 + a1) + (a2 + a3))` over the lanes of `acc`. */
const finish = (acc: number, k: number): number[] => [
  ...get(OB),
  ...get(BB),
  ...f32Load(4 * k),
  ...get(acc),
  ...lane(0),
  ...get(acc),
  ...lane(1),
  ...F32_ADD,
  ...get(acc),
  ...lane(2),
  ...get(acc),
  ...lane(3),
  ...F32_ADD,
  ...F32_ADD,
  ...F32_ADD,
  ...f32Store(4 * k),
];

/** `affine(w, n, x, b, out, rows)`, all addresses in bytes; rows and n multiples of 4. */
function affineBody(): number[] {
  const cols = loop([
    ...get(J),
    ...get(ROW_BYTES),
    ...GE_U,
    ...brIf(1),
    ...get(X),
    ...get(J),
    ...ADD,
    ...V128_LOAD,
    ...set(XV),
    ...madd(A0, P0),
    ...madd(A1, P1),
    ...madd(A2, P2),
    ...madd(A3, P3),
    ...get(J),
    ...i32c(16),
    ...ADD,
    ...set(J),
    ...br(0),
  ]);
  const rows = loop([
    ...get(R),
    ...get(ROWS),
    ...GE_U,
    ...brIf(1),
    ...get(P0),
    ...get(ROW_BYTES),
    ...ADD,
    ...tee(P1),
    ...get(ROW_BYTES),
    ...ADD,
    ...tee(P2),
    ...get(ROW_BYTES),
    ...ADD,
    ...set(P3),
    ...V128_ZERO,
    ...set(A0),
    ...V128_ZERO,
    ...set(A1),
    ...V128_ZERO,
    ...set(A2),
    ...V128_ZERO,
    ...set(A3),
    ...i32c(0),
    ...set(J),
    ...block(cols),
    ...get(OUT),
    ...get(R),
    ...i32c(2),
    ...SHL,
    ...ADD,
    ...set(OB),
    ...get(B),
    ...get(R),
    ...i32c(2),
    ...SHL,
    ...ADD,
    ...set(BB),
    ...finish(A0, 0),
    ...finish(A1, 1),
    ...finish(A2, 2),
    ...finish(A3, 3),
    ...get(R),
    ...i32c(4),
    ...ADD,
    ...set(R),
    ...get(P3),
    ...get(ROW_BYTES),
    ...ADD,
    ...set(P0),
    ...br(0),
  ]);
  const code = [
    ...get(N),
    ...i32c(2),
    ...SHL,
    ...set(ROW_BYTES),
    ...i32c(0),
    ...set(R),
    ...get(W),
    ...set(P0),
    ...block(rows),
    0x0b,
  ];
  const locals = vec([
    [9, I32],
    [5, V128],
  ]);
  const body = [...locals, ...code];
  return [...u32(body.length), ...body];
}

// --- cell(z, c, h, out, H) ------------------------------------------------------

const [CZ, CC, CH, COUT, CHN] = [0, 1, 2, 3, 4];
const [K, HB, Z1, Z2, Z3] = [5, 6, 7, 8, 9];
const [VI, VF, VG, VO, VC, TX, TN, TR, TP, TS] = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

/** Cephes' expf of local TX, left on the stack (TX within about ±87). */
const expTx = (): number[] => [
  ...get(TX),
  ...splat(1.4426950408889634),
  ...F32X4_MUL,
  ...F32X4_NEAREST,
  ...set(TN),
  ...get(TX),
  ...get(TN),
  ...splat(0.693359375),
  ...F32X4_MUL,
  ...F32X4_SUB,
  ...get(TN),
  ...splat(-2.1219444e-4),
  ...F32X4_MUL,
  ...F32X4_SUB,
  ...set(TR),
  ...splat(1.98756915e-4),
  ...get(TR),
  ...F32X4_MUL,
  ...splat(1.3981999507e-3),
  ...F32X4_ADD,
  ...get(TR),
  ...F32X4_MUL,
  ...splat(8.3334519073e-3),
  ...F32X4_ADD,
  ...get(TR),
  ...F32X4_MUL,
  ...splat(4.1665795894e-2),
  ...F32X4_ADD,
  ...get(TR),
  ...F32X4_MUL,
  ...splat(1.6666665459e-1),
  ...F32X4_ADD,
  ...get(TR),
  ...F32X4_MUL,
  ...splat(5.0000001201e-1),
  ...F32X4_ADD,
  ...get(TR),
  ...get(TR),
  ...F32X4_MUL,
  ...F32X4_MUL,
  ...get(TR),
  ...F32X4_ADD,
  ...splat(1),
  ...F32X4_ADD,
  ...set(TP),
  // 2^n, built in the exponent bits.
  ...get(TN),
  ...I32X4_TRUNC_SAT_F32X4_S,
  ...splat(127, true),
  ...I32X4_ADD,
  ...i32c(23),
  ...I32X4_SHL,
  ...set(TS),
  ...get(TP),
  ...get(TS),
  ...F32X4_MUL,
];

/** `v = 1 / (1 + e^-v)`, the input clipped to ±60 as the reference does. */
const sigmoidOf = (v: number): number[] => [
  ...get(v),
  ...splat(-60),
  ...F32X4_MAX,
  ...splat(60),
  ...F32X4_MIN,
  ...F32X4_NEG,
  ...set(TX),
  ...splat(1),
  ...splat(1),
  ...expTx(),
  ...F32X4_ADD,
  ...F32X4_DIV,
  ...set(v),
];

/** `v = tanh(v) = 1 - 2 / (e^2v + 1)`, with 2v clipped to ±87 (tanh is ±1 there). */
const tanhOf = (v: number): number[] => [
  ...get(v),
  ...splat(2),
  ...F32X4_MUL,
  ...splat(-87),
  ...F32X4_MAX,
  ...splat(87),
  ...F32X4_MIN,
  ...set(TX),
  ...splat(1),
  ...splat(2),
  ...expTx(),
  ...splat(1),
  ...F32X4_ADD,
  ...F32X4_DIV,
  ...F32X4_SUB,
  ...set(v),
];

const loadAt = (base: number): number[] => [...get(base), ...get(K), ...ADD, ...V128_LOAD];
const storeAt = (base: number, v: number): number[] => [
  ...get(base),
  ...get(K),
  ...ADD,
  ...get(v),
  ...V128_STORE,
];

/** `cell(z, c, h, out, H)`, addresses in bytes, H a multiple of 4. */
function cellBody(): number[] {
  const units = loop([
    ...get(K),
    ...get(HB),
    ...GE_U,
    ...brIf(1),
    ...loadAt(CZ),
    ...set(VI),
    ...loadAt(Z1),
    ...set(VF),
    ...loadAt(Z2),
    ...set(VG),
    ...loadAt(Z3),
    ...set(VO),
    ...sigmoidOf(VI),
    ...sigmoidOf(VF),
    ...tanhOf(VG),
    ...sigmoidOf(VO),
    // c = f·c + i·g
    ...get(VF),
    ...loadAt(CC),
    ...F32X4_MUL,
    ...get(VI),
    ...get(VG),
    ...F32X4_MUL,
    ...F32X4_ADD,
    ...set(VC),
    ...storeAt(CC, VC),
    // h = o·tanh(c)
    ...get(VC),
    ...set(VG),
    ...tanhOf(VG),
    ...get(VO),
    ...get(VG),
    ...F32X4_MUL,
    ...set(VG),
    ...storeAt(CH, VG),
    ...storeAt(COUT, VG),
    ...get(K),
    ...i32c(16),
    ...ADD,
    ...set(K),
    ...br(0),
  ]);
  const code = [
    ...get(CHN),
    ...i32c(2),
    ...SHL,
    ...tee(HB),
    ...get(CZ),
    ...ADD,
    ...tee(Z1),
    ...get(HB),
    ...ADD,
    ...tee(Z2),
    ...get(HB),
    ...ADD,
    ...set(Z3),
    ...i32c(0),
    ...set(K),
    ...block(units),
    0x0b,
  ];
  const locals = vec([
    [5, I32],
    [10, V128],
  ]);
  const body = [...locals, ...code];
  return [...u32(body.length), ...body];
}

/** The module's bytes: imports `env.memory`, exports `affine` and `cell`. */
export function kernelModule(): Uint8Array<ArrayBuffer> {
  const i32s = (n: number): number[][] => new Array<number[]>(n).fill([I32]);
  const type = vec([
    [0x60, ...vec(i32s(6)), ...vec([])],
    [0x60, ...vec(i32s(5)), ...vec([])],
  ]);
  const imports = vec([[...str("env"), ...str("memory"), 0x02, 0x00, ...u32(1)]]);
  const functions = vec([u32(0), u32(1)]);
  const exports = vec([
    [...str("affine"), 0x00, ...u32(0)],
    [...str("cell"), 0x00, ...u32(1)],
  ]);
  const code = vec([affineBody(), cellBody()]);
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, type),
    ...section(2, imports),
    ...section(3, functions),
    ...section(7, exports),
    ...section(10, code),
  ]);
}

/** The kernels on their own memory. Views go stale when the memory grows: take them anew. */
export interface SimdKernel {
  memory: WebAssembly.Memory;
  affine: (w: number, n: number, x: number, b: number, out: number, rows: number) => void;
  cell: (z: number, c: number, h: number, out: number, H: number) => void;
}

/** The kernels with at least `bytes` of memory, or null without WebAssembly SIMD. */
export function simdKernel(bytes: number): SimdKernel | null {
  try {
    const wasm = kernelModule();
    if (typeof WebAssembly !== "object" || !WebAssembly.validate(wasm)) return null;
    const memory = new WebAssembly.Memory({ initial: Math.max(1, Math.ceil(bytes / 65536)) });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), { env: { memory } });
    const affine = instance.exports.affine as SimdKernel["affine"];
    const cell = instance.exports.cell as SimdKernel["cell"];
    return { memory, affine, cell };
  } catch {
    return null;
  }
}
