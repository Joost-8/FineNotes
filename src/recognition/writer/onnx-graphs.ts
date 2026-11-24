/**
 * A writer model's ONNX graphs behind a {@link GraphRunner}, for
 * onnxruntime-web: inputs and outputs by position, the tensor names from
 * the model's manifest. The ORT module is handed in, so the worker (which
 * bundles `onnxruntime-web/wasm`) and laptop checks share this code.
 */

import type * as Ort from "onnxruntime-web/wasm";
import type { GraphRunner, Tensorish } from "./kinds";
import type { WriterManifest } from "./manifest";

type OrtModule = Pick<typeof Ort, "Tensor">;

/** A tensor the runner made, kept as ORT's so it can go back in without a copy. */
const handles = new WeakMap<Tensorish, Ort.Tensor>();

export function ortRunner(
  ort: OrtModule,
  sessions: ReadonlyMap<string, Ort.InferenceSession>,
  m: WriterManifest,
): GraphRunner {
  return async (role, inputs) => {
    const session = sessions.get(role);
    const spec = m.graphs[role];
    if (!session || !spec) throw new Error(`the model has no ${role} graph`);
    if (inputs.length !== spec.inputs.length)
      throw new Error(`${role}: ${inputs.length} inputs given`);
    const feeds: Record<string, Ort.Tensor> = {};
    spec.inputs.forEach((s, i) => {
      const t = inputs[i];
      if (t.type !== s.type) throw new Error(`${role}: ${s.role} is ${s.type}, given ${t.type}`);
      feeds[s.name] = handles.get(t) ?? new ort.Tensor(t.type, t.data, t.dims);
    });
    const out = await session.run(feeds);
    return spec.outputs.map((s) => {
      const tensor = out[s.name];
      if (!tensor) throw new Error(`${role}: no output ${s.name}`);
      const t: Tensorish = {
        type: s.type,
        data: tensor.data as Tensorish["data"],
        dims: [...tensor.dims],
      };
      handles.set(t, tensor);
      return t;
    });
  };
}
