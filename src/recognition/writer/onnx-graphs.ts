/**
 * The writer's three ONNX graphs (gen/export_onnx.py: `encode`,
 * `durations`, `velocity`) behind the sampler's {@link Graphs}, for
 * onnxruntime-web. The ORT module is handed in, so the worker (which bundles
 * `onnxruntime-web/wasm`) and laptop checks share this code.
 */

import type * as Ort from "onnxruntime-web/wasm";
import { ROW, type Reference } from "./rows";
import type { Encoded, Graphs } from "./sampler";

type OrtModule = Pick<typeof Ort, "Tensor">;

/** An encoded reference, as the velocity graph takes it. */
export interface OrtEncoded extends Encoded {
  mem: Ort.Tensor;
  valid: Ort.Tensor;
  gTensor: Ort.Tensor;
}

export interface WriterSessions {
  encode: Ort.InferenceSession;
  durations: Ort.InferenceSession;
  velocity: Ort.InferenceSession;
}

const i64 = (v: ArrayLike<number>): BigInt64Array => BigInt64Array.from(Array.from(v, (n) => BigInt(n)));
const bools = (v: ArrayLike<number>): Uint8Array => Uint8Array.from(v, (n) => (n ? 1 : 0));

export function ortGraphs(ort: OrtModule, s: WriterSessions): Graphs<OrtEncoded> {
  const T = ort.Tensor;
  return {
    async encode(ref: Reference, drop: boolean): Promise<OrtEncoded> {
      const R = ref.n;
      const out = await s.encode.run({
        rx: new T("float32", ref.x, [1, R, ROW]),
        rmask: new T("bool", new Uint8Array(R).fill(1), [1, R]),
        rcid: new T("int64", i64(ref.cid), [1, R]),
        rk: new T("int64", i64(ref.k), [1, R]),
        rd: new T("int64", i64(ref.d), [1, R]),
        rsep: new T("bool", bools(ref.sep), [1, R]),
        drop: new T("bool", Uint8Array.from([drop ? 1 : 0]), [1]),
      });
      return { mem: out.mem, valid: out.valid, gTensor: out.g, g: Float32Array.from(out.g.data as Float32Array) };
    },
    async durations(ids: Int32Array, g: Float32Array): Promise<Float32Array> {
      const L = ids.length;
      const out = await s.durations.run({
        tid: new T("int64", i64(ids), [1, L]),
        tmask: new T("bool", new Uint8Array(L).fill(1), [1, L]),
        g: new T("float32", g, [1, g.length]),
      });
      const logits = Float32Array.from(out.logits.data as Float32Array);
      out.logits.dispose();
      return logits;
    },
    async velocity(x, tau, cid, k, d, enc): Promise<Float32Array> {
      const n = cid.length;
      const out = await s.velocity.run({
        x: new T("float32", x, [1, n, ROW]),
        tau: new T("float32", Float32Array.from([tau]), [1]),
        mask: new T("bool", new Uint8Array(n).fill(1), [1, n]),
        cid: new T("int64", i64(cid), [1, n]),
        k: new T("int64", i64(k), [1, n]),
        d: new T("int64", i64(d), [1, n]),
        mem: enc.mem,
        valid: enc.valid,
        g: enc.gTensor,
      });
      const v = Float32Array.from(out.v.data as Float32Array);
      out.v.dispose();
      return v;
    },
  };
}
