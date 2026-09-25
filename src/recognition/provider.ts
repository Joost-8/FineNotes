/**
 * What a transcription engine is. The view hands one page to whichever engine
 * the settings name (see `registry.ts`) and writes the text it gets back into
 * the note's text layer.
 */

import type { Stroke } from "../model/document";

/** One page to transcribe. */
export interface RecognitionRequest {
  /** The page's ink, in page coordinates. */
  strokes: readonly Stroke[];
  /**
   * The page as the reader sees it — paper, typed text boxes and ink — as a
   * PNG in base64 without a data-URL prefix. When it is missing, an engine
   * that reads images draws `strokes` on white itself.
   */
  pageImage?: { base64: string };
  /**
   * Status lines for a job slow enough to report on. The cloud engine sends
   * one request per page and has nothing to report.
   */
  onProgress?: (message: string) => void;
}

export interface RecognitionResult {
  /** Markdown for the text layer; "" when the engine read nothing. */
  text: string;
}

export interface RecognitionProvider {
  /** The id `settings.recognitionProviderId` stores. */
  readonly id: string;
  /** Whether a page leaves the device, which needs the user's consent first. */
  readonly requiresNetwork: boolean;
  recognize(req: RecognitionRequest): Promise<RecognitionResult>;
}
