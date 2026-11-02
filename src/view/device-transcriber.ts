/**
 * "Transcribe on this device": one job at a time, owned by the plugin so it
 * survives the menu and even the note closing.
 *
 * 1. Refuse or warn on length (speech-models.ts: no more than 30 minutes on
 *    an iPad, a question past 15).
 * 2. Download the model on first use, after saying its size (the shared
 *    model registry: verified by SHA-256, kept in the plugin's folder, so it
 *    syncs with the vault like Grape).
 * 3. Decode the recording to 16 kHz mono on the main thread (`decodeAudioData`
 *    exists only there), then hand the samples to the worker.
 * 4. Transcribe in the worker (view/speech-client.ts), reporting progress to
 *    a notice with Stop and to anyone subscribed (the recordings panel).
 *
 * Nothing runs by itself: every job starts from a tap.
 */

import { Notice, Platform } from "obsidian";
import { type SpeechSegment, SPEECH_RATE, downmix, resample } from "../audio/speech-chunks";
import {
  type SpeechModelId,
  effectiveSpeechModel,
  lengthVerdict,
  speechAsset,
  speechLanguage,
  speechModelInfo,
} from "../audio/speech-models";
import { formatSize, stateText, totalBytes } from "../downloads/model-manifest";
import type { AssetStore } from "../downloads/model-store";
import { ConfirmModal } from "../ui/confirm-modal";
import { errorMessage } from "../util/errors";
import type { ModelRegistry } from "./model-downloads";
// Started on first use, as the handwriting reader's worker is (its source is a `worker:` import).
import type { SpeechClient } from "./speech-client";
import { SpeechCancelled } from "../audio/speech-protocol";
import type { App } from "obsidian";

export interface DeviceTranscriberHost {
  readonly app: App;
  readonly models: ModelRegistry;
  /** The chosen model and language (settings). */
  speechSettings(): { model?: string; language?: string };
}

/** A job's input: what to transcribe, and where its result goes. */
export interface DeviceJob {
  /** The recording's vault path: the job's key, shown by the panel. */
  path: string;
  /** Its length, ms (from the note's recording entry). */
  durationMs: number;
  read: () => Promise<ArrayBuffer>;
  /** Write the transcript; returns where it went. */
  finish: (segments: SpeechSegment[], language: string) => Promise<string>;
}

export interface RunningJob {
  path: string;
  /** What it is doing now, for the panel. */
  status: string;
  percent: number;
}

/**
 * A file of the model, checked by size and SHA-256 as it is read. One that
 * changed since the model was found (a sync replaced or removed it) is
 * downloaded once more; null when that fails too.
 */
async function verifiedBytes(store: AssetStore, name?: string): Promise<ArrayBuffer | null> {
  const bytes = await store.bytes(name);
  if (bytes) return bytes;
  return (await store.download()) ? store.bytes(name) : null;
}

export class DeviceTranscriber {
  private client: SpeechClient | null = null;
  private current: RunningJob | null = null;
  private cancelled = false;
  private readonly listeners = new Set<() => void>();
  private notice: Notice | null = null;
  private noticeText: HTMLElement | null = null;

  constructor(private readonly host: DeviceTranscriberHost) {}

  /** The job running now, or null. */
  get running(): RunningJob | null {
    return this.current;
  }

  /** Called whenever the running job changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** The model used here, by the settings and the device. */
  modelId(): SpeechModelId {
    return effectiveSpeechModel(this.host.speechSettings().model, Platform.isMobile);
  }

  /** The registered store of a speech model. */
  store(id: SpeechModelId = this.modelId()): AssetStore {
    return this.host.models.register(speechAsset(id));
  }

  /** Transcribe a recording. Resolves once it is done, declined, refused or stopped. */
  async start(job: DeviceJob): Promise<void> {
    if (this.current) {
      new Notice("FineNotes: a recording is already being transcribed on this device.");
      return;
    }
    const app = this.host.app;
    const id = this.modelId();
    const info = speechModelInfo(id);
    const verdict = lengthVerdict(job.durationMs, id, Platform.isMobile);
    if (verdict.kind === "too-long") {
      new Notice(
        verdict.byModel
          ? `FineNotes: this recording is longer than ${verdict.limitMinutes} minutes, too long ` +
              `for ${info.label}, which would take hours. Choose a smaller voice model ` +
              "(Settings → FineNotes → Models on this device), or use an AI key."
          : `FineNotes: this recording is longer than ${verdict.limitMinutes} minutes, too long to ` +
              "transcribe on this device. Use an AI key or your own server (Settings → FineNotes → AI).",
        12000,
      );
      return;
    }
    if (verdict.kind === "warn") {
      const ok = await ConfirmModal.confirm(app, {
        title: "Transcribe a long recording?",
        message:
          `On this device this takes about ${verdict.minutes} minutes and uses battery. ` +
          "Keep Obsidian open meanwhile; you can go on writing, and stop it at any time.",
        cta: "Transcribe",
      });
      if (!ok) return;
    }
    const store = this.store(id);
    await store.check();
    if (store.state.kind !== "ready") {
      const ok = await ConfirmModal.confirm(app, {
        title: `Download ${info.label}?`,
        message:
          `Transcribing on this device needs the ${info.label} speech model ` +
          `(${formatSize(totalBytes(store.asset))}), downloaded once from GitHub. ` +
          (store.asset.deviceOnly
            ? "It stays on this computer, outside the vault, so it does not sync. "
            : "It stays in FineNotes' folder in this vault, so it syncs with it. ") +
          "Nothing you record is sent anywhere.",
        cta: "Download",
      });
      if (!ok) return;
    }

    this.cancelled = false;
    this.current = { path: job.path, status: "Starting…", percent: 0 };
    this.showNotice();
    try {
      if (store.state.kind !== "ready") {
        const unsubscribe = store.subscribe(() => this.update(stateText(store.asset, store.state)));
        const ok = await store.download().finally(unsubscribe);
        if (this.cancelled) throw new SpeechCancelled();
        if (!ok) throw new Error(stateText(store.asset, store.state));
      }
      this.update("Preparing the recording…");
      const samples = await decodeForSpeech(await job.read());
      if (this.cancelled) throw new SpeechCancelled();
      const { SpeechClient } = await import("./speech-client");
      this.client ??= new SpeechClient(async () => {
        const bytes = await verifiedBytes(this.store(), store.asset.files[1].name);
        if (!bytes) throw new Error("the speech recognizer's files are missing");
        return new TextDecoder().decode(bytes);
      });
      this.update("Loading the speech model…");
      const client = this.client;
      await client.ensureModel(id, async () => {
        const bytes = await verifiedBytes(store);
        if (!bytes) throw new Error("the speech model is missing");
        return bytes;
      });
      const language = speechLanguage(this.host.speechSettings().language);
      const result = await client.transcribe(samples, language, (p) =>
        this.update(`Transcribing on this device… ${p.percent}%`, p.percent),
      );
      if (result.segments.length === 0) {
        new Notice("FineNotes: no speech was heard in this recording.", 8000);
        return;
      }
      const path = await job.finish(result.segments, result.language);
      new Notice(`FineNotes: transcript saved to ${path}.`, 8000);
    } catch (error) {
      if (error instanceof SpeechCancelled || this.cancelled) {
        new Notice("FineNotes: transcription stopped.");
      } else {
        new Notice(
          `FineNotes: transcription on this device failed — ${errorMessage(error)}`,
          12000,
        );
      }
    } finally {
      this.current = null;
      this.hideNotice();
      this.emit();
    }
  }

  /** Stop the running job. */
  cancel(): void {
    if (!this.current) return;
    this.cancelled = true;
    this.client?.cancel();
  }

  private update(status: string, percent = this.current?.percent ?? 0): void {
    if (!this.current) return;
    this.current = { ...this.current, status, percent };
    this.noticeText?.setText(`FineNotes: ${status}`);
    this.emit();
  }

  /** A notice that stays up with the progress and a Stop button. Tapping it only hides it. */
  private showNotice(): void {
    const fragment = createFragment();
    const wrap = fragment.createDiv({ cls: "goodobsidian-speech-notice" });
    this.noticeText = wrap.createSpan({ text: "FineNotes: starting…" });
    const stop = wrap.createEl("button", {
      cls: "goodobsidian-speech-notice-stop clickable-icon",
      text: "Stop",
    });
    stop.addEventListener("click", (event) => {
      event.stopPropagation();
      this.cancel();
    });
    this.notice = new Notice(fragment, 0);
  }

  private hideNotice(): void {
    this.notice?.hide();
    this.notice = null;
    this.noticeText = null;
  }

  /** Let go of the worker and its model (its files are being removed or replaced). */
  release(): void {
    this.cancel();
    this.client?.dispose();
    this.client = null;
  }

  dispose(): void {
    this.cancel();
    this.client?.dispose();
    this.client = null;
    this.hideNotice();
  }
}

/**
 * A recording as 16 kHz mono samples. Decoding into a 16 kHz offline context
 * makes the browser resample (WebKit and Chromium both do it well); a
 * platform that refuses that rate decodes at its own and is resampled here.
 */
export async function decodeForSpeech(bytes: ArrayBuffer): Promise<Float32Array> {
  let buffer: AudioBuffer;
  try {
    buffer = await new OfflineAudioContext(1, 1, SPEECH_RATE).decodeAudioData(bytes.slice(0));
  } catch {
    const context = new OfflineAudioContext(1, 1, 44100);
    buffer = await context.decodeAudioData(bytes.slice(0));
  }
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    // A copy: the worker takes the samples over, which a view into the
    // AudioBuffer's own storage cannot be.
    const copy = new Float32Array(buffer.length);
    buffer.copyFromChannel(copy, c);
    channels.push(copy);
  }
  return resample(downmix(channels), buffer.sampleRate, SPEECH_RATE);
}
