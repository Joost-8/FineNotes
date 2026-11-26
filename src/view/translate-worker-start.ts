/**
 * Starts the translation worker: Mozilla's two glue files
 * (src/translate/vendor) followed by translate-worker.ts, as one Blob.
 * Imported only when a translation runs (translator.ts), so the build's
 * `worker:` and `.txt` imports never reach a module the tests load.
 */

import workerSource from "worker:../translate/translate-worker";
import bergamotGlue from "../translate/vendor/bergamot-translator.txt";
import fasttextGlue from "../translate/vendor/fasttext-wasm.txt";

/** A new worker, and the Blob URL to revoke when it is let go. */
export function startTranslateWorker(): { worker: Worker; url: string } {
  const url = URL.createObjectURL(
    new Blob([bergamotGlue, "\n;\n", fasttextGlue, "\n;\n", workerSource], {
      type: "text/javascript",
    }),
  );
  return { worker: new Worker(url), url };
}
