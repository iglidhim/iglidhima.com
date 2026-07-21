import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  sortNewestFirst,
  removeById,
  isEmptyState,
  toItemViewModel,
  type SenderName,
  type SubmissionSummary,
} from "./inbox";

const SENDERS: readonly SenderName[] = ["Kian", "Eloise"];
const senderArb: fc.Arbitrary<SenderName> = fc.constantFrom(...SENDERS);

// A submission summary whose has_note / note_text and has_image flags are kept
// mutually consistent (note_text is non-null iff has_note is true), matching the
// D1 index invariants.
const summaryArb: fc.Arbitrary<SubmissionSummary> = fc
  .record({
    id: fc.uuid(),
    sender: senderArb,
    created_at: fc.integer({ min: 0, max: 4_102_444_800_000 }),
    hasNote: fc.boolean(),
    noteText: fc.string({ maxLength: 500 }),
    has_image: fc.boolean(),
  })
  .map(
    ({ id, sender, created_at, hasNote, noteText, has_image }): SubmissionSummary => ({
      id,
      sender,
      created_at,
      has_note: hasNote,
      note_text: hasNote ? noteText : null,
      has_image,
    }),
  );

// A list of summaries with distinct ids so id-based operations are unambiguous.
const summaryListArb: fc.Arbitrary<SubmissionSummary[]> = fc
  .uniqueArray(summaryArb, {
    maxLength: 30,
    selector: (s) => s.id,
  });

describe("inbox", () => {
  // Feature: family-corner, Property 13: Inbox lists submissions newest-first
  it("sortNewestFirst orders created_at non-increasing and preserves the multiset", () => {
    fc.assert(
      fc.property(fc.array(summaryArb, { maxLength: 30 }), (list) => {
        const sorted = sortNewestFirst(list);

        // created_at is non-increasing from first to last.
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i - 1]!.created_at).toBeGreaterThanOrEqual(
            sorted[i]!.created_at,
          );
        }

        // Non-mutating and same elements (same length, same id multiset).
        expect(sorted).toHaveLength(list.length);
        expect(sorted.map((s) => s.id).sort()).toEqual(
          list.map((s) => s.id).sort(),
        );
      }),
      { numRuns: 100 },
    );
  });

  // Feature: family-corner, Property 14: Each listed item is complete
  it("toItemViewModel includes sender, timestamp label, and flags matching the summary", () => {
    fc.assert(
      fc.property(summaryArb, (summary) => {
        const vm = toItemViewModel(summary);

        expect(vm.sender).toBe(summary.sender);
        expect(typeof vm.timestampLabel).toBe("string");
        expect(vm.timestampLabel.length).toBeGreaterThan(0);
        expect(vm.hasNote).toBe(summary.has_note);
        expect(vm.hasImage).toBe(summary.has_image);

        // A note preview is present exactly when the summary carries note text.
        if (summary.has_note && summary.note_text !== null) {
          expect(typeof vm.notePreview).toBe("string");
        } else {
          expect(vm.notePreview).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: family-corner, Property 15: Deleting removes exactly the targeted submission
  it("removeById drops exactly the targeted id and leaves an absent id unchanged", () => {
    fc.assert(
      fc.property(summaryListArb, fc.uuid(), (list, extraId) => {
        // Present id: removing shrinks by exactly one and the id is gone.
        if (list.length > 0) {
          const target = list[0]!.id;
          const after = removeById(list, target);
          expect(after).toHaveLength(list.length - 1);
          expect(after.some((s) => s.id === target)).toBe(false);
        }

        // Absent id: list is unchanged (same contents).
        const absentId = list.some((s) => s.id === extraId)
          ? `${extraId}-absent`
          : extraId;
        const unchanged = removeById(list, absentId);
        expect(unchanged).toEqual(list);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: family-corner, Property 16: Empty-state vs. list is chosen by count
  it("isEmptyState is true iff the list is empty", () => {
    fc.assert(
      fc.property(fc.array(summaryArb, { maxLength: 30 }), (list) => {
        expect(isEmptyState(list)).toBe(list.length === 0);
      }),
      { numRuns: 100 },
    );
  });
});
