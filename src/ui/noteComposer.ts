// src/ui/noteComposer.ts
// NoteComposer chrome component (Requirements 3.1, 3.3, 10.3).
//
// The NoteComposer lets a Child_User leave their dad a typed message. It is a
// framework-free vanilla-TS factory matching the other ui/ components
// (themeToggle, playArea, …): it builds its own DOM using the `.note-composer`
// / `.note-composer__input` / `.note-composer__count` CSS classes (styling is
// added in task 18.1) and exposes a small { element, mount, destroy } handle
// plus `getText()` / `isEmpty()` accessors the FamilyCorner view reads at send
// time.
//
// The message is a single <textarea> capped at MAX_NOTE_LENGTH characters. The
// cap is enforced two ways: the native `maxlength` attribute stops typing past
// the limit, and an input handler defensively clamps the value (covering paste
// paths and programmatic assignment) before recomputing the live remaining
// count. The count lives in an `aria-live="polite"` region so assistive tech
// announces the remaining characters as the child types, without stealing
// focus (Requirement 10.3). The 500-char ceiling is shared with the pure
// server-side validation via MAX_NOTE_LENGTH so the UI and the security
// boundary never drift (Requirement 3.3).
//
// Accessibility:
//   - The <textarea> has a visible <label> associated via `for`/`id`, so it has
//     an accessible name (Requirement 10.3).
//   - The remaining-count region is `aria-live="polite"` and labelled, so its
//     updates are announced but non-disruptive.

import { MAX_NOTE_LENGTH } from "../worker/validation";

/** A mounted NoteComposer. Returned by {@link createNoteComposer}. */
export interface NoteComposer {
  /** The composer root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the composer to a parent node. */
  mount(parent: HTMLElement): void;
  /** Remove the composer from the DOM and detach its listener. */
  destroy(): void;
  /** The current message, trimmed of leading/trailing whitespace. */
  getText(): string;
  /** True when the trimmed message is empty (blank or whitespace-only). */
  isEmpty(): boolean;
}

/** Options for {@link createNoteComposer}. */
export interface CreateNoteComposerOptions {
  /** Visible label text for the textarea. Defaults to a kid-friendly prompt. */
  label?: string;
  /** Placeholder shown in the empty textarea. */
  placeholder?: string;
}

/** A short DOM-unique id so the label's `for` can target the textarea. */
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `note-composer-input-${idCounter}`;
}

/**
 * Create a NoteComposer component.
 *
 * The textarea is capped at {@link MAX_NOTE_LENGTH} characters (native
 * `maxlength` plus a defensive clamp), and a live `aria-live="polite"` count
 * reports how many characters remain, updating on every input.
 */
export function createNoteComposer(options: CreateNoteComposerOptions = {}): NoteComposer {
  const { label = "Write your note", placeholder = "Type a message for Dad…" } = options;

  const root = document.createElement("div");
  root.className = "note-composer";

  const inputId = nextId();

  const labelEl = document.createElement("label");
  labelEl.className = "note-composer__label";
  labelEl.setAttribute("for", inputId);
  labelEl.textContent = label;

  const textarea = document.createElement("textarea");
  textarea.className = "note-composer__input";
  textarea.id = inputId;
  textarea.placeholder = placeholder;
  // Native cap: the browser prevents typing past the limit (Requirement 3.3).
  textarea.maxLength = MAX_NOTE_LENGTH;

  const count = document.createElement("p");
  count.className = "note-composer__count";
  // Announce remaining-character updates politely, without moving focus.
  count.setAttribute("aria-live", "polite");
  count.setAttribute("role", "status");

  /**
   * Defensively clamp the value to the cap (covering paste/programmatic writes
   * that can bypass `maxlength` in some engines) and refresh the live count.
   */
  function refresh(): void {
    if (textarea.value.length > MAX_NOTE_LENGTH) {
      textarea.value = textarea.value.slice(0, MAX_NOTE_LENGTH);
    }
    const remaining = MAX_NOTE_LENGTH - textarea.value.length;
    count.textContent = `${remaining} characters remaining`;
  }

  function handleInput(): void {
    refresh();
  }

  textarea.addEventListener("input", handleInput);

  // Seed the count from the initial (empty) value.
  refresh();

  root.appendChild(labelEl);
  root.appendChild(textarea);
  root.appendChild(count);

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      textarea.removeEventListener("input", handleInput);
      root.remove();
    },

    getText(): string {
      return textarea.value.trim();
    },

    isEmpty(): boolean {
      return textarea.value.trim().length === 0;
    },
  };
}
