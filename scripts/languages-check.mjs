// What each interface language lacks, against the English tables.
//
//   npm run languages:check                      one line per language
//   npm run languages:check -- --missing <dir>   also <dir>/<code>.json: the
//                                                English of every key that
//                                                language lacks, to translate
//   npm run languages:check -- --english <dir>   <dir>/<area>.json: all of
//                                                English, by area
//
// English lives in TypeScript (src/i18n/en), so it is bundled in memory with
// esbuild and imported from a data URL. Exits 1 when a table has a key
// English does not (a renamed key left behind), or a plural form that stands
// for several numbers without {count}; missing keys are only listed.
import esbuild from "esbuild";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? path.resolve(args[i + 1]) : null;
};

const bundle = await esbuild.build({
  entryPoints: [path.join(root, "src/i18n/en/index.ts")],
  bundle: true,
  write: false,
  format: "esm",
  logLevel: "silent",
});
const { EN, AREAS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const PLURAL = /\.(zero|one|two|few|many|other)$/;
const english = new Set(Object.keys(EN));
const pluralBases = new Set(
  [...english].filter((k) => k.endsWith(".other")).map((k) => k.slice(0, -6)),
);
const baseOf = (key) => {
  const base = key.replace(PLURAL, "");
  return base !== key && pluralBases.has(base) ? base : null;
};
const isKnown = (key) => english.has(key) || baseOf(key) !== null;

const englishDir = option("--english");
if (englishDir) {
  mkdirSync(englishDir, { recursive: true });
  for (const [area, table] of Object.entries(AREAS)) {
    writeFileSync(path.join(englishDir, `${area}.json`), JSON.stringify(table, null, 1) + "\n");
  }
}

// The plural forms of `code` that more than one whole number selects. Each
// must write {count} when English's .other does: Russian's "one" is also 21
// and 101, so a literal 1 there is wrong. English's one and Arabic's zero,
// one and two stand for a single number and may spell it out.
const manyNumberForms = (code) => {
  const rules = new Intl.PluralRules(code);
  const seen = new Map();
  const numbers = [...Array(1001).keys(), 1e6, 2e6, 1e7];
  for (const n of numbers) {
    const form = rules.select(n);
    seen.set(form, (seen.get(form) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([form]) => form));
};
const hasCount = (text) => /\{count\}/.test(text);
const countless = (code, table) => {
  const many = manyNumberForms(code);
  return Object.keys(table).filter((key) => {
    const base = baseOf(key);
    const form = key.slice(key.lastIndexOf(".") + 1);
    if (!base || !many.has(form)) return false;
    return hasCount(EN[`${base}.other`]) && !hasCount(table[key]);
  });
};

const dir = path.join(root, "src/i18n/locales");
const missingDir = option("--missing");
if (missingDir) mkdirSync(missingDir, { recursive: true });
let stale = 0;
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
  : [];
for (const file of files) {
  const code = file.slice(0, -5);
  const table = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
  const extra = Object.keys(table).filter((k) => !isKnown(k));
  // A plural set counts as there when the language has any of its forms:
  // languages need different ones.
  const present = (key) => {
    const base = baseOf(key);
    return base
      ? Object.keys(table).some((k) => baseOf(k) === base)
      : typeof table[key] === "string";
  };
  const missing = [...english].filter((k) => !present(k));
  const noCount = countless(code, table);
  stale += extra.length + noCount.length;
  console.log(
    `${code.padEnd(6)} ${String(english.size - missing.length).padStart(5)}/${english.size}` +
      (missing.length ? `  missing ${missing.length}` : "") +
      (extra.length ? `  UNKNOWN ${extra.length}: ${extra.slice(0, 5).join(", ")}` : ""),
  );
  for (const key of noCount) console.log(`       NO {count}: ${key}: ${table[key]}`);
  if (missingDir && missing.length) {
    writeFileSync(
      path.join(missingDir, `${code}.json`),
      JSON.stringify(Object.fromEntries(missing.map((k) => [k, EN[k]])), null, 1) + "\n",
    );
  }
}
if (files.length === 0) console.log(`no translations yet; English has ${english.size} keys`);
process.exit(stale ? 1 : 0);
