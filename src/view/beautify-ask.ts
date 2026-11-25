/**
 * Beautify's question about the words Grape is not sure of (Joost, 25
 * November): before writing, the word card opens on each such word in turn,
 * the same card a tapped underline or "Correct" opens (word-check.ts), and
 * its answer is saved as any correction is (it teaches Grape). A word the
 * writer answers is written too; one whose card they close stays their ink.
 *
 * The card closes as soon as a row or a chip is tapped, and its answer is
 * reported once saved (a write of the corrections file, slow on a tablet);
 * "Type what it says" closes it to open a dialog whose answer comes later.
 * So a word whose card was closed by a tap on one of its choices waits,
 * after any dialog has gone, for the answer; a card closed beside it is a
 * skip and nothing is waited for.
 *
 * No DOM, no Obsidian: the view hands in how to open a card.
 */

/** How the view opens the word card. */
export interface WordCardHost {
  /**
   * Open the card on the word this ink is in; false when it could not be
   * (no word there, the page gone). `after.chosen` when one of its rows or
   * chips is tapped, `after.done` when an answer is saved, `after.closed`
   * when the card goes.
   */
  open(
    strokeIds: string[],
    after: { chosen: () => void; done: () => void; closed: () => void },
  ): Promise<boolean>;
  /** Whether a dialog the card opened ("Type what it says") is still up. */
  dialogOpen(): boolean;
}

/** How often to look again for the dialog, and for a chosen answer's save. */
export const POLL_MS = 150;
/** Longest wait for a chosen answer to be saved (or a typed one to be given) before moving on. */
export const ANSWER_WAIT_MS = 10_000;

const pause = (ms: number): Promise<void> =>
  new Promise((done) => {
    window.setTimeout(done, ms);
  });

/**
 * Ask about each word (its ink) in turn; resolves with the ink of each one
 * answered. `stop` ends the asking (an edit, another notebook): the words
 * not yet asked stay as written.
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
    let chosen = false;
    let done = false;
    let closed = (): void => {};
    const gone = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const opened = await host.open([...ids], {
      chosen: () => (chosen = true),
      done: () => (done = true),
      closed: () => closed(),
    });
    if (!opened) continue;
    await gone;
    while (host.dialogOpen() && !stop()) await wait(POLL_MS);
    // A choice was tapped: its answer is being saved (or was typed in the dialog just closed).
    for (let waited = 0; chosen && !done && waited < ANSWER_WAIT_MS && !stop(); waited += POLL_MS) {
      await wait(POLL_MS);
    }
    if (done) answered.push([...ids]);
  }
  return answered;
}
