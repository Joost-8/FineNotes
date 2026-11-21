import { describe, expect, it, vi } from "vitest";
import { WorkspaceLeaf, TFile } from "./fake-obsidian";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkView } = await import("../../src/view/ink-view");
const { DEFAULT_SETTINGS } = await import("../../src/settings");
function setup(text = "", uri = "", html = "") {
  const view = new InkView(new WorkspaceLeaf({}) as never, { settings: DEFAULT_SETTINGS } as never);
  const existing = [
    new TFile("Lecture.pdf", 100),
    new TFile("photo.png", 100),
    new TFile("note.md", 100),
  ];
  Object.assign(view.app, {
    vault: { getFileByPath: (path: string) => existing.find((file) => file.path === path) ?? null },
    metadataCache: { getFirstLinkpathDest: () => null },
  });
  const internal = view as unknown as {
    handleFileDrop(event: DragEvent): Promise<void>;
    importPdfFile(file: File, ask?: boolean): Promise<void>;
    file: TFile | null;
    surface: unknown;
    isProtected(): boolean;
  };
  const pdf = vi.spyOn(internal, "importPdfFile").mockResolvedValue();
  const vaultPdf = vi.spyOn(view, "importVaultPdf").mockResolvedValue();
  const image = vi.spyOn(view, "insertImageBytes").mockResolvedValue(null);
  const vaultImage = vi.spyOn(view, "insertImageFromVault").mockResolvedValue(null);
  const event = {
    target: null as EventTarget | null,
    clientX: 0,
    clientY: 0,
    dataTransfer: {
      files: [] as File[],
      // As a browser lists them: files, then the text types the drag carries.
      get types(): string[] {
        return [
          ...(this.files.length ? ["Files"] : []),
          ...(text ? ["text/plain"] : []),
          ...(uri ? ["text/uri-list"] : []),
          ...(html ? ["text/html"] : []),
        ];
      },
      getData: (type: string) =>
        type === "text/plain"
          ? text
          : type === "text/uri-list"
            ? uri
            : type === "text/html"
              ? html
              : "",
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  const drop = (files: File[] = []) => {
    event.dataTransfer.files = files;
    return internal.handleFileDrop(event as unknown as DragEvent);
  };
  return { internal, pdf, vaultPdf, image, vaultImage, event, drop };
}
function picture(name = "photo.png", type = "") {
  const file = new File(["photo"], name, { type });
  const bytes = new ArrayBuffer(5);
  Object.defineProperty(file, "arrayBuffer", { value: vi.fn().mockResolvedValue(bytes) });
  return { file, bytes };
}
describe("file drop routing", () => {
  it.each([
    ["Lecture.PDF", ""],
    ["download", "application/pdf"],
  ])("routes an external PDF named %s", async (name, type) => {
    const file = new File(["%PDF-"], name, { type });
    const { pdf, event, drop } = setup();
    await drop([file]);
    // A drop adds every page after the last, without the page picker.
    expect(pdf).toHaveBeenCalledWith(file);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it.each(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"])(
    "uses the existing picture importer for .%s without a MIME type",
    async (extension) => {
      const { file, bytes } = picture(`photo.${extension.toUpperCase()}`);
      const { image, pdf, drop } = setup();
      await drop([file]);
      expect(image).toHaveBeenCalledWith(bytes, "", file.name);
      expect(pdf).not.toHaveBeenCalled();
    },
  );
  it("accepts picture MIME types supported by the existing file picker", async () => {
    const { file, bytes } = picture("download", "image/avif");
    const { image, drop } = setup();
    await drop([file]);
    expect(image).toHaveBeenCalledWith(bytes, "image/avif", "download");
  });
  it("references an existing vault PDF without copying it", async () => {
    const { vaultPdf, pdf, drop } = setup("[[Lecture.pdf#page=2|Lecture]]");
    await drop();
    expect(vaultPdf).toHaveBeenCalledWith("Lecture.pdf");
    expect(pdf).not.toHaveBeenCalled();
  });
  it("takes a file dragged from Obsidian's file list when the drop carries no text (iPad)", async () => {
    const { internal, vaultPdf, drop } = setup();
    const app = (internal as unknown as { app: object }).app;
    Object.assign(app, {
      dragManager: { draggable: { type: "file", file: new TFile("Lecture.pdf", 100) } },
    });
    await drop();
    expect(vaultPdf).toHaveBeenCalledWith("Lecture.pdf");
  });
  it("takes every PDF and picture of a dragged selection, in order, and skips notes", async () => {
    const { internal, vaultPdf, vaultImage, drop } = setup("ignored.pdf");
    const app = (internal as unknown as { app: object }).app;
    const files = [
      new TFile("Lecture.pdf", 100),
      new TFile("note.md", 100),
      new TFile("photo.png", 100),
    ];
    Object.assign(app, { dragManager: { draggable: { type: "files", files } } });
    await drop();
    expect(vaultPdf).toHaveBeenCalledExactlyOnceWith("Lecture.pdf");
    expect(vaultImage).toHaveBeenCalledExactlyOnceWith("photo.png");
  });
  it.each([
    ["![[photo.png|Photo]]", ""],
    ["", "obsidian://open?vault=School&file=photo.png"],
  ])("references an existing vault picture from %s%s", async (text, uri) => {
    const { vaultImage, image, drop } = setup(text, uri);
    await drop();
    expect(vaultImage).toHaveBeenCalledWith("photo.png");
    expect(image).not.toHaveBeenCalled();
  });
  it.each(["missing.pdf", "missing.png", "note.md", "https://example.com/photo.png"])(
    "leaves unsupported or unresolved drops alone: %s",
    async (text) => {
      const { image, pdf, vaultImage, vaultPdf, event, drop } = setup(text);
      await drop([new File(["text"], "note.txt", { type: "text/plain" })]);
      expect(image).not.toHaveBeenCalled();
      expect(pdf).not.toHaveBeenCalled();
      expect(vaultImage).not.toHaveBeenCalled();
      expect(vaultPdf).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    },
  );
  it("processes multiple pictures in order and skips unsupported files", async () => {
    const first = picture("first.png");
    const second = picture("second.jpg");
    const { image, drop } = setup();
    await drop([first.file, new File(["text"], "note.txt"), second.file]);
    expect(image.mock.calls).toEqual([
      [first.bytes, "", "first.png"],
      [second.bytes, "", "second.jpg"],
    ]);
  });
  it("continues after a file cannot be read", async () => {
    const broken = new File(["photo"], "broken.png");
    Object.defineProperty(broken, "arrayBuffer", {
      value: vi.fn().mockRejectedValue(new Error("unreadable")),
    });
    const next = picture();
    const { image, drop } = setup();
    await drop([broken, next.file]);
    expect(image).toHaveBeenCalledExactlyOnceWith(next.bytes, "", next.file.name);
  });
  it("stops if the notebook changes while reading a picture", async () => {
    const file = new File(["photo"], "photo.png");
    const { internal, image, pdf, drop } = setup();
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => {
        internal.file = new TFile("Other.ink", 100);
        return new ArrayBuffer(5);
      },
    });
    await drop([file, new File(["%PDF-"], "Lecture.pdf")]);
    expect(image).not.toHaveBeenCalled();
    expect(pdf).not.toHaveBeenCalled();
  });
  it("does not import external files into a protected notebook", async () => {
    const { internal, image, pdf, drop } = setup();
    vi.spyOn(internal, "isProtected").mockReturnValue(true);
    await drop([picture().file, new File(["%PDF-"], "Lecture.pdf")]);
    expect(image).not.toHaveBeenCalled();
    expect(pdf).not.toHaveBeenCalled();
  });
});

describe("text drop (discussion #288)", () => {
  function withSurface(text: string, html = "") {
    const made = setup(text, "", html);
    const dropText = vi.fn().mockReturnValue(true);
    made.internal.surface = { dropText, debugDrop: vi.fn() };
    made.event.clientX = 120;
    made.event.clientY = 340;
    return { ...made, dropText };
  }

  it("makes the dropped paragraphs a text box at the drop point", async () => {
    const { dropText, event, drop } = withSurface("First paragraph.\r\n\r\nSecond one.");
    await drop();
    expect(dropText).toHaveBeenCalledExactlyOnceWith(120, 340, "First paragraph.\n\nSecond one.");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("reads HTML when the drag has no plain text", async () => {
    const { dropText, drop } = withSurface("", "<p>One</p><p>Two &amp; three</p>");
    await drop();
    expect(dropText).toHaveBeenCalledExactlyOnceWith(120, 340, "One\n\nTwo & three");
  });

  it("leaves a drop the surface refuses to the browser", async () => {
    const { dropText, event, drop } = withSurface("Some words.");
    dropText.mockReturnValue(false);
    await drop();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("takes but writes nothing into a protected notebook", async () => {
    const { internal, dropText, event, drop } = withSurface("Some words.");
    vi.spyOn(internal, "isProtected").mockReturnValue(true);
    await drop();
    expect(dropText).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("imports a vault link instead of writing it", async () => {
    const { dropText, vaultPdf, drop } = withSurface("[[Lecture.pdf]]");
    await drop();
    expect(vaultPdf).toHaveBeenCalledWith("Lecture.pdf");
    expect(dropText).not.toHaveBeenCalled();
  });

  it("writes nothing for a link to a note", async () => {
    const { dropText, drop } = withSurface("[[note.md]]");
    await drop();
    expect(dropText).not.toHaveBeenCalled();
  });

  it("writes nothing while Obsidian drags one of its own things", async () => {
    const { internal, dropText, drop } = withSurface("Some words.");
    const app = (internal as unknown as { app: object }).app;
    Object.assign(app, { dragManager: { draggable: { type: "link", linktext: "x" } } });
    await drop();
    expect(dropText).not.toHaveBeenCalled();
  });

  it("leaves a file's name alone, but not prose beside it", async () => {
    const named = withSurface("note.txt");
    await named.drop([new File(["text"], "note.txt")]);
    expect(named.dropText).not.toHaveBeenCalled();
    const prose = withSurface("A whole sentence from another app.");
    await prose.drop([new File(["text"], "clip.rtf")]);
    expect(prose.dropText).toHaveBeenCalledOnce();
  });

  it("leaves a text field's own drop to it", async () => {
    const { dropText, event, drop } = withSurface("Some words.");
    event.target = {
      nodeType: 1,
      tagName: "TEXTAREA",
      classList: [],
      isContentEditable: false,
    } as unknown as EventTarget;
    await drop();
    expect(dropText).not.toHaveBeenCalled();
  });
});
