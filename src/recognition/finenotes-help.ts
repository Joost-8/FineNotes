/**
 * FineNotes' own handbook for Ask AI: what the app can do, so a question
 * like "can I turn a page into flashcards?" or "how do I snap a circle?"
 * gets an answer from the app's features rather than a guess.
 *
 * The handbook is the feature index (`model/feature-index.ts`): every tip
 * and every switch in settings, with its title, what it does and how to
 * reach it, in English (what goes to the AI is never translated). A
 * `finenotes_help` search finds the entries; the AI links each with its
 * feature link, which opens that tip or switch in FineNotes.
 *
 * And Ask AI's own abilities and settings, said in its system prompt, so it
 * can say what it can do and which setting to change.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import type { TextKey } from "../i18n/translate";
import { FEATURES, type Feature, featureLink, searchWords } from "../model/feature-index";
import type { AskVaultScope } from "./vault-context";

/** Most handbook entries one search hands the AI. */
export const MAX_HELP_ENTRIES = 6;

/** Words too common to tell features apart. */
const STOP = new Set(
  "a an and are can do does for from how i in is it my of on or the to use what with you your".split(
    " ",
  ),
);

/** Whether a typed term means a word: its start, or the word with an ending. */
function means(term: string, word: string): boolean {
  if (word.startsWith(term)) return true;
  return word.length >= 3 && term.startsWith(word) && term.length - word.length <= 3;
}

/**
 * The entries a question means, best first: each word found in an entry's
 * title counts most, then its extra words, then its text. Unlike the
 * feature search people type into, an entry need not hold every word: an
 * AI asks in sentences.
 */
export function helpEntries(
  query: string,
  text: (key: TextKey) => string,
  features: readonly Feature[] = FEATURES,
  limit = MAX_HELP_ENTRIES,
): Feature[] {
  const terms = searchWords(query).filter((term) => term.length >= 2 && !STOP.has(term));
  if (terms.length === 0) return [];
  const scored: { feature: Feature; score: number; at: number }[] = [];
  features.forEach((feature, at) => {
    const title = searchWords(text(feature.title));
    const also = searchWords(feature.also);
    const body = searchWords(text(feature.body));
    let score = 0;
    for (const term of terms) {
      if (title.some((word) => means(term, word))) score += 4;
      else if (also.some((word) => means(term, word))) score += 2;
      else if (body.some((word) => means(term, word))) score += 1;
    }
    if (score > 0) scored.push({ feature, score, at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.slice(0, limit).map((item) => item.feature);
}

/** How an entry is reached: its switch's name, or the command that runs it. */
function reachOf(feature: Feature, text: (key: TextKey) => string): string {
  const action = feature.action;
  if (action?.kind === "setting") return `A switch in settings: "${text(action.name)}".`;
  if (action?.kind === "command") return `A command: finenotes:${action.id}.`;
  if (feature.tryOn) return "A gesture on the page.";
  return "";
}

/** The entries as the AI reads them: title, what it does, how to reach it, its link. */
export function helpText(
  query: string,
  entries: readonly Feature[],
  text: (key: TextKey) => string,
): string {
  if (entries.length === 0) {
    return `The FineNotes handbook has nothing on “${query}”. Say you are not sure rather than guess, and suggest the Tips page (the lightbulb on Home).`;
  }
  const lines = entries.map((feature) => {
    const reach = reachOf(feature, text);
    return [
      `- ${text(feature.title)}: ${text(feature.body)}`,
      reach ? `  ${reach}` : "",
      `  Link: [${text(feature.title)}](${featureLink(feature.id)})`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    "From the FineNotes handbook:",
    ...lines,
    "",
    "Give the link with your answer: it opens that tip or switch in FineNotes.",
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
export function askAbilitiesPrompt(scope: AskVaultScope, showCost: boolean): string {
  return [
    "About you, Ask AI in FineNotes (a handwriting notebook plugin for Obsidian):",
    `- Besides this notebook you may read ${REACH_TEXT[scope]} (search_vault, read_note, linked_notes). The user changes this with the folder button at the top of this chat, or in Settings › AI › Ask AI can read: "This notebook only", "This notebook's folder" or "The whole vault". When a question needs notes you may not read, say so and suggest the setting that would let you.`,
    "- You can write a new note beside the notebook (create_note), and add text boxes, tables, pages, practice pages, drawings, marks and comments to the notebook.",
    `- Each answer can show what it cost: Settings › AI › Show what each answer cost (${showCost ? "on" : "off"} now).`,
    "- The model you run on is set in Settings › AI › AI model; a new chat is the pencil button at the top of this chat; Save chat keeps chats in the notebook's AI chats folder.",
    "- For any question about what FineNotes can do or how to do something in it, look it up with finenotes_help and answer from what it finds, with its links. Never invent a feature, a setting or a menu.",
  ].join("\n");
}
