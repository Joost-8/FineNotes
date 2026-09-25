/**
 * Turning a caught value into text for a notice or a status line.
 *
 * Pure: no DOM, no Obsidian.
 */

/**
 * The message of an `Error`, or, for anything else that was thrown, the
 * value as a string. An `Error` with an empty message gives `""`. `fallback`,
 * when given, replaces the string for a thrown value that is not an `Error`.
 */
export function errorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}
