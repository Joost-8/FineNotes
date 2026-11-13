/**
 * English words every area shares, and the Language row. Keys start with
 * "common." or "language.". An area uses these where the word is the same
 * thing (a Cancel button is a Cancel button); it adds its own key where the
 * same English word could be translated differently in context.
 */
export const common = {
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.backTo": "Back to {name}",
  "common.delete": "Delete",
  "common.done": "Done",
  "common.duplicate": "Duplicate",
  "common.rename": "Rename",
  "common.remove": "Remove",
  "common.save": "Save",
  "common.undo": "Undo",
  "common.redo": "Redo",
  "common.copy": "Copy",
  "common.paste": "Paste",
  "common.cut": "Cut",
  "common.more": "More",
  "common.on": "On",
  "common.off": "Off",
  "common.ok": "OK",
  "common.retry": "Try again",
  "common.dismiss": "Dismiss",

  "language.name": "Language",
  "language.follow": "Follow Obsidian ({language})",
  "language.info":
    "The language of FineNotes' menus, buttons and settings. Follow Obsidian uses the language Obsidian is in. Your notes and handwriting are never translated.",
  "language.relaunch": "Relaunch",
  "language.relaunchTip": "Relaunch Obsidian to show FineNotes in this language everywhere",
  "language.downloading": "Getting the language…",
  "language.failed": "Could not get this language. FineNotes stays in English for now.",
} as const;
