// src/ui/parentInbox.ts
// ParentInbox chrome component (Requirements 7.2, 7.3, 7.4, 7.5, 7.6).
//
// The ParentInbox is the `/inbox` view: the private, access-controlled page
// where the dad reviews the drawings and notes his kids sent. It is a
// framework-free vanilla-TS factory matching the other ui/ components
// (noteComposer, playArea, …): it builds its own DOM using the `.inbox` /
// `.inbox__item` / `.inbox__empty` / `.inbox__detail` / `.inbox__delete` CSS
// classes (styling is added in task 18.1) and exposes a small
// { element, mount, destroy } handle plus an async `load()` that fetches the
// submission list.
//
// All list ordering, empty-vs-list selection, item view-modelling, and
// delete-by-id are delegated to the pure transforms in `src/lib/inbox.ts`
// (`sortNewestFirst`, `toItemViewModel`, `isEmptyState`, `removeById`) so this
// factory only owns DOM rendering and the fetch/delete side effects.
//
// Data flow:
//   - load()   → fetch `GET /api/family/submissions`, sort newest-first, render
//                the list (Requirement 7.1 ordering; 7.2 item content).
//   - select   → render the full-view detail: the full drawing image plus the
//                full note text (Requirement 7.3).
//   - delete   → call `DELETE /api/family/submissions/:id`, then drop the row
//                from the in-memory list and the DOM via `removeById`
//                (Requirement 7.4).
//   - empty    → show the no-submissions message when the list is empty, and
//                the list whenever there is at least one (Requirements 7.5, 7.6).
//   - error    → show a retry message (not a blank page) if the list fetch
//                fails, with a button to try loading again.
//
// The image bytes are served by the parent-only `GET /api/family/submissions/
// :id/image` route; this factory only references that URL as an <img src>, so
// tests can inject a stubbed URL and never assert on real bytes. The fetcher
// and deleter are injectable for testability and default to `fetch`.

import {
  sortNewestFirst,
  removeById,
  isEmptyState,
  toItemViewModel,
  type SubmissionSummary,
} from "../lib/inbox";

/** A mounted ParentInbox. Returned by {@link createParentInbox}. */
export interface ParentInbox {
  /** The inbox root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the inbox to a parent node. */
  mount(parent: HTMLElement): void;
  /**
   * Fetch the submission list and render it (or the empty-state / retry
   * message). Safe to call more than once (e.g. from the retry button).
   */
  load(): Promise<void>;
  /** Remove the inbox from the DOM. */
  destroy(): void;
}

/** Options for {@link createParentInbox}. */
export interface CreateParentInboxOptions {
  /**
   * Fetch the submission list. Injectable for testing; defaults to
   * `GET /api/family/submissions`.
   */
  fetchSubmissions?: () => Promise<SubmissionSummary[]>;
  /**
   * Delete a submission by id. Injectable for testing; defaults to
   * `DELETE /api/family/submissions/:id`.
   */
  deleteSubmission?: (id: string) => Promise<void>;
  /**
   * Build the `<img src>` URL for a submission's drawing. Injectable so tests
   * can stub the URL; defaults to `GET /api/family/submissions/:id/image`.
   */
  imageSrc?: (id: string) => string;
}

/** Default list fetcher: `GET /api/family/submissions` → `{ submissions }`. */
async function defaultFetchSubmissions(): Promise<SubmissionSummary[]> {
  const res = await fetch("/api/family/submissions");
  if (!res.ok) {
    throw new Error(`Failed to load submissions: ${res.status}`);
  }
  const data = (await res.json()) as { submissions?: SubmissionSummary[] };
  return data.submissions ?? [];
}

/** Default deleter: `DELETE /api/family/submissions/:id`. */
async function defaultDeleteSubmission(id: string): Promise<void> {
  const res = await fetch(`/api/family/submissions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Failed to delete submission: ${res.status}`);
  }
}

/** Default image URL: the parent-only image route for a submission id. */
function defaultImageSrc(id: string): string {
  return `/api/family/submissions/${encodeURIComponent(id)}/image`;
}

/**
 * Create a ParentInbox component.
 *
 * The root element is created synchronously; call {@link ParentInbox.load} to
 * fetch and render the submission list (the caller does this after mounting,
 * behind Cloudflare Access).
 */
export function createParentInbox(
  options: CreateParentInboxOptions = {},
): ParentInbox {
  const {
    fetchSubmissions = defaultFetchSubmissions,
    deleteSubmission = defaultDeleteSubmission,
    imageSrc = defaultImageSrc,
  } = options;

  const root = document.createElement("div");
  root.className = "inbox";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Parent inbox");

  const heading = document.createElement("h1");
  heading.className = "inbox__heading";
  heading.textContent = "Family Inbox";
  root.appendChild(heading);

  // The single content region swapped between the loading, list, detail,
  // empty-state, and error views. Rebuilt wholesale on each render so stale
  // nodes (and their listeners) never linger.
  const content = document.createElement("div");
  content.className = "inbox__content";
  root.appendChild(content);

  // In-memory source of truth for the currently loaded, newest-first list.
  let submissions: SubmissionSummary[] = [];

  /** Replace the content region with the given node. */
  function setContent(node: Node): void {
    content.replaceChildren(node);
  }

  /** Render the loading placeholder. */
  function renderLoading(): void {
    const loading = document.createElement("p");
    loading.className = "inbox__loading";
    loading.setAttribute("role", "status");
    loading.textContent = "Loading…";
    setContent(loading);
  }

  /** Render the no-submissions message (Requirements 7.5, 7.6). */
  function renderEmpty(): void {
    const empty = document.createElement("p");
    empty.className = "inbox__empty";
    empty.setAttribute("role", "status");
    empty.textContent = "No submissions yet.";
    setContent(empty);
  }

  /** Render a retry message when the list fetch fails (never a blank page). */
  function renderError(): void {
    const wrapper = document.createElement("div");
    wrapper.className = "inbox__error";
    wrapper.setAttribute("role", "alert");

    const message = document.createElement("p");
    message.className = "inbox__error-message";
    message.textContent = "Could not load submissions.";
    wrapper.appendChild(message);

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "inbox__retry";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      void load();
    });
    wrapper.appendChild(retry);

    setContent(wrapper);
  }

  /**
   * Render the newest-first submission list (Requirements 7.1, 7.2). Each row
   * shows the sender, the formatted timestamp, note/image indicators, a
   * thumbnail when the submission has an image, a select button (opens the full
   * view), and a delete button.
   */
  function renderList(): void {
    if (isEmptyState(submissions)) {
      renderEmpty();
      return;
    }

    const list = document.createElement("ul");
    list.className = "inbox__list";

    for (const summary of submissions) {
      const vm = toItemViewModel(summary);

      const item = document.createElement("li");
      item.className = "inbox__item";
      item.dataset.id = summary.id;

      // The select control carries the item content and opens the full view.
      const select = document.createElement("button");
      select.type = "button";
      select.className = "inbox__select";
      select.setAttribute(
        "aria-label",
        `View submission from ${vm.sender} sent ${vm.timestampLabel}`,
      );

      if (vm.hasImage) {
        const thumb = document.createElement("img");
        thumb.className = "inbox__thumb";
        thumb.src = imageSrc(summary.id);
        thumb.alt = `Drawing from ${vm.sender}`;
        select.appendChild(thumb);
      }

      const sender = document.createElement("span");
      sender.className = "inbox__sender";
      sender.textContent = vm.sender;
      select.appendChild(sender);

      const time = document.createElement("time");
      time.className = "inbox__time";
      time.textContent = vm.timestampLabel;
      select.appendChild(time);

      const indicator = document.createElement("span");
      indicator.className = "inbox__indicator";
      indicator.textContent = contentIndicator(vm.hasNote, vm.hasImage);
      select.appendChild(indicator);

      if (vm.notePreview !== undefined) {
        const preview = document.createElement("span");
        preview.className = "inbox__preview";
        preview.textContent = vm.notePreview;
        select.appendChild(preview);
      }

      select.addEventListener("click", () => {
        renderDetail(summary);
      });
      item.appendChild(select);

      // The delete control removes the submission (Requirement 7.4).
      const del = document.createElement("button");
      del.type = "button";
      del.className = "inbox__delete";
      del.textContent = "Delete";
      del.setAttribute(
        "aria-label",
        `Delete submission from ${vm.sender} sent ${vm.timestampLabel}`,
      );
      del.addEventListener("click", () => {
        void handleDelete(summary.id, del);
      });
      item.appendChild(del);

      list.appendChild(item);
    }

    setContent(list);
  }

  /**
   * Render the full view for a selected submission (Requirement 7.3): the full
   * drawing image and the full note text, plus a back control and a delete
   * control.
   */
  function renderDetail(summary: SubmissionSummary): void {
    const detail = document.createElement("div");
    detail.className = "inbox__detail";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "inbox__back";
    back.textContent = "Back to list";
    back.addEventListener("click", () => {
      renderList();
    });
    detail.appendChild(back);

    const sender = document.createElement("p");
    sender.className = "inbox__detail-sender";
    sender.textContent = summary.sender;
    detail.appendChild(sender);

    const time = document.createElement("time");
    time.className = "inbox__detail-time";
    time.textContent = toItemViewModel(summary).timestampLabel;
    detail.appendChild(time);

    if (summary.has_image) {
      const image = document.createElement("img");
      image.className = "inbox__detail-image";
      image.src = imageSrc(summary.id);
      image.alt = `Drawing from ${summary.sender}`;
      detail.appendChild(image);
    }

    if (summary.has_note && summary.note_text !== null) {
      const note = document.createElement("p");
      note.className = "inbox__detail-note";
      note.textContent = summary.note_text;
      detail.appendChild(note);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "inbox__delete";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete submission from ${summary.sender}`);
    del.addEventListener("click", () => {
      // After deleting from the detail view, return to the (updated) list.
      void handleDelete(summary.id, del, true);
    });
    detail.appendChild(del);

    setContent(detail);
  }

  /**
   * Delete a submission: call the deleter, then drop it from the in-memory list
   * (via `removeById`) and re-render so it disappears from the DOM
   * (Requirement 7.4). On failure the item is left in place and the button is
   * re-enabled so the parent can retry.
   */
  async function handleDelete(
    id: string,
    button: HTMLButtonElement,
    fromDetail = false,
  ): Promise<void> {
    button.disabled = true;
    try {
      await deleteSubmission(id);
      submissions = removeById(submissions, id);
      renderList();
    } catch {
      button.disabled = false;
      if (!fromDetail) {
        button.textContent = "Delete failed — retry";
      }
    }
  }

  /** Fetch and render the list; show the retry message on failure. */
  async function load(): Promise<void> {
    renderLoading();
    try {
      const fetched = await fetchSubmissions();
      submissions = sortNewestFirst(fetched);
      renderList();
    } catch {
      renderError();
    }
  }

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    load,

    destroy(): void {
      // Replacing children drops every rendered node and its listeners; the
      // content region is rebuilt wholesale on each render so nothing lingers.
      content.replaceChildren();
      root.remove();
    },
  };
}

/** A short text indicator of whether an item carries a note and/or a drawing. */
function contentIndicator(hasNote: boolean, hasImage: boolean): string {
  if (hasNote && hasImage) return "Drawing + note";
  if (hasImage) return "Drawing";
  if (hasNote) return "Note";
  return "";
}
