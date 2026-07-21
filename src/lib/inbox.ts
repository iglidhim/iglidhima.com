// Pure inbox list transforms and item view-model for the Parent_Inbox
// (Requirements 7.1, 7.2, 7.4, 7.5, 7.6).
//
// This module is intentionally free of any DOM or Cloudflare Workers globals so
// it compiles under both the client (`tsconfig.json`) and Worker
// (`tsconfig.worker.json`) programs and is directly unit/property testable in
// the fast `node` environment. The ParentInbox factory (`src/ui/parentInbox.ts`)
// renders these plain values into DOM.

/**
 * The allowed sender identities. Kept locally compatible with the
 * `SenderName` type in the shared validation module so this file stays
 * dependency-free.
 */
export type SenderName = "Kian" | "Eloise";

/**
 * The submission summary returned by `GET /api/family/submissions` and rendered
 * in the Parent_Inbox list. Mirrors the D1 index row (see the design Data
 * Models section).
 */
export interface SubmissionSummary {
  id: string;
  sender: SenderName;
  created_at: number; // epoch milliseconds (UTC)
  has_note: boolean;
  note_text: string | null;
  has_image: boolean;
}

/**
 * The plain view-model for a single inbox item. The ParentInbox factory turns
 * this into DOM; keeping it a plain object makes Property 14 node-testable.
 */
export interface ItemViewModel {
  sender: SenderName;
  timestampLabel: string;
  hasNote: boolean;
  hasImage: boolean;
  /** Present only when the item carries note text. */
  notePreview?: string;
}

/** Maximum number of characters shown in the list note preview. */
const NOTE_PREVIEW_MAX = 80;

/**
 * Order submissions from newest to oldest by `created_at` (Requirement 7.1).
 *
 * Returns a new array and never mutates the input. The sort is stable so
 * submissions sharing a timestamp keep their original relative order.
 */
export function sortNewestFirst(
  list: readonly SubmissionSummary[],
): SubmissionSummary[] {
  // Decorate with the original index so equal timestamps stay stable even on
  // engines whose Array.prototype.sort is not itself stable.
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (b.item.created_at !== a.item.created_at) {
        return b.item.created_at - a.item.created_at;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * Remove the submission with the given id (Requirement 7.4).
 *
 * Returns a new array without the targeted id. If no submission has that id the
 * returned array has the same contents as the input (a fresh copy).
 */
export function removeById(
  list: readonly SubmissionSummary[],
  id: string,
): SubmissionSummary[] {
  return list.filter((item) => item.id !== id);
}

/**
 * Whether the Parent_Inbox should show the no-submissions message
 * (Requirements 7.5, 7.6): true if and only if the list is empty.
 */
export function isEmptyState(list: readonly SubmissionSummary[]): boolean {
  return list.length === 0;
}

/**
 * Build the plain view-model for a single inbox item (Requirement 7.2).
 *
 * Reflects the summary's `has_note` / `has_image` flags and includes a trimmed
 * note preview only when the item actually carries note text.
 */
export function toItemViewModel(summary: SubmissionSummary): ItemViewModel {
  const base: ItemViewModel = {
    sender: summary.sender,
    timestampLabel: formatTimestamp(summary.created_at),
    hasNote: summary.has_note,
    hasImage: summary.has_image,
  };

  if (summary.has_note && summary.note_text !== null) {
    return { ...base, notePreview: previewText(summary.note_text) };
  }
  return base;
}

/**
 * Format an epoch-millisecond timestamp into a stable, human-readable UTC label
 * (e.g. `2024-01-15 14:30`). UTC and fixed formatting keep the label
 * deterministic across environments.
 */
export function formatTimestamp(createdAt: number): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/** Trim and truncate note text for the list preview. */
function previewText(note: string): string {
  const trimmed = note.trim();
  if (trimmed.length <= NOTE_PREVIEW_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, NOTE_PREVIEW_MAX)}…`;
}
