/**
 * Home's part of organising by tag (`note-organiser.ts`, after Apple
 * Notes): the smart folders as folder tiles with a gear, the Tags row
 * under the folders, and the Tag Browser a tap on a tag opens, where
 * several tags narrow the list (tap: in, again: left out, again: off).
 * Home calls these and draws the covers itself.
 */

import { setIcon } from "obsidian";
import { t, tn } from "../i18n/translate";
import {
  type SmartFolder,
  type TagCount,
  type TagPick,
  browseTags,
  matchesSmart,
  ruleText,
} from "../model/note-organise";
import { tagChip } from "./note-organiser";

/** What Home shows instead of a folder: the Tag Browser, or one smart folder. */
export type TagView = { kind: "tags"; picks: Map<string, TagPick> } | { kind: "smart"; id: string };

/** The tags picked in the browser: those in, those left out. */
export function picked(view: { picks: Map<string, TagPick> }): { on: string[]; out: string[] } {
  const on: string[] = [];
  const out: string[] = [];
  for (const [tag, pick] of view.picks) {
    if (pick === "on") on.push(tag);
    if (pick === "out") out.push(tag);
  }
  return { on, out };
}

/** The items a tag view holds. */
export function itemsOf<T extends { tags: readonly string[] }>(
  view: TagView,
  items: readonly T[],
  smart: readonly SmartFolder[],
): T[] {
  if (view.kind === "tags") {
    const { on, out } = picked(view);
    return browseTags(items, on, out);
  }
  const folder = smart.find((f) => f.id === view.id);
  return folder ? items.filter((item) => matchesSmart(item, folder)) : [];
}

/** A smart folder as a Home tile: the folder art with a gear, its name and ⌄, its rule. */
export function smartTile(
  parent: HTMLElement,
  folder: SmartFolder,
  count: number,
  open: () => void,
  menu: (event: MouseEvent) => void,
): HTMLElement {
  const card = parent.createDiv({
    cls: "goodobsidian-library-card finenotes-smart-card",
    attr: { role: "button", tabindex: "0", "aria-label": folder.name },
  });
  const cover = card.createDiv({ cls: "goodobsidian-library-cover is-folder is-smart" });
  const art = cover.createDiv({ cls: "goodobsidian-library-folder-art" });
  art.createDiv({ cls: "goodobsidian-library-folder-back" });
  setIcon(art.createDiv({ cls: "goodobsidian-library-folder-front" }), "folder-cog");
  const caption = card.createDiv({ cls: "goodobsidian-library-caption" });
  const row = caption.createDiv({ cls: "goodobsidian-library-name-row" });
  row.createDiv({ cls: "goodobsidian-library-name", text: folder.name });
  const caret = row.createEl("button", {
    cls: "clickable-icon goodobsidian-library-caret",
    attr: {
      type: "button",
      "aria-label": t("notebooks.home.options", { name: folder.name }),
      "aria-haspopup": "menu",
    },
  });
  setIcon(caret, "chevron-down");
  caret.addEventListener("click", (event) => {
    event.stopPropagation();
    menu(event);
  });
  caption.createDiv({
    cls: "goodobsidian-library-when",
    text: `${tn("notebooks.home.itemCount", count)} · ${ruleText(
      folder,
      t("notebooks.organise.noTags"),
      t("notebooks.organise.or"),
    )}`,
  });
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    menu(event);
  });
  return card;
}

/**
 * The tags as a row of chips (Apple's Tag Browser): each with its count,
 * the picked ones marked. "All tags" first, on while nothing is picked.
 */
export function tagRow(
  parent: HTMLElement,
  counts: readonly TagCount[],
  pickOf: (tag: string) => TagPick,
  tap: (tag: string | null) => void,
): HTMLElement {
  const row = parent.createDiv({ cls: "finenotes-tag-row" });
  const none = counts.every((c) => pickOf(c.tag) === "off");
  const all = row.createEl("button", {
    cls: "clickable-icon finenotes-tag-chip",
    text: t("notebooks.organise.allTags"),
    attr: { type: "button", "aria-pressed": String(none) },
  });
  all.toggleClass("is-on", none);
  all.addEventListener("click", () => tap(null));
  for (const { tag, count } of counts) tagChip(row, tag, pickOf(tag), () => tap(tag), count);
  return row;
}
