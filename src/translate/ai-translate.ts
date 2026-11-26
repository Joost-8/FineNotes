/**
 * Translating with the AI service the user set up (Claude, GPT, Gemini, or
 * their own endpoint), as an option of the Translate window: the prompt,
 * and the answer read back.
 *
 * - A text is translated as a whole, line breaks kept.
 * - A word or a few (`isShort`) are answered as a dictionary would: the
 *   translation, and a few notes (the word's kind, a noun's article and
 *   plural, a verb's forms, other meanings), in the language translated
 *   into. With the sentence the word stands in on the page, when there is
 *   one, so the meaning is the one meant there.
 *
 * PURE: no DOM, no Obsidian, no network.
 */

/** A word or a few: answered with dictionary notes. */
export const SHORT_WORDS = 3;
/** The sentence sent with a short text is cut at this many characters. */
export const SENTENCE_CHARS = 300;

export function isShort(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= SHORT_WORDS && !/[.!?]\s/.test(text.trim());
}

export interface AiTranslateRequest {
  text: string;
  /** The language to translate into, as a code ("en", "nl", "zh-Hans"). */
  to: string;
  /** Its name in English, for the model ("Dutch"). */
  toName: string;
  /** The text's language when the user chose it or it was detected; null to leave it to the model. */
  fromName: string | null;
  /** The sentence a short text stands in (`sentenceAround`), or null. */
  sentence: string | null;
}

export interface AiTranslation {
  translation: string;
  /** Dictionary notes for a short text; empty for longer ones. */
  notes: string[];
}

/** The system prompt and the one question, for `askAi`-style one-turn chats. */
export function buildAiTranslatePrompt(request: AiTranslateRequest): {
  system: string;
  question: string;
} {
  const from = request.fromName ? `from ${request.fromName} ` : "";
  const short = isShort(request.text);
  const system = [
    `You are a careful translator. Translate the user's text ${from}into ${request.toName}.`,
    "Translate meaning, not word for word: natural, idiomatic, the register of the original.",
    "Keep line breaks, names, numbers and formatting. Never add explanations to the translation itself.",
    short
      ? `It is a word or a short phrase: also give up to 4 short dictionary notes, written in ${request.toName}: its kind of word; for a noun its article (for example de/het) and plural; for a verb its main forms; other common meanings. Notes about the original word, not about the translation.`
      : "",
    short && request.sentence
      ? "It comes from the sentence given below it: translate the meaning it has there."
      : "",
    'Answer with JSON only: {"translation": "...", "notes": ["..."]} ("notes" empty for a longer text).',
  ]
    .filter(Boolean)
    .join("\n");
  const question =
    short && request.sentence
      ? `Text:\n${request.text}\n\nSentence it comes from:\n${request.sentence}`
      : request.text;
  return { system, question };
}

/**
 * The model's answer read back: its JSON when it gave some (a code fence
 * around it allowed), else the whole reply as the translation.
 */
export function parseAiTranslation(reply: string): AiTranslation {
  const trimmed = reply.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === "object") {
        const { translation, notes } = parsed as { translation?: unknown; notes?: unknown };
        if (typeof translation === "string" && translation.trim()) {
          return {
            translation: translation.trim(),
            notes: Array.isArray(notes)
              ? notes
                  .filter((n): n is string => typeof n === "string")
                  .map((n) => n.trim())
                  .filter(Boolean)
                  .slice(0, 6)
              : [],
          };
        }
      }
    } catch {
      // Not JSON after all: the reply is the translation.
    }
  }
  return { translation: trimmed, notes: [] };
}

/**
 * The sentence of `context` (a page's text) that holds `text`, cut to
 * `SENTENCE_CHARS`; null when it is not there, or is the text itself.
 */
export function sentenceAround(context: string | undefined, text: string): string | null {
  const needle = text.trim();
  if (!context || !needle) return null;
  const flat = context.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;
  let start = at;
  while (start > 0 && !/[.!?]/.test(flat[start - 1])) start--;
  let end = at + needle.length;
  while (end < flat.length && !/[.!?]/.test(flat[end])) end++;
  if (end < flat.length) end++;
  let sentence = flat.slice(start, end).trim();
  if (sentence.length > SENTENCE_CHARS) {
    // Keep the text in the middle of what is sent.
    const mid = at - start + needle.length / 2;
    const from = Math.max(0, Math.round(mid - SENTENCE_CHARS / 2));
    sentence = `…${sentence.slice(from, from + SENTENCE_CHARS).trim()}…`;
  }
  return sentence.toLowerCase() === needle.toLowerCase() ? null : sentence;
}
