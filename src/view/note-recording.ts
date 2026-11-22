/**
 * Recordings in a text note: record from the note, a card for each
 * recording in the text (`AudioBlock`), the notebook's player, and the
 * notebook's transcription — online or on this device, whichever the
 * settings choose, into a transcript note of its own.
 *
 * Everything here is the notebook's (`note-audio.ts`): the recorder, the
 * recording pill (time, bin, Stop), the player bar, the consent-gated
 * `plugin.transcribeAudioFile`, the device transcriber and the transcript
 * note's layout. What differs is where a recording lives: in a notebook it
 * is an entry of the document; in a note it is a line of the text, so it
 * goes where the caret is, moves like a picture, and Undo takes it out
 * (never the file).
 *
 * - **Stops by itself**, saying why, when Obsidian goes to the background
 *   on a phone or an iPad (WKWebView mutes the microphone there), or when
 *   the note closes; what was recorded is kept and put in the note.
 * - **Transcript.** A note keeps no link to it: it is found by the
 *   recording's name (`latestTranscriptPath`). Once there is one, the
 *   card's transcript button opens a menu: open it, put its text in the
 *   note under the recording, or transcribe again.
 */

import { type App, Menu, Notice, Platform, type TFile, normalizePath } from "obsidian";
import { t } from "../i18n/translate";
import {
  RecordingClock,
  audioMimeForExtension,
  baseNameOf,
  buildTranscriptNote,
  formatClock,
  transcriptPathFor,
  transcriptText,
} from "../audio/recording";
import { isOnlineSpeechService } from "../audio/online-speech";
import { buildTimedTranscript } from "../audio/speech-chunks";
import { speechModelInfo } from "../audio/speech-models";
import { availablePath, parentFolder } from "../canvas/image-raster";
import type { Recording } from "../model/document";
import { latestTranscriptPath } from "../model/note-files";
import { recordingStartFromName } from "../model/note-audio-embed";
import { stripTextNoteSuffix } from "../model/text-note-file";
import type { AudioBlock } from "../model/text-note";
import { audioAvailability } from "../recognition/ai-menu-model";
import { ConfirmModal } from "../ui/confirm-modal";
import { errorMessage } from "../util/errors";
import type GoodObsidianPlugin from "../main";
import { AudioRecorder, type RecorderResult } from "./audio-recorder";
import { AudioPlayerBar, RecordingPill, tapButton } from "./audio-ui";
import { ensureFolder } from "./note-files";

/** What the note view lends its recordings. */
export interface NoteRecordingHost {
  readonly app: App;
  /** The plugin, for transcription; null where there is none (the UI gallery). */
  plugin: () => GoodObsidianPlugin | null;
  /** The note shown, or null. */
  file: () => TFile | null;
  /** Where the note keeps recordings and transcripts; undefined for Obsidian's attachment location. */
  folder: (kind: "audio" | "transcripts") => string | undefined;
  /** What the recording pill and the player float over. */
  container: () => HTMLElement;
  /** Put a recording in the note, at the caret. */
  insertAudio: (path: string, duration: number) => void;
  /** Put a transcript's text in the note right under its recording. */
  insertTextAfter: (id: string, text: string) => boolean;
  /** Draw every recording's card again. */
  refreshCards: () => void;
  /** A recording started or stopped: the bar shows it. */
  recordingChanged: () => void;
}

type StopReason = "user" | "hidden" | "closed";

/** A recording at least this long asks before the pill's bin discards it, ms. */
const DISCARD_CONFIRM_MS = 30000;
/** How often the recording pill's time is redrawn, ms. */
const PILL_TICK_MS = 500;

export class NoteRecordings {
  private readonly clock = new RecordingClock(
    () => Date.now(),
    () => performance.now(),
  );
  private recorder: AudioRecorder | null = null;
  private starting = false;
  private finishing: Promise<void> | null = null;
  private pill: RecordingPill | null = null;
  private tick = 0;
  private player: AudioPlayerBar | null = null;
  private transcribing = false;
  private alive = true;
  private readonly unsubscribe: () => void;

  constructor(private readonly host: NoteRecordingHost) {
    const plugin = host.plugin();
    this.unsubscribe = plugin ? plugin.speech.subscribe(() => host.refreshCards()) : () => {};
  }

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  // --- Recording ----------------------------------------------------------------

  /** Start a recording, or stop the one running. Call inside the tap. */
  toggle(): void {
    if (this.recorder) {
      void this.stop("user");
      return;
    }
    if (this.starting || this.finishing) return;
    void this.start();
  }

  private async start(): Promise<void> {
    const file = this.host.file();
    if (!file) return;
    const recorder = new AudioRecorder(this.host.app, this.clock);
    this.starting = true;
    const folder = this.host.folder("audio");
    // Synchronously, inside the tap: `start` asks for the microphone before
    // its first await. The folder is made meanwhile; the first chunk waits for it.
    const started = recorder.start(file.path, folder);
    const made = folder ? ensureFolder(this.host.app, folder) : Promise.resolve();
    this.closePlayer();
    try {
      await Promise.all([started, made]);
    } catch (error) {
      new Notice(t("ai.rec.startFailed", { message: errorMessage(error) }), 10000);
      return;
    } finally {
      this.starting = false;
    }
    if (!this.alive) {
      void recorder.stop();
      return;
    }
    this.recorder = recorder;
    recorder.onInterrupted = () => void this.stop("user");
    this.showPill();
    this.host.recordingChanged();
  }

  /** Stop the running recording, save it, and put it in the note. */
  stop(reason: StopReason): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return this.finishing ?? Promise.resolve();
    this.recorder = null;
    this.hidePill();
    this.host.recordingChanged();
    const finishing: Promise<void> = recorder
      .stop()
      .then((result) => this.finish(result, reason))
      .catch((error) => {
        new Notice(t("ai.rec.saveFailed", { message: errorMessage(error) }), 0);
      })
      .finally(() => {
        if (this.finishing === finishing) this.finishing = null;
      });
    this.finishing = finishing;
    return finishing;
  }

  private finish(result: RecorderResult, reason: StopReason): void {
    const { saved, problem } = result;
    if (!saved) {
      new Notice(
        problem ? t("ai.rec.saveFailed", { message: problem }) : t("ai.rec.nothingRecorded"),
        10000,
      );
      return;
    }
    this.host.insertAudio(saved.path, saved.duration);
    if (reason === "hidden") new Notice(t("ai.rec.notice", { text: t("ai.rec.stopHidden") }), 0);
    if (problem) new Notice(t("ai.rec.notice", { text: t("ai.rec.partMissing", { problem }) }), 0);
  }

  private async discard(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    if (this.clock.elapsed() >= DISCARD_CONFIRM_MS) {
      const sure = await ConfirmModal.confirm(this.host.app, {
        title: t("ai.rec.discardTitle"),
        message: t("ai.rec.discardMessage", { length: formatClock(this.clock.elapsed()) }),
        cta: t("ai.rec.discardCta"),
      });
      if (!sure || this.recorder !== recorder) return;
    }
    this.recorder = null;
    this.hidePill();
    this.host.recordingChanged();
    const finishing: Promise<void> = recorder
      .stop()
      .then(async ({ saved }) => {
        const file = saved ? this.host.app.vault.getFileByPath(saved.path) : null;
        if (file) await this.host.app.fileManager.trashFile(file);
        new Notice(t("ai.rec.discarded"));
      })
      .catch((error) => {
        new Notice(t("ai.rec.discardFailed", { message: errorMessage(error) }), 0);
      })
      .finally(() => {
        if (this.finishing === finishing) this.finishing = null;
      });
    this.finishing = finishing;
    await finishing;
  }

  private showPill(): void {
    this.pill?.destroy();
    this.pill = new RecordingPill(
      this.host.container(),
      () => void this.stop("user"),
      () => void this.discard(),
    );
    window.clearInterval(this.tick);
    this.tick = window.setInterval(() => this.pill?.update(this.clock.elapsed()), PILL_TICK_MS);
  }

  private hidePill(): void {
    window.clearInterval(this.tick);
    this.tick = 0;
    this.pill?.destroy();
    this.pill = null;
  }

  // --- Lifecycle ------------------------------------------------------------------

  /** The document went hidden: on a phone or an iPad the microphone is about to go quiet. */
  onHidden(): void {
    if (!Platform.isMobile) return;
    if (this.recorder) void this.stop("hidden");
    this.player?.pause();
  }

  /** The note is about to be unloaded: a running recording lands in it first. */
  async finishForUnload(): Promise<void> {
    if (this.recorder) await this.stop("closed");
    else if (this.finishing) await this.finishing;
  }

  destroy(): void {
    this.alive = false;
    this.unsubscribe();
    if (this.recorder) void this.stop("closed");
    this.hidePill();
    this.closePlayer();
  }

  // --- The card ---------------------------------------------------------------------

  private resolve(path: string): TFile | null {
    const { vault, metadataCache } = this.host.app;
    return (
      vault.getFileByPath(normalizePath(path)) ??
      metadataCache.getFirstLinkpathDest(path, this.host.file()?.path ?? "")
    );
  }

  private transcriptOf(audio: TFile): TFile | null {
    const { vault } = this.host.app;
    const path = latestTranscriptPath(
      audio.path,
      this.host.folder("transcripts"),
      (p) => vault.getAbstractFileByPath(p) !== null,
    );
    return path ? vault.getFileByPath(path) : null;
  }

  /** A recording's card: play, its name and length, and its transcript. */
  drawCard(card: HTMLElement, block: AudioBlock): void {
    const audio = this.resolve(block.path);
    const job = this.host.plugin()?.speech.running;
    const running = job && audio && job.path === audio.path ? job : null;
    const playing = this.player?.recording?.path === audio?.path && audio !== null;
    card.toggleClass("is-missing", audio === null);
    const play = tapButton(
      card,
      { icon: "play", label: t("ai.audio.play"), cls: "finenotes-note-audio-play" },
      () => {
        if (audio) this.play(block, audio);
      },
    );
    play.disabled = audio === null;
    play.toggleClass("is-active", playing);
    const text = card.createDiv({ cls: "finenotes-note-audio-text" });
    const name = audio ? audio.basename : baseNameOf(block.path);
    text.createDiv({ cls: "finenotes-note-audio-name", text: name });
    const meta = running
      ? running.status
      : audio
        ? formatClock(block.duration ?? 0)
        : t("notebooks.note.missingRecording");
    text.createDiv({ cls: "finenotes-note-audio-meta", text: meta });
    if (!audio) return;
    const plugin = this.host.plugin();
    if (!plugin) return;
    if (running) {
      tapButton(card, { icon: "square", label: t("ai.audio.stopTranscribing") }, () =>
        plugin.speech.cancel(),
      );
      return;
    }
    const transcript = this.transcriptOf(audio);
    const button = tapButton(
      card,
      {
        icon: "file-text",
        label: transcript ? t("notebooks.note.transcript") : t("ai.audio.transcribe"),
        cls: "finenotes-note-audio-transcript",
      },
      () => {
        if (!transcript) {
          void this.transcribe(block, audio);
          return;
        }
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle(t("notebooks.note.putTranscript"))
            .setIcon("text-cursor-input")
            .onClick(() => void this.putTranscript(block, transcript)),
        );
        menu.addItem((item) =>
          item
            .setTitle(t("ai.audio.openTranscript"))
            .setIcon("external-link")
            .onClick(() => {
              void this.host.app.workspace.openLinkText(
                transcript.path,
                this.host.file()?.path ?? "",
                true,
              );
            }),
        );
        menu.addItem((item) =>
          item
            .setTitle(t("ai.audio.transcribeAgain"))
            .setIcon("rotate-ccw")
            .onClick(() => void this.transcribe(block, audio, true)),
        );
        const at = button.getBoundingClientRect();
        menu.showAtPosition({ x: at.left, y: at.bottom + 4 });
      },
    );
    button.toggleClass("has-transcript", transcript !== null);
  }

  // --- The player ---------------------------------------------------------------------

  private recordingOf(block: AudioBlock, audio: TFile): Recording {
    return {
      id: block.id,
      path: audio.path,
      start: recordingStartFromName(audio.basename) ?? audio.stat.ctime,
      duration: block.duration ?? 0,
    };
  }

  private play(block: AudioBlock, audio: TFile): void {
    if (this.recorder || this.starting) {
      new Notice(t("ai.rec.stopFirst"));
      return;
    }
    let player = this.player;
    if (!player) {
      player = new AudioPlayerBar(this.host.container(), () => this.closePlayer());
      this.player = player;
    }
    if (player.recording?.path !== audio.path) {
      player.load(this.recordingOf(block, audio), this.host.app.vault.getResourcePath(audio));
    }
    player.play();
    this.host.refreshCards();
  }

  private closePlayer(): void {
    const player = this.player;
    this.player = null;
    player?.destroy();
    if (player) this.host.refreshCards();
  }

  // --- Transcription ----------------------------------------------------------------

  private async putTranscript(block: AudioBlock, transcript: TFile): Promise<void> {
    const text = transcriptText(await this.host.app.vault.cachedRead(transcript));
    if (!text) {
      new Notice(t("ai.rec.transcriptEmpty"));
      return;
    }
    if (!this.alive || !this.host.insertTextAfter(block.id, text)) {
      new Notice(t("ai.rec.pasteFailed"));
    }
  }

  /**
   * Transcribe where the settings say: with the online service chosen, or
   * on this device. `again` has been asked for (the menu says so).
   */
  private async transcribe(block: AudioBlock, audio: TFile, again = false): Promise<void> {
    const plugin = this.host.plugin();
    if (!plugin) return;
    if (!again && this.transcriptOf(audio)) {
      const sure = await ConfirmModal.confirm(this.host.app, {
        title: t("ai.rec.againTitle"),
        message: t("ai.rec.againMessage"),
        cta: t("ai.audio.transcribe"),
      });
      if (!sure) return;
    }
    const recording = this.recordingOf(block, audio);
    if (isOnlineSpeechService(plugin.aiSetup().speechService)) {
      await this.transcribeOnline(plugin, recording, audio);
    } else {
      await this.transcribeOnDevice(plugin, recording, audio);
    }
  }

  private async transcribeOnDevice(
    plugin: GoodObsidianPlugin,
    recording: Recording,
    audio: TFile,
  ): Promise<void> {
    const note = this.host.file();
    const folder = this.host.folder("transcripts");
    const model = speechModelInfo(plugin.speech.modelId()).label;
    await plugin.speech.start({
      path: audio.path,
      durationMs: recording.duration,
      read: () => this.host.app.vault.readBinary(audio),
      finish: async (segments, language) => {
        const named = language && language !== "auto" ? ` (${language})` : "";
        const via = `Transcribed on this device with ${model}${named}.`;
        const path = await this.writeTranscript(
          recording,
          audio,
          buildTimedTranscript(segments),
          note,
          folder,
          via,
        );
        if (this.alive) this.host.refreshCards();
        return path;
      },
    });
  }

  private async transcribeOnline(
    plugin: GoodObsidianPlugin,
    recording: Recording,
    audio: TFile,
  ): Promise<void> {
    if (this.transcribing) {
      new Notice(t("ai.rec.busy"));
      return;
    }
    // What can be refused is refused before the file is read or anything is sent.
    const availability = audioAvailability(plugin.aiSetup());
    if (!availability.enabled) {
      new Notice(t("ai.rec.cannotTranscribe", { reason: availability.reason }), 10000);
      return;
    }
    this.transcribing = true;
    const progress = new Notice(t("ai.rec.preparing"), 0);
    try {
      const bytes = await this.host.app.vault.readBinary(audio);
      const text = await plugin.transcribeAudioFile(
        bytes,
        audioMimeForExtension(audio.extension) ?? "audio/mp4",
        (message) => progress.setMessage(t("ai.rec.notice", { text: message })),
      );
      if (text === null) return; // They declined to send it.
      const path = await this.writeTranscript(
        recording,
        audio,
        text,
        this.host.file(),
        this.host.folder("transcripts"),
      );
      if (this.alive) this.host.refreshCards();
      new Notice(t("ai.device.saved", { path }), 8000);
    } catch (error) {
      new Notice(t("ai.rec.transcribeFailed", { message: errorMessage(error) }), 12000);
    } finally {
      progress.hide();
      this.transcribing = false;
    }
  }

  /** Write the transcript note, as a notebook writes one; returns its path. */
  private async writeTranscript(
    recording: Recording,
    audio: TFile,
    text: string,
    note: TFile | null,
    folder: string | undefined,
    via?: string,
  ): Promise<string> {
    const { app } = this.host;
    const exists = (path: string): boolean => app.vault.getAbstractFileByPath(path) !== null;
    let path = normalizePath(transcriptPathFor(audio.path, folder));
    const parent = parentFolder(path);
    if (parent) await ensureFolder(app, parent);
    if (exists(path)) {
      path = normalizePath(availablePath(parentFolder(path), baseNameOf(path), "md", exists));
    }
    const noteLink = note
      ? app.fileManager.generateMarkdownLink(note, path, undefined, stripTextNoteSuffix(note.name))
      : "its note";
    const content = buildTranscriptNote({
      title: audio.basename,
      start: recording.start,
      duration: recording.duration,
      notebookLink: noteLink,
      audioEmbed: `!${app.fileManager.generateMarkdownLink(audio, path)}`,
      text,
      via,
    });
    const created = await app.vault.create(path, content);
    return created.path;
  }
}
