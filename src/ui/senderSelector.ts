// src/ui/senderSelector.ts
// Sender_Selector chrome component (Requirements 4.1, 4.2, 4.3, 10.2, 10.5).
//
// The Sender_Selector lets a Child_User say who they are — Kian or Eloise —
// before sending, with NO login, password, or any other credential prompt
// (Requirement 4.3). It is a framework-free vanilla-TS factory matching the
// other ui/ components (doodleBoard, noteComposer, …): it builds its own DOM
// using the `.sender-selector` / `.sender-selector__option` CSS classes
// (>=44x44px sizing styled in task 18.1) and exposes a small
// { element, mount, destroy } handle plus a `getSender()` accessor the
// FamilyCorner view reads at send time.
//
// Design notes:
//   - Exactly two options are rendered, one per allowed sender name, sourced
//     from ALLOWED_SENDERS in the shared validation module so the UI and the
//     server-side allow-list can never drift (Requirement 4.1).
//   - Each option is a native <button> so it is keyboard reachable and
//     activatable out of the box (Requirement 10.5). Selecting one marks it
//     `aria-pressed="true"` and the other `aria-pressed="false"`, and records
//     the chosen name.
//   - No sender is selected initially: `getSender()` returns `null` until the
//     child picks one.
//
// Accessibility:
//   - The two buttons live in a `role="group"` container with an accessible
//     label so assistive tech announces them as one "who are you?" choice
//     (Requirement 10.3-adjacent).
//   - Selection state is exposed via `aria-pressed` on each toggle.

import { ALLOWED_SENDERS, type SenderName } from "../worker/validation";

/** A mounted Sender_Selector. Returned by {@link createSenderSelector}. */
export interface SenderSelector {
  /** The selector root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the selector to a parent node. */
  mount(parent: HTMLElement): void;
  /** Detach every listener and remove the selector from the DOM. */
  destroy(): void;
  /** The chosen sender name, or `null` when none has been picked yet. */
  getSender(): SenderName | null;
}

/** Options for {@link createSenderSelector}. */
export interface CreateSenderSelectorOptions {
  /** Accessible label for the option group. Defaults to a kid-friendly prompt. */
  label?: string;
  /** Called with the chosen sender whenever the selection changes. */
  onChange?: (sender: SenderName) => void;
}

/**
 * Create a Sender_Selector component.
 *
 * Renders exactly two large toggle buttons — one per allowed sender — with no
 * credential prompt of any kind. The first pick records the sender and marks
 * that button pressed; picking the other switches the pressed state.
 */
export function createSenderSelector(
  options: CreateSenderSelectorOptions = {},
): SenderSelector {
  const { label = "Who are you?", onChange } = options;

  const root = document.createElement("div");
  root.className = "sender-selector";
  // The two toggles form a single labelled choice for assistive tech.
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", label);

  let selected: SenderName | null = null;

  /** Per-option button elements, keyed by the sender name they select. */
  const buttons = new Map<SenderName, HTMLButtonElement>();
  /** The click listeners registered per button, so destroy() can detach them. */
  const listeners: Array<{ button: HTMLButtonElement; listener: () => void }> = [];

  function handleSelect(name: SenderName): void {
    selected = name;
    // Reflect the new selection on every toggle's aria-pressed state.
    for (const [sender, button] of buttons) {
      button.setAttribute("aria-pressed", sender === name ? "true" : "false");
    }
    onChange?.(name);
  }

  // Build exactly one option per allowed sender (Requirement 4.1).
  for (const sender of ALLOWED_SENDERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sender-selector__option";
    button.textContent = sender;
    // A text alternative independent of the visible label (Requirement 10.3).
    button.setAttribute("aria-label", sender);
    // Nothing is selected initially: getSender() returns null until a pick.
    button.setAttribute("aria-pressed", "false");

    const listener = (): void => handleSelect(sender);
    button.addEventListener("click", listener);

    buttons.set(sender, button);
    listeners.push({ button, listener });
    root.appendChild(button);
  }

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      for (const { button, listener } of listeners) {
        button.removeEventListener("click", listener);
      }
      listeners.length = 0;
      buttons.clear();
      root.remove();
    },

    getSender(): SenderName | null {
      return selected;
    },
  };
}
