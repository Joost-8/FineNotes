/**
 * The label in front of a notebook's payload, `v2:` in `v2:<base64>`, and
 * the features it can name.
 *
 * A feature is something an older FineNotes would lose if it opened and saved
 * the notebook: its reader keeps only what it knows and writes the rest away.
 * A notebook that uses one is labelled `v2+<feature>:` (several are joined by
 * `+`, in {@link FORMAT_FEATURES} order). Every reader since 2.0 requires the
 * part after `v` to be a number, so an older build refuses such a payload,
 * and the view's protected load (`view/load-guard.ts`) then holds the note
 * read-only and saves it back unchanged. This reader refuses a feature it
 * does not know in the same way. A notebook without any feature keeps the
 * plain `v2:` label, so older builds still open it.
 *
 * The stored JSON names the features too (`requires`, before `view`), so
 * whoever holds only the JSON (the save worker) labels it the same.
 *
 * Pure: no DOM, no Obsidian.
 */

import { SCHEMA_VERSION } from "../constants";

/**
 * Every feature this build reads, in the order a label lists them.
 * - `sticky`: sticky notes, paper with ink of its own (`model/sticky-notes`).
 * - `connectors`: arrows joining two shapes, routed from them as they are
 *   (`model/connectors`); an older reader would drop them on its next save.
 */
export const FORMAT_FEATURES = ["sticky", "connectors"] as const;

export type FormatFeature = (typeof FORMAT_FEATURES)[number];

/** A payload label, read. */
export interface PayloadLabel {
  version: number;
  features: FormatFeature[];
}

/** Why a label cannot be read: malformed, or naming a feature this build lacks. */
export type LabelProblem = { kind: "malformed" } | { kind: "unknown-feature"; feature: string };

function isFeature(name: string): name is FormatFeature {
  return (FORMAT_FEATURES as readonly string[]).includes(name);
}

/** Known features, deduplicated, in label order. */
function ordered(features: Iterable<string>): FormatFeature[] {
  const wanted = new Set(features);
  return FORMAT_FEATURES.filter((feature) => wanted.has(feature));
}

/** The label, colon excluded, for a notebook that uses `features`. */
export function payloadLabel(features: Iterable<string> = []): string {
  return [`v${SCHEMA_VERSION}`, ...ordered(features)].join("+");
}

/**
 * Read a label (the payload up to its first colon, colon excluded). The
 * version is any number, as it always was: the reader goes by the data's
 * shape. Each feature after it must be one this build reads.
 */
export function readPayloadLabel(label: string): PayloadLabel | LabelProblem {
  if (!label.startsWith("v")) return { kind: "malformed" };
  const whole = Number(label.slice(1));
  if (Number.isFinite(whole)) return { version: whole, features: [] };
  const [first, ...rest] = label.slice(1).split("+");
  // Exactly the test every reader since 2.0 made of the whole label (`v:` reads as 0).
  const version = Number(first);
  if (!Number.isFinite(version)) return { kind: "malformed" };
  const features: FormatFeature[] = [];
  for (const name of rest) {
    if (!isFeature(name)) return { kind: "unknown-feature", feature: name };
    features.push(name);
  }
  return { version, features };
}

/** Whether {@link readPayloadLabel}'s answer is a problem. */
export function isLabelProblem(read: PayloadLabel | LabelProblem): read is LabelProblem {
  return "kind" in read;
}

/**
 * The features the stored JSON's head names (`requires`), given the head as
 * the encoder hands it out: the document's JSON up to the `[` that opens its
 * pages. Anything unreadable names none.
 */
export function featuresOfHead(head: string): FormatFeature[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(`${head}]}`);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const requires = (parsed as { requires?: unknown }).requires;
  if (!Array.isArray(requires)) return [];
  return ordered(requires.filter((name): name is string => typeof name === "string"));
}

/**
 * Whether a payload names a feature this build cannot read: a notebook from a
 * newer FineNotes, rather than one cut short by a sync.
 */
export function needsNewerReader(payload: string): boolean {
  const text = payload.trim();
  const colon = text.indexOf(":");
  if (colon < 0) return false;
  const read = readPayloadLabel(text.slice(0, colon));
  return isLabelProblem(read) && read.kind === "unknown-feature";
}
