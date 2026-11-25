/**
 * The E-ink screen setting on this device (discussion #309): the choice,
 * kept per device because the plugin's settings sync to the person's other
 * devices, whether the device is a known e-ink one, and what turning it on
 * does outside a notebook. The rules are `model/eink.ts`'s.
 *
 * On, FineNotes' chrome holds still (`motion.ts` and the body class
 * styles.css reads), and each notebook keeps its wet layer shown between
 * strokes. Turning it on or off applies at once.
 */

import { type EinkChoice, einkOn, isEinkModel, parseEinkChoice } from "../model/eink";
import { setEinkStill } from "./motion";

/** The class on each window's body while FineNotes draws for e-ink; styles.css stops animations under it. */
export const EINK_CLASS = "goodobsidian-eink";

/** Where this device keeps its choice (`App.loadLocalStorage`, never synced). */
export const EINK_STORAGE_KEY = "goodobsidian:eink-screen";

/** What the setting needs from the plugin. */
export interface EinkHost {
  load(): unknown;
  save(choice: EinkChoice): void;
  /** The bodies of the windows open now: the main one and any popouts. */
  bodies(): HTMLElement[];
  /** Tell every open notebook. */
  apply(on: boolean): void;
}

/** `navigator.userAgentData`, where Chromium has it. */
interface AgentData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>;
}

export class EinkScreen {
  private stored: EinkChoice;
  /**
   * The device model, once Chromium has said it (`userAgentData`): null
   * before, and where the WebView has no such API, so Auto stays off there.
   */
  private deviceModel: string | null = null;
  /** Whether this WebView has `userAgentData` to ask, for the diagnostics. */
  private modelApi = false;

  constructor(private readonly host: EinkHost) {
    this.stored = parseEinkChoice(host.load());
  }

  /** The choice on this device. */
  get choice(): EinkChoice {
    return this.stored;
  }

  /** Whether this device looks like an e-ink one. */
  get detected(): boolean {
    return isEinkModel(this.deviceModel);
  }

  /** Whether FineNotes draws for an e-ink screen now. */
  get on(): boolean {
    return einkOn(this.stored, this.detected);
  }

  /**
   * Apply the choice, then ask Chromium for the device model, and apply
   * again once it answers: Auto turns on for a known e-ink one.
   */
  start(agentData: AgentData | undefined = navigatorAgentData()): void {
    this.sync();
    if (typeof agentData?.getHighEntropyValues !== "function") return;
    this.modelApi = true;
    void agentData
      .getHighEntropyValues(["model"])
      .then((values) => {
        const model = values.model?.trim() ?? "";
        if (model === "") return;
        this.deviceModel = model;
        this.sync();
      })
      .catch(() => {
        // No model to be had: the choice stands as it is.
      });
  }

  /** Store a new choice on this device and apply it. */
  set(choice: EinkChoice): void {
    this.stored = choice;
    this.host.save(choice);
    this.sync();
  }

  /** Put the mode on the bodies, the chrome's motion and the open notebooks. */
  sync(): void {
    const on = this.on;
    setEinkStill(on);
    for (const body of this.host.bodies()) body.toggleClass(EINK_CLASS, on);
    this.host.apply(on);
  }

  /** Turn everything back as it was (the plugin unloads). */
  stop(): void {
    setEinkStill(false);
    for (const body of this.host.bodies()) body.removeClass(EINK_CLASS);
  }

  /** For the diagnostics export: what was chosen, what the device said it is, and whether it could. */
  report(): { choice: EinkChoice; on: boolean; model: string | null; modelApi: boolean } {
    return { choice: this.stored, on: this.on, model: this.deviceModel, modelApi: this.modelApi };
  }
}

function navigatorAgentData(): AgentData | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { userAgentData?: AgentData }).userAgentData;
}
