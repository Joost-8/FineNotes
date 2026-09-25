/**
 * The two small dialogs: the yes/no confirmation that settles a promise
 * exactly once, and "What's new", which renders changelog markdown.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../fakes/obsidian"));

const { MarkdownRenderer, Modal, Setting } = await import("../fakes/obsidian");
const { ConfirmModal } = await import("../../src/ui/confirm-modal");
const { WhatsNewModal } = await import("../../src/ui/whats-new-modal");

type FakeModal = InstanceType<typeof Modal>;

const OPTIONS = { title: "Delete page 3?", message: "Its ink goes too.", cta: "Delete" };

/** Ask as the plugin does; return the answer, the open modal and its button row. */
function ask() {
  const answer = ConfirmModal.confirm({} as never, OPTIONS);
  const modal = Modal.made[Modal.made.length - 1];
  const row = Setting.created[Setting.created.length - 1];
  return { answer, modal, row };
}

beforeEach(() => {
  MarkdownRenderer.rendered.length = 0;
});

describe("ConfirmModal", () => {
  it("opens with the title, the message, and the confirming button before Cancel", () => {
    const { modal, row } = ask();
    expect(modal.isOpen).toBe(true);
    expect(modal.modalEl.hasClass("goodobsidian-dialog")).toBe(true);
    expect(modal.titleEl.text).toBe("Delete page 3?");
    expect(modal.contentEl.children[0]).toMatchObject({ tag: "p", text: "Its ink goes too." });
    expect(modal.contentEl.children[1]).toBe(row.settingEl);
    expect(row.buttons.map((b) => [b.text, b.cta])).toEqual([
      ["Delete", true],
      ["Cancel", false],
    ]);
  });

  it("resolves true on the confirming button, and closes", async () => {
    const { answer, modal, row } = ask();
    await row.button("Delete").click();
    expect(modal.isOpen).toBe(false);
    await expect(answer).resolves.toBe(true);
  });

  it("resolves false on Cancel, and closes", async () => {
    const { answer, modal, row } = ask();
    await row.button("Cancel").click();
    expect(modal.isOpen).toBe(false);
    await expect(answer).resolves.toBe(false);
  });

  it("resolves false when dismissed without a button (Esc, the ×, a tap outside)", async () => {
    const { answer, modal } = ask();
    modal.close();
    await expect(answer).resolves.toBe(false);
  });

  it("settles once: a confirmed dialog stays confirmed as it closes", async () => {
    const results: boolean[] = [];
    const { answer, modal, row } = ask();
    void answer.then((v) => results.push(v));
    await row.button("Delete").click();
    modal.close();
    await answer;
    expect(results).toEqual([true]);
  });

  it("clears its content when it closes", () => {
    const { modal } = ask();
    modal.close();
    expect(modal.contentEl.children).toHaveLength(0);
  });
});

describe("WhatsNewModal", () => {
  it("renders the markdown into the modal, owned by the given component", () => {
    const owner = { name: "plugin" };
    new WhatsNewModal({} as never, "## [1.0.0]\n- New", owner as never).open();
    const modal: FakeModal = Modal.made[Modal.made.length - 1];
    expect(modal.titleEl.text).toBe("What's new in FineNotes");
    expect(modal.modalEl.hasClass("goodobsidian-whats-new")).toBe(true);
    expect(modal.modalEl.hasClass("goodobsidian-dialog")).toBe(true);
    expect(MarkdownRenderer.rendered).toHaveLength(1);
    expect(MarkdownRenderer.rendered[0]).toMatchObject({
      markdown: "## [1.0.0]\n- New",
      el: modal.contentEl,
      component: owner,
    });
    modal.close();
    expect(modal.contentEl.children).toHaveLength(0);
  });
});
