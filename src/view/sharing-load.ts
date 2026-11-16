/* global __FINENOTES_SHARING__, __FINENOTES_SHARING_ENDPOINT__ -- defined by esbuild.config.mjs */
/**
 * "Help improve Grape", when this build has it: the feature, or null. The
 * `define` makes the condition a constant at build time, so a build
 * without it drops the `import()` and every module only it reaches
 * (ledger, 2026-10-07: an imported constant would not). A build with it
 * also needs a server address from the builder's environment; the
 * repository names none.
 */
import type { SharingFeature, SharingHost } from "./sharing-feature";

/** Whether this build has the feature: the settings row is defined only then. */
export const SHARING_BUILT =
  typeof __FINENOTES_SHARING__ !== "undefined" &&
  __FINENOTES_SHARING__ &&
  typeof __FINENOTES_SHARING_ENDPOINT__ !== "undefined" &&
  __FINENOTES_SHARING_ENDPOINT__ !== "";

export async function loadSharing(host: SharingHost): Promise<SharingFeature | null> {
  if (typeof __FINENOTES_SHARING__ !== "undefined" && __FINENOTES_SHARING__ && SHARING_BUILT) {
    const { GrapeSharing } = await import("./grape-sharing");
    return new GrapeSharing(host);
  }
  return null;
}
