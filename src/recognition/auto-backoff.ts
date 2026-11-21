/**
 * Automatic transcription after a failure (FineNotes#265 review): a spent
 * quota, a wrong key or no connection fails every request alike, and the
 * automatic run used to try again, and say so in a notice, after every
 * 30-second pause in writing. After a failure it now waits: 10 minutes,
 * then twice as long after each further failure, up to an hour. Only the
 * first failure of a run of them is shown. Any success, automatic or
 * by hand, ends the wait.
 *
 * Pure: the caller keeps the state and passes the clock in.
 */

/** The first wait after a failure. */
export const AUTO_BACKOFF_FIRST_MS = 10 * 60_000;
/** The longest wait. */
export const AUTO_BACKOFF_MAX_MS = 60 * 60_000;

export interface AutoBackoff {
  /** Automatic runs that failed in a row. */
  failures: number;
  /** No automatic run before this time (ms since the epoch); 0: none waiting. */
  until: number;
}

export const NO_BACKOFF: AutoBackoff = { failures: 0, until: 0 };

/** The state after an automatic run failed at `now`. */
export function afterAutoFailure(state: AutoBackoff, now: number): AutoBackoff {
  const failures = state.failures + 1;
  const wait = Math.min(AUTO_BACKOFF_MAX_MS, AUTO_BACKOFF_FIRST_MS * 2 ** (failures - 1));
  return { failures, until: now + wait };
}

/** How long, in ms, automatic runs still wait at `now`; 0 when they may run. */
export function autoWaitLeft(state: AutoBackoff, now: number): number {
  return Math.max(0, state.until - now);
}

/** Whether the failure that led to `state` is the one to show: the first of a run of them. */
export function showsAutoFailure(state: AutoBackoff): boolean {
  return state.failures === 1;
}
