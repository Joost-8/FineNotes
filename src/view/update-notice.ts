/**
 * Whether a newer FineNotes is out (2.4.2): reads `main`'s manifest on
 * GitHub at most once a day, keeps what it read on this device, and tells
 * whoever shows the mark (the toolbar's gear, the notebook's settings, the
 * settings tab) when that changes. The rules are `model/update-check.ts`.
 */

import { requestUrl } from "obsidian";
import type { CheckOutcome } from "../model/update-button";
import {
  UPDATE_MANIFEST_URL,
  type UpdateRecord,
  checkDue,
  newerVersion,
  toAnnounce,
  updateRecordOf,
  versionOfManifest,
} from "../model/update-check";

export interface UpdateNoticeOptions {
  /** The version running now (the plugin's manifest). */
  current: string;
  /** Whether checking is on (Settings › Advanced). */
  enabled: () => boolean;
  /** Whether "Update available" may pop up, or the dot alone says it. */
  remind: () => boolean;
  /** This device's record of the last check, as stored. */
  load: () => unknown;
  save: (record: UpdateRecord) => void;
  now?: () => number;
}

export class UpdateNotice {
  private latest: string | null;
  /** The user asked (Home's check button): the answer shows even with checking off. */
  private asked = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: UpdateNoticeOptions) {
    this.latest = newerVersion(updateRecordOf(options.load()), options.current);
  }

  /** The newer version to mark, or null (none known, or checking is off). */
  get available(): string | null {
    return this.options.enabled() || this.asked ? this.latest : null;
  }

  /** Call `listener` whenever {@link available} may have changed; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The version whose "Update available" is still to be shown here, or
   * null; {@link announced} records that it was.
   */
  pendingAnnouncement(): string | null {
    if (!this.options.enabled() || !this.options.remind()) return null;
    return toAnnounce(updateRecordOf(this.options.load()), this.options.current, this.now());
  }

  /** "Update available" was shown for `version` on this device: not again for two days. */
  announced(version: string): void {
    this.options.save({
      ...updateRecordOf(this.options.load()),
      announced: version,
      announcedAt: this.now(),
    });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Checking was switched on or off: the marks follow. */
  changed(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Read the released version if a day has passed since the last read.
   * Offline, or any answer that is not a manifest, is silence: the next
   * start tries again.
   */
  async check(): Promise<void> {
    if (!this.options.enabled()) return;
    if (!checkDue(updateRecordOf(this.options.load()), this.now())) return;
    await this.read();
  }

  /**
   * Read the released version now, because the user asked (Home's check
   * button): no daily limit, and the answer shows even with checking off.
   */
  async checkNow(): Promise<CheckOutcome> {
    this.asked = true;
    const latest = await this.read();
    if (latest === null) return "offline";
    return this.latest === null ? "none" : "found";
  }

  /** One read of `main`'s manifest: the version on it (kept), or null with no answer. */
  private async read(): Promise<string | null> {
    const now = this.now();
    let latest: string | null = null;
    try {
      const answer = await requestUrl({ url: UPDATE_MANIFEST_URL, throw: false });
      if (answer.status === 200) latest = versionOfManifest(answer.json);
    } catch {
      // No connection, or not JSON.
    }
    if (latest === null) return null;
    const record = { ...updateRecordOf(this.options.load()), checkedAt: now, latest };
    this.options.save(record);
    const found = newerVersion(record, this.options.current);
    if (found !== this.latest) {
      this.latest = found;
      this.changed();
    }
    return latest;
  }
}
