// src/ui/familyCorner.ts
// Family_Corner view — the create-and-send experience a Child_User opens from
// the Hub (Requirements 3.2, 3.4, 3.5, 4.4, 5.3, 10.1).
//
// This is a framework-free vanilla-TS factory matching the other ui/ components
// (playArea, doodleBoard, …): it builds its own DOM using the `.family-corner`
// CSS classes (styling/sizing added in task 18.1) and exposes the shared
// { element, mount, destroy } handle. It is the composition root for the
// create-and-send flow: it wires together the already-built child factories —
// SenderSelector, DoodleBoard, NoteComposer, a big "Send to Dad" button, a
// Back-to-Hub control (mirroring PlayArea), and a SendConfirmation overlay — and
// owns the submit orchestration.
//
// Submit orchestration (on "Send to Dad"):
//   1. Gather the chosen sender, the trimmed note, and whether the doodle is
//      empty.
//   2. Run the shared, pure `validateSubmission` as an optimistic client-side
//      pre-check (the authoritative check is server-side). Two kid-facing cases
//      get a friendly inline prompt instead of a network round-trip:
//        - no sender picked   -> "Pick who you are first!"   (Req 4.4)
//        - empty submission   -> "Add a drawing or a note!"  (Req 3.5)
//      Any other pre-check rejection surfaces a gentle inline error.
//   3. On a passing pre-check, export the drawing to a PNG blob (null when the
//      drawing is empty) and call the injected `submit`. On success, play the
//      celebration then reset the whole experience for a fresh submission
//      (Req 5.3). On failure, keep the content and show a gentle inline error so
//      the child can retry.
//
// The `submit` function is injectable so tests can drive the flow with a mock;
// the default posts a `multipart/form-data` body to `POST /api/family/submit`
// (fields: `sender`, optional `note`, optional `image` PNG file) and reports
// `{ ok }` from the response.

import { createDoodleBoard, type DoodleBoard } from "./doodleBoard";
import { createNoteComposer, type NoteComposer } from "./noteComposer";
import { createSenderSelector, type SenderSelector } from "./senderSelector";
import { createSendConfirmation, type SendConfirmation } from "./sendConfirmation";
import { validateSubmission, type SenderName } from "../worker/validation";

/**
 * The client-side submission payload handed to {@link CreateFamilyCornerOptions.submit}.
 * A flat value object (not FormData) so tests can assert on it directly and the
 * default sender can build the multipart body from it.
 */
export interface SubmitInput {
  /** The chosen sender — already narrowed to an allowed name by the pre-check. */
  sender: SenderName;
  /** The trimmed note; empty string when there is no note. */
  note: string;
  /** The drawing PNG, or `null` when the drawing is empty / cannot encode. */
  imageBlob: Blob | null;
}

/**
 * The outcome of a submit attempt. `ok` reports whether the submission was
 * accepted and persisted; `reason` optionally names why it was rejected so the
 * view can tailor the inline error.
 */
export interface SubmitResult {
  ok: boolean;
  reason?: string;
}

/** Options for {@link createFamilyCorner}. */
export interface CreateFamilyCornerOptions {
  /** Invoked when the Child_User activates Back-to-Hub (mirrors PlayArea). */
  onBackToHub: () => void;
  /**
   * Sends the submission. Injectable for tests; defaults to posting a
   * `multipart/form-data` body to `POST /api/family/submit`.
   */
  submit?: (input: SubmitInput) => Promise<SubmitResult>;
}

/** A mounted Family_Corner view. Returned by {@link createFamilyCorner}. */
export interface FamilyCorner {
  /** The view root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the view to a parent node. */
  mount(parent: HTMLElement): void;
  /** Tear down every child factory, detach listeners, and remove from the DOM. */
  destroy(): void;
}

/** Kid-friendly inline prompts / errors. */
const PROMPT_NO_SENDER = "Pick who you are first!";
const PROMPT_EMPTY = "Add a drawing or a note!";
const ERROR_SEND_FAILED = "Oops! That didn't send. Please try again.";
const ERROR_GENERIC = "Something's not right with that. Please try again.";

/**
 * Default submit: POST the submission as `multipart/form-data` to the public
 * create endpoint. The browser sets the multipart boundary automatically, so we
 * must NOT set the Content-Type header by hand. Returns `{ ok }` from the
 * response, forwarding any structured `reason` the Worker provides.
 */
async function defaultSubmit(input: SubmitInput): Promise<SubmitResult> {
  const form = new FormData();
  form.append("sender", input.sender);
  if (input.note.length > 0) {
    form.append("note", input.note);
  }
  if (input.imageBlob !== null) {
    form.append("image", input.imageBlob, "drawing.png");
  }

  try {
    const response = await fetch("/api/family/submit", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      let reason: string | undefined;
      try {
        const data = (await response.json()) as { reason?: string };
        reason = data?.reason;
      } catch {
        // Non-JSON error body: fall back to a generic failure.
      }
      return reason === undefined ? { ok: false } : { ok: false, reason };
    }
    return { ok: true };
  } catch {
    // Network / fetch failure: report a non-ok result so the view keeps the
    // content and shows a retry-friendly message.
    return { ok: false, reason: "network_error" };
  }
}

/**
 * Create the Family_Corner create-and-send view.
 *
 * All child factories are created and mounted synchronously; the view is usable
 * as soon as it is mounted. The submit orchestration is bound to the "Send to
 * Dad" button, and a successful send resets the experience for a new submission.
 */
export function createFamilyCorner(
  options: CreateFamilyCornerOptions,
): FamilyCorner {
  const { onBackToHub } = options;
  const submit = options.submit ?? defaultSubmit;

  // --- Root ---------------------------------------------------------------
  const root = document.createElement("div");
  root.className = "family-corner";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Family Corner");

  // --- Header with Back-to-Hub (mirrors PlayArea's lifecycle Back control) --
  const header = document.createElement("div");
  header.className = "family-corner__header";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "btn family-corner__back";
  backButton.textContent = "Back to Hub";
  backButton.setAttribute("aria-label", "Back to Hub");

  const heading = document.createElement("h1");
  heading.className = "family-corner__title";
  heading.textContent = "Family Corner";

  header.append(backButton, heading);

  // --- Child-factory slots (stable mount points survive a reset) ----------
  const senderSlot = document.createElement("div");
  senderSlot.className = "family-corner__sender";

  const doodleSlot = document.createElement("div");
  doodleSlot.className = "family-corner__doodle";

  const noteSlot = document.createElement("div");
  noteSlot.className = "family-corner__note";

  // --- Inline prompt / error region (aria-live so AT announces it) --------
  const prompt = document.createElement("p");
  prompt.className = "family-corner__prompt";
  prompt.setAttribute("role", "status");
  prompt.setAttribute("aria-live", "polite");
  prompt.hidden = true;

  // --- Big "Send to Dad" button -------------------------------------------
  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "btn btn--primary family-corner__send";
  sendButton.textContent = "Send to Dad";
  sendButton.setAttribute("aria-label", "Send to Dad");

  root.append(header, senderSlot, doodleSlot, noteSlot, prompt, sendButton);

  // --- Child factories (re-created on reset) ------------------------------
  let sender: SenderSelector;
  let doodle: DoodleBoard;
  let note: NoteComposer;

  function buildInputs(): void {
    sender = createSenderSelector();
    doodle = createDoodleBoard();
    note = createNoteComposer();
    sender.mount(senderSlot);
    doodle.mount(doodleSlot);
    note.mount(noteSlot);
  }

  function destroyInputs(): void {
    sender.destroy();
    doodle.destroy();
    note.destroy();
    // Clear any residue so the fresh children mount into empty slots.
    senderSlot.replaceChildren();
    doodleSlot.replaceChildren();
    noteSlot.replaceChildren();
  }

  buildInputs();

  // --- SendConfirmation overlay -------------------------------------------
  const confirmation: SendConfirmation = createSendConfirmation();
  confirmation.mount(root);

  // --- Prompt helpers ------------------------------------------------------
  function showPrompt(message: string): void {
    prompt.textContent = message;
    prompt.hidden = false;
  }

  function clearPrompt(): void {
    prompt.textContent = "";
    prompt.hidden = true;
  }

  /** Rebuild every input child and clear prompts, ready for a new submission. */
  function resetExperience(): void {
    destroyInputs();
    buildInputs();
    clearPrompt();
  }

  // --- Submit orchestration -----------------------------------------------
  let sending = false;

  async function handleSend(): Promise<void> {
    if (sending) return;

    clearPrompt();

    const chosenSender = sender.getSender();
    const noteText = note.getText();
    const drawingEmpty = doodle.isEmpty();
    const hasImage = !drawingEmpty;

    // Optimistic client-side pre-check (authoritative check is server-side).
    // Estimate the size cheaply: the real byte total is measured on the server.
    const preCheck = validateSubmission({
      sender: chosenSender,
      note: noteText,
      hasImage,
      totalBytes: noteText.length + (hasImage ? 1024 : 0),
      contentType: "multipart/form-data",
    });

    if (!preCheck.ok) {
      if (preCheck.reason === "invalid_sender") {
        showPrompt(PROMPT_NO_SENDER);
      } else if (preCheck.reason === "empty") {
        showPrompt(PROMPT_EMPTY);
      } else {
        showPrompt(ERROR_GENERIC);
      }
      return;
    }

    // Pre-check passed: export the drawing (null when empty) and send.
    sending = true;
    sendButton.disabled = true;
    try {
      const imageBlob = drawingEmpty ? null : await doodle.toPngBlob();
      const result = await submit({
        sender: preCheck.sender,
        note: noteText,
        imageBlob,
      });

      if (result.ok) {
        // Celebrate, then reset the experience for a new submission (Req 5.3).
        await confirmation.celebrate();
        resetExperience();
      } else {
        // Keep the content so the child can retry (Req 6.5 client mirror).
        showPrompt(ERROR_SEND_FAILED);
      }
    } catch {
      showPrompt(ERROR_SEND_FAILED);
    } finally {
      sending = false;
      sendButton.disabled = false;
    }
  }

  // --- Listeners -----------------------------------------------------------
  const cleanups: Array<() => void> = [];

  function addClick(button: HTMLButtonElement, handler: () => void): void {
    button.addEventListener("click", handler);
    cleanups.push(() => button.removeEventListener("click", handler));
  }

  addClick(backButton, () => onBackToHub());
  addClick(sendButton, () => {
    void handleSend();
  });

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
      destroyInputs();
      confirmation.destroy();
      root.replaceChildren();
      root.remove();
    },
  };
}
