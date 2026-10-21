/**
 * Grape (the handwriting recognizer model) as this build expects it: the
 * file published at Joost-8/Grape, pinned by size and SHA-256, and the model
 * format this build reads (bundle.ts). Downloaded on first use
 * (downloads/model-store.ts) into the plugin's `handwriting/grape-2/`
 * folder, or written there from the copy built into main.js
 * (view/grape-bundle.ts).
 *
 * PURE: data only.
 */

import type { ModelAsset } from "../../downloads/model-manifest";
import { BUNDLE_FORMAT_INPUT } from "./bundle";

/**
 * Grape 2.0, as published at Joost-8/Grape (Apache 2.0): a 5x192 network on
 * Bezier curves (curves.ts). Its folder and id keep the names the first
 * Grape 2 build used, so what a writer learned from it stays where it is.
 */
export const GRAPE_MODEL: ModelAsset = {
  id: "grape-2",
  label: "Grape (handwriting recognizer model)",
  purpose:
    "It reads your handwriting on this device for search, titles and links; what you " +
    "write never leaves the device.",
  version: "2.0",
  format: BUNDLE_FORMAT_INPUT,
  folder: "handwriting/grape-2",
  files: [
    {
      name: "grape-2.0.bin",
      url: "https://github.com/Joost-8/Grape/releases/download/v2.0/grape-2.0.bin",
      bytes: 5_687_620,
      sha256: "f553c71367e8881f2918c9a34a44b3f215a54e86b39d6547ff885aede1fa6d04",
    },
  ],
  prefix: "grape-",
  suffix: ".bin",
};
