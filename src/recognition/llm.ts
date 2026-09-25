/**
 * Cloud AI as a transcription engine: each page goes to the vision model the
 * settings name, with the user's own key, as a one-question chat
 * (`ai-client.ts`). The view sends the page as the reader sees it; when it
 * cannot, the ink is drawn on white here instead (`render.ts`).
 */

import type { RecognitionProvider, RecognitionRequest, RecognitionResult } from "./provider";
import { LLM_PROVIDER_ID } from "./llm-request";
import { type AiVendorConfig, assertConfigured, transcribePageImage } from "./ai-client";
import { renderStrokesForRecognition } from "./render";

/** The vendor, model, key and endpoint a transcription uses. */
export type LlmProviderConfig = AiVendorConfig;

export class LlmProvider implements RecognitionProvider {
  readonly id = LLM_PROVIDER_ID;
  readonly requiresNetwork = true;

  /** `config` is asked again for every page, so a change in settings applies at once. */
  constructor(private readonly config: () => LlmProviderConfig) {}

  async recognize(req: RecognitionRequest): Promise<RecognitionResult> {
    const config = this.config();
    // An unusable setup is reported before any time goes into a picture.
    assertConfigured(config);
    const image = req.pageImage ?? renderStrokesForRecognition(req.strokes);
    if (!image) return { text: "" };
    return {
      text: await transcribePageImage(config, image.base64, req.pageImage !== undefined),
    };
  }
}
