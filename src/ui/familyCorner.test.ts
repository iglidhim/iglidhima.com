// Render/behaviour tests for the Family_Corner create-and-send view.
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts),
// giving it a document and window. The submit function is injected as a mock so
// the tests drive the orchestration without any network I/O; the child factories
// are the real ones (jsdom canvas is fine — the DoodleBoard guards it).
//
// _Validates: Requirements 3.2, 3.4, 3.5, 4.4, 5.3_
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFamilyCorner, type SubmitInput } from "./familyCorner";

/** Fill the note textarea and dispatch an input event, as a child typing would. */
function typeNote(host: HTMLElement, text: string): void {
  const textarea = host.querySelector<HTMLTextAreaElement>(
    ".note-composer__input",
  )!;
  textarea.value = text;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Click the sender option with the given visible label (Kian | Eloise). */
function pickSender(host: HTMLElement, name: string): void {
  const options = host.querySelectorAll<HTMLButtonElement>(
    ".sender-selector__option",
  );
  const option = Array.from(options).find((b) => b.textContent === name)!;
  option.click();
}

function sendButton(host: HTMLElement): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(".family-corner__send")!;
}

function promptEl(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>(".family-corner__prompt")!;
}

describe("createFamilyCorner", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("posts the sender + note to the injected submit and resets on success (Requirements 3.2, 3.4, 5.3)", async () => {
    const submit = vi.fn<(input: SubmitInput) => Promise<{ ok: boolean }>>(
      async () => ({ ok: true }),
    );
    const view = createFamilyCorner({ onBackToHub: () => {}, submit });
    view.mount(host);

    pickSender(host, "Kian");
    typeNote(host, "Hi Dad, love you!");

    sendButton(host).click();
    // Let the async handleSend (validate -> toPngBlob -> submit -> celebrate) run.
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    const input = submit.mock.calls[0]![0];
    expect(input.sender).toBe("Kian");
    expect(input.note).toBe("Hi Dad, love you!");
    // No drawing was made, so the image is sent as null.
    expect(input.imageBlob).toBeNull();

    // After the celebration, the experience resets: note cleared, sender reset.
    await vi.waitFor(() => {
      const textarea = host.querySelector<HTMLTextAreaElement>(
        ".note-composer__input",
      )!;
      expect(textarea.value).toBe("");
    });
    const options = host.querySelectorAll<HTMLButtonElement>(
      ".sender-selector__option",
    );
    options.forEach((b) => expect(b.getAttribute("aria-pressed")).toBe("false"));
    expect(promptEl(host).hidden).toBe(true);
  });

  it("blocks an empty submission with a prompt and does not call submit (Requirement 3.5)", async () => {
    const submit = vi.fn(async () => ({ ok: true }));
    const view = createFamilyCorner({ onBackToHub: () => {}, submit });
    view.mount(host);

    // Pick a sender but leave both the drawing and the note empty.
    pickSender(host, "Eloise");
    sendButton(host).click();
    await Promise.resolve();

    expect(submit).not.toHaveBeenCalled();
    const prompt = promptEl(host);
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toBe("Add a drawing or a note!");
  });

  it("blocks a missing sender with a prompt and does not call submit (Requirement 4.4)", async () => {
    const submit = vi.fn(async () => ({ ok: true }));
    const view = createFamilyCorner({ onBackToHub: () => {}, submit });
    view.mount(host);

    // A note is present but no sender is picked.
    typeNote(host, "Guess who!");
    sendButton(host).click();
    await Promise.resolve();

    expect(submit).not.toHaveBeenCalled();
    const prompt = promptEl(host);
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toBe("Pick who you are first!");
  });

  it("keeps the content and shows an error when submit fails", async () => {
    const submit = vi.fn(async () => ({ ok: false, reason: "storage_error" }));
    const view = createFamilyCorner({ onBackToHub: () => {}, submit });
    view.mount(host);

    pickSender(host, "Kian");
    typeNote(host, "Keep me please");
    sendButton(host).click();

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(promptEl(host).hidden).toBe(false));

    // Content is preserved for a retry.
    const textarea = host.querySelector<HTMLTextAreaElement>(
      ".note-composer__input",
    )!;
    expect(textarea.value).toBe("Keep me please");
    expect(sendButton(host).disabled).toBe(false);
  });

  it("invokes onBackToHub when Back to Hub is activated", () => {
    const onBackToHub = vi.fn();
    const view = createFamilyCorner({ onBackToHub, submit: async () => ({ ok: true }) });
    view.mount(host);

    host.querySelector<HTMLButtonElement>(".family-corner__back")!.click();
    expect(onBackToHub).toHaveBeenCalledTimes(1);
  });

  it("detaches children and removes itself on destroy", () => {
    const view = createFamilyCorner({ onBackToHub: () => {}, submit: async () => ({ ok: true }) });
    view.mount(host);

    expect(host.querySelector(".family-corner")).not.toBeNull();
    view.destroy();
    expect(host.querySelector(".family-corner")).toBeNull();
    expect(host.querySelector(".sender-selector")).toBeNull();
    expect(host.querySelector(".doodle")).toBeNull();
    expect(host.querySelector(".note-composer")).toBeNull();
  });
});
