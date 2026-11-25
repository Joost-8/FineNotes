/**
 * Beautify's question about the words Grape is not sure of (Joost, 25
 * November): before writing, the word card opens on each such word in turn,
 * the same card a tapped underline or "Correct" opens (word-check.ts), and
 * its answer is saved as any correction is (it teaches Grape). A word the
 * writer answers is written too; one whose card they close stays their ink.
 *
 * The card closes as soon as an answer is picked, and "Type what it says"
 * closes it to open a dialog whose answer comes later: so a word counts as
 * answered once the card has closed, any dialog it opened has gone, and the
 * card reported an answer.
 *
 * No DOM, no Obsidian: the view hands in how to open a card.
 */

/** How the view opens the word card. */
export interface WordCardHost {
  /**
   * Open the card on the word this ink is in; false when there is none.
   * `after.done` when an answer is saved, `after.closed` when the card goes.
   */
  open(strokeIds: string[], after: { done: () => void; closed: () => void }): Promise<boolean>;
  /** Whether a dialog the card opened ("Type what it says") is still up. */
  dialogOpen(): boolean;
}

/** How long to look again for a dialog, and to wait for an answer to be saved after it. */
export const DIALOG_POLL_MS = 150;
export const ANSWER_GRACE_MS = 400;

const pause = (ms: number): Promise<void> =>
  new Promise((done) => {
    activeWindow.setTimeout(done, ms);
  });

/**
 * Ask about each word (its ink) in turn; resolves with the ink of each one
 * answered. `stop` ends the asking (an edit): the words not yet asked stay
 * as written.
 */
export async function askUnsureWords(
  host: WordCardHost,
  words: readonly (readonly string[])[],
  stop: () => boolean,
  wait: (ms: number) => Promise<void> = pause,
): Promise<string[][]> {
  const answered: string[][] = [];
  for (const ids of words) {
    if (stop()) break;
    let done = false;
    let closed = (): void => {};
    const gone = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const opened = await host.open([...ids], { done: () => (done = true), closed: () => closed() });
    if (!opened) continue;
    await gone;
    while (host.dialogOpen() && !stop()) await wait(DIALOG_POLL_MS);
    // An answer is saved, then reported: give the last one its moment.
    if (!done) await wait(ANSWER_GRACE_MS);
    if (done) answered.push([...ids]);
  }
  return answered;
}
