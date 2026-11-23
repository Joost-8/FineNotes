// Build the pool that drawn practice sheets take their lines from
// (src/recognition/practice-pool.ts). Five kinds:
//
// - prose: sentences from Mozilla Common Voice's sentence collection (CC0,
//   public domain), 20 to 40 characters, every longer word in the public
//   word list FineNotes already ships (words.txt), so archaic or rare words
//   stay out. Never anything from a vault;
// - notes: note-like lines made here (dates, times, rooms, units, courses);
// - sums: arithmetic with the right answer, many 1s and 7s;
// - caps: capitals in ordinary sentences (names for every letter, places,
//   days, months), plus acronyms and course codes;
// - signs: short lines with the signs people write by hand (√ π ≤ ≥ ≠ ± ° →
//   and α β θ Δ); nothing rarer.
//
// Deterministic: the same inputs give the same file. The pool is append-only
// once a version ships: a sheet stores its lines' ids, and the rig checks a
// shared line against the pool (research/handwriting-rig/donations.py).
//
// Usage: node scripts/build-practice-pool.mjs <cv-sentences.txt> <words.txt> [out.ts]
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [cvFile, wordsFile, outFile = "src/recognition/practice-pool.ts"] = process.argv.slice(2);
if (!cvFile || !wordsFile) {
  console.error(
    "usage: node scripts/build-practice-pool.mjs <cv-sentences.txt> <words.txt> [out.ts]",
  );
  process.exit(1);
}

const VERSION = 1;
const SIZES = { prose: 1500, notes: 600, sums: 600, caps: 600, signs: 300 };

/** A seeded generator (mulberry32), so templates come out the same every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (text) => createHash("sha256").update(text).digest("hex");

// --- prose --------------------------------------------------------------

const words = new Set(
  readFileSync(wordsFile, "utf8")
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean),
);
/** Words a sheet given to strangers should not ask anyone to copy. */
const AVOID =
  /\b(kill|killed|killing|murder|dead|death|die|died|blood|gun|guns|war|sex|sexy|drunk|drug|drugs|naked|hate|hell|damn|god|gospel|jesus|christ|church|bible|pray|suicide|rape|slave|slaves|nazi|bomb|stupid|idiot|fat|ugly|black|white|race|religion|muslim|jew|jewish|christian|catholic|protestant|presbyterian|baptist|methodist|priest|bishop|pope|mosque|temple|saint|holy|heaven|sin|politics|political|president|trump|biden|corpse|grave|weapon|knife|beer|wine|whisky|smoke|cigarette|naughty|kiss|lover|shoot|shot|deadly)\b/i;

const prose = [];
const seen = new Set();
for (const raw of readFileSync(cvFile, "utf8").split(/\r?\n/)) {
  const line = raw.trim().replace(/\s+/g, " ");
  if (line.length < 20 || line.length > 40) continue;
  if (!/^[A-Z]/.test(line)) continue; // no dialogue openings, no fragments
  if (!/^[\x20-\x7e]+$/.test(line)) continue; // Grape's alphabet: printable ASCII
  if (/["]/.test(line) || /\bsaid\b/i.test(line)) continue;
  if (AVOID.test(line)) continue;
  const tokens = line.match(/[A-Za-z]+(?:'[a-z]+)?/g) ?? [];
  if (tokens.length < 4) continue;
  // Every word of 4 letters or more is a current word; names (capitalised
  // mid-sentence) are allowed only when the list has them too.
  if (!tokens.every((w) => w.length < 4 || words.has(w.toLowerCase()))) continue;
  const key = line.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  prose.push(line);
}
prose.sort((a, b) => (hash(a) < hash(b) ? -1 : 1));
prose.length = Math.min(prose.length, SIZES.prose);

// --- templates ----------------------------------------------------------

const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
/** A number with a fair share of 1s and 7s, the pair that is misread most. */
const n17 = (r, lo, hi) => {
  if (r() < 0.45) {
    const digits = String(int(r, lo, hi)).split("");
    const i = Math.floor(r() * digits.length);
    digits[i] = r() < 0.5 ? "1" : "7";
    if (digits[0] === "0") digits[0] = "7";
    const n = Number(digits.join(""));
    // Never outside the range asked for: a divisor of 2 to 17 must not become 1.
    if (n >= lo && n <= hi) return n;
  }
  return int(r, lo, hi);
};
const pad = (n) => String(n).padStart(2, "0");

const DAYS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];
const MONTHS = [
  "Jan",
  "Feb",
  "March",
  "April",
  "May",
  "June",
  "July",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
];
const COURSES = [
  "linear algebra",
  "calculus",
  "statistics",
  "chemistry",
  "physics",
  "biology",
  "economics",
  "databases",
  "networks",
  "algorithms",
  "history",
  "psychology",
  "anatomy",
  "thermodynamics",
  "signals",
  "mechanics",
  "genetics",
  "marketing",
  "philosophy",
  "geography",
];
const THINGS = [
  "slides",
  "notes",
  "laptop",
  "charger",
  "calculator",
  "ID card",
  "USB stick",
  "lab coat",
  "textbook",
  "headphones",
];
const UNITS = ["kg", "g", "km", "m", "cm", "mm", "ml", "L", "kWh", "MB", "GB", "ms", "Hz", "mol"];
const notesTemplates = [
  (r) =>
    `Lab ${n17(r, 1, 9)}${pick(r, ["A", "B", "C"])} moved to ${pick(r, DAYS)} ${pad(int(r, 8, 17))}:${pick(r, ["00", "15", "30", "45"])}`,
  (r) => `Read pp. ${n17(r, 10, 200)}-${n17(r, 201, 400)} before ${pick(r, DAYS)}`,
  (r) =>
    `Room ${pick(r, ["A", "B", "C", "D", "F", "K"])}-${n17(r, 100, 499)}, ${n17(r, 1, 28)} ${pick(r, MONTHS)}`,
  (r) => `Exam on ${n17(r, 1, 28)} ${pick(r, MONTHS)}: ch. ${n17(r, 1, 9)} to ${n17(r, 10, 17)}`,
  (r) => `Bring the ${pick(r, THINGS)} to ${pick(r, COURSES)}`,
  (r) => `Quiz ${n17(r, 1, 12)} in week ${n17(r, 1, 17)}, ${pick(r, COURSES)}`,
  (r) => `Email the TA about Q${n17(r, 1, 17)} by ${pick(r, DAYS)}`,
  (r) =>
    `${n17(r, 2, 90)} ${pick(r, UNITS)} per ${pick(r, ["day", "hour", "week", "trial"])}, see table ${n17(r, 1, 9)}`,
  (r) =>
    `Deadline ${2026 + int(r, 0, 1)}-${pad(n17(r, 1, 12))}-${pad(n17(r, 1, 28))} at ${pad(int(r, 9, 23))}:59`,
  (r) =>
    `Ex. ${n17(r, 1, 17)}${pick(r, ["a", "b", "c", "d"])} and ${n17(r, 1, 17)}${pick(r, ["a", "b", "c"])} for ${pick(r, DAYS)}`,
  (r) =>
    `Office hours ${pick(r, DAYS.slice(0, 5))} ${((h) => `${pad(h)}-${pad(h + int(r, 1, 3))}`)(int(r, 9, 15))}, room ${n17(r, 100, 799)}`,
  (r) => `Score: ${n17(r, 1, 17)}/${n17(r, 18, 20)} on the ${pick(r, COURSES)} test`,
  (r) => `Recap ${pick(r, COURSES)}, lecture ${n17(r, 1, 17)} (part ${n17(r, 1, 3)})`,
  (r) => `Buy ${n17(r, 2, 12)} pens, ${int(r, 2, 7)} pads & tape`,
  (r) =>
    `Train at ${pad(int(r, 6, 22))}:${pad(n17(r, 0, 59))}, platform ${n17(r, 1, 17)}${pick(r, ["a", "b", ""])}`,
  (r) =>
    `Pay ${pick(r, ["$", "EUR "])}${n17(r, 5, 99)}.${pad(n17(r, 0, 99))} by ${n17(r, 1, 28)} ${pick(r, MONTHS)}`,
  (r) =>
    `Call ${pick(r, ["Ana", "Sam", "Jo", "Kim", "Lee", "Max", "Eva", "Tom"])} at ${pad(int(r, 9, 21))}:${pick(r, ["00", "15", "30", "45"])}?`,
  (r) => `#todo: redo ${pick(r, COURSES)} sheet ${n17(r, 1, 17)}`,
  (r) => `See [[${pick(r, ["Week", "Lecture", "Lab", "Chapter"])} ${n17(r, 1, 17)}]] for the proof`,
  (r) => `v = ${n17(r, 10, 99)} m/s, t = ${n17(r, 1, 17)} s, a = ?`,
];

const sumsTemplates = [
  (r) => {
    const a = n17(r, 2, 99),
      b = n17(r, 2, 99);
    return `${a} + ${b} = ${a + b}`;
  },
  (r) => {
    const a = n17(r, 20, 199),
      b = n17(r, 1, a - 1);
    return `${a} - ${b} = ${a - b}`;
  },
  (r) => {
    const a = n17(r, 2, 19),
      b = n17(r, 2, 19);
    return `${a} * ${b} = ${a * b}`;
  },
  (r) => {
    const b = n17(r, 2, 17),
      q = n17(r, 2, 19);
    return `${b * q} / ${b} = ${q}`;
  },
  (r) => {
    const a = n17(r, 2, 29),
      b = n17(r, 2, 17),
      c = n17(r, 2, 9);
    return `(${a} - ${b}) * ${c} = ${(a - b) * c}`;
  },
  (r) => {
    const a = n17(r, 2, 9),
      e = int(r, 2, 5);
    return `${a}^${e} = ${a ** e}`;
  },
  (r) => {
    const p = pick(r, [10, 15, 20, 25, 50, 75]),
      b = 4 * n17(r, 2, 50);
    return `${p}% of ${b} = ${(p * b) / 100}`;
  },
  (r) => {
    const x = n17(r, 1, 17),
      a = n17(r, 2, 9),
      b = n17(r, 1, 30);
    return `${a}x + ${b} = ${a * x + b}, so x = ${x}`;
  },
  (r) => {
    const a = n17(r, 1, 9) + n17(r, 0, 99) / 100,
      b = n17(r, 1, 9) + n17(r, 0, 99) / 100;
    return `${a.toFixed(2)} + ${b.toFixed(2)} = ${(a + b).toFixed(2)}`;
  },
  (r) => {
    const d = pick(r, [2, 3, 4, 5, 6, 7, 8]),
      a = n17(r, 1, d - 1);
    return `${a}/${d} + ${d - a}/${d} = 1`;
  },
  (r) => {
    const a = n17(r, 11, 99);
    return `${a} * 11 = ${a * 11}`;
  },
  (r) => {
    const a = n17(r, 2, 17),
      b = n17(r, 2, 17);
    return `${a}^2 - ${b}^2 = ${a * a - b * b}`;
  },
  (r) => {
    const a = n17(r, 100, 999),
      b = n17(r, 100, 999);
    return `${a} + ${b} = ${a + b}`;
  },
  (r) => {
    const a = n17(r, 2, 9),
      b = n17(r, 2, 9),
      c = n17(r, 2, 9);
    return `${a} + ${b} * ${c} = ${a + b * c}`;
  },
  (r) => {
    const a = n17(r, 1, 7);
    return `${a} * 7 + 1 = ${a * 7 + 1}, ${a} * 17 = ${a * 17}`;
  },
];

const PLACES = [
  "Quebec",
  "Zurich",
  "Oslo",
  "Kyoto",
  "Vienna",
  "Quito",
  "Jakarta",
  "Yerevan",
  "Valencia",
  "Utrecht",
  "Helsinki",
  "Zagreb",
  "Kenya",
  "Iceland",
  "Jordan",
  "Wales",
  "Yukon",
  "Xiamen",
  "Galway",
  "Brno",
];
/** First names, several for every capital, from many languages. */
const NAMES = [
  "Ada",
  "Amir",
  "Ben",
  "Bea",
  "Chen",
  "Clara",
  "Dev",
  "Dina",
  "Emma",
  "Eli",
  "Femi",
  "Fay",
  "Gus",
  "Grace",
  "Hana",
  "Hugo",
  "Ines",
  "Ivan",
  "Jack",
  "Jade",
  "Kai",
  "Kemi",
  "Lena",
  "Luis",
  "Max",
  "Mia",
  "Nora",
  "Nils",
  "Omar",
  "Olivia",
  "Priya",
  "Paul",
  "Quinn",
  "Qiu",
  "Ravi",
  "Rosa",
  "Sofia",
  "Sam",
  "Tom",
  "Tara",
  "Uma",
  "Ugo",
  "Vera",
  "Viktor",
  "Wen",
  "Will",
  "Xavi",
  "Xena",
  "Yara",
  "Yusuf",
  "Zoe",
  "Zane",
];
const MORE_PLACES = [
  "Amsterdam",
  "Berlin",
  "Cairo",
  "Dublin",
  "Eindhoven",
  "Florence",
  "Ghent",
  "Lisbon",
  "Madrid",
  "Nairobi",
  "Paris",
  "Rome",
  "Seoul",
  "Toronto",
  "Lima",
];
const ALL_PLACES = [...PLACES, ...MORE_PLACES];
const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** Two different items of `list`. */
const two = (r, list) => {
  const a = pick(r, list);
  let b = pick(r, list);
  while (b === a) b = pick(r, list);
  return [a, b];
};
const capsTemplates = [
  (r) => `${two(r, NAMES).join(" and ")} live in ${pick(r, ALL_PLACES)}.`,
  (r) => `${two(r, NAMES).join(" meets ")} on ${pick(r, WEEKDAY)}.`,
  (r) =>
    `Ask ${pick(r, NAMES)} about the ${pick(r, ["VAT", "RSVP", "ID", "PDF", "FAQ"])} in ${pick(r, MONTH)}.`,
  (r) => `${pick(r, NAMES)} flew from ${two(r, ALL_PLACES).join(" to ")}.`,
  (r) => `Dear ${pick(r, NAMES)}, see you in ${pick(r, ALL_PLACES)}!`,
  (r) => {
    const [code, course] = pick(r, [
      ["MATH", "Calculus"],
      ["MATH", "Linear Algebra"],
      ["PHYS", "Mechanics"],
      ["CHEM", "Organic Chemistry"],
      ["BIO", "Genetics"],
      ["ECON", "Economics"],
      ["HIST", "History"],
      ["CS", "Algorithms"],
      ["EE", "Signals"],
      ["STAT", "Statistics"],
      ["PSY", "Psychology"],
    ]);
    return `${code} ${n17(r, 1000, 4999)}: ${course}`;
  },
  (r) => `Trip to ${two(r, ALL_PLACES).join(" via ")} (${pick(r, MONTHS)})`,
  (r) => `The ${pick(r, ["UN", "EU", "WHO", "NASA"])} office in ${pick(r, ALL_PLACES)} is closed.`,
  (r) =>
    `Dr. ${pick(r, NAMES)} at ${pick(r, ["MIT", "UCL", "ETH", "TU/e", "KTH", "UvA"])} on ${pick(r, WEEKDAY)}`,
  (r) =>
    `THE ${pick(r, ["QUIZ", "EXAM", "LAB", "TALK", "DEMO"])} IS ON ${pick(r, ["MONDAY", "FRIDAY", "JUNE 7", "MAY 17"])}`,
  (r) => `${pick(r, ALL_PLACES)}, ${pick(r, ALL_PLACES)} and ${pick(r, ALL_PLACES)}`,
];

// Only the signs people write by hand in everyday notes: roots, pi,
// comparisons, plus-minus, degrees, arrows, and a few Greek letters from
// school maths. No sums, integrals, set signs or rarer Greek.
const GREEK = ["α", "β", "θ", "Δ"];
const signsTemplates = [
  (r) => {
    const a = n17(r, 2, 17);
    return `√${a * a} = ${a} and ${a} ≤ ${a + n17(r, 1, 9)}`;
  },
  (r) => `π ≈ 3.14, so 2π ≈ 6.28`,
  (r) => `x ≤ ${n17(r, 1, 17)} and y ≥ -${n17(r, 1, 9)}`,
  (r) => `a ≠ b, so a - b ≠ 0`,
  (r) => `x = ${n17(r, 1, 17)} ± ${n17(r, 1, 9)}`,
  (r) => `${pick(r, GREEK.slice(0, 3))} = ${pick(r, [30, 45, 60, 90, 120])}°`,
  (r) => `Δx = ${n17(r, 1, 17)} cm, Δt = ${n17(r, 1, 9)} s`,
  (r) => `${n17(r, 1, 9)} ≤ √x ≤ ${n17(r, 10, 17)}`,
  (r) => `θ ≈ ${n17(r, 10, 79)}°, so cos θ > 0`,
  (r) => `It was ${n17(r, 2, 31)}°C at ${pad(int(r, 6, 22))}:00`,
  (r) => `heat → water → steam (${n17(r, 100, 117)}°)`,
  (r) => `${n17(r, 17, 77)}° ± ${n17(r, 1, 7)}°`,
  (r) => `area = π r^2 ≈ ${n17(r, 3, 77)}.${n17(r, 0, 9)} cm^2`,
  (r) => `α + β = ${pick(r, [90, 180])}°`,
];

/**
 * A sum nobody would write: an answer of 0, times, divided or raised by 1,
 * or the same number taken from itself ("7^2 - 7^2").
 */
function trivial(line) {
  if (/= 0\b/.test(line)) return true;
  if (/[*/^] 1\b|[*/^]1\b|\b1 [*/]|\b1\^/.test(line)) return true;
  const same = /\b(\d+)(\^\d)? - \1\2\b/.exec(line);
  return same !== null;
}

/** `size` distinct lines from `templates`, seeded per kind. */
function generate(kind, templates, size) {
  const r = rng(Number.parseInt(hash(kind).slice(0, 8), 16));
  const out = [];
  const have = new Set();
  for (let tries = 0; out.length < size && tries < size * 200; tries++) {
    const line = templates[tries % templates.length](r).replace(/\s+/g, " ").trim();
    if (line.length > 44 || have.has(line)) continue;
    if (kind === "sums" && trivial(line)) continue;
    have.add(line);
    out.push(line);
  }
  return out;
}

const pool = {
  prose,
  notes: generate("notes", notesTemplates, SIZES.notes),
  sums: generate("sums", sumsTemplates, SIZES.sums),
  caps: generate("caps", capsTemplates, SIZES.caps),
  signs: generate("signs", signsTemplates, SIZES.signs),
};

const header = `/**
 * The lines drawn practice sheets are made of (practice-draw.ts), version ${VERSION}.
 * GENERATED by scripts/build-practice-pool.mjs: do not edit by hand.
 *
 * prose: Mozilla Common Voice sentences (CC0, public domain), every longer
 * word in FineNotes' public word list. The rest is made by the script.
 * Append-only once shipped: a sheet stores its lines' ids (kind letter and
 * index), and the rig checks shared lines against this pool.
 *
 * Counts: ${Object.entries(pool)
   .map(([k, v]) => `${k} ${v.length}`)
   .join(", ")}.
 */

/** The pool's version, stored on every sheet drawn from it. */
export const PRACTICE_POOL_VERSION = ${VERSION};

export const PRACTICE_POOL = {
`;
const body = Object.entries(pool)
  .map(
    ([kind, lines]) =>
      `  ${kind}: [\n${lines.map((l) => `    ${JSON.stringify(l)},`).join("\n")}\n  ],`,
  )
  .join("\n");
writeFileSync(
  outFile,
  `${header}${body}\n} as const satisfies Record<string, readonly string[]>;\n`,
);
console.log(Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, v.length])));
