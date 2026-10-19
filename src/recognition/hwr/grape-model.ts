/**
 * Grape (the handwriting recognizer model) as this build expects it: the
 * file published at Joost-8/Grape, pinned by size and SHA-256, and the model
 * format this build reads (bundle.ts). Downloaded on first use
 * (downloads/model-store.ts) into the plugin's `handwriting/` folder.
 *
 * PURE: data only.
 */

import type { ModelAsset } from "../../downloads/model-manifest";
import { BUNDLE_FORMAT } from "./bundle";

/** Grape 1.0, as published at Joost-8/Grape (Apache 2.0). */
export const GRAPE_MODEL: ModelAsset = {
  id: "grape",
  label: "Grape (handwriting recognizer model)",
  purpose:
    "It reads your handwriting on this device for search, titles and links; what you " +
    "write never leaves the device.",
  version: "1.0",
  format: BUNDLE_FORMAT,
  folder: "handwriting",
  files: [
    {
      name: "grape-1.0.bin",
      url: "https://github.com/Joost-8/Grape/releases/download/v1.0/grape-1.0.bin",
      bytes: 3_500_236,
      sha256: "87a9ddd56b6bcf01e66a027ff74f1b8ba9a58fe0d4b0077e6abb6455710d21f9",
    },
  ],
  prefix: "grape-",
  suffix: ".bin",
};
