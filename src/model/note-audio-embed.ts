/**
 * A recording in a text note, as its file writes it: an embed on a line of
 * its own, so any Markdown editor (and Obsidian's reading view) plays it,
 * with the recording's length after the bar:
 *
 * ```
 * ![[Lecture/Recordings/Recording 2026-11-22 10-30.m4a|1:23]]
 * ```
 *
 * The length is kept because a recording made in the browser often has none
 * in its own header (a fragmented MP4), and the player's scrubber needs it.
 * An embed of an audio file with any other text after the bar is the user's
 * own, and stays body text, as it was written. PURE.
 */

/** The file types Obsidian plays as audio. */
export const AUDIO_EXTENSIONS: readonly string[] = [
  "m4a",
  "mp3",
  "wav",
  "webm",
  "ogg",
  "oga",
  "3gp",
  "flac",
  "aac",
];

const AUDIO_EMBED = new RegExp(
  String.raw`^!\[\[([^\]|\n]+?\.(?:${AUDIO_EXTENSIONS.join("|")}))(?:\|([^\]\n]*))?\]\]\s*$`,
  "i",
);
const LENGTH = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;

/** Whether a vault path or link names an audio file. */
export function isAudioPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && AUDIO_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}

/** A length as the embed writes it: `0:07`, `12:05`, `1:02:03`. */
export function formatAudioLength(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** A length the embed wrote, ms; `undefined` for anything that is not one. */
export function parseAudioLength(text: string): number | undefined {
  const match = LENGTH.exec(text.trim());
  if (!match) return undefined;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (seconds >= 60 || (match[1] && minutes >= 60)) return undefined;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

/** A line as a recording: its path and length; `null` for any other line. */
export function readAudioEmbed(line: string): { path: string; duration?: number } | null {
  const match = AUDIO_EMBED.exec(line);
  if (!match) return null;
  const path = match[1].trim();
  if (!path) return null;
  if (match[2] === undefined) return { path };
  const duration = parseAudioLength(match[2]);
  if (duration === undefined) return null;
  return duration > 0 ? { path, duration } : { path };
}

/**
 * When a recording started, read from the name the recorder gave it
 * (`Recording 2026-11-22 10-30`, local time), or `undefined` for any other
 * name. A file's own creation time is not trusted: a sync rewrites it.
 */
export function recordingStartFromName(name: string): number | undefined {
  const match = /Recording (\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})/.exec(name);
  if (!match) return undefined;
  const [year, month, day, hours, minutes] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) {
    return undefined;
  }
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

/** A recording as its line in the file. */
export function audioEmbedLine(block: { path: string; duration?: number }): string {
  const length =
    block.duration !== undefined && Math.round(block.duration / 1000) > 0
      ? `|${formatAudioLength(block.duration)}`
      : "";
  return `![[${block.path}${length}]]`;
}
