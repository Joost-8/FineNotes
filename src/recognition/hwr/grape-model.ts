/**
 * Grape (the handwriting recognizer model) as this build expects it: the
 * file published at Joost-8/Grape, pinned by size and SHA-256, and the model
 * format this build reads (bundle.ts). Downloaded on first use
 * (downloads/model-store.ts) into the plugin's `handwriting/` folder.
 *
 * PURE: data only.
 */

import type { ModelAsset } from "../../downloads/model-manifest";
import { BUNDLE_FORMAT_INPUT, BUNDLE_FORMAT_POINTS } from "./bundle";

/** Grape 1.0, as published at Joost-8/Grape (Apache 2.0). */
export const GRAPE_MODEL: ModelAsset = {
  id: "grape",
  label: "Grape (handwriting recognizer model)",
  purpose:
    "It reads your handwriting on this device for search, titles and links; what you " +
    "write never leaves the device.",
  version: "1.0",
  format: BUNDLE_FORMAT_POINTS,
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

/**
 * Grape 2 (preview): a 6x256 network on Bezier curves (curves.ts), trained
 * on Grape 1.0's data. Opt-in, in Settings › Handwriting; Grape 1.0 stays
 * the default. Its own folder, so neither store takes the other's file for
 * one of its older versions. Until it is published the download answers 404.
 */
export const GRAPE2_MODEL: ModelAsset = {
  id: "grape-2",
  label: "Grape 2 (preview)",
  purpose:
    "A larger handwriting reader, in preview: it reads small, quick note writing better " +
    "than Grape 1.0, a little slower. What you write never leaves the device.",
  version: "2.0-preview",
  format: BUNDLE_FORMAT_INPUT,
  folder: "handwriting/grape-2",
  files: [
    {
      name: "grape-2.0-preview.bin",
      url: "https://github.com/Joost-8/Grape/releases/download/v2.0-preview/grape-2.0-preview.bin",
      bytes: 10_316_108,
      sha256: "c92d2e4063049b4a007e0195e960957fd92802f340f90fc47152d3bf6b2230b8",
    },
  ],
  prefix: "grape-",
  suffix: ".bin",
};

/** Which Grape reads handwriting (Settings › Handwriting). */
export type GrapeChoice = "grape" | "grape-2";

/** The model a choice names; anything unknown is Grape 1.0. */
export function grapeAsset(choice: GrapeChoice | undefined): ModelAsset {
  return choice === "grape-2" ? GRAPE2_MODEL : GRAPE_MODEL;
}
