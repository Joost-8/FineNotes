// Bundle the gallery against the plugin's real sources, with `obsidian`
// swapped for the stub. `--watch` rebuilds on change.
//
//   node scripts/ui-gallery/build.mjs [--watch]
import esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

// Harness-only instrumentation: tag each canvas with what was painted on it,
// so an export can repaint it from a few bytes of JSON instead of shipping
// pixels. The sources on disk are untouched; this rewrites them in memory.
const tagPaint = {
  name: "gallery-tag-paint",
  setup(build) {
    build.onLoad({ filter: /src[\\/]canvas[\\/](backdrop|renderer)\.ts$/ }, async (args) => {
      let src = await readFile(args.path, "utf8");
      const wrap = (name, tag) => {
        const decl = `export function ${name}(`;
        if (!src.includes(decl)) throw new Error(`gallery: ${name} not found in ${args.path}`);
        src = src.replace(decl, `function __gallery_${name}(`);
        src +=
          `\nexport function ${name}(...a: Parameters<typeof __gallery_${name}>): ReturnType<typeof __gallery_${name}> {\n` +
          `  const tag = (globalThis as any).__galleryTag;\n` +
          `  tag?.(${JSON.stringify(tag)}, a, "begin");\n` +
          `  try {\n    return __gallery_${name}(...a);\n  } finally {\n    tag?.(${JSON.stringify(tag)}, a, "end");\n  }\n}\n`;
      };
      if (args.path.endsWith("backdrop.ts")) wrap("drawSynthetic", "synthetic");
      else wrap("renderPageThumbnail", "thumbnail");
      return { contents: src, loader: "ts" };
    });
  },
};

const options = {
  entryPoints: [path.join(here, "gallery.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  sourcemap: "inline",
  outfile: path.join(here, "out/gallery.js"),
  alias: { obsidian: path.join(here, "obsidian-stub.ts") },
  absWorkingDir: repo,
  loader: { ".md": "text" },
  define: { __GOODOBSIDIAN_BUILD__: '"gallery"' },
  plugins: [tagPaint],
  logLevel: "warning",
};

// The page painter shipped with exported snapshots: the real ruling table,
// small enough to upload as text. Not minified: it is uploaded as text and
// read back line by line.
const paper = {
  entryPoints: [path.join(here, "paper.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: path.join(here, "out/export/paper.js"),
  absWorkingDir: repo,
  legalComments: "none",
  logLevel: "warning",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching…");
} else {
  await esbuild.build(options);
  await esbuild.build(paper);
  console.log("built out/gallery.js and out/export/paper.js");
}
