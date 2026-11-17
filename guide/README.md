# FineNotes guide

What FineNotes can do, where each thing is and how to reach it: every toolbar
tool, gesture, menu, settings row and command. Ask AI looks it up (its
`finenotes_help` tool) to answer "how do I…?", "can FineNotes…?" and "where
is…?", and to give tips. It was traced to the code in November 2026, not to
the changelog, and the doubtful points were settled by Joost.

## Pages

1. [Start here](01-start.md): what FineNotes is, devices, sync, setting up AI,
   reporting a bug, and other things people ask first.
2. [Settings](02-settings.md): every row of the settings tab.
3. [The toolbar](03-toolbar.md): every button, its options and the ⋯ menu.
4. [On the page](04-on-the-page.md): gestures, the lasso, text, shapes,
   pictures and the tools that act on the page.
5. [Notebooks, pages, Home, PDF and files](05-notebooks.md).
6. [AI, recordings and maths](06-ai-recordings-maths.md).

[Tips and switches](tips.md) lists every tip in Tips and every switch the
feature search finds, with the guide entries that link to each. It is
generated; change the tips in the code, not that page.

## Editing

Each entry is a `###` heading (what a user would call it) and these fields:

| Field    | What goes in it                                                                 |
| -------- | ------------------------------------------------------------------------------- |
| Id       | Unique, camelCase. Keep it when you change the rest.                            |
| What     | What it does, in a few plain sentences, as you would tell a user.               |
| Where    | The path through the app by its names on screen: `Toolbar › Pen › ⌄ › …`.       |
| Notes    | Optional: platform limits ("iPad only"), conditions, caveats.                   |
| Words    | Words and phrases people use for it, comma-separated. Search weighs these high. |
| Settings | Optional: the settings keys it is about, in code marks.                         |
| Commands | Optional: its command ids, without `finenotes:`.                                |
| Tip      | Optional: the id of its tip in [Tips and switches](tips.md); Ask AI links it.   |

Rules:

- Write What and Where for people. Never a settings key or a file name there:
  the AI repeats what it reads. A test checks this.
- Trace a claim to the code that does it. The changelog has been wrong before.
- A new entry goes on the page of its area; a new page needs a line in
  `GUIDE_PAGES` (`src/model/guide-markdown.ts`).

Then run:

```bash
npm run guide
```

It writes `src/model/finenotes-guide-data.ts` (what Ask AI searches) and
`tips.md`. `npm test` fails while either is out of date, while an entry names a
setting or command that no longer exists, and while one of the sample questions
in `tests/model/finenotes-guide.test.ts` stops finding its answer. When you add
an entry for a question people ask, add the question there too.
