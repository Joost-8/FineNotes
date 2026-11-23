/**
 * The texts of "Help improve Grape" (grape-sharing.ts), in English only.
 *
 * They live beside the feature, not in the translation tables: consent
 * wording is translated once it is final, not before, so until then every
 * language sees English.
 */

const TEXT = {
  // --- Help improve Grape (sharing labelled handwriting) -------------------
  // Every sentence here is a promise the code or the server keeps; change
  // one only with what it describes (src/recognition/hwr/sharing.ts, the
  // grape-ink server, PRIVACY.md), and raise CONSENT_VERSION when what is
  // shared, why, or under what licence changes.
  off: "Share handwriting you labelled, so Grape reads more hands. Off.",
  setUp: "Set up…",
  "on.other": "{count} items shared",
  "on.one": "{count} item shared",
  "newCount.other": "{count} new",
  "newCount.one": "{count} new",
  "shareNew.other": "Share {count} new",
  "shareNew.one": "Share {count} new",
  review: "Review new items…",
  more: "More",
  stop: "Stop sharing",
  delete: "Delete everything I shared…",
  deletePending: "Deleting what you shared: waiting for a connection",
  askAgain: "The terms changed. Read them again to keep sharing.",

  "consent.title": "Help Grape read more handwriting",
  "consent.intro":
    "Grape, the model that reads handwriting in FineNotes, is free and open. It reads hands it has never seen badly, because it has learned from only a few people. You can share handwriting you have already labelled, so the next Grape reads more people's writing, yours included.",
  "consent.have": "You have {list} to share.",
  "consent.and": "{head} and {last}",
  "count.practice.other": "{count} practice lines",
  "count.practice.one": "{count} practice line",
  "count.word.other": "{count} corrected words",
  "count.word.one": "{count} corrected word",
  "count.equation.other": "{count} equations",
  "count.equation.one": "{count} equation",
  "consent.sentHeading": "What is sent",
  "consent.sent":
    "For each item: the pen strokes (their shape, pressure and timing) and the text they say. With them: FineNotes' version, the Grape you read with, the kind of device, and a random number made on this device that tells your items apart from other people's. Later practice sheets, corrections and equations, sums or graphs whose reading you used are shared too, when you press Share in settings.",
  "consent.neverHeading": "What is never sent",
  "consent.never":
    "Note and vault names, where on a page anything was written, the rest of your notes, words you only marked as real words (often names), your AI transcriptions, ink FineNotes wrote for you (neatened or rewritten words), your name and your email. The server does not store your IP address.",
  "consent.honestHeading": "Good to know",
  "consent.identifies":
    "Handwriting can identify you, like a signature. It is treated as personal data.",
  "consent.who":
    "It is kept on a server in the Netherlands run by Joost, who makes FineNotes, and used to train Grape and to test it on writers it has never seen, and to train FineNotes' handwriting writer: a model that neatens handwriting in its writer's own style, rewrites a word you corrected in your hand, and writes made-up lines that teach Grape more words. Training may run on Google Cloud computers in the EU; their copies are deleted when the run ends. It may also be used in his research on handwriting at TU Eindhoven.",
  "consent.licence":
    "Your items stay private. They are never published as a dataset; they are only used to train and test Grape and the writer, and in Joost's research. To check that each label matches its ink, an item may be shown to Claude, an AI by Anthropic (USA): only a picture of the ink and its text, nothing that says who wrote it. Anthropic may not train on it, and deletes it within 30 days. Only Grape and the writer themselves are released, free under Apache 2.0. The writer keeps no one's handwriting and no list of contributors' styles: it takes a style only from ink it is given, on the device using it. Lines it writes in contributors' styles stay private, like your items, and may be checked by Claude in the same way.",
  "consent.control":
    "Review first shows every item, and lets you keep any of them. Stop at any time, and delete everything you shared from the server. A Grape or writer that was already released cannot unlearn what it learned from your items; models trained after the delete never see them.",
  "consent.policy": "Privacy notice",
  "consent.cancel": "Not now",
  "consent.review": "Review first",
  "consent.share.other": "Share {count} items",
  "consent.share.one": "Share {count} item",
  "consent.nothing":
    "There is nothing to share yet. Correct a few words, or copy a practice sheet, and come back.",

  // Shown above the terms to someone who agreed to an older version: only
  // what changed since then (consentChanges in sharing.ts).
  "changed.title": "The terms changed",
  "changed.anthropic":
    "To check that each label matches its ink, an item may be shown to Claude, an AI by Anthropic: only a picture of the ink and its text.",
  "changed.writer":
    "Your items may also train FineNotes' handwriting writer, which neatens writing and rewrites corrected words in their writer's hand. It is released like Grape and keeps no one's handwriting.",
  "changed.madeUp":
    "The writer may write made-up lines in contributors' styles to teach Grape. Those stay private.",
  "changed.used":
    "An equation, sum or graph FineNotes read counts as labelled once you used what it read.",
  "changed.cloud": "Training may run on Google Cloud computers in the EU.",
  "changed.covers": "This covers what you already shared too. Everything else is as you agreed.",
  "changed.stop": "Stop sharing",
  "changed.agree": "Agree",

  "kind.practice": "Practice sheets",
  "kind.word": "Corrected words",
  "kind.equation": "Equations",

  "invite.title": "Help Grape read everyone's handwriting?",
  "invite.body":
    "Your lines just made Grape read you better. Shared, they help it read strangers too.",
  "invite.bodySheet":
    "You just copied a whole practice sheet. Shared, those lines help Grape read strangers' handwriting too.",
  "invite.later": "Not now",
  "invite.more": "Learn more",
  "invite.help": "Help",
  "invite.terms.other":
    "Help shares {count} labelled items, only their ink and text, to train Grape. They stay private; only Grape is released. Learn more shows them first; you can delete them any time.",
  "invite.terms.one":
    "Help shares {count} labelled item, only its ink and text, to train Grape. It stays private; only Grape is released. Learn more shows it first; you can delete it any time.",

  "review.title.other": "Review {count} items",
  "review.title.one": "Review {count} item",
  "review.intro":
    "This is exactly what is sent: the ink, and the text under it. Untick anything you would rather keep. An unticked item is never offered again.",
  "review.untickAll": "Untick all",
  "review.tickAll": "Tick all",
  "review.typed": "you typed “{text}” · Grape read “{read}”",
  "review.slip": "you confirmed a slip: “{text}”",
  "review.confirmed": "you confirmed “{text}”",
  "review.line": "“{text}”",
  "review.back": "Back",
  "review.send.other": "Send {count} items",
  "review.send.one": "Send {count} item",
  "review.none": "Send nothing",
  "review.tooBig.other": "{count} items are too large to send and stay on this device.",
  "review.tooBig.one": "{count} item is too large to send and stays on this device.",

  "sent.other": "FineNotes: sent {count} items to Grape. Thank you.",
  "sent.one": "FineNotes: sent {count} item to Grape. Thank you.",
  closed:
    "FineNotes: Grape is not collecting handwriting yet. Nothing was sent, and nothing was kept.",
  offline: "FineNotes: could not reach Grape's server. Nothing was lost; try again later.",
  failed: "FineNotes: sharing failed ({message}). Nothing more was sent.",
  "partly.other":
    "FineNotes: sent {count} items, then sharing failed ({message}). The rest stay on this device.",
  "partly.one":
    "FineNotes: sent {count} item, then sharing failed ({message}). The rest stay on this device.",
  stopped: "FineNotes: sharing stopped. What you shared stays until you delete it.",

  deleteTitle: "Delete everything you shared?",
  "deleteBody.other":
    "This removes your {count} items from Grape's server and stops sharing. Grapes trained from now on never see them. A Grape that was already released keeps what it learned.",
  "deleteBody.one":
    "This removes your {count} item from Grape's server and stops sharing. Grapes trained from now on never see it. A Grape that was already released keeps what it learned.",
  deleteConfirm: "Delete",
  deleted: "FineNotes: everything you shared was deleted from Grape's server.",
  deleteQueued:
    "FineNotes: sharing stopped. The server could not be reached, so the delete is sent the next time it can be.",
} as const;

type Key = keyof typeof TEXT;
type PluralBase = { [K in Key]: K extends `${infer B}.other` ? B : never }[Key];

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

const plural = new Intl.PluralRules("en");

/** A text of the feature, with `{name}`s filled. */
export function st(key: Key, vars?: Record<string, string | number>): string {
  return fill(TEXT[key], vars);
}

/** The English plural form of `key` for `count`, `{count}` filled. */
export function stn(
  key: PluralBase,
  count: number,
  vars?: Record<string, string | number>,
): string {
  const form = plural.select(count) === "one" ? "one" : "other";
  const text = (TEXT as Record<string, string>)[`${key}.${form}`] ?? TEXT[`${key}.other` as Key];
  return fill(text, { count, ...vars });
}
