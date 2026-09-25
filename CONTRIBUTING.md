# Contributing to FineNotes

Thanks for helping. FineNotes is a small project, and bug reports from real
use are what make it better.

## Reporting a bug or an idea

- Open an [issue](https://github.com/Joost-8/FineNotes/issues). The bug-report
  form asks for:
  - your device;
  - the plugin and Obsidian versions;
  - the steps that reproduce the bug.
- **For anything about writing, erasing, scrolling or zooming on an iPad,**
  attach a screen recording. Switch on **Show or hide the input debug overlay**
  from the command palette first, so the recording shows what the plugin saw.
  Many iPad bugs cannot be reproduced any other way.
- **Security problems** go through
  [private vulnerability reporting](https://github.com/Joost-8/FineNotes/security/advisories/new),
  never a public issue. See [SECURITY.md](SECURITY.md).

## Working on the code

You need Node 22 (see `.nvmrc`).

```
npm install
npm run dev          # watch-mode build
npm test             # unit tests (vitest)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint, no warnings allowed
npm run lint:review  # Obsidian's plugin-review rules
npm run format:check # prettier
npm run build        # production build
```

To try your build in a vault:

1. Put the plugin folder's path (`<vault>/.obsidian/plugins/finenotes`) in a
   `.deploy-target` file at the repo root. The file is gitignored.
2. Build: every build is then copied into that folder.
3. Reload Obsidian.

CI runs lint, the review lint, the type check, the tests and the build on every
push. A pull request needs all of them green.

## House rules

- **Pure logic lives in pure modules.**
  - `src/model/`, `src/ink/` and much of `src/canvas/` use no DOM, no
    Obsidian and no network. That is what keeps them testable.
  - Put new logic there, with tests.
  - Add each new pure module to the coverage `include` list in
    `vitest.config.mts`; otherwise it goes silently untested.
- **A warning is a failure.** `npm run lint` runs with `--max-warnings 0`.
  `npm run lint:review` enforces Obsidian's review rules, which plain lint does
  not.
- **The note format is a contract.**
  - `contracts/api.md` describes it.
  - The goldens in `tests/model/goldens/` pin its exact bytes.
  - A format change needs a migration, an updated contract and new goldens.
  - Never store a coordinate that depends on the window's size: strokes live
    in page coordinates.
- **Never touch the user's own text.** FineNotes writes only:
  - its frontmatter keys;
  - its `%%goodobsidian` ink block;
  - its `<!--goodobsidian-text-->` section.
- **Mobile is not optional.** Everything must work on the iPad (the plugin's
  `isDesktopOnly` is `false`). Test gestures on a device, or say in the pull
  request that you could not.
- **Buttons carry `clickable-icon`.** Obsidian restyles plain buttons, and on
  the iPad it pads each one by 20 px.
- **Old names are compatibility, not branding.** Keep `goodobsidian` where it
  appears in CSS classes, note markers, the view type and Keychain ids.
- **Only your own code.** FineNotes began as a fork of InkedMark and was
  rewritten so that it inherits none of its code. Do not copy code in from
  InkedMark, or from any project whose licence is not compatible with MIT.

## Pull requests

- Keep each pull request to one change, with tests for the logic.
- Say how you tested it, and on which devices.
- By contributing, you agree that your contribution is licensed under the
  project's [MIT licence](LICENSE).

Releases are cut by the maintainer, following [RELEASE.md](RELEASE.md).
