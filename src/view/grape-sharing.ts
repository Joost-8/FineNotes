/* global __FINENOTES_SHARING_ENDPOINT__ -- defined by esbuild.config.mjs (SHARING_ENDPOINT) */
/**
 * "Help improve Grape": the settings row, the consent sheet, the review
 * sheet, sending and deleting (research/review/help-improve-grape.html).
 *
 * Nothing is sent unless the user agreed, under the consent wording in use
 * now, and then pressed Send in a review sheet that drew every item. The
 * pure part (what an item holds, the ledger, batches) is
 * recognition/hwr/sharing.ts.
 *
 * Loaded only in builds made with FINENOTES_SHARING=1 (sharing-feature.ts),
 * which releases are (release.yml); the server refuses batches while its
 * GRAPE_INK_OPEN is off.
 */

import {
  Menu,
  Modal,
  Notice,
  Platform,
  type Setting,
  normalizePath,
  requestUrl,
  setIcon,
} from "obsidian";
import { HANDWRITING_FOLDER } from "../model/vault-folders";
import { practiceLines, practiceSetOfDoc } from "../recognition/practice";
import {
  type PracticeSource,
  CONSENT_VERSION,
  REMIND_EVERY,
  type ConsentChange,
  SHARE_KINDS,
  SHARE_LICENCE,
  type ShareBatch,
  type ShareClient,
  type ShareItem,
  type ShareKind,
  type SharingLedger,
  agree,
  autoSends,
  consentChanges,
  inviteDismissed,
  buildBatches,
  correctionDrafts,
  countByKind,
  deleteDone,
  markDeclined,
  markSent,
  mergeLedgers,
  parseLedger,
  pendingItems,
  practiceDrafts,
  remindDue,
  reminded,
  requestDelete,
  serializeLedger,
  setAuto,
  sharingOn,
  stopSharing,
  upgradeDone,
  withIds,
} from "../recognition/hwr/sharing";
import { errorMessage } from "../util/errors";
import { st, stn } from "./grape-sharing-text";
import { practiceFiles, readCorrections, readPracticeDoc } from "./handwriting-learning";
import type { SharingFeature, SharingHost } from "./sharing-feature";

/** Grape's collection server, from the build (esbuild.config.mjs, SHARING_ENDPOINT). */
const ENDPOINT = __FINENOTES_SHARING_ENDPOINT__;

const PRIVACY_URL = "https://github.com/Joost-8/FineNotes/blob/main/PRIVACY.md";

/** Rows drawn per kind before "Show all": a long practice history stays quick to open. */
const FIRST_ROWS = 60;

/** After a word is answered, how long to wait for more before sending or reminding. */
const ADDED_PAUSE_MS = 60_000;

export function ledgerPath(): string {
  return normalizePath(`${HANDWRITING_FOLDER}/shared.json`);
}

/** What the server's answer meant. */
type SendOutcome = "sent" | "closed" | "offline" | { failed: string };

export class GrapeSharing implements SharingFeature {
  private ledger: SharingLedger | null = null;
  private items: ShareItem[] | null = null;
  private loading: Promise<void> | null = null;
  private busy = false;
  private addedTimer = 0;
  /** The reminder on screen, if any: a new one replaces it. */
  private remindNotice: Notice | null = null;
  private destroyed = false;

  constructor(private readonly host: SharingHost) {}

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.addedTimer);
    this.remindNotice?.hide();
  }

  start(): void {
    void this.load().then(async () => {
      await this.retryDelete(true);
      await this.retryUpgrade();
      // What a send by itself left behind (offline, another device's items).
      await this.newItems(false);
    });
  }

  itemsAdded(): void {
    // A burst of answered words is one send, or one reminder.
    window.clearTimeout(this.addedTimer);
    this.addedTimer = window.setTimeout(() => void this.newItems(true), ADDED_PAUSE_MS);
  }

  /**
   * For someone sharing: send what is new by itself if they chose that,
   * else, when `remind` and enough has come since the last one, a reminder.
   */
  private async newItems(remind: boolean): Promise<void> {
    if (this.destroyed || this.busy) return;
    // The ledger alone first: reading every practice sheet is only worth it
    // for someone who shares (this runs after every answered word).
    if (!sharingOn(await this.readLedger())) return;
    await this.load();
    const ledger = this.ledger;
    const items = this.items;
    if (!ledger || !items || !sharingOn(ledger) || this.destroyed) return;
    const pending = pendingItems(items, ledger);
    if (pending.length === 0) return;
    if (autoSends(ledger)) {
      await this.send(ledger, pending, [], true);
    } else if (remind && remindDue(ledger, pending.length)) {
      await this.saveLedger(reminded(ledger, pending.length, Date.now()));
      this.remindCard(pending);
    }
  }

  /** "N new items to share": Later, Always (send by itself from now on), Share N. */
  private remindCard(pending: ShareItem[]): void {
    this.remindNotice?.hide();
    const notice = new Notice(
      createFragment((fragment) => {
        drawRemindCard(fragment.createDiv(), pending, (choice) => {
          notice.hide();
          if (this.remindNotice === notice) this.remindNotice = null;
          void this.reminderAnswered(choice, pending);
        });
      }),
      0,
    );
    this.remindNotice = notice;
  }

  /** Always is saved before anything is sent, and only while sharing is still on. */
  private async reminderAnswered(
    choice: "later" | "always" | "share",
    pending: ShareItem[],
  ): Promise<void> {
    if (choice === "later" || !this.ledger || !sharingOn(this.ledger)) return;
    if (choice === "always") await this.saveLedger(setAuto(this.ledger, true, Date.now()));
    if (this.ledger) await this.send(this.ledger, pending, []);
  }

  /**
   * The one-time invite, under the result of a learning run that made Grape
   * read the user better: the moment they have just seen what their own
   * lines are worth. Not shown once sharing is on, once answered on any
   * device of the vault, or when there is nothing to share.
   */
  drawInvite(parent: HTMLElement): void {
    void this.inviteFor().then((pending) => {
      if (pending) this.inviteCard(parent, "learned", pending, () => undefined);
    });
  }

  /**
   * The same invite as a card in the corner, when a practice sheet's last
   * line was just written (Joost, 2026-11-16): the other moment someone has
   * just made labelled handwriting. Shown once per vault, whichever comes
   * first.
   */
  inviteAfterSheet(): void {
    void this.inviteFor().then((pending) => {
      if (!pending) {
        void this.newItems(true);
        return;
      }
      const notice = new Notice(
        createFragment((fragment) => {
          this.inviteCard(fragment.createDiv(), "sheet", pending, () => notice.hide());
        }),
        0,
      );
    });
  }

  /** What the invite would share, or null when it is not to be shown. */
  private async inviteFor(): Promise<ShareItem[] | null> {
    await this.load();
    const ledger = this.ledger;
    const items = this.items;
    if (!ledger || !items || ledger.invited || sharingOn(ledger)) return null;
    const pending = pendingItems(items, ledger);
    return pending.length > 0 ? pending : null;
  }

  private inviteCard(
    parent: HTMLElement,
    moment: "learned" | "sheet",
    pending: ShareItem[],
    done: () => void,
  ): void {
    const card = parent.createDiv({ cls: "goodobsidian-share-invite" });
    setIcon(card.createDiv({ cls: "goodobsidian-share-invite-icon" }), "heart-handshake");
    const text = card.createDiv({ cls: "goodobsidian-share-invite-text" });
    text.createDiv({ cls: "goodobsidian-share-invite-title", text: st("invite.title") });
    text.createDiv({
      cls: "goodobsidian-share-desc",
      text: st(moment === "sheet" ? "invite.bodySheet" : "invite.body"),
    });
    // Help shares from here, without the sheet, so the card says what it
    // shares, how, and where the rest is (Joost, 2026-11-16).
    const terms = text.createDiv({
      cls: "goodobsidian-share-desc",
      text: `${stn("invite.terms", pending.length)} `,
    });
    terms.createEl("a", { text: st("consent.policy"), href: PRIVACY_URL });
    const buttons = card.createDiv({ cls: "goodobsidian-share-invite-buttons" });
    const later = buttons.createEl("button", { text: st("invite.later") });
    // Not filled: the learn window's own Done stays its one primary button.
    const more = buttons.createEl("button", { text: st("invite.more") });
    const help = buttons.createEl("button", { text: st("invite.help") });
    const answered = (): void => {
      if (this.ledger && !sharingOn(this.ledger)) {
        void this.saveLedger(inviteDismissed(this.ledger));
      }
    };
    const close = (event: MouseEvent): void => {
      // A notice hides on any click; the buttons decide for themselves.
      event.stopPropagation();
      card.remove();
      done();
    };
    later.addEventListener("click", (event) => {
      close(event);
      answered();
    });
    more.addEventListener("click", (event) => {
      close(event);
      // Closing the sheet without sharing also answers the invite.
      this.openConsent(() => undefined, answered);
    });
    help.addEventListener("click", (event) => {
      close(event);
      if (this.ledger) void this.send(agree(this.ledger, Date.now(), randomBytes), pending, []);
    });
  }

  drawRow(setting: Setting, redraw: () => void): void {
    setting.settingEl.addClass("goodobsidian-share-row");
    const ledger = this.ledger;
    const items = this.items;
    if (!ledger || !items) {
      void this.load().then(redraw);
      return;
    }
    const on = sharingOn(ledger);
    const fresh = pendingItems(items, ledger).length;
    if (ledger.pendingDelete) {
      setting.setDesc(st("deletePending"));
    } else if (on) {
      const shared = stn("on", ledger.sent.length);
      setting.setDesc(fresh > 0 ? `${shared} · ${stn("newCount", fresh)}` : shared);
    } else if (ledger.consent) {
      setting.setDesc(st("askAgain"));
    } else {
      setting.setDesc(st("off"));
    }
    if (on && fresh > 0) {
      setting.addButton((b) =>
        b
          .setButtonText(stn("shareNew", fresh))
          .setCta()
          .onClick(() => this.shareNew(redraw)),
      );
    } else if (!on) {
      setting.addButton((b) =>
        b.setButtonText(st("setUp")).onClick(() => this.openConsent(redraw)),
      );
    }
    const canDelete = ledger.sent.length > 0 || ledger.pendingDelete !== null;
    if (on || canDelete) {
      setting.addExtraButton((b) => {
        b.setIcon("more-horizontal").setTooltip(st("more"));
        b.extraSettingsEl.addClass("clickable-icon");
        b.onClick(() => {
          const menu = new Menu();
          if (on && fresh > 0) {
            menu.addItem((i) =>
              i
                .setTitle(st("review"))
                .setIcon("eye")
                .onClick(() => this.review(redraw)),
            );
          }
          if (on) {
            // Send new items by themselves: a check mark, on or off.
            menu.addItem((i) =>
              i
                .setTitle(st("auto"))
                .setIcon("refresh-cw")
                .setChecked(ledger.auto.on)
                .onClick(() => void this.toggleAuto(redraw)),
            );
            menu.addItem((i) =>
              i
                .setTitle(st("stop"))
                .setIcon("pause")
                .onClick(() => void this.stop(redraw)),
            );
          }
          if (canDelete) {
            menu.addItem((i) => {
              i.setTitle(st("delete"))
                .setIcon("trash-2")
                .onClick(() => this.confirmDelete(redraw));
              i.setWarning(true);
            });
          }
          const rect = b.extraSettingsEl.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom });
        });
      });
    }
  }

  /** Read the ledger and every labelled item afresh. */
  private load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        this.ledger = await this.readLedger();
        this.items = await this.collect();
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Every labelled item in the vault: practice lines and corrections. */
  private async collect(): Promise<ShareItem[]> {
    const learning = this.host.learning();
    const lines: PracticeSource[] = [];
    for (const file of practiceFiles(learning)) {
      const doc = await readPracticeDoc(learning, file.path).catch(() => null);
      if (!doc) continue;
      const set = practiceSetOfDoc(doc);
      for (const line of practiceLines(doc)) {
        lines.push({
          text: line.text,
          set,
          device: doc.practice?.device,
          input: doc.practice?.input,
          strokes: line.strokes,
        });
      }
    }
    const corrections = await readCorrections(learning);
    return withIds([...practiceDrafts(lines), ...correctionDrafts(corrections)]);
  }

  private async readLedger(): Promise<SharingLedger> {
    const adapter = this.host.app.vault.adapter;
    const path = ledgerPath();
    return parseLedger((await adapter.exists(path)) ? await adapter.read(path) : null);
  }

  /** Write `next`, merged with what sync may have brought since it was read. */
  private async saveLedger(next: SharingLedger): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    const disk = await this.readLedger();
    const merged = mergeLedgers(next, disk);
    if (!(await adapter.exists(HANDWRITING_FOLDER))) await adapter.mkdir(HANDWRITING_FOLDER);
    await adapter.write(ledgerPath(), serializeLedger(merged));
    this.ledger = merged;
  }

  private client(): ShareClient {
    return { app: this.host.version, grape: this.host.grape(), device: deviceKind() };
  }

  private openConsent(redraw: () => void, onClosed?: () => void): void {
    void this.load().then(() => {
      const ledger = this.ledger;
      const items = this.items;
      if (!ledger || !items) return;
      const pending = pendingItems(items, ledger);
      // Agreeing is recorded with the send, not before: "Not now" leaves nothing behind.
      // `auto` is the consent's box: new items go by themselves from now on.
      const agreed = (auto: boolean): SharingLedger => agree(ledger, Date.now(), randomBytes, auto);
      let acted = false;
      // Someone who agreed to older terms sees what changed, and agrees or stops.
      const before = ledger.consent?.version;
      const changes =
        before !== undefined && before < CONSENT_VERSION ? consentChanges(before) : [];
      const modal = new SharingConsentModal(
        this.host,
        pending,
        changes,
        // Ticked only for someone who chose it and has not stopped since.
        ledger.consent !== null && ledger.auto.on,
        (auto) => {
          acted = true;
          void this.saveLedger(agreed(auto))
            .then(() => this.retryUpgrade())
            .then(() => this.newItems(false))
            .then(redraw);
        },
        () => {
          acted = true;
          void this.stop(redraw);
        },
        (auto) => {
          acted = true;
          void this.send(agreed(auto), pending, []).then(redraw);
        },
        (auto) => {
          acted = true;
          this.openReview(agreed(auto), pending, redraw);
        },
      );
      if (onClosed) {
        const close = modal.onClose.bind(modal);
        modal.onClose = () => {
          close();
          if (!acted) onClosed();
        };
      }
      modal.open();
    });
  }

  /** Send what is new, without a review: the user agreed, and chose Share. */
  private shareNew(redraw: () => void): void {
    void this.load().then(() => {
      if (!this.ledger || !this.items) return;
      void this.send(this.ledger, pendingItems(this.items, this.ledger), []).then(redraw);
    });
  }

  private review(redraw: () => void): void {
    void this.load().then(() => {
      if (!this.ledger || !this.items) return;
      this.openReview(this.ledger, pendingItems(this.items, this.ledger), redraw);
    });
  }

  private openReview(ledger: SharingLedger, pending: ShareItem[], redraw: () => void): void {
    new SharingReviewModal(this.host, pending, (kept, declined) => {
      void this.send(ledger, kept, declined).then(redraw);
    }).open();
  }

  /** Send new items by themselves, or only on Share; turning it on sends what waits. */
  private async toggleAuto(redraw: () => void): Promise<void> {
    if (!this.ledger) return;
    const on = !this.ledger.auto.on;
    await this.saveLedger(setAuto(this.ledger, on, Date.now()));
    if (on) await this.newItems(false);
    redraw();
  }

  /**
   * Record the consent and the review, then send what was kept, batch by
   * batch. `quiet` (a send by itself) says nothing: what failed waits for
   * the next new item or the next start, and the settings row counts it.
   */
  private async send(
    agreed: SharingLedger,
    kept: ShareItem[],
    declined: string[],
    quiet = false,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.saveLedger(markDeclined(agreed, declined));
      const ledger = this.ledger;
      if (!ledger) return;
      const built = buildBatches(kept, ledger, this.client());
      if (!built) return;
      // Stop, Delete, unticking Share automatically or a plugin unload while
      // batches go ends the send before the next one: nothing more is sent,
      // and nothing is marked sent under a contributor a delete ended.
      const stillOn = (): boolean => {
        const now = this.ledger;
        return (
          !this.destroyed &&
          now !== null &&
          now.epoch === ledger.epoch &&
          now.contributor === ledger.contributor &&
          (quiet ? autoSends(now) : sharingOn(now))
        );
      };
      if (quiet) {
        for (const batch of built.batches) {
          if (!stillOn()) return;
          if ((await postBatch(batch, ledger.key ?? "")) !== "sent" || !stillOn()) return;
          await this.saveLedger(
            markSent(
              this.ledger ?? ledger,
              batch.items.map((i) => i.id),
            ),
          );
        }
        return;
      }
      if (built.tooBig.length > 0) {
        new Notice(stn("review.tooBig", built.tooBig.length), 8000);
      }
      let count = 0;
      for (const batch of built.batches) {
        if (!stillOn()) return;
        const outcome = await postBatch(batch, ledger.key ?? "");
        if (!stillOn()) return;
        if (outcome === "sent") {
          await this.saveLedger(
            markSent(
              this.ledger ?? ledger,
              batch.items.map((i) => i.id),
            ),
          );
          count += batch.items.length;
          continue;
        }
        if (outcome === "closed") new Notice(st("closed"), 10000);
        else if (outcome === "offline") new Notice(st("offline"), 8000);
        else if (count > 0) new Notice(stn("partly", count, { message: outcome.failed }));
        else new Notice(st("failed", { message: outcome.failed }), 10000);
        return;
      }
      if (count > 0) new Notice(stn("sent", count), 6000);
    } catch (error) {
      if (quiet) console.warn("FineNotes: sharing new items failed", error);
      else new Notice(st("failed", { message: errorMessage(error) }), 10000);
    } finally {
      this.busy = false;
    }
  }

  private async stop(redraw: () => void): Promise<void> {
    if (!this.ledger) return;
    await this.saveLedger(stopSharing(this.ledger, Date.now()));
    new Notice(st("stopped"), 6000);
    redraw();
  }

  private confirmDelete(redraw: () => void): void {
    const ledger = this.ledger;
    if (!ledger) return;
    new DeleteSharedModal(this.host, ledger.sent.length, () => {
      void (async () => {
        await this.saveLedger(requestDelete(ledger, Date.now()));
        await this.retryDelete(false);
        redraw();
      })();
    }).open();
  }

  /**
   * Tell the server the consent now covers what was shared before, when the
   * ledger owes it. Quiet: it is sent again on the next start until it lands.
   */
  private async retryUpgrade(): Promise<void> {
    const ledger = this.ledger;
    if (!ledger || ledger.upgradeOwed === 0 || !ledger.contributor || !ledger.key) return;
    const version = ledger.upgradeOwed;
    let response;
    try {
      response = await requestUrl({
        url: `${ENDPOINT}/contributors/${ledger.contributor}/consent`,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${ledger.key}` },
        body: JSON.stringify({ version, licence: SHARE_LICENCE }),
        throw: false,
      });
    } catch {
      return;
    }
    // 404: the server holds nothing of this contributor, so nothing older to cover.
    if (response.status === 200 || response.status === 404) {
      if (this.ledger) await this.saveLedger(upgradeDone(this.ledger, version));
    }
  }

  /** Send the delete the ledger owes; `quiet` on load, where only success is worth a word. */
  private async retryDelete(quiet: boolean): Promise<void> {
    const owed = this.ledger?.pendingDelete;
    if (!owed) return;
    let response;
    try {
      response = await requestUrl({
        url: `${ENDPOINT}/contributors/${owed.contributor}`,
        method: "DELETE",
        headers: { Authorization: `Bearer ${owed.key}` },
        throw: false,
      });
    } catch {
      if (!quiet) new Notice(st("deleteQueued"), 10000);
      return;
    }
    // 404: the server has nothing for this contributor, which is what was asked.
    if (response.status === 200 || response.status === 204 || response.status === 404) {
      if (this.ledger) await this.saveLedger(deleteDone(this.ledger));
      new Notice(st("deleted"), 8000);
    } else if (!quiet) {
      new Notice(st("deleteQueued"), 10000);
    }
  }
}

async function postBatch(batch: ShareBatch, key: string): Promise<SendOutcome> {
  let response;
  try {
    response = await requestUrl({
      url: `${ENDPOINT}/batches`,
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${key}` },
      body: JSON.stringify(batch),
      throw: false,
    });
  } catch {
    return "offline";
  }
  if (response.status === 200) return "sent";
  if (response.status === 503) return "closed";
  let message = `HTTP ${response.status}`;
  try {
    const body = response.json as { error?: unknown };
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // Not JSON: the status says enough.
  }
  return { failed: message };
}

function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

/** The kind of device, as the batch says it (never more than this). */
function deviceKind(): string {
  if (Platform.isIosApp) return Platform.isTablet ? "ipad" : "iphone";
  if (Platform.isAndroidApp) return Platform.isTablet ? "android-tablet" : "android";
  return "desktop";
}

// ---------------------------------------------------------------------------
// Reminder

/**
 * The reminder, drawn like the invite: how many new items wait and what
 * they are; Not now, Always share (from now on by themselves), Share N.
 */
export function drawRemindCard(
  parent: HTMLElement,
  pending: readonly ShareItem[],
  chose: (choice: "later" | "always" | "share") => void,
): void {
  const card = parent.createDiv({ cls: "goodobsidian-share-invite" });
  setIcon(card.createDiv({ cls: "goodobsidian-share-invite-icon" }), "heart-handshake");
  const text = card.createDiv({ cls: "goodobsidian-share-invite-text" });
  text.createDiv({
    cls: "goodobsidian-share-invite-title",
    text: stn("remind.title", pending.length),
  });
  text.createDiv({ cls: "goodobsidian-share-desc", text: whatThereIs(countByKind(pending)) });
  const buttons = card.createDiv({ cls: "goodobsidian-share-invite-buttons" });
  const button = (label: string, choice: "later" | "always" | "share", cta = false): void => {
    const b = buttons.createEl("button", { text: label });
    if (cta) b.addClass("mod-cta");
    b.addEventListener("click", (event) => {
      // A notice hides on any click; the buttons decide for themselves.
      event.stopPropagation();
      chose(choice);
    });
  };
  button(st("invite.later"), "later");
  button(st("remind.always"), "always");
  button(stn("shareNew", pending.length), "share", true);
}

// ---------------------------------------------------------------------------
// Consent

/**
 * Asking once: what sharing is, in plain words, and one choice. Share is the
 * agreement, and Review first shows every item before anything goes (Joost,
 * 2026-11-16). One box, unticked: whether later items go by themselves or
 * wait for Share (Joost, 2026-11-26).
 */
export class SharingConsentModal extends Modal {
  private auto: boolean;

  constructor(
    host: SharingHost,
    private readonly pending: readonly ShareItem[],
    /** What changed since the terms this person agreed to; empty for someone new. */
    private readonly changes: readonly ConsentChange[],
    /** The box's state when the dialog opens: the choice already made, else off. */
    auto: boolean,
    private readonly onAgree: (auto: boolean) => void,
    private readonly onStop: () => void,
    private readonly onShare: (auto: boolean) => void,
    private readonly onReview: (auto: boolean) => void,
  ) {
    super(host.app);
    this.auto = auto;
  }

  /** The box: send later items by themselves. */
  private drawAuto(body: HTMLElement): void {
    const row = body.createEl("label", { cls: "goodobsidian-share-auto" });
    const box = row.createEl("input", { type: "checkbox" });
    box.checked = this.auto;
    box.addEventListener("change", () => {
      this.auto = box.checked;
    });
    row.createSpan({ text: st("consent.auto", { count: REMIND_EVERY }) });
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-share");
    const body = this.contentEl;
    if (this.changes.length > 0) {
      this.drawChanged(body);
      return;
    }
    this.titleEl.setText(st("consent.title"));
    body.createEl("p", { text: st("consent.intro") });
    body.createEl("p", {
      cls: "goodobsidian-share-what",
      text:
        this.pending.length > 0 ? whatThereIs(countByKind(this.pending)) : st("consent.nothing"),
    });

    drawTerms(body);
    if (this.pending.length > 0) this.drawAuto(body);

    const footer = body.createDiv({ cls: "modal-button-container" });
    footer
      .createEl("button", { text: st("consent.cancel") })
      .addEventListener("click", () => this.close());
    if (this.pending.length === 0) return;
    footer.createEl("button", { text: st("consent.review") }).addEventListener("click", () => {
      this.close();
      this.onReview(this.auto);
    });
    footer
      .createEl("button", { cls: "mod-cta", text: stn("consent.share", this.pending.length) })
      .addEventListener("click", () => {
        this.close();
        this.onShare(this.auto);
      });
  }

  /**
   * For someone who agreed to older terms: what changed since, then the
   * terms in full, the box, and one choice. Agreeing sends nothing unless
   * the box is ticked; else new items wait for Share in settings, as before.
   */
  private drawChanged(body: HTMLElement): void {
    this.titleEl.setText(st("changed.title"));
    const list = body.createEl("ul", { cls: "goodobsidian-share-changes" });
    for (const change of this.changes) list.createEl("li", { text: st(`changed.${change}`) });
    body.createEl("p", { cls: "goodobsidian-share-desc", text: st("changed.covers") });
    drawTerms(body);
    this.drawAuto(body);
    const footer = body.createDiv({ cls: "modal-button-container" });
    footer
      .createEl("button", { cls: "mod-warning", text: st("changed.stop") })
      .addEventListener("click", () => {
        this.close();
        this.onStop();
      });
    footer
      .createEl("button", { cls: "mod-cta", text: st("changed.agree") })
      .addEventListener("click", () => {
        this.close();
        this.onAgree(this.auto);
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** The terms in full, as every consent dialog shows them. */
function drawTerms(body: HTMLElement): void {
  const facts = body.createDiv({ cls: "goodobsidian-share-facts" });
  const fact = (heading: string, ...lines: string[]): void => {
    facts.createEl("h4", { text: heading });
    for (const line of lines) facts.createEl("p", { text: line });
  };
  fact(st("consent.sentHeading"), st("consent.sent"));
  fact(st("consent.neverHeading"), st("consent.never"));
  fact(
    st("consent.honestHeading"),
    st("consent.identifies"),
    st("consent.who"),
    st("consent.licence"),
    st("consent.control"),
  );
  facts.createEl("a", { text: st("consent.policy"), href: PRIVACY_URL });
}

/** "20 practice lines, 86 corrected words and 33 equations", leaving out what there is none of. */
function whatThereIs(counts: Record<ShareKind, number>): string {
  const parts = SHARE_KINDS.filter((kind) => counts[kind] > 0).map((kind) =>
    stn(`count.${kind}`, counts[kind]),
  );
  const last = parts[parts.length - 1] ?? "";
  const list =
    parts.length > 1 ? st("consent.and", { head: parts.slice(0, -1).join(", "), last }) : last;
  return st("consent.have", { list });
}

// ---------------------------------------------------------------------------
// Review

class SharingReviewModal extends Modal {
  private readonly ticked = new Set<string>();

  constructor(
    host: SharingHost,
    private readonly items: readonly ShareItem[],
    private readonly onSend: (kept: ShareItem[], declined: string[]) => void,
  ) {
    super(host.app);
    for (const item of items) this.ticked.add(item.id);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-share");
    this.titleEl.setText(stn("review.title", this.items.length));
    const body = this.contentEl;
    body.createEl("p", { text: st("review.intro") });
    const list = body.createDiv({ cls: "goodobsidian-share-review" });
    const color = getComputedStyle(this.contentEl).color || "#222";
    const send = createEl("button", { cls: "mod-cta" });
    const update = (): void => {
      const n = this.ticked.size;
      send.setText(n > 0 ? stn("review.send", n) : st("review.none"));
    };

    for (const kind of SHARE_KINDS) {
      const items = this.items.filter((item) => item.kind === kind);
      if (items.length === 0) continue;
      const group = list.createDiv({ cls: "goodobsidian-share-group" });
      const head = group.createDiv({ cls: "goodobsidian-share-group-head" });
      head.createSpan({ text: `${st(`kind.${kind}`)} · ${items.length}` });
      const all = head.createEl("button", { cls: "clickable-icon goodobsidian-share-all" });
      const rows = group.createDiv();
      const boxes = new Map<string, HTMLInputElement>();
      const syncAll = (): void => {
        const any = items.some((item) => this.ticked.has(item.id));
        all.setText(st(any ? "review.untickAll" : "review.tickAll"));
      };
      all.addEventListener("click", () => {
        const any = items.some((item) => this.ticked.has(item.id));
        for (const item of items) {
          if (any) this.ticked.delete(item.id);
          else this.ticked.add(item.id);
          const box = boxes.get(item.id);
          if (box) box.checked = !any;
        }
        syncAll();
        update();
      });
      const draw = (from: number, to: number): void => {
        for (const item of items.slice(from, to)) {
          const row = rows.createEl("label", { cls: "goodobsidian-share-item" });
          const box = row.createEl("input", { type: "checkbox" });
          box.checked = this.ticked.has(item.id);
          boxes.set(item.id, box);
          box.addEventListener("change", () => {
            if (box.checked) this.ticked.add(item.id);
            else this.ticked.delete(item.id);
            row.toggleClass("is-off", !box.checked);
            syncAll();
            update();
          });
          const strip = row.createDiv({ cls: "goodobsidian-share-strip" });
          drawInk(strip.createEl("canvas"), item, color);
          strip.createDiv({ cls: "goodobsidian-share-label", text: caption(item) });
        }
      };
      draw(0, FIRST_ROWS);
      if (items.length > FIRST_ROWS) {
        const more = group.createEl("button", {
          cls: "clickable-icon goodobsidian-share-all",
          text: `+ ${items.length - FIRST_ROWS}`,
        });
        more.addEventListener("click", () => {
          more.remove();
          draw(FIRST_ROWS, items.length);
        });
      }
      syncAll();
    }

    const footer = body.createDiv({ cls: "modal-button-container" });
    footer
      .createEl("button", { text: st("review.back") })
      .addEventListener("click", () => this.close());
    footer.appendChild(send);
    send.addEventListener("click", () => {
      const kept = this.items.filter((item) => this.ticked.has(item.id));
      const declined = this.items.filter((item) => !this.ticked.has(item.id)).map((i) => i.id);
      this.close();
      this.onSend(kept, declined);
    });
    update();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** The line under an item's ink: its text, and for a correction what was answered. */
function caption(item: ShareItem): string {
  if (item.kind === "practice") return st("review.line", { text: item.text });
  if (item.answer === "misread" && item.read !== undefined) {
    return st("review.typed", { text: item.text, read: item.read });
  }
  if (item.answer === "mistake") return st("review.slip", { text: item.text });
  return st("review.confirmed", { text: item.text });
}

/** Draw an item's ink as it will be sent: its points, fitted into a strip. */
function drawInk(canvas: HTMLCanvasElement, item: ShareItem, color: string): void {
  const height = 44;
  const maxWidth = 320;
  let maxX = 0;
  let maxY = 0;
  for (const stroke of item.strokes) {
    for (let i = 0; i + 1 < stroke.pts.length; i += 3) {
      maxX = Math.max(maxX, stroke.pts[i]);
      maxY = Math.max(maxY, stroke.pts[i + 1]);
    }
  }
  const pad = 4;
  const scale = Math.min(
    (height - 2 * pad) / Math.max(maxY, 1),
    (maxWidth - 2 * pad) / Math.max(maxX, 1),
    1.5,
  );
  const width = Math.max(height, Math.ceil(maxX * scale + 2 * pad));
  const ratio = canvas.win?.devicePixelRatio ?? 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.setCssProps({ width: `${width}px`, height: `${height}px` });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const top = (height - maxY * scale) / 2;
  for (const stroke of item.strokes) {
    ctx.beginPath();
    for (let i = 0; i + 1 < stroke.pts.length; i += 3) {
      const x = pad + stroke.pts[i] * scale;
      const y = top + stroke.pts[i + 1] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // A dot (one point) still shows.
    if (stroke.pts.length === 3)
      ctx.lineTo(pad + stroke.pts[0] * scale + 0.01, top + stroke.pts[1] * scale);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Delete

class DeleteSharedModal extends Modal {
  constructor(
    host: SharingHost,
    private readonly count: number,
    private readonly onDelete: () => void,
  ) {
    super(host.app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-share");
    this.titleEl.setText(st("deleteTitle"));
    this.contentEl.createEl("p", { text: stn("deleteBody", this.count) });
    const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
    footer
      .createEl("button", { text: st("consent.cancel") })
      .addEventListener("click", () => this.close());
    const del = footer.createEl("button", {
      cls: "mod-warning",
      text: st("deleteConfirm"),
    });
    del.addEventListener("click", () => {
      this.close();
      this.onDelete();
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
