/**
 * Audio for one open note (0.5): record against the notes, replay from the
 * ink, transcribe. The ink view owns one of these and forwards its toolbar
 * taps and lifecycle to it; everything audio-shaped lives here so the view
 * stays a thin host.
 *
 * - **Record.** The mic starts and stops a recording (`AudioRecorder`). While
 *   it runs the mic is tinted, a red pill shows the time, and the strokes
 *   drawn are stamped on the recording's own clock. On stop the recording
 *   joins the note through `AddRecording` on the surface's undo stack, so it
 *   saves with the note — and Undo takes the entry away but never the file.
 * - **Stop by itself**, saying why, when Obsidian goes to the background (an
 *   iPad that locks stops recording, and a plugin cannot change that), when
 *   the note is closed or changes on disk, or when the microphone goes away.
 * - **Discard.** The bin on the recording pill stops the recording and throws
 *   the audio away: nothing joins the note, and the file goes to the trash.
 * - **Replay.** The page sidebar's Audio tab lists the note's recordings; Play
 *   opens a player bar, and while it is open a tap on ink seeks to a few
 *   seconds before that ink was written — on any page, since every page's
 *   `epoch` is wall-clock time.
 * - **Transcribe** through `plugin.transcribeAudioFile`, the one
 *   consent-gated way audio leaves the device, into a note of its own beside
 *   the audio file. The notebook's markdown is never touched.
 */

import { type App, Notice, Platform, type TFile, normalizePath } from "obsidian";
import {
  RecordingClock,
  audioMimeForExtension,
  baseNameOf,
  buildTranscriptNote,
  findRecordingAt,
  formatClock,
  nextRecordingId,
  seekTargetMs,
  strokeTime,
  transcriptPathFor,
  uploadSizeProblem,
} from "../audio/recording";
import { availablePath, parentFolder } from "../canvas/image-raster";
import { attachmentFolder } from "../model/attachment-folders";
import type { InkDocument, Page, Recording, Stroke } from "../model/document";
import { stripInkSuffix } from "../model/new-notebook";
import { AddRecording, RemoveRecording, SetRecordingTranscript } from "../model/recording-commands";
import { audioAvailability } from "../recognition/ai-menu-model";
import { ConfirmModal } from "../ui/confirm-modal";
import type GoodObsidianPlugin from "../main";
import { AudioRecorder, type RecorderInterruption, type RecorderResult } from "./audio-recorder";
import {
  AudioPlayerBar,
  type RecordingEntry,
  RecordingPill,
  RecordingSuggestModal,
  RecordingsPanel,
} from "./audio-ui";
import type { InkSurface } from "./ink-surface";
import type { Toolbar } from "./toolbar";
import { errorMessage } from "../util/errors";

/** What the note view lends the audio controller. */
export interface NoteAudioHost {
  readonly app: App;
  readonly plugin: GoodObsidianPlugin;
  /** The note shown, or `null`. */
  file(): TFile | null;
  surface(): InkSurface | null;
  toolbar(): Toolbar | null;
  /** Whether the note is protected (its ink failed to load). Silent. */
  isLocked(): boolean;
}

/** Why a recording stopped. */
type StopReason = "user" | "hidden" | "closed" | "file-changed" | RecorderInterruption;

/** A recording at least this long asks before the pill's bin discards it, ms. */
const DISCARD_CONFIRM_MS = 30000;

/** How often the recording pill's time is redrawn, ms. */
const PILL_TICK_MS = 500;

/**
 * The first recording in a session says, once, that recording stops when the
 * iPad locks or Obsidian is left — the one limit a plugin cannot lift.
 */
let limitExplained = false;

export class NoteAudio {
  /** Strokes and recordings share this clock (see `RecordingClock`). */
  private readonly clock = new RecordingClock(
    () => Date.now(),
    () => performance.now(),
  );
  private recorder: AudioRecorder | null = null;
  /** A recording being asked for (the microphone prompt may be up). */
  private starting = false;
  /** A recording being stopped and saved. */
  private finishing: Promise<void> | null = null;
  private pill: RecordingPill | null = null;
  private tick = 0;
  private player: AudioPlayerBar | null = null;
  private panel: RecordingsPanel | null = null;
  private transcribing = false;
  private alive = true;

  constructor(private readonly host: NoteAudioHost) {}

  /** Now, in wall-clock ms, on the clock strokes are stamped with. */
  now(): number {
    return this.clock.now();
  }

  private doc(): InkDocument | null {
    return this.host.surface()?.document ?? null;
  }

  private recordings(): Recording[] {
    return this.doc()?.recordings ?? [];
  }

  // --- Recording ----------------------------------------------------------------

  /** The mic: start a recording, or stop the one running. Call inside the tap. */
  toggleRecording(): void {
    if (this.recorder) {
      void this.stopRecording("user");
      return;
    }
    if (this.starting || this.finishing) return;
    void this.startRecording();
  }

  private async startRecording(): Promise<void> {
    const file = this.host.file();
    if (!file) return;
    if (this.host.isLocked()) {
      new Notice("FineNotes: this note is protected until its ink data loads cleanly.");
      return;
    }
    const recorder = new AudioRecorder(this.host.app, this.clock);
    this.starting = true;
    // Synchronously, inside the tap: `start` asks for the microphone before
    // its first await. A player left open would be recorded too.
    const started = recorder.start(file.path, attachmentFolder(this.doc(), "audio"));
    this.closePlayer();
    try {
      await started;
    } catch (error) {
      new Notice(`FineNotes: couldn't start recording — ${errorMessage(error)}.`, 10000);
      return;
    } finally {
      this.starting = false;
    }
    if (!this.alive) {
      // The note closed while the microphone prompt was up.
      void recorder.stop();
      return;
    }
    this.recorder = recorder;
    recorder.onInterrupted = (why) => void this.stopRecording(why);
    this.host.toolbar()?.setRecording(true);
    this.panel?.setRecording(true);
    this.showPill();
    this.explainLimit(recorder.keepsScreenOn);
  }

  /** Stop the running recording, save it, and add it to the note. */
  private stopRecording(reason: StopReason): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return this.finishing ?? Promise.resolve();
    this.recorder = null;
    this.hidePill();
    this.host.toolbar()?.setRecording(false);
    this.panel?.setRecording(false);
    const finishing: Promise<void> = recorder
      .stop()
      .then((result) => this.finishRecording(result, reason))
      .catch((error) => {
        new Notice(`FineNotes: the recording could not be saved — ${errorMessage(error)}.`, 0);
      })
      .finally(() => {
        // Never left set: the mic would refuse every tap after this one.
        if (this.finishing === finishing) this.finishing = null;
      });
    this.finishing = finishing;
    return finishing;
  }

  /**
   * The bin on the pill: stop the running recording and throw it away. It
   * never joins the note, and its file goes to the trash (the user's own
   * trash setting decides which). A long recording asks first, since a stray
   * tap would otherwise lose a lecture.
   */
  private async discardRecording(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    if (this.clock.elapsed() >= DISCARD_CONFIRM_MS) {
      const sure = await ConfirmModal.confirm(this.host.app, {
        title: "Discard this recording?",
        message: `${formatClock(this.clock.elapsed())} of audio will be deleted and not added to the note.`,
        cta: "Discard",
      });
      // Stopped or discarded some other way while the question was up.
      if (!sure || this.recorder !== recorder) return;
    }
    this.recorder = null;
    this.hidePill();
    this.host.toolbar()?.setRecording(false);
    this.panel?.setRecording(false);
    const finishing: Promise<void> = recorder
      .stop()
      .then(async ({ saved }) => {
        const file = saved ? this.host.app.vault.getFileByPath(saved.path) : null;
        if (file) await this.host.app.fileManager.trashFile(file);
        new Notice("FineNotes: recording discarded.");
      })
      .catch((error) => {
        new Notice(`FineNotes: the recording could not be discarded — ${errorMessage(error)}.`, 0);
      })
      .finally(() => {
        if (this.finishing === finishing) this.finishing = null;
      });
    this.finishing = finishing;
    await finishing;
  }

  private finishRecording(result: RecorderResult, reason: StopReason): void {
    const { saved, problem } = result;
    if (!saved) {
      new Notice(
        problem
          ? `FineNotes: the recording could not be saved — ${problem}.`
          : "FineNotes: nothing was recorded.",
        10000,
      );
      return;
    }
    const length = formatClock(saved.duration);
    const surface = this.alive ? this.host.surface() : null;
    let linked = false;
    if (surface && !this.host.isLocked()) {
      surface.applyCommand(
        new AddRecording({
          id: nextRecordingId(surface.document.recordings),
          path: saved.path,
          start: saved.start,
          duration: saved.duration,
        }),
      );
      linked = true;
    }
    const why: Record<StopReason, string> = {
      user: "",
      hidden:
        "Recording stopped: Obsidian went to the background (the screen locked, or you " +
        "switched apps). ",
      closed: "Recording stopped because the note was closed. ",
      "file-changed": "Recording stopped because this note changed on disk (a sync?). ",
      error: "Recording stopped: the recorder reported an error. ",
      "track-ended": "Recording stopped: the microphone stopped sending sound. ",
      "write-failed": `Recording stopped: the audio could not be written (${problem ?? "unknown"}). `,
    };
    const where = linked
      ? `${length} saved to ${saved.path}. ` +
        (reason === "user"
          ? "Play it from the Audio tab in the page sidebar; Undo takes it off this note " +
            "(the file stays)."
          : "It is in this note's recordings (the Audio tab in the page sidebar).")
      : `${length} saved to ${saved.path}, but it could not be added to the note.`;
    const trouble =
      problem && reason !== "write-failed" ? ` Part of it may be missing: ${problem}.` : "";
    new Notice(
      `FineNotes: ${why[reason]}${where}${trouble}`,
      reason === "user" && !trouble ? 8000 : 0,
    );
  }

  private showPill(): void {
    const container = this.host.surface()?.surfaceEl;
    if (!container) return;
    this.pill?.destroy();
    this.pill = new RecordingPill(
      container,
      () => void this.stopRecording("user"),
      () => void this.discardRecording(),
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

  private explainLimit(screenOn: boolean): void {
    if (limitExplained) return;
    limitExplained = true;
    const device = Platform.isTablet ? "iPad" : Platform.isPhone ? "phone" : "";
    const message = Platform.isMobile
      ? `FineNotes is recording. Recording stops if the ${device || "device"} locks or you ` +
        "leave Obsidian — " +
        (screenOn
          ? "the screen is kept on while it records."
          : "keep the screen on (Settings → Display & Brightness → Auto-Lock → Never).")
      : "FineNotes is recording. It stops when you tap the mic again or close this note.";
    new Notice(message, 12000);
  }

  // --- Lifecycle, forwarded by the view ------------------------------------------

  /**
   * The document went hidden. On a phone or an iPad that means Obsidian went
   * to the background, where WKWebView mutes the microphone within moments:
   * stop and save now, cleanly, rather than keep a recording of silence. On
   * the desktop a hidden document is only a minimised or covered window,
   * the microphone keeps working, and a lecture recorded while reading the
   * slides in another window is exactly the point — so it carries on there.
   */
  onHidden(): void {
    if (!Platform.isMobile) return;
    if (this.recorder) void this.stopRecording("hidden");
    this.player?.pause();
  }

  /**
   * The note is about to be unloaded (closed, or the tab moves to another
   * file). Finish a running recording first, so its entry lands in *this*
   * note. Resolves true when the document changed and needs saving.
   */
  async finishForUnload(): Promise<boolean> {
    if (!this.recorder && !this.finishing) return false;
    if (this.recorder) await this.stopRecording("closed");
    else await this.finishing;
    return true;
  }

  /**
   * The view's document was replaced — loaded, reloaded because the file
   * changed on disk, or cleared. A running recording stops (its entry goes
   * into the document now shown), and the player lets go of a recording
   * that belonged to the old one.
   */
  documentReplaced(): void {
    if (this.recorder) void this.stopRecording("file-changed");
    this.closePlayer();
    this.syncChrome();
  }

  /** The document changed (an edit, undo, redo): keep the chrome in step. */
  syncChrome(): void {
    const recordings = this.recordings();
    // Its recording was undone off the note, or removed: nothing to play.
    const playing = this.player?.recording;
    if (playing && !recordings.some((r) => sameRecording(r, playing))) this.closePlayer();
    this.panel?.render(this.entries());
  }

  /** The view is closing. A recording still running is saved but can no longer join the note. */
  destroy(): void {
    this.alive = false;
    if (this.recorder) void this.stopRecording("closed");
    this.hidePill();
    this.closePlayer();
  }

  // --- Recordings panel -------------------------------------------------------------

  /** Build the recordings list into `container` (the page sidebar's Audio tab). */
  attachPanel(container: HTMLElement): void {
    this.panel = new RecordingsPanel(container, {
      play: (recording) => this.play(recording),
      transcribe: (recording) => void this.transcribe(recording),
      openTranscript: (recording) => this.openTranscript(recording),
      remove: (recording) => this.remove(recording),
      record: () => this.toggleRecording(),
    });
    this.panel.setRecording(this.recorder !== null);
    this.panel.render(this.entries());
  }

  private entries(): RecordingEntry[] {
    const vault = this.host.app.vault;
    return [...this.recordings()]
      .sort((a, b) => b.start - a.start)
      .map((recording) => ({
        recording,
        available: vault.getFileByPath(recording.path) !== null,
        hasTranscript:
          recording.transcript !== undefined && vault.getFileByPath(recording.transcript) !== null,
      }));
  }

  private remove(recording: Recording): void {
    const surface = this.host.surface();
    if (!surface) return;
    if (this.host.isLocked()) {
      new Notice("FineNotes: this note is protected until its ink data loads cleanly.");
      return;
    }
    const playing = this.player?.recording;
    if (playing && sameRecording(playing, recording)) this.closePlayer();
    surface.applyCommand(new RemoveRecording(recording));
    new Notice(
      `FineNotes: removed from this note — the audio stays in ${recording.path}. ` +
        "Undo brings it back.",
    );
  }

  private openTranscript(recording: Recording): void {
    const path = recording.transcript;
    if (!path) return;
    void this.host.app.workspace.openLinkText(path, this.host.file()?.path ?? "", true);
  }

  // --- Player and tap-to-seek -------------------------------------------------------

  /** Play `recording` from `fromMs` in the player bar, opening it if needed. */
  private play(recording: Recording, fromMs = 0): void {
    if (this.recorder || this.starting) {
      new Notice("FineNotes: stop recording before playing one back.");
      return;
    }
    const player = this.load(recording);
    if (!player) return;
    player.seek(fromMs);
    player.play();
  }

  /** Put `recording` in the player (opening it), or say why not. */
  private load(recording: Recording): AudioPlayerBar | null {
    const file = this.host.app.vault.getFileByPath(recording.path);
    if (!file) {
      new Notice(`FineNotes: the audio file is missing — ${recording.path}.`);
      return null;
    }
    const player = this.openPlayer();
    if (!player) return null;
    const current = player.recording;
    if (!current || !sameRecording(current, recording)) {
      player.load(recording, this.host.app.vault.getResourcePath(file));
    }
    return player;
  }

  private openPlayer(): AudioPlayerBar | null {
    if (this.player) return this.player;
    const surface = this.host.surface();
    if (!surface) return null;
    this.player = new AudioPlayerBar(surface.surfaceEl, () => this.closePlayer());
    surface.setStrokeTapHandler((page, stroke) => this.onStrokeTap(page, stroke));
    return this.player;
  }

  private closePlayer(): void {
    const player = this.player;
    this.player = null;
    player?.destroy();
    this.host.surface()?.setStrokeTapHandler(null);
  }

  /**
   * A tap on ink while the player is open: play from a few seconds before
   * that ink was written — in whichever of the note's recordings it falls,
   * the one in the player first. Returns false (the tap then does what it
   * would have done) for ink written outside every recording, with a hint.
   */
  private onStrokeTap(page: Page, stroke: Stroke): boolean {
    const player = this.player;
    if (!player) return false;
    const at = strokeTime(page, stroke);
    if (at === null) {
      player.hint("That ink has no time stamp — it was written before version 0.5.");
      return false;
    }
    const hit = findRecordingAt(this.recordings(), at, player.recording?.id);
    if (!hit) {
      player.hint(
        this.recordings().length > 1
          ? "That was written outside every recording in this note."
          : "That was written outside this recording — there is nothing to play there.",
      );
      return false;
    }
    const loaded = this.load(hit.recording);
    if (!loaded) return true;
    const target = seekTargetMs(hit.offsetMs, hit.recording.duration);
    loaded.seek(target);
    loaded.play();
    loaded.hint(`Playing from ${formatClock(target)}, just before that was written.`);
    return true;
  }

  // --- Transcription ----------------------------------------------------------------

  /** The AI menu's "Transcribe recording…": the one there is, or a choice. */
  transcribeFromMenu(): void {
    const recordings = this.recordings();
    if (recordings.length === 0) {
      new Notice("FineNotes: this note has no recordings yet — tap the mic to record.");
      return;
    }
    if (recordings.length === 1) {
      void this.transcribe(recordings[0]);
      return;
    }
    new RecordingSuggestModal(this.host.app, recordings, (recording) => {
      void this.transcribe(recording);
    }).open();
  }

  /**
   * Transcribe a recording into a note of its own beside the audio, and
   * point the recording at it. Everything that can be refused is refused
   * before the file is read or anything is sent: no audio-capable service,
   * or a file over the service's upload limit.
   */
  async transcribe(recording: Recording): Promise<void> {
    const { app, plugin } = this.host;
    if (this.transcribing) {
      new Notice("FineNotes: a recording is already being transcribed.");
      return;
    }
    if (this.host.isLocked()) {
      new Notice("FineNotes: this note is protected until its ink data loads cleanly.");
      return;
    }
    const audio = app.vault.getFileByPath(recording.path);
    if (!audio) {
      new Notice(`FineNotes: the audio file is missing — ${recording.path}.`);
      return;
    }
    const availability = audioAvailability(plugin.aiSetup());
    if (!availability.enabled) {
      new Notice(
        `FineNotes: can't transcribe audio — ${availability.reason}. Set it up in AI settings.`,
        10000,
      );
      return;
    }
    const tooBig = uploadSizeProblem(plugin.settings.llmVendor, audio.stat.size);
    if (tooBig) {
      new Notice(`FineNotes: ${tooBig}`, 12000);
      return;
    }
    if (recording.transcript && app.vault.getFileByPath(recording.transcript)) {
      const again = await ConfirmModal.confirm(app, {
        title: "Transcribe again?",
        message:
          "This recording already has a transcript. A new one is written as a separate " +
          "note; the old one stays.",
        cta: "Transcribe",
      });
      if (!again) return;
    }

    this.transcribing = true;
    const progress = new Notice("FineNotes: preparing the recording…", 0);
    try {
      const bytes = await app.vault.readBinary(audio);
      const text = await plugin.transcribeAudioFile(
        bytes,
        audioMimeForExtension(audio.extension) ?? "audio/mp4",
        (message) => progress.setMessage(`FineNotes: ${message}`),
      );
      if (text === null) return; // They declined to send it.
      const path = await this.writeTranscript(recording, audio, text);
      const surface = this.alive ? this.host.surface() : null;
      if (surface && !this.host.isLocked()) {
        surface.applyCommand(new SetRecordingTranscript(recording, path));
      }
      new Notice(`FineNotes: transcript saved to ${path}.`, 8000);
    } catch (error) {
      new Notice(`FineNotes: transcription failed — ${errorMessage(error)}`, 12000);
    } finally {
      progress.hide();
      this.transcribing = false;
    }
  }

  /** Write the transcript note; returns its path. A name already taken gets ` 1`, ` 2` … */
  private async writeTranscript(recording: Recording, audio: TFile, text: string): Promise<string> {
    const { app } = this.host;
    const exists = (path: string): boolean => app.vault.getAbstractFileByPath(path) !== null;
    let path = normalizePath(transcriptPathFor(audio.path));
    if (exists(path)) {
      path = normalizePath(availablePath(parentFolder(path), baseNameOf(path), "md", exists));
    }
    const note = this.host.file();
    const notebookLink = note
      ? app.fileManager.generateMarkdownLink(note, path, undefined, stripInkSuffix(note.basename))
      : "its notebook";
    const content = buildTranscriptNote({
      title: audio.basename,
      start: recording.start,
      duration: recording.duration,
      notebookLink,
      audioEmbed: `!${app.fileManager.generateMarkdownLink(audio, path)}`,
      text,
    });
    const created = await app.vault.create(path, content);
    return created.path;
  }
}

/** The same recording: the same object, or the same id and file (after a reload). */
function sameRecording(a: Recording, b: Recording): boolean {
  return a === b || (a.id === b.id && a.path === b.path);
}
