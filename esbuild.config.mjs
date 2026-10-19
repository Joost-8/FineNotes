import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";
import { copyArtifacts, resolveDeployDir } from "./scripts/deploy-target.mjs";

const banner = `/*
FineNotes — bundled plugin output. Do not edit directly.
Source: https://github.com/Joost-8/FineNotes
FineNotes is licensed under the GNU General Public License v3.0 or later.

${readFileSync(new URL("./THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8")}
*/`;

const production = process.argv[2] === "production";
const deployDir = resolveDeployDir();
// A stamp for the deploy log below, so each copy into the vault can be told
// apart. It is not bundled: a release rebuilt from its tag stays
// byte-identical, which the community-directory review checks.
const now = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const buildId = production
  ? "release"
  : `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
    `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;

// Copy artifacts into the configured vault plugin folder after each successful
// build. In watch mode this fires on every rebuild, giving an edit -> vault
// (-> iCloud -> iPad) loop.
const deployPlugin = {
  name: "finenotes-deploy",
  setup(build) {
    build.onEnd((result) => {
      if (!deployDir || result.errors.length > 0) return;
      copyArtifacts(deployDir);
      console.log(`[finenotes] deployed ${buildId} → ${deployDir}`);
    });
  },
};

// `import source from "worker:./worker"` gives the module bundled on its own
// as a string, to start as a Web Worker from a Blob URL (src/build.d.ts).
const inlineWorker = {
  name: "finenotes-inline-worker",
  setup(build) {
    build.onResolve({ filter: /^worker:/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice("worker:".length)),
      namespace: "inline-worker",
    }));
    build.onLoad({ filter: /.*/, namespace: "inline-worker" }, async (args) => {
      const entry = /\.[cm]?[jt]s$/.test(args.path) ? args.path : `${args.path}.ts`;
      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: "iife",
        target: "es2020",
        minify: production,
        metafile: true,
        logLevel: "silent",
      });
      return {
        contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
        loader: "js",
        watchFiles: Object.keys(result.metafile.inputs).map((file) => resolve(file)),
      };
    });
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  format: "cjs",
  target: "es2020",
  // CHANGELOG.md is bundled as text for the in-app "What's new" modal. The
  // handwriting model is not bundled: it downloads on first use
  // (src/recognition/hwr/model-manifest.ts).
  loader: { ".md": "text" },
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
  plugins: [inlineWorker, deployPlugin],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
