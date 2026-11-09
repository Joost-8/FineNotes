/**
 * Home's update control (2.8.4): a circle of two arrows that checks for a
 * newer FineNotes when tapped. A newer one turns it into an "Update to x"
 * pill, which opens FineNotes' page under Community plugins; none says
 * "No update" for a moment and shrinks back to the arrows.
 *
 * PURE: no DOM, no Obsidian, no network. The reading itself is
 * `view/update-notice.ts`'s, the version order `update-check.ts`'s.
 */

/** Where a check the user asked for stands. */
export type CheckPhase = "idle" | "checking" | "none" | "offline";

/** What one check found: a newer version, nothing newer, or no answer. */
export type CheckOutcome = "found" | "none" | "offline";

/** What the control shows. */
export type UpdateButtonLook =
  | { kind: "check" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "offline" }
  | { kind: "update"; version: string };

/** How long "No update" (or the no-connection mark) stays before the arrows come back. */
export const CHECK_RESULT_MS = 2200;

/**
 * The look for `available` (the newer version known, or null) and the
 * phase of the last check. A known update wins: there is nothing to check,
 * only to install.
 */
export function updateButtonLook(available: string | null, phase: CheckPhase): UpdateButtonLook {
  if (available !== null) return { kind: "update", version: available };
  if (phase === "idle") return { kind: "check" };
  return { kind: phase };
}

/** The phase a finished check leaves: "found" shows as the pill, through `available`. */
export function phaseAfter(outcome: CheckOutcome): CheckPhase {
  return outcome === "found" ? "idle" : outcome;
}
