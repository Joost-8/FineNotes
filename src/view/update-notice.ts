/**
 * Whether a newer FineNotes is out (2.4.2): reads `main`'s manifest on
 * GitHub at most once a day, keeps what it read on this device, and tells
 * whoever shows the mark (the toolbar's gear, the notebook's settings, the
 * settings tab) when that changes. The rules are `model/update-check.ts`.
 */

import { requestUrl } from "obsidian";
import {
  UPDATE_MANIFEST_URL,
  type UpdateRecord,
  checkDue,
  newerVersion,
  updateRecordOf,
  versionOfManifest,
} from "../model/update-check";

export interface UpdateNoticeOptions {
  /** The version running now (the plugin's manifest). */
  current: string;
  /** Whether checking is on (Settings › Advanced). */
  enabled: () => boolean;
  /** This device's record of the last check, as stored. */
  load: () => unknown;
  save: (record: UpdateRecord) => void;
  now?: () => number;
}

export class UpdateNotice {
  private latest: string | null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: UpdateNoticeOptions) {
    this.latest = newerVersion(updateRecordOf(options.load()), options.current);
  }

  /** The newer version to mark, or null (none known, or checking is off). */
  get available(): string | null {
    return this.options.enabled() ? this.latest : null;
  }

  /** Call `listener` whenever {@link available} may have changed; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    const now = (this.options.now ?? Date.now)();
    if (!checkDue(updateRecordOf(this.options.load()), now)) return;
    let latest: string | null = null;
    try {
      const answer = await requestUrl({ url: UPDATE_MANIFEST_URL, throw: false });
      if (answer.status === 200) latest = versionOfManifest(answer.json);
    } catch {
      // No connection, or not JSON.
    }
    if (latest === null) return;
    const record = { checkedAt: now, latest };
    this.options.save(record);
    const found = newerVersion(record, this.options.current);
    if (found === this.latest) return;
    this.latest = found;
    this.changed();
  }
}
