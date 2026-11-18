/**
 * What the rest of the plugin sees of "Help improve Grape"
 * (view/grape-sharing.ts). Types only: the feature itself is loaded with
 * `import()` behind the `__FINENOTES_SHARING__` define, so a release built
 * without it carries none of its code, address or texts' callers.
 */

import type { App, Setting } from "obsidian";
import type { LearningHost } from "./handwriting-learning";

export interface SharingFeature {
  /** Draw the settings row; `redraw` re-renders it after a change. */
  drawRow(setting: Setting, redraw: () => void): void;
  /** The one-time invite, drawn into the learn window under a run that helped. */
  drawInvite(parent: HTMLElement): void;
  /** The one-time invite as a card in the corner, when a practice sheet was just finished. */
  inviteAfterSheet(): void;
  /** On load: send a delete the server has not confirmed yet. */
  start(): void;
}

/** What the feature needs from the plugin. */
export interface SharingHost {
  app: App;
  learning(): LearningHost;
  /** FineNotes' version. */
  version: string;
  /** The Grape the device reads with ("grape-2.0"), or null. */
  grape(): string | null;
}
