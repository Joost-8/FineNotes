/**
 * FineNotes' own handbook for Ask AI: what the app can do and where, so a
 * question like "can I annotate a PDF?" or "where did the ruler go?" gets an
 * answer from the app rather than a guess.
 *
 * The handbook is the guide (`model/finenotes-guide.ts`: every tool, gesture,
 * menu, settings row and command, traced to the code, with the words people
 * use for each) plus every tip of the feature index it does not cover. A
 * `finenotes_help` search finds entries; the AI answers from them and links
 * those with a feature link, which opens that tip or switch in FineNotes.
 *
 * And Ask AI's own abilities and settings, said in its system prompt, so it
 * can say what it can do and which setting to change.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import type { TextKey } from "../i18n/translate";
import { FEATURES, type Feature, featureLink } from "../model/feature-index";
import {
  COMMAND_NAMES,
  GUIDE,
  type GuideEntry,
  SETTING_PLACES,
  type Searchable,
  bestOf,
  rank,
  searchableOf,
} from "../model/finenotes-guide";
import type { TipRow } from "../model/guide-markdown";
import type { AskVaultScope } from "./vault-context";

/** Most handbook entries one search hands the AI. */
export const MAX_HELP_ENTRIES = 6;

/** One thing the handbook says, as the AI reads it. */
export interface HelpEntry {
  /** The guide entry's id, or the feature's for a tip the guide does not cover. */
  id: string;
  title: string;
  what: string;
  /** How to reach it, by its on-screen names. */
  where: string;
  notes: string;
  /** Where its settings are changed: "Settings › Writing › Pressure-sensitive pens". */
  settings: string[];
  /** Its commands' names in the command palette. */
  commands: string[];
  /** Its feature link (`obsidian://finenotes?do=show&feature=…`), when it has one. */
  link: string | null;
}

/** How a tip the guide does not cover is reached: its switch, or its command. */
function reachOf(feature: Feature, text: (key: TextKey) => string): string {
  const action = feature.action;
  if (action?.kind === "setting") return `A switch in settings: "${text(action.name)}".`;
  if (action?.kind === "command") {
    const name = COMMAND_NAMES[action.id];
    return name ? `The command "FineNotes: ${name}".` : "";
  }
  if (feature.tryOn) return "A gesture on the page.";
  return "";
}

function fromGuide(entry: GuideEntry): HelpEntry {
  const settings = (entry.settings ?? [])
    .map((key) => SETTING_PLACES.get(key))
    .filter((place): place is string => place !== undefined && place !== entry.where);
  return {
    id: entry.id,
    title: entry.title,
    what: entry.what,
    where: entry.where,
    notes: entry.notes ?? "",
    settings: [...new Set(settings)],
    commands: (entry.commands ?? []).map((id) => COMMAND_NAMES[id]).filter(Boolean),
    link: entry.feature ? featureLink(entry.feature) : null,
  };
}

function fromFeature(feature: Feature, text: (key: TextKey) => string): HelpEntry {
  return {
    id: feature.id,
    title: text(feature.title),
    what: text(feature.body),
    where: reachOf(feature, text),
    notes: "",
    settings: [],
    commands: [],
    link: featureLink(feature.id),
  };
}

/** Everything the handbook can hand over: the guide, then the tips it does not cover. */
function candidates(
  text: (key: TextKey) => string,
  guide: readonly GuideEntry[],
  features: readonly Feature[],
): { entry: () => HelpEntry; searchable: Searchable }[] {
  const covered = new Set(guide.map((entry) => entry.feature).filter(Boolean));
  return [
    ...guide.map((entry) => ({ entry: () => fromGuide(entry), searchable: searchableOf(entry) })),
    ...features
      .filter((feature) => !covered.has(feature.id))
      .map((feature) => ({
        entry: () => fromFeature(feature, text),
        searchable: {
          title: text(feature.title),
          words: feature.also,
          body: text(feature.body),
        },
      })),
  ];
}

/**
 * The entries a question means, best first: the guide (traced to the code,
 * with the words people use) and every tip it does not already cover. A
 * word in an entry's title counts most, then its people's words, then its
 * text; a synonym counts half. Unlike the search people type into, an entry
 * need not hold every word: an AI asks in sentences.
 */
export function helpEntries(
  query: string,
  text: (key: TextKey) => string,
  limit = MAX_HELP_ENTRIES,
  guide: readonly GuideEntry[] = GUIDE,
  features: readonly Feature[] = FEATURES,
): HelpEntry[] {
  const items = candidates(text, guide, features);
  const scores = rank(
    query,
    items.map((item) => item.searchable),
  );
  return bestOf(scores, limit).map((at) => items[at].entry());
}

/** The entries as the AI reads them: what each does, where it is, its settings and link. */
export function helpText(query: string, entries: readonly HelpEntry[]): string {
  if (entries.length === 0) {
    return [
      `The FineNotes handbook has nothing on “${query}”. Try other words once; then say you are not sure rather than guess.`,
      "Suggest the Tips page (the lightbulb on Home), and for a feature FineNotes lacks or a bug, an issue at https://github.com/Joost-8/FineNotes/issues.",
    ].join(" ");
  }
  const lines = entries.map((entry) =>
    [
      `- ${entry.title}: ${entry.what}`,
      entry.where ? `  Where: ${entry.where}` : "",
      entry.notes ? `  Note: ${entry.notes}` : "",
      entry.settings.length > 0 ? `  Settings: ${entry.settings.join("; ")}` : "",
      entry.commands.length > 0
        ? `  Commands: ${entry.commands.map((name) => `"FineNotes: ${name}"`).join(", ")}`
        : "",
      entry.link ? `  Link: [${entry.title}](${entry.link})` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    "From the FineNotes handbook (traced to the app; trust it over memory):",
    ...lines,
    "",
    "Answer from these entries, naming the path as written. Give an entry's link when it has one: it opens that tip or setting in FineNotes.",
  ].join("\n");
}

/** What the user lets Ask AI read, as its system prompt says it. */
const REACH_TEXT: Readonly<Record<AskVaultScope, string>> = {
  off: "only this notebook",
  folder: "this notebook's folder and its subfolders",
  vault: "the whole vault",
};

/**
 * What Ask AI can do and which of its settings to suggest, for its system
 * prompt. `scope` is the reach in use now; `showCost` whether answers show
 * their cost. Constant while neither changes, so the prompt cache holds.
 */
export function askAbilitiesPrompt(
  scope: AskVaultScope,
  showCost: boolean,
  notebookPath = "",
): string {
  return [
    "About you, Ask AI in FineNotes (a handwriting notebook plugin for Obsidian):",
    ...(notebookPath ? [`- This notebook is ${notebookPath}.`] : []),
    `- Besides this notebook you may read ${REACH_TEXT[scope]} (search_vault, read_note, linked_notes). The user changes this with the folder button at the top of this chat, or in Settings › AI › Ask AI can read: "This notebook only", "This notebook's folder" or "The whole vault". When a question needs notes you may not read, say so and suggest the setting that would let you.`,
    "- You can write a new note beside the notebook (create_note), and rewrite a note you wrote in this chat (create_note with replace), never any other note; and add text boxes, tables, pages, practice pages, drawings, marks and comments to the notebook.",
    `- Each answer can show what it cost: Settings › AI › Show what each answer cost (${showCost ? "on" : "off"} now).`,
    "- The model you run on is set in Settings › AI › AI model; a new chat is the pencil button at the top of this chat; every chat is kept as a note in the notebook's AI chats folder, where it can be opened or deleted.",
    "- For any question about what FineNotes can do, how to do something in it or where something is, look it up with finenotes_help (try other words if the first search misses) and answer from what it finds, naming the path through the app and giving its links. Never invent a feature, a setting or a menu; when the handbook does not have it, say so, and suggest an issue at https://github.com/Joost-8/FineNotes/issues for a missing feature or a bug.",
  ].join("\n");
}

/** Every tip and switch of the feature index as the guide's tips page lists it, in English. */
export function tipRows(
  text: (key: TextKey) => string,
  features: readonly Feature[] = FEATURES,
): TipRow[] {
  return features.map((feature) => ({
    id: feature.id,
    collection: feature.collection ? text(feature.collection.title) : "Other tips and switches",
    title: text(feature.title),
    body: text(feature.body),
    reach: reachOf(feature, text),
    words: feature.also,
  }));
}
