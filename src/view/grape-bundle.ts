/* global __FINENOTES_BUNDLE_GRAPE__ -- defined by esbuild.config.mjs (BUNDLE_GRAPE) */
/**
 * Grape's bytes as bundled in main.js, in a build that still bundles it
 * (`BUNDLE_GRAPE` in esbuild.config.mjs); null in one that does not. The
 * `define` makes the condition a constant, so a build without the bundle
 * drops the import and the 5.7 MB with it.
 *
 * The bundle is base64 text, decoded here. esbuild's own `binary` loader
 * hands a dynamic import a Uint8Array, and its CommonJS wrapper (`__toESM`)
 * then defines a getter for every one of its 5.7 million indexes: 5 s of
 * blocked main thread on a laptop, at every start-up (ledger, 2026-10-22).
 */
import { strToU8 } from "fflate";

/** Whether this build bundles Grape. */
export const GRAPE_BUNDLED =
  typeof __FINENOTES_BUNDLE_GRAPE__ !== "undefined" && __FINENOTES_BUNDLE_GRAPE__;

export async function bundledGrape(): Promise<ArrayBuffer | null> {
  if (typeof __FINENOTES_BUNDLE_GRAPE__ !== "undefined" && __FINENOTES_BUNDLE_GRAPE__) {
    const { default: base64 } = await import("../../models/grape-2.0.bin");
    // A new buffer of its own: the caller may hand it to a worker.
    return strToU8(atob(base64), true).buffer;
  }
  return null;
}
