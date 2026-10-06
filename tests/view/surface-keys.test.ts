/** `src/view/surface-keys.ts` — which action a key press on the notebook stands for. */

import { describe, expect, it } from "vitest";
import {
  type KeyChord,
  type KeyOutcome,
  type KeyScene,
  TOOL_KEYS,
  keyOutcome,
} from "../../src/view/surface-keys";

type Flags = Partial<Record<Exclude<keyof KeyScene, "cropping">, boolean>> & {
  cropping?: boolean;
};

/** A scene from yes/no answers, noting which questions were asked, in order. */
function scene(flags: Flags = {}, asked: string[] = []): KeyScene {
  const ask = (name: Exclude<keyof KeyScene, "cropping">) => (): boolean => {
    asked.push(name);
    return flags[name] === true;
  };
  return {
    cropping: flags.cropping === true,
    editingText: ask("editingText"),
    clipboard: ask("clipboard"),
    menuOpen: ask("menuOpen"),
    imageSelected: ask("imageSelected"),
    groupSelected: ask("groupSelected"),
    pressMenuOpen: ask("pressMenuOpen"),
    rowFitsPane: ask("rowFitsPane"),
  };
}

function chord(key: string, mods: Partial<Omit<KeyChord, "key">> = {}): KeyChord {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

const loud = (action: KeyOutcome["action"]): KeyOutcome => ({ action, preventDefault: true });
const quiet = (action: KeyOutcome["action"]): KeyOutcome => ({ action, preventDefault: false });

describe("keyOutcome", () => {
  it("undoes and redoes with Cmd or Ctrl, whatever is on screen", () => {
    const busy = scene({ cropping: true, menuOpen: true, groupSelected: true });
    expect(keyOutcome(chord("z", { metaKey: true }), busy)).toEqual(loud("undo"));
    expect(keyOutcome(chord("z", { ctrlKey: true }), scene())).toEqual(loud("undo"));
    expect(keyOutcome(chord("Z", { metaKey: true, shiftKey: true }), scene())).toEqual(
      loud("redo"),
    );
  });

  it("gives crop mode Enter, Escape and the delete keys", () => {
    const crop = scene({ cropping: true, imageSelected: true });
    expect(keyOutcome(chord("Enter"), crop)).toEqual(loud("keep-crop"));
    expect(keyOutcome(chord("Escape"), crop)).toEqual(loud("drop-crop"));
    expect(keyOutcome(chord("Delete"), crop)).toEqual(quiet("none"));
    expect(keyOutcome(chord("Backspace"), crop)).toEqual(quiet("none"));
    expect(keyOutcome(chord("Enter"), scene())).toBeNull();
    expect(keyOutcome(chord("p"), crop)).toEqual(quiet({ tool: "pen" }));
  });

  it("offers Cmd/Ctrl + a key to the clipboard unless Alt, Shift or a text box is in the way", () => {
    const asked: string[] = [];
    expect(keyOutcome(chord("c", { metaKey: true }), scene({ clipboard: true }, asked))).toEqual(
      quiet("none"),
    );
    expect(asked).toEqual(["editingText", "clipboard"]);
    const typing: string[] = [];
    const editing = scene({ clipboard: true, editingText: true }, typing);
    expect(keyOutcome(chord("c", { metaKey: true }), editing)).toBeNull();
    expect(typing).not.toContain("clipboard");
    for (const mods of [{ altKey: true }, { shiftKey: true }]) {
      const none: string[] = [];
      keyOutcome(chord("v", { ctrlKey: true, ...mods }), scene({ clipboard: true }, none));
      expect(none).not.toContain("clipboard");
    }
  });

  it("goes on past a clipboard that refused the key", () => {
    expect(
      keyOutcome(chord("Backspace", { metaKey: true }), scene({ groupSelected: true })),
    ).toEqual(loud("delete-selection"));
  });

  it("lets Escape close a menu, then a picture, then a selection or a hold bar", () => {
    expect(keyOutcome(chord("Escape"), scene({ menuOpen: true, imageSelected: true }))).toEqual(
      quiet("close-menu"),
    );
    expect(
      keyOutcome(chord("Escape"), scene({ imageSelected: true, groupSelected: true })),
    ).toEqual(quiet("deselect-image"));
    expect(keyOutcome(chord("Escape"), scene({ groupSelected: true }))).toEqual(
      quiet("clear-selection"),
    );
    expect(keyOutcome(chord("Escape"), scene({ pressMenuOpen: true }))).toEqual(
      quiet("clear-selection"),
    );
    expect(keyOutcome(chord("Escape"), scene())).toBeNull();
  });

  it("asks only what a key needs, in order", () => {
    const asked: string[] = [];
    keyOutcome(chord("Escape"), scene({ groupSelected: true }, asked));
    expect(asked).toEqual(["menuOpen", "imageSelected", "groupSelected"]);
    const quietKey: string[] = [];
    keyOutcome(chord("p"), scene({}, quietKey));
    expect(quietKey).toEqual([]);
  });

  it("deletes a selected picture before a selection", () => {
    const both = scene({ imageSelected: true, groupSelected: true });
    expect(keyOutcome(chord("Delete"), both)).toEqual(loud("delete-image"));
    expect(keyOutcome(chord("Delete"), scene({ groupSelected: true }))).toEqual(
      loud("delete-selection"),
    );
    expect(keyOutcome(chord("Delete"), scene({ pressMenuOpen: true }))).toBeNull();
  });

  it("turns pages and scrolls with bare page and arrow keys", () => {
    expect(keyOutcome(chord("PageDown"), scene())).toEqual(loud("next-page"));
    expect(keyOutcome(chord("PageUp"), scene())).toEqual(loud("previous-page"));
    expect(keyOutcome(chord("ArrowDown"), scene())).toEqual(loud("scroll-down"));
    expect(keyOutcome(chord("ArrowUp"), scene())).toEqual(loud("scroll-up"));
    const fits = scene({ rowFitsPane: true });
    expect(keyOutcome(chord("ArrowDown"), fits)).toEqual(loud("next-page"));
    expect(keyOutcome(chord("ArrowUp"), fits)).toEqual(loud("previous-page"));
    expect(keyOutcome(chord("PageDown", { altKey: true }), scene())).toBeNull();
    expect(keyOutcome(chord("ArrowDown", { ctrlKey: true }), scene())).toBeNull();
  });

  it("picks a tool with its letter, in either case, and only a bare letter", () => {
    for (const [letter, tool] of TOOL_KEYS) {
      expect(keyOutcome(chord(letter), scene())).toEqual(quiet({ tool }));
      expect(keyOutcome(chord(letter.toUpperCase()), scene())).toEqual(quiet({ tool }));
      expect(keyOutcome(chord(letter, { altKey: true }), scene())).toBeNull();
      expect(keyOutcome(chord(letter, { metaKey: true }), scene())).toBeNull();
    }
    expect([...TOOL_KEYS.keys()].sort()).toEqual(["e", "h", "p", "s", "t", "v"]);
  });

  it("has no use for other keys, including names an object would inherit", () => {
    for (const key of ["x", "Tab", "1", "ArrowLeft", "constructor", "toString", "__proto__"]) {
      expect(keyOutcome(chord(key), scene())).toBeNull();
    }
  });
});

describe("space: the hand (FineNotes#7)", () => {
  it("holds the hand with a bare space", () => {
    expect(keyOutcome(chord(" "), scene())).toEqual(loud("hand"));
  });

  it("leaves space to a text box being edited, and to chords", () => {
    expect(keyOutcome(chord(" "), scene({ editingText: true }))).toBeNull();
    expect(keyOutcome(chord(" ", { ctrlKey: true }), scene())).toBeNull();
    expect(keyOutcome(chord(" ", { altKey: true }), scene())).toBeNull();
  });
});

describe("desktop modifier compatibility", () => {
  it.each(["Linux", "Windows", "macOS"])(
    "resolves history and clipboard shortcuts on %s",
    (platform) => {
      const modifier = platform === "macOS" ? { metaKey: true } : { ctrlKey: true };
      expect(keyOutcome(chord("z", modifier), scene())).toEqual(loud("undo"));
      expect(keyOutcome(chord("Z", { ...modifier, shiftKey: true }), scene())).toEqual(
        loud("redo"),
      );
      for (const key of ["c", "x", "v"])
        expect(keyOutcome(chord(key, modifier), scene({ clipboard: true }))).toEqual(quiet("none"));
    },
  );
  it("accepts Ctrl+Y redo and leaves modified host/AltGraph chords alone", () => {
    expect(keyOutcome(chord("y", { ctrlKey: true }), scene())).toEqual(loud("redo"));
    for (const mods of [
      { ctrlKey: true, altKey: true },
      { ctrlKey: true, shiftKey: true },
      { metaKey: true },
    ])
      expect(keyOutcome(chord("y", mods), scene())).toBeNull();
    expect(keyOutcome(chord("z", { ctrlKey: true, altKey: true }), scene())).toBeNull();
    expect(keyOutcome(chord("z", { metaKey: true, altKey: true }), scene())).toBeNull();
  });
});
