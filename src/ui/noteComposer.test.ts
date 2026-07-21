// Render/behaviour tests for the NoteComposer chrome component.
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts),
// giving it a document and window.
//
// _Validates: Requirements 3.1, 3.3_
import { describe, it, expect, beforeEach } from "vitest";
import { createNoteComposer } from "./noteComposer";
import { MAX_NOTE_LENGTH } from "../worker/validation";

describe("createNoteComposer", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  /** Type `value` into the composer's textarea and dispatch an input event. */
  function type(textarea: HTMLTextAreaElement, value: string): void {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("renders a labelled textarea using the .note-composer classes", () => {
    const composer = createNoteComposer();
    composer.mount(host);

    const root = host.querySelector(".note-composer");
    expect(root).not.toBeNull();

    const textarea = host.querySelector<HTMLTextAreaElement>(".note-composer__input");
    expect(textarea).not.toBeNull();
    expect(textarea?.tagName).toBe("TEXTAREA");

    // The label is associated with the textarea via for/id (Requirement 10.3).
    const label = host.querySelector<HTMLLabelElement>(".note-composer__label");
    expect(label).not.toBeNull();
    expect(label?.getAttribute("for")).toBe(textarea?.id);
    expect(textarea?.id).toBeTruthy();
  });

  it("carries a maxlength attribute enforcing the 500-char cap (Requirement 3.3)", () => {
    const composer = createNoteComposer();
    composer.mount(host);

    const textarea = host.querySelector<HTMLTextAreaElement>(".note-composer__input")!;
    expect(textarea.maxLength).toBe(MAX_NOTE_LENGTH);
    expect(MAX_NOTE_LENGTH).toBe(500);
  });

  it("updates the value and the live remaining-count on input (Requirement 3.1)", () => {
    const composer = createNoteComposer();
    composer.mount(host);

    const textarea = host.querySelector<HTMLTextAreaElement>(".note-composer__input")!;
    const count = host.querySelector<HTMLElement>(".note-composer__count")!;

    // Seeded count reflects the full budget.
    expect(count.textContent).toBe(`${MAX_NOTE_LENGTH} characters remaining`);
    // The count is announced politely to assistive tech (Requirement 10.3).
    expect(count.getAttribute("aria-live")).toBe("polite");

    type(textarea, "Hi Dad");
    expect(textarea.value).toBe("Hi Dad");
    expect(count.textContent).toBe(`${MAX_NOTE_LENGTH - 6} characters remaining`);
  });

  it("clamps programmatic over-length input to the 500-char cap (Requirement 3.3)", () => {
    const composer = createNoteComposer();
    composer.mount(host);

    const textarea = host.querySelector<HTMLTextAreaElement>(".note-composer__input")!;
    const count = host.querySelector<HTMLElement>(".note-composer__count")!;

    // A paste/programmatic write longer than the cap is clamped on input.
    type(textarea, "a".repeat(MAX_NOTE_LENGTH + 50));
    expect(textarea.value.length).toBe(MAX_NOTE_LENGTH);
    expect(count.textContent).toBe("0 characters remaining");
    expect(composer.getText().length).toBe(MAX_NOTE_LENGTH);
  });

  it("reports isEmpty() for blank and whitespace-only input", () => {
    const composer = createNoteComposer();
    composer.mount(host);

    const textarea = host.querySelector<HTMLTextAreaElement>(".note-composer__input")!;

    // Initially empty.
    expect(composer.isEmpty()).toBe(true);

    // Whitespace-only is still empty.
    type(textarea, "   \n\t  ");
    expect(composer.isEmpty()).toBe(true);

    // Real content is not empty.
    type(textarea, "  hello  ");
    expect(composer.isEmpty()).toBe(false);
  });

  it("getText() returns the trimmed value", () => {
    const composer = createNoteComposer();
    composer.mount(host);

    const textarea = host.querySelector<HTMLTextAreaElement>(".note-composer__input")!;

    type(textarea, "   surrounded by spaces   ");
    expect(composer.getText()).toBe("surrounded by spaces");
  });

  it("detaches its listener and removes itself on destroy", () => {
    const composer = createNoteComposer();
    composer.mount(host);
    const textarea = host.querySelector<HTMLTextAreaElement>(".note-composer__input")!;

    expect(host.querySelector(".note-composer")).not.toBeNull();

    composer.destroy();
    expect(host.querySelector(".note-composer")).toBeNull();

    // Firing input on the detached textarea must not throw or re-clamp.
    textarea.value = "x".repeat(MAX_NOTE_LENGTH + 10);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    // The clamp handler is detached, so the raw over-length value survives.
    expect(textarea.value.length).toBe(MAX_NOTE_LENGTH + 10);
  });
});
