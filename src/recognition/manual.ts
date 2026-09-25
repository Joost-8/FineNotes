/**
 * "Manual": the engine for typing the text layer yourself. It reads nothing
 * and sends nothing, and it is what every unknown setting falls back to.
 */

import type { RecognitionProvider } from "./provider";

export const MANUAL_PROVIDER_ID = "manual";

export const manualProvider: RecognitionProvider = {
  id: MANUAL_PROVIDER_ID,
  requiresNetwork: false,
  recognize: () => Promise.resolve({ text: "" }),
};
