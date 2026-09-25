import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { copyArtifacts, resolveDeployDir } from "./scripts/deploy-target.mjs";

const banner = `/*
GoodObsidian — bundled plugin output. Do not edit directly.
Source: https://github.com/Joost-8/GoodObsidian
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
  // CHANGELOG.md is bundled as text for the in-app "What's new" modal.
  loader: { ".md": "text" },
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
  plugins: [deployPlugin],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
