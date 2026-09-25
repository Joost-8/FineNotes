# Releasing FineNotes

CI (`ci.yml`) gates every push: lint → lint:review → typecheck → test → build.
Releases are automated. A few steps are manual by nature. There is no website
(see below).

Releases go to **`Joost-8/FineNotes`**. Pass `-R Joost-8/FineNotes` to `gh`
release commands, or run `gh repo set-default Joost-8/FineNotes` once per
clone: when a clone has a remote named `upstream`, a bare `gh` command talks to
that repository instead.

## Cut a release (automated)

1. Make sure `main` is green and the working tree is clean.
2. Check for pending dependency advisories. Merge them, or consciously defer
   them, _before_ tagging, so a release never goes out with a known-open alert:
   ```bash
   gh pr list -R Joost-8/FineNotes   # open Dependabot PRs
   npm audit                         # catches advisories Dependabot hasn't filed yet
   ```
3. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`. `release.yml`
   uses it as the GitHub Release notes, and falls back to a generic line if the
   section is missing.
4. Bump the version:
   ```bash
   npm version patch   # or minor / major, or an explicit x.y.z
   ```
   This updates `manifest.json` and `versions.json` (via `version-bump.mjs`,
   which records the current `minAppVersion` for the new version). It also tags
   the commit as `x.y.z`, with **no `v` prefix** (enforced by `.npmrc`'s
   `tag-version-prefix=""`). Obsidian requires the tag to match
   `manifest.json`'s version exactly.
5. Push the commit and **that one tag**:
   ```bash
   git push origin main && git push origin x.y.z
   ```
   Never run `git push --tags`: a clone that still holds the pre-1.0 tags
   would push them, and they would carry the old history into this repository
   (see "History" below).
6. `release.yml` builds and creates a GitHub Release:
   - it attaches `main.js`, `manifest.json` and `styles.css`, the three files
     Obsidian downloads;
   - it attests their build provenance;
   - it uses the matching `CHANGELOG.md` section as the notes.

> `minAppVersion` (now 1.13.0) lives in `manifest.json`. Raise it there before
> releasing if you start using a newer Obsidian API.

## History

FineNotes 1.0.0 (2026-09-26) is the root commit of this repository.

- **Where the older history lives:** everything before it was called
  GoodObsidian and started as a fork of InkedMark. That history is in the
  private `Joost-8/GoodObsidian` repository, and in a local git bundle.
- **Why it starts fresh:** Obsidian's community directory does not list a fork
  of a listed plugin. FineNotes took the route the policy names: it inherits no
  code. Every line InkedMark's author still had was rewritten or removed before
  1.0.0. The method, the keep list of one-way lines and the
  `git blame` result are kept with the private history.
- **Why the name changed:** the directory also bans "obsidian" in a plugin's id
  and name, so GoodObsidian (id `goodobsidian`) became FineNotes (id
  `finenotes`). Settings saved under the old id carry over once.

**Do not change** these old names. They are compatibility facts, not branding,
and changing them would break existing notes, workspaces or keys:

- the CSS classes `goodobsidian-*`;
- the note markers (`%%goodobsidian`, `<!--goodobsidian-text-->`, the
  frontmatter flag);
- the view type `goodobsidian-view`;
- the Keychain ids `goodobsidian-*-api-key`;
- `PREVIOUS_PLUGIN_ID`;
- the `LEGACY_*` names.

## The Community directory

Plugins are submitted at [community.obsidian.md](https://community.obsidian.md),
not by a pull request to `obsidianmd/obsidian-releases`:

1. Sign in with an Obsidian account, and connect GitHub (Profile → GitHub →
   Connect).
2. Go to **Plugins → New plugin**. Enter the repo URL, choose the owner, agree
   to the Developer policies, and submit.
3. The directory reads `manifest.json` at the HEAD of `main`. Installs download
   the three files from the release whose tag equals `version`.
4. An automated review runs. Fix whatever it flags, and release again with a
   higher version.

Once it is listed, announce it:

- in the forum, under [Share & showcase](https://forum.obsidian.md/c/share-showcase/9);
- in Discord's `#updates` channel, which needs the developer role.

## Website

**There is none, deliberately.** `docs/` and `pages.yml` came from the original
project: its marketing site, and a workflow that published it to GitHub Pages.
They were removed so this repo could never serve someone else's site. If a site
is wanted, write a new one.

## Manual steps (not automatable)

- **On-device QA.** Go through the on-device checklist on the iPad before a
  release that changes
  input, rendering, layout or gestures. Check the open issues too:
  `gh issue list -R Joost-8/FineNotes`.
- **Screenshots and social preview.** The README and the directory listing
  show images from the repo; relative paths such as `./assets/notebook.png` are
  rewritten on the listing page. Take them on the iPad. The repo's social
  preview image is set by hand, in Settings → General.
- **BRAT beta.** Testers add `Joost-8/FineNotes` in the BRAT plugin. Nothing
  more is needed than a GitHub release.
