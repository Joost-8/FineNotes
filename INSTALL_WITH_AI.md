# Install FineNotes with an AI assistant

Copy the prompt below into an AI assistant that can run commands on your
computer (Claude Code, the Claude desktop app, Codex, Cursor and the like). It
installs Obsidian if you do not have it, makes a vault, and puts FineNotes in
it. It asks you before it installs anything.

On an iPad, an Android tablet or a phone, an assistant cannot install apps for
you. Install Obsidian from the App Store or Google Play, then follow
[Install](README.md#install) in the README.

```text
Install the Obsidian note-taking app and the FineNotes plugin on this computer
for me. Work step by step, tell me what you are about to do, and ask me before
you install software or change anything outside the new vault folder.

Use only these official sources:
- Obsidian: https://obsidian.md (or the system's package manager)
- FineNotes: https://github.com/Joost-8/FineNotes/releases/latest
Never download either from anywhere else.

1. Find out which operating system this is. If Obsidian is already installed,
   skip to step 3.

2. Install Obsidian, after asking me:
   - Windows: `winget install --id Obsidian.Obsidian -e`
   - macOS: `brew install --cask obsidian`, or the .dmg from obsidian.md
   - Linux: `flatpak install flathub md.obsidian.Obsidian`, or the AppImage
     from obsidian.md
   If the package manager is missing, give me the download link from
   obsidian.md instead of working around it.

3. Ask me where my vault should be. If I have one already, use it; otherwise
   suggest a new folder such as `~/Documents/Notes` and create it.

4. Download `main.js`, `manifest.json` and `styles.css` from the latest
   FineNotes release (the GitHub API
   https://api.github.com/repos/Joost-8/FineNotes/releases/latest lists their
   download URLs) into `<vault>/.obsidian/plugins/finenotes/`. Check that
   `manifest.json` says `"id": "finenotes"`.

5. Turn the plugin on: in `<vault>/.obsidian/community-plugins.json`, make sure
   the JSON array contains "finenotes". If the file exists, add to it and keep
   what is there; never remove other plugins.

6. If Obsidian is running, ask me to close it first. Then open the vault: tell
   me to start Obsidian, choose "Open folder as vault" and pick the vault
   folder (or, if it is already one of my vaults, open
   `obsidian://open?vault=<folder name>`).

7. Tell me what to click in Obsidian, because you cannot do it for me:
   - when Obsidian asks whether I trust the vault's author, choose
     "Trust author and enable plugins" (or, under Settings → Community
     plugins, turn off Restricted mode and switch FineNotes on);
   - then open a notebook with the notebook button in the left ribbon, or the
     command "New notebook or page…".

At the end, tell me in two or three sentences what you installed and where.
```

You can also install FineNotes without an assistant: in Obsidian open
Settings → Community plugins → Browse, and search for "FineNotes".
