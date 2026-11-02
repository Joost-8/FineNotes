/**
 * The on-screen parts of audio recording (0.5):
 *
 * - the red "● 03:12  Stop" pill shown over the page while recording;
 * - the player bar over the bottom of the page — play/pause, back 10 s, a
 *   scrubber, elapsed / total, close — with a hint line above it;
 * - the recordings list in the page sidebar's Audio tab;
 * - a picker for "Transcribe recording…" when a note has several.
 *
 * Everything here only displays and reports; what a tap *does* is the
 * host's (`note-audio.ts`). Buttons over the page act on pointerup after a
 * pointerdown on the same button, never on `click`: the surface cancels a
 * Pencil's touchstart, and a Pencil tap then never becomes a click.
 */

import { type App, FuzzySuggestModal, Menu, setIcon } from "obsidian";
import {
  type TranscriptParagraph,
  describeRecording,
  formatClock,
  isShortTranscript,
  transcriptLead,
} from "../audio/recording";
import { formatStamp } from "../audio/speech-chunks";
import type { Recording } from "../model/document";
import { swallowGhostClick } from "./ghost-click";
import { syncRangeFill } from "./range-fill";

/** `setIcon`, with a text fallback for mobile builds where an icon comes up blank. */
function iconInto(el: HTMLElement, icon: string, fallback: string): void {
  setIcon(el, icon);
  const svg = el.querySelector("svg");
  if (!svg || svg.childElementCount === 0) {
    el.empty();
    el.setText(fallback);
  }
}

interface TapButtonOptions {
  icon: string;
  /** Accessible name and tooltip. */
  label: string;
  /** Visible text beside the icon, if any. */
  text?: string;
  cls?: string;
}

/**
 * A button over the page that acts on pointerup after a pointerdown on
 * itself — a Pencil tap included — and a keyboard press (a click with no
 * pointer behind it, `detail === 0`). A finger that slides off before
 * lifting cancels, as on iOS. `clickable-icon` opts it out of Obsidian's
 * 20 px iPad button padding.
 */
export function tapButton(
  parent: HTMLElement,
  options: TapButtonOptions,
  run: () => void,
): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: `goodobsidian-audio-button clickable-icon${options.cls ? ` ${options.cls}` : ""}`,
    attr: { "aria-label": options.label, title: options.label },
  });
  iconInto(
    button.createSpan({ cls: "goodobsidian-audio-button-icon" }),
    options.icon,
    options.text ? "" : options.label.slice(0, 1),
  );
  if (options.text) {
    button.createSpan({ cls: "goodobsidian-audio-button-text", text: options.text });
  }
  let armed: number | null = null;
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    // No focus change: a page text box keeps its keyboard.
    event.preventDefault();
    armed = event.pointerId;
  });
  button.addEventListener("pointerup", (event) => {
    event.stopPropagation();
    if (armed !== event.pointerId) return;
    armed = null;
    // Touch pointers are captured by the button they went down on, so a
    // lift elsewhere still arrives here: it only counts over the button.
    const r = button.getBoundingClientRect();
    const inside =
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom;
    if (!inside || button.disabled) return;
    swallowGhostClick(button.ownerDocument, event);
    run();
  });
  button.addEventListener("pointercancel", () => {
    armed = null;
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.detail === 0 && !button.disabled) run();
  });
  return button;
}

/** Swap a tap button's icon (play ↔ pause). */
function setButtonIcon(button: HTMLButtonElement, icon: string, label: string): void {
  const slot = button.querySelector<HTMLElement>(".goodobsidian-audio-button-icon");
  if (slot) {
    slot.empty();
    iconInto(slot, icon, label.slice(0, 1));
  }
  button.setAttr("aria-label", label);
  button.setAttribute("title", label);
}

// --- Recording pill -----------------------------------------------------------

/** "● 03:12  🗑  Stop", over the page while a recording runs. The bin discards it. */
export class RecordingPill {
  private readonly el: HTMLElement;
  private readonly timeEl: HTMLElement;

  constructor(parent: HTMLElement, onStop: () => void, onDiscard: () => void) {
    this.el = parent.createDiv({
      cls: "goodobsidian-rec-pill",
      attr: { role: "status", "aria-label": "Recording" },
    });
    this.el.createSpan({ cls: "goodobsidian-rec-dot" });
    this.timeEl = this.el.createSpan({ cls: "goodobsidian-rec-time", text: formatClock(0) });
    tapButton(
      this.el,
      { icon: "trash-2", label: "Discard recording", cls: "goodobsidian-rec-discard" },
      onDiscard,
    );
    tapButton(
      this.el,
      { icon: "square", label: "Stop recording", text: "Stop", cls: "goodobsidian-rec-stop" },
      onStop,
    );
  }

  update(elapsedMs: number): void {
    this.timeEl.setText(formatClock(elapsedMs));
  }

  destroy(): void {
    this.el.remove();
  }
}

// --- Player bar -----------------------------------------------------------------

/** How long a hint stays before the player's standing hint comes back, ms. */
const HINT_MS = 4000;
const STANDING_HINT = "Tap your writing to hear what was said as you wrote it.";

/** What the page does as a recording plays (2.5): ink replay. */
export interface PlayerHooks {
  /**
   * Where playback is, ms into the recording: every frame while it plays,
   * and on a seek, a pause or a load.
   */
  onTime?: (ms: number) => void;
  /** Ink replay is on: the bar shows its switch, which calls `onReplay`. */
  replay?: boolean;
  onReplay?: (on: boolean) => void;
}

/**
 * The compact player over the bottom of the page. Plays through an
 * `<audio>` element fed the vault's resource URL for the file.
 *
 * The recording's measured length is the authority for the scrubber and the
 * total: a fragmented MP4 from `MediaRecorder` has no duration in its
 * header, so `audio.duration` can read `NaN` or `Infinity` (FEATURES.md
 * §3.1 trap 2). A seek asked for before the metadata has loaded waits for it.
 */
export class AudioPlayerBar {
  private readonly el: HTMLElement;
  private readonly audio: HTMLAudioElement;
  private readonly playButton: HTMLButtonElement;
  private readonly scrubber: HTMLInputElement;
  private readonly titleEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private hintTimer = 0;
  private current: Recording | null = null;
  private durationMs = 0;
  private pendingSeekMs: number | null = null;
  /** A finger is on the scrubber: playback must not drag it back. */
  private scrubbing = false;
  /** The frame loop that reports the time while playing; 0 when stopped. */
  private frame = 0;
  private replayButton: HTMLButtonElement | null = null;
  private replayOn: boolean;

  constructor(
    parent: HTMLElement,
    onClose: () => void,
    private readonly hooks: PlayerHooks = {},
  ) {
    this.replayOn = hooks.replay === true;
    this.el = parent.createDiv({
      cls: "goodobsidian-player",
      attr: { role: "region", "aria-label": "Recording player" },
    });
    // Dragging the scrubber must not open one of Obsidian's sidebars.
    this.el.dataset.ignoreSwipe = "true";
    this.hintEl = this.el.createDiv({
      cls: "goodobsidian-player-hint",
      attr: { "aria-live": "polite" },
      text: STANDING_HINT,
    });
    const row = this.el.createDiv({ cls: "goodobsidian-player-row" });
    this.playButton = tapButton(row, { icon: "play", label: "Play" }, () => this.toggle());
    tapButton(row, { icon: "rotate-ccw", label: "Back 10 seconds" }, () => this.skip(-10000));
    const middle = row.createDiv({ cls: "goodobsidian-player-middle" });
    this.titleEl = middle.createDiv({ cls: "goodobsidian-player-title" });
    this.scrubber = middle.createEl("input", {
      cls: "goodobsidian-player-scrubber",
      type: "range",
      attr: { min: "0", max: "0", step: "0.1", value: "0", "aria-label": "Position" },
    });
    this.timeEl = row.createDiv({ cls: "goodobsidian-player-time" });
    if (hooks.onReplay) {
      // Ink replay: what was not written yet at this moment shows pale.
      this.replayButton = tapButton(
        row,
        { icon: "pen-line", label: "Replay ink", cls: "goodobsidian-player-replay" },
        () => {
          this.replayOn = !this.replayOn;
          this.renderReplay();
          hooks.onReplay?.(this.replayOn);
        },
      );
      this.renderReplay();
    }
    tapButton(row, { icon: "x", label: "Close player" }, onClose);

    // The scrubber is the only thing here that takes a drag; nothing below sees it.
    this.scrubber.addEventListener("pointerdown", (event) => event.stopPropagation());
    // Nor does Obsidian mobile, which watches touches for its edge swipes: a
    // scrub near the edge must not pull out a sidebar (the page's own
    // touches are kept from it the same way, in ink-surface.ts).
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
      this.el.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
    }
    this.scrubber.addEventListener("input", () => {
      this.scrubbing = true;
      this.renderTime(Number(this.scrubber.value) * 1000);
    });
    this.scrubber.addEventListener("change", () => {
      this.scrubbing = false;
      this.seek(Number(this.scrubber.value) * 1000);
    });

    this.audio = this.el.createEl("audio", { cls: "goodobsidian-player-audio" });
    this.audio.preload = "auto";
    this.audio.addEventListener("timeupdate", () => {
      if (!this.scrubbing) this.renderPosition(this.audio.currentTime * 1000);
    });
    this.audio.addEventListener("play", () => {
      this.renderPlaying(true);
      this.startFrames();
    });
    this.audio.addEventListener("pause", () => {
      this.renderPlaying(false);
      this.stopFrames();
    });
    this.audio.addEventListener("ended", () => {
      this.renderPlaying(false);
      this.stopFrames();
    });
    // A seek lands: the page shows that moment, playing or not.
    this.audio.addEventListener("seeked", () => this.reportTime());
    this.audio.addEventListener("loadedmetadata", () => {
      // A recording saved without a length (it should not happen) takes the
      // file's, if the file knows it.
      const fileMs = this.audio.duration * 1000;
      if (this.durationMs <= 0 && Number.isFinite(fileMs) && fileMs > 0) {
        this.setDuration(fileMs);
      }
      const pending = this.pendingSeekMs;
      this.pendingSeekMs = null;
      if (pending !== null) this.audio.currentTime = pending / 1000;
    });
    this.audio.addEventListener("error", () => {
      this.hint("This recording can't be played here — the file may be missing or unreadable.");
    });
  }

  /** The recording loaded, if any. */
  get recording(): Recording | null {
    return this.current;
  }

  /** Where playback is, ms into the recording. */
  get positionMs(): number {
    return this.audio.currentTime * 1000;
  }

  /** Load `recording` from `url` (the vault's resource URL), paused at the start. */
  load(recording: Recording, url: string): void {
    this.current = recording;
    this.pendingSeekMs = null;
    this.titleEl.setText(describeRecording(recording));
    this.setDuration(recording.duration);
    this.audio.src = url;
    this.audio.load();
    this.renderPosition(0);
    this.renderPlaying(false);
    this.hooks.onTime?.(0);
  }

  /** Move to `ms` into the recording (clamped to it). */
  seek(ms: number): void {
    const target = Math.min(Math.max(0, ms), this.durationMs > 0 ? this.durationMs : ms);
    this.renderPosition(target);
    if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.audio.currentTime = target / 1000;
    } else {
      this.pendingSeekMs = target;
    }
  }

  /**
   * Start playing. Called inside the tap that asked for it, because iPadOS
   * only starts audio from a user gesture; a refusal is said, not thrown.
   */
  play(): void {
    this.audio.play().catch(() => {
      this.hint("Tap ▶ to play.");
    });
  }

  pause(): void {
    this.audio.pause();
  }

  /** Show `text` for a few seconds in place of the standing hint. */
  hint(text: string): void {
    window.clearTimeout(this.hintTimer);
    this.hintEl.setText(text);
    this.hintEl.addClass("is-message");
    this.hintTimer = window.setTimeout(() => {
      this.hintEl.setText(STANDING_HINT);
      this.hintEl.removeClass("is-message");
    }, HINT_MS);
  }

  destroy(): void {
    window.clearTimeout(this.hintTimer);
    this.stopFrames();
    this.audio.pause();
    // Let go of the file: an `<audio>` keeps its source open until told.
    this.audio.removeAttribute("src");
    this.audio.load();
    this.el.remove();
  }

  private toggle(): void {
    if (this.audio.paused) this.play();
    else this.pause();
  }

  private skip(deltaMs: number): void {
    this.seek(this.audio.currentTime * 1000 + deltaMs);
  }

  private setDuration(ms: number): void {
    this.durationMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
    this.scrubber.max = String(this.durationMs / 1000);
    syncRangeFill(this.scrubber);
  }

  private renderPosition(ms: number): void {
    this.scrubber.value = String(ms / 1000);
    this.renderTime(ms);
  }

  private renderTime(ms: number): void {
    // Called after every change of the scrubber's value, dragged or played.
    syncRangeFill(this.scrubber);
    this.timeEl.setText(`${formatClock(ms)} / ${formatClock(this.durationMs)}`);
  }

  /** Tell the page where playback is. */
  private reportTime(): void {
    this.hooks.onTime?.(this.audio.currentTime * 1000);
  }

  /** Report the time every frame while playing: ink comes back as it was written. */
  private startFrames(): void {
    if (!this.hooks.onTime || this.frame !== 0) return;
    const step = (): void => {
      this.reportTime();
      this.frame = this.audio.paused ? 0 : window.requestAnimationFrame(step);
    };
    this.frame = window.requestAnimationFrame(step);
  }

  private stopFrames(): void {
    if (this.frame !== 0) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.reportTime();
  }

  private renderReplay(): void {
    const button = this.replayButton;
    if (!button) return;
    button.toggleClass("is-active", this.replayOn);
    button.setAttribute("aria-pressed", String(this.replayOn));
  }

  private renderPlaying(playing: boolean): void {
    setButtonIcon(this.playButton, playing ? "pause" : "play", playing ? "Pause" : "Play");
  }
}

// --- Recordings panel ---------------------------------------------------------

export interface RecordingEntry {
  recording: Recording;
  /** Whether the audio file is in the vault. */
  available: boolean;
  /** Whether its transcript note is (only then are there Transcript and Paste buttons). */
  hasTranscript: boolean;
  /** The transcript note's paragraphs, once read; shown in the recording's box. */
  transcript?: readonly TranscriptParagraph[];
  /** What an on-device transcription of it is doing now, when one runs. */
  deviceStatus?: string;
}

export interface RecordingsActions {
  // Properties holding functions, not methods (CLAUDE.md: a callback is a value).
  /** Play from the start, or from `fromMs` (a time in its transcript). */
  play: (recording: Recording, fromMs?: number) => void;
  transcribe: (recording: Recording) => void;
  /** Transcribe with the speech model on this device (no key, nothing sent). */
  transcribeOnDevice: (recording: Recording) => void;
  /** Stop the on-device transcription running now. */
  stopDevice: () => void;
  openTranscript: (recording: Recording) => void;
  /** Put the transcript's text on the page in view, as a text box. */
  pasteTranscript: (recording: Recording) => void;
  remove: (recording: Recording) => void;
  /** The Record / Stop button at the foot of the panel. Called inside the tap. */
  record: () => void;
  /** Open the AI settings (from the line saying transcription needs setting up). */
  openAiSettings: () => void;
}

/** Whether recordings can be transcribed with the AI set up, and if not, why. */
export interface TranscribeState {
  enabled: boolean;
  reason: string;
}

/**
 * The note's recordings, newest first, in the page sidebar's Audio tab — where
 * GoodNotes keeps them (2026-09-22, from Joost's screenshot). Each has Play,
 * Transcribe (only when the AI set up can transcribe speech; otherwise a line
 * under the hint says what it needs), its transcript (once there is one:
 * whole when short, else its first lines with the rest a tap away, each
 * paragraph's time playing from there; the note itself an icon away) and
 * Remove from note; a Record button sits at the foot. The sidebar is outside the surface that cancels
 * Pencil touches, so `click` is right here.
 */
export class RecordingsPanel {
  private readonly list: HTMLElement;
  /** What transcribing needs, shown while the AI set up cannot do it. */
  private readonly needsEl: HTMLElement;
  private readonly recordButton: HTMLButtonElement;
  private readonly recordLabel: HTMLElement;
  private readonly recordIcon: HTMLElement;
  /** Recordings (by path) whose long transcript is open in full. */
  private readonly openTranscripts = new Set<string>();
  /** How far each open transcript is scrolled, kept across redraws (progress redraws often). */
  private readonly transcriptScroll = new Map<string, number>();

  constructor(
    parent: HTMLElement,
    private readonly actions: RecordingsActions,
  ) {
    const el = parent.createDiv({ cls: "goodobsidian-recordings" });
    el.createDiv({
      cls: "goodobsidian-recordings-hint",
      text: "Play one, then tap your writing to hear what was said as you wrote it.",
    });
    this.needsEl = el.createDiv({ cls: "goodobsidian-recordings-needs is-hidden" });
    this.list = el.createDiv({ cls: "goodobsidian-recordings-list" });
    const foot = el.createDiv({ cls: "goodobsidian-recordings-foot" });
    this.recordButton = foot.createEl("button", {
      cls: "goodobsidian-recordings-record clickable-icon",
    });
    this.recordIcon = this.recordButton.createSpan({ cls: "goodobsidian-audio-button-icon" });
    this.recordLabel = this.recordButton.createSpan();
    this.recordButton.addEventListener("click", () => this.actions.record());
    this.setRecording(false);
  }

  /** Redraw with the note's recordings as they are now (after an undo, say). */
  render(entries: readonly RecordingEntry[], transcribe: TranscribeState): void {
    // Transcribing on this device needs no key, so nothing here needs setting
    // up any more; the line stays for a future requirement.
    this.needsEl.empty();
    this.needsEl.addClass("is-hidden");
    this.list.empty();
    if (entries.length === 0) {
      this.list.createDiv({
        cls: "goodobsidian-recordings-empty",
        text: "No recordings in this note yet.",
      });
    }
    for (const entry of entries) this.renderEntry(entry, transcribe.enabled);
  }

  /** The foot button reads Record, or Stop while a recording runs. */
  setRecording(active: boolean): void {
    this.recordButton.toggleClass("is-recording", active);
    this.recordIcon.empty();
    iconInto(this.recordIcon, active ? "square" : "mic", "");
    this.recordLabel.setText(active ? "Stop" : "Record");
    this.recordButton.setAttribute("aria-label", active ? "Stop recording" : "Record audio");
  }

  private renderEntry(entry: RecordingEntry, canTranscribe: boolean): void {
    const { recording } = entry;
    const block = this.list.createDiv({ cls: "goodobsidian-recordings-entry" });
    // Remove sits beside the label, apart from Play and Transcribe.
    const head = block.createDiv({ cls: "goodobsidian-recordings-head" });
    head.createDiv({ cls: "goodobsidian-recordings-label", text: describeRecording(recording) });
    if (!entry.available) {
      block.createDiv({
        cls: "goodobsidian-recordings-missing",
        text: `The audio file is missing: ${recording.path}`,
      });
    }
    if (entry.transcript && entry.transcript.length > 0) {
      const box = block.appendChild(this.transcriptBox(entry, entry.transcript));
      const top = this.transcriptScroll.get(recording.path);
      const text = box.querySelector<HTMLElement>(".goodobsidian-recordings-transcript-text");
      if (top !== undefined && text) text.scrollTop = top;
    }
    const row = block.createDiv({ cls: "goodobsidian-recordings-actions" });
    // `short` is shown beside the icon; without it the button is icon-only.
    const act = (
      icon: string,
      label: string,
      short: string,
      run: () => void,
      enabled = true,
      parent = row,
    ): void => {
      const button = parent.createEl("button", {
        cls: "goodobsidian-recordings-action clickable-icon",
        attr: { "aria-label": label, title: label },
      });
      iconInto(
        button.createSpan({ cls: "goodobsidian-audio-button-icon" }),
        icon,
        short ? "" : label.slice(0, 1),
      );
      if (short) button.createSpan({ text: short });
      button.disabled = !enabled;
      button.addEventListener("click", () => {
        if (!button.disabled) run();
      });
    };
    act("play", "Play", "Play", () => this.actions.play(recording), entry.available);
    if (entry.deviceStatus !== undefined) {
      const status = block.createDiv({ cls: "goodobsidian-recordings-device" });
      status.createSpan({ cls: "goodobsidian-recordings-device-text", text: entry.deviceStatus });
      act("square", "Stop transcribing", "Stop", () => this.actions.stopDevice(), true, status);
    } else {
      // On this device always works; with a key set up as well, ask which.
      const label = entry.hasTranscript ? "Transcribe again" : "Transcribe";
      act(
        "file-text",
        label,
        "Transcribe",
        () => {
          if (!canTranscribe) {
            this.actions.transcribeOnDevice(recording);
            return;
          }
          const menu = new Menu();
          menu.addItem((item) =>
            item
              .setTitle("On this device")
              .setIcon("audio-waveform")
              .onClick(() => this.actions.transcribeOnDevice(recording)),
          );
          menu.addItem((item) =>
            item
              .setTitle("With your AI key")
              .setIcon("cloud")
              .onClick(() => this.actions.transcribe(recording)),
          );
          const button = block.querySelector<HTMLElement>(".goodobsidian-recordings-transcribe");
          const rect = button?.getBoundingClientRect();
          if (rect) menu.showAtPosition({ x: rect.left, y: rect.bottom });
          else menu.showAtPosition({ x: 0, y: 0 });
        },
        entry.available,
      );
      row.lastElementChild?.addClass("goodobsidian-recordings-transcribe");
    }
    if (entry.hasTranscript) {
      // Its text is in the box now: the note is an icon away.
      act("external-link", "Open transcript note", "", () =>
        this.actions.openTranscript(recording),
      );
      act("clipboard-paste", "Paste transcript onto the page", "", () =>
        this.actions.pasteTranscript(recording),
      );
    }
    act("trash-2", "Remove from note", "", () => this.actions.remove(recording), true, head);
  }

  /**
   * The transcript in the recording's box: whole when short; else its lead,
   * which a tap opens in full (scrolling in the box), and a chevron closes.
   * A paragraph's time plays the recording from there.
   */
  private transcriptBox(
    entry: RecordingEntry,
    paragraphs: readonly TranscriptParagraph[],
  ): HTMLElement {
    const { recording } = entry;
    const short = isShortTranscript(paragraphs);
    const open = !short && this.openTranscripts.has(recording.path);
    const box = createDiv({ cls: "goodobsidian-recordings-transcript" });
    const text = box.createDiv({ cls: "goodobsidian-recordings-transcript-text" });
    for (const paragraph of short || open ? paragraphs : transcriptLead(paragraphs)) {
      const p = text.createEl("p");
      const at = paragraph.atMs;
      if (at !== undefined) {
        const stamp = formatStamp(at);
        const time = p.createSpan({ cls: "goodobsidian-recordings-time", text: stamp });
        if (entry.available) {
          time.addClass("is-playable");
          time.setAttribute("role", "button");
          time.setAttribute("tabindex", "0");
          time.setAttribute("aria-label", `Play from ${stamp}`);
          const play = (event: Event): void => {
            event.stopPropagation();
            this.actions.play(recording, at);
          };
          time.addEventListener("click", play);
          time.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") play(event);
          });
        }
      }
      p.appendText(paragraph.text);
    }
    if (short) return box;
    box.addClass(open ? "is-open" : "is-lead");
    if (open) {
      text.addEventListener("scroll", () =>
        this.transcriptScroll.set(recording.path, text.scrollTop),
      );
    }
    const toggle = (): void => {
      this.transcriptScroll.delete(recording.path);
      if (open) this.openTranscripts.delete(recording.path);
      else this.openTranscripts.add(recording.path);
      box.replaceWith(this.transcriptBox(entry, paragraphs));
    };
    const chevron = box.createEl("button", {
      cls: "goodobsidian-recordings-transcript-toggle clickable-icon",
      attr: {
        "aria-label": open ? "Show less of the transcript" : "Show the whole transcript",
        "aria-expanded": String(open),
      },
    });
    iconInto(chevron, open ? "chevron-up" : "chevron-down", open ? "▴" : "▾");
    chevron.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });
    // Closed, the whole lead opens it; open, the text stays put for reading and selecting.
    if (!open) text.addEventListener("click", toggle);
    return box;
  }
}

// --- Picker ---------------------------------------------------------------------

/** "Transcribe recording…" in a note with several: which one? Newest first. */
export class RecordingSuggestModal extends FuzzySuggestModal<Recording> {
  constructor(
    app: App,
    private readonly recordings: readonly Recording[],
    private readonly onPick: (recording: Recording) => void,
  ) {
    super(app);
    this.setPlaceholder("Which recording should be transcribed?");
  }

  getItems(): Recording[] {
    return [...this.recordings].sort((a, b) => b.start - a.start);
  }

  getItemText(recording: Recording): string {
    return `${describeRecording(recording)} — ${recording.path}`;
  }

  onChooseItem(recording: Recording): void {
    this.onPick(recording);
  }
}
