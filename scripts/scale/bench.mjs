// Build and run the scale benchmark (tests/bench/scale-bench.ts) under Node.
//
//   npm run bench:scale [-- --full] [-- --sizes 100,500 --density dense]
//
// The bundle and the generated PDFs land in scripts/scale/out/ (gitignored).
// Node gets a large heap and an exposed gc, so heap figures are after a
// collection; see the benchmark's header for what it measures.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outfile = path.join(root, "scripts/scale/out/scale-bench.mjs");
await build({
  entryPoints: [path.join(root, "tests/bench/scale-bench.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "warning",
});
const run = spawnSync(
  process.execPath,
  ["--expose-gc", "--max-old-space-size=12000", outfile, ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root },
);
process.exit(run.status ?? 1);
