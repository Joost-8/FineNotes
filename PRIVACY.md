# Privacy notice: Help improve Grape

> **Status: collecting, only from people who turn it on.** Help improve
> Grape is in FineNotes releases from November 2026, off until you agree to
> it in Settings.

FineNotes sends nothing anywhere on its own. This notice covers one optional
feature, **Help improve Grape**, which shares handwriting you have labelled
with the people who make Grape, the free model that reads handwriting in
FineNotes. Everything else FineNotes does over the network is listed in the
README, under "Privacy and network use".

## Who is responsible

Joost Dille, the developer of FineNotes, an individual in
the Netherlands. Contact: fine.notes0@gmail.com.

## What is shared, and only if you choose it

Sharing is off until you turn it on: in Settings › Reading and voice ›
Your handwriting › Help improve Grape, or from the card FineNotes shows once,
after "Learn your handwriting" has made Grape read you better. It is one
choice, for these three kinds of labelled handwriting together:

| What            | Where it comes from                                                                       | Who wrote the text             |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| Practice sheets | Lines you copied on a FineNotes practice sheet                                            | FineNotes chose it             |
| Corrected words | Single words you corrected or confirmed under "Underline words it may have misread"       | You                            |
| Equations       | Numbers, signs and short sums from calculation notes, as you confirmed them               | You                            |
| Used readings   | Equations, sums and graphs FineNotes read, once you kept the answer or inserted the graph | FineNotes read it, you used it |

Words you only marked as real words (often names and course terms) are never
shared.

Pressing **Share** is your agreement. Before that you can choose **Review
first**, which shows every item, its ink drawn as it will be sent and the
text under it, and lets you keep any of them; a kept item is never offered
again. Later items (new practice lines, corrections and equations) are sent
when you press **Share N new** in settings, or after reviewing them from its
⋯ menu.

**Each item holds:** the pen strokes (their shape, pressure and timing),
moved so they start at the top left, so where on a page you wrote is not
sent; and the text they say. For a correction, also what Grape had read and
how you answered. Practice lines also carry the device kind and pen they were
written with.

**Each batch also holds:** FineNotes' version, the Grape you read with, the
kind of device ("ipad", "desktop"…), the version of these terms you agreed
to, and a random contributor
number made on your device. That number tells your items apart from other
people's; it is not linked to your name, email, vault or account.

**Never sent:** note and vault names, page ids, where on a page anything was
written, words you only marked as real, the rest of your notes, AI
transcriptions, ink FineNotes wrote for you (neatened or rewritten words),
your name, your email.
The server does not store IP addresses.

Handwriting can identify the person who wrote it, like a signature, so all
of it is treated as personal data.

## Why, and on what basis

To train Grape and to test it on writers it has never seen, so it reads more
people's handwriting; and to train **FineNotes' handwriting writer**, a model
that neatens handwriting in its writer's own style, rewrites a word you
corrected in your hand, and writes made-up lines that teach Grape more words.
It may also be used in Joost's research on handwriting (reading it and
writing it) at Eindhoven University of Technology (TU/e). The legal basis is
your consent (GDPR art. 6(1)(a)).

## Your items stay private; only Grape is released

What you share is **never published**: it is not released as a dataset, and
nobody but Joost works with it, apart from the label check below. By sharing
you allow Joost to use your items for the purposes above: to train and test
Grape and the writer, and in his research. Research results report measurements, never
your handwriting itself.

Only the **Grape models** and the **writer** trained on your items are
released, free and open under the Apache License 2.0. A model holds what it
learned, not your items.

The writer keeps no one's handwriting and no list of contributors' styles. It
takes a style only from ink it is given, on the device using it, so it holds
nothing that would make it write like you. Lines it writes in contributors'
styles, to train Grape, are treated like your items: they stay private, and
they are never published.

## The label check by Anthropic

A wrong label teaches Grape the wrong thing, so before an item is used, its
label is checked against its ink. For that check an item may be sent to
**Claude**, an AI model by **Anthropic PBC** (USA), through Anthropic's API:

- **What is sent:** a picture of the item's ink and the text it should say.
  Not the contributor number, the pen timing, the device, the FineNotes
  version or anything else from the batch. The same check may be made of
  lines the writer wrote in contributors' styles, in the same way.
- **What Anthropic may do with it:** only answer whether the text matches
  the ink. Anthropic acts as Joost's processor under its commercial terms
  and data processing agreement: it may not train its models on what it is
  sent, and deletes it within 30 days (longer only for what it flags as
  breaking its usage policy).
- **Transfer outside the EU:** Anthropic processes data in the USA, under
  the standard contractual clauses in its data processing agreement.

Items shared under the terms before this check was added (version 2) are
never sent to Anthropic, unless their contributor agreed to a later version,
which covers what they shared before.

## Where it is kept, and for how long

On a server in the Netherlands run by Joost, for as long as Grape is being
developed, or until you delete it. Copies made to train Grape or the writer
follow the server: when you delete, they are deleted too.

Training may run on rented computers of **Google Cloud** (Google Ireland,
acting as Joost's processor), only in regions in the EU. The copies there are
deleted when the run ends; what is kept is the trained model.

## Your control

- **See it first:** Review first shows every item before it goes.
- **Stop:** Settings › Reading and voice ›
  Help improve Grape › ⋯ › Stop sharing. Nothing more is
  sent; what was sent stays until you delete it.
- **Delete:** ⋯ › Delete everything I shared. The server removes all your
  items. If it cannot be reached, FineNotes sends the request again until it
  succeeds.
- **The limit:** a Grape model or writer already released has learned from
  what it was trained on and cannot unlearn it. Models trained after your
  delete never see your items.
- Your rights under the GDPR (access, rectification, erasure, restriction,
  objection, portability) can also be exercised by writing to the contact
  above. You may complain to the Dutch Data Protection Authority
  (Autoriteit Persoonsgegevens).

## Changes

If what is shared, why, or under what licence changes, FineNotes asks you
again before it sends anything more. It shows what changed since the version
you agreed to, and you choose: **Agree**, which also covers what you already
shared, or **Stop sharing**. Until you agree, nothing more is sent, and what
you shared is used only as the version you agreed to allows.

| Version | Date       | What it added                                                                                                                                                                 |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2       | 2026-11-16 | Items stay private; only Grape is released                                                                                                                                    |
| 3       | 2026-11-19 | The label check by Anthropic                                                                                                                                                  |
| 4       | 2026-11-23 | The handwriting writer, its made-up lines (checked like items), used readings as labels, training on Google Cloud in the EU, and agreeing again covers what was shared before |
