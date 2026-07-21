// test/worker.validation.test.ts
// Property-based tests for the pure Family Corner validation and decision logic
// in `src/worker/validation.ts` (Properties 5-12 from the design).
//
// Placed under `test/worker.*.test.ts` so it is type-checked by the Worker
// program (tsconfig.worker.json) alongside the module it exercises. It runs
// under the default `node` Vitest environment (the module has no DOM/Workers
// globals). Every property inherits numRuns >= 100 from test/setup.fast-check.ts.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateSubmission,
  decideRateLimit,
  decideParentAccess,
  MAX_NOTE_LENGTH,
  MAX_TOTAL_BYTES,
  RATE_LIMIT,
  ALLOWED_SENDERS,
  type SubmissionInput,
  type VerifiedParentClaims,
} from "../src/worker/validation";

// A content-type the allow-list accepts (multipart form). Boundary varies but
// is irrelevant to the media-type check.
const supportedContentType = "multipart/form-data; boundary=----abc123";

/** Build a fully-valid submission input, then override specific fields. */
function validInput(overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    sender: "Kian",
    note: "hello dad",
    hasImage: true,
    totalBytes: 1024,
    contentType: supportedContentType,
    ...overrides,
  };
}

describe("validateSubmission — note length (Property 5)", () => {
  // Feature: family-corner, Property 5: Note length is capped at 500 characters
  it("accepts a note iff its trimmed length is <= 500, else note_too_long", () => {
    fc.assert(
      fc.property(
        // A note of an arbitrary length that straddles the 500 boundary,
        // plus optional surrounding whitespace so trimming is exercised.
        fc.integer({ min: 0, max: 900 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (bodyLen, leadWs, trailWs) => {
          const note =
            " ".repeat(leadWs) + "x".repeat(bodyLen) + " ".repeat(trailWs);
          // hasImage=true guarantees the empty-check can never fire, isolating
          // the note-length rule.
          const result = validateSubmission(validInput({ note, hasImage: true }));

          if (bodyLen <= MAX_NOTE_LENGTH) {
            expect(result.ok).toBe(true);
          } else {
            expect(result).toEqual({ ok: false, reason: "note_too_long" });
          }
        },
      ),
    );
  });
});

describe("validateSubmission — empty submissions (Property 6)", () => {
  // Feature: family-corner, Property 6: Empty submissions are rejected
  it("rejects with reason empty iff no image and the trimmed note is blank", () => {
    const blankNoteArb = fc.stringMatching(/^[ \t\n\r]*$/); // whitespace-only (incl. empty)
    const nonBlankNoteArb = fc
      .string({ minLength: 1, maxLength: 100 })
      .filter((s) => s.trim().length > 0 && s.trim().length <= MAX_NOTE_LENGTH);

    fc.assert(
      fc.property(
        fc.boolean(),
        fc.oneof(blankNoteArb, nonBlankNoteArb),
        (hasImage, note) => {
          const result = validateSubmission(validInput({ hasImage, note }));
          const noteBlank = note.trim().length === 0;

          if (!hasImage && noteBlank) {
            expect(result).toEqual({ ok: false, reason: "empty" });
          } else {
            // The empty-check passes; with all other fields valid the whole
            // submission is accepted.
            expect(result.ok).toBe(true);
          }
        },
      ),
    );
  });
});

describe("validateSubmission — sender allow-list (Property 7)", () => {
  // Feature: family-corner, Property 7: Sender must be an allowed name
  it("accepts the sender iff it is exactly Kian or Eloise, else invalid_sender", () => {
    const senderArb = fc.oneof(
      fc.constantFrom<string | null>(...ALLOWED_SENDERS),
      fc.constant(null),
      // Arbitrary strings, including near-misses like casing/whitespace.
      fc.string(),
      fc.constantFrom("kian", "ELOISE", " Kian", "Eloise ", "Dad", ""),
    );

    fc.assert(
      fc.property(senderArb, (sender) => {
        // Keep every other field valid and non-empty so only the sender rule
        // can decide the outcome.
        const result = validateSubmission(validInput({ sender, hasImage: true }));
        const isAllowed =
          sender !== null && (ALLOWED_SENDERS as readonly string[]).includes(sender);

        if (isAllowed) {
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.sender).toBe(sender);
          }
        } else {
          expect(result).toEqual({ ok: false, reason: "invalid_sender" });
        }
      }),
    );
  });
});

describe("validateSubmission — size limit (Property 8)", () => {
  // Feature: family-corner, Property 8: Submission size limit
  it("rejects with too_large iff total size exceeds 5 MB", () => {
    fc.assert(
      fc.property(
        // Range straddles the 5 MB boundary from just under to well over.
        fc.integer({ min: 0, max: MAX_TOTAL_BYTES * 2 }),
        (totalBytes) => {
          const result = validateSubmission(validInput({ totalBytes }));

          if (totalBytes > MAX_TOTAL_BYTES) {
            expect(result).toEqual({ ok: false, reason: "too_large" });
          } else {
            expect(result.ok).toBe(true);
          }
        },
      ),
    );
  });

  it("accepts exactly at the boundary and rejects one byte over", () => {
    expect(validateSubmission(validInput({ totalBytes: MAX_TOTAL_BYTES })).ok).toBe(
      true,
    );
    expect(
      validateSubmission(validInput({ totalBytes: MAX_TOTAL_BYTES + 1 })),
    ).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("decideRateLimit — rate-limit decision (Property 9)", () => {
  // Feature: family-corner, Property 9: Rate-limit decision
  it("denies iff accepting would exceed the limit, and denials carry rate_limited", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (count, limit) => {
          const decision = decideRateLimit(count, limit);
          const wouldExceed = count + 1 > limit;

          if (wouldExceed) {
            expect(decision).toEqual({ allow: false, reason: "rate_limited" });
          } else {
            expect(decision).toEqual({ allow: true });
          }
        },
      ),
    );
  });

  it("allows the 20th and denies the 21st against the default limit", () => {
    // count = number already accepted in the window.
    expect(decideRateLimit(RATE_LIMIT - 1, RATE_LIMIT)).toEqual({ allow: true });
    expect(decideRateLimit(RATE_LIMIT, RATE_LIMIT)).toEqual({
      allow: false,
      reason: "rate_limited",
    });
  });
});

describe("validateSubmission — content-type allow-list (Property 10)", () => {
  // Feature: family-corner, Property 10: Content-type allow-list
  it("accepts only multipart/form-data envelopes, else unsupported_type", () => {
    const supportedArb = fc
      .string()
      .map((boundary) => `multipart/form-data; boundary=${boundary}`);
    const unsupportedArb = fc
      .string()
      .filter((s) => !s.trim().toLowerCase().startsWith("multipart/form-data"));
    const knownUnsupported = fc.constantFrom(
      "application/json",
      "text/plain",
      "image/png",
      "application/x-www-form-urlencoded",
      "",
    );

    fc.assert(
      fc.property(
        fc.oneof(supportedArb, unsupportedArb, knownUnsupported),
        (contentType) => {
          const result = validateSubmission(validInput({ contentType }));
          const isSupported = contentType
            .trim()
            .toLowerCase()
            .startsWith("multipart/form-data");

          if (isSupported) {
            expect(result.ok).toBe(true);
          } else {
            expect(result).toEqual({ ok: false, reason: "unsupported_type" });
          }
        },
      ),
    );
  });
});

describe("validateSubmission — every rejection identifies its reason (Property 11)", () => {
  // Feature: family-corner, Property 11: Every rejection identifies its reason
  it("returns a rejection whose reason names an actually-violated rule", () => {
    // Fully arbitrary inputs so many break several rules at once.
    const inputArb: fc.Arbitrary<SubmissionInput> = fc.record({
      sender: fc.oneof(fc.constant(null), fc.string(), fc.constantFrom(...ALLOWED_SENDERS)),
      note: fc.string({ maxLength: 700 }),
      hasImage: fc.boolean(),
      totalBytes: fc.integer({ min: 0, max: MAX_TOTAL_BYTES * 2 }),
      contentType: fc.oneof(
        fc.constant(supportedContentType),
        fc.string(),
        fc.constantFrom("application/json", "image/png", ""),
      ),
    });

    fc.assert(
      fc.property(inputArb, (input) => {
        const result = validateSubmission(input);
        if (result.ok) {
          return; // acceptance is covered by the other properties
        }

        // Independently confirm the named reason reflects a real violation.
        const supported = input.contentType
          .trim()
          .toLowerCase()
          .startsWith("multipart/form-data");
        const trimmed = input.note.trim();
        const allowedSender =
          input.sender !== null &&
          (ALLOWED_SENDERS as readonly string[]).includes(input.sender);

        switch (result.reason) {
          case "unsupported_type":
            expect(supported).toBe(false);
            break;
          case "too_large":
            expect(input.totalBytes > MAX_TOTAL_BYTES).toBe(true);
            break;
          case "invalid_sender":
            expect(allowedSender).toBe(false);
            break;
          case "note_too_long":
            expect(trimmed.length > MAX_NOTE_LENGTH).toBe(true);
            break;
          case "empty":
            expect(!input.hasImage && trimmed.length === 0).toBe(true);
            break;
          default:
            // rate_limited is not produced by validateSubmission.
            throw new Error(`unexpected reason: ${result.reason as string}`);
        }
      }),
    );
  });
});

describe("decideParentAccess — access requires a verified parent identity (Property 12)", () => {
  // Feature: family-corner, Property 12: Access-control decision requires a verified parent identity
  it("allows iff verified claims are present and their audience matches", () => {
    const audienceArb = fc.string({ minLength: 1, maxLength: 20 });
    // Claims may be absent (null/undefined) or a verified object whose `aud` is
    // a single string or a list, matching or not matching the expected value.
    const claimsArb: fc.Arbitrary<VerifiedParentClaims | null | undefined> =
      fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.record({ aud: fc.string() }),
        fc.record({ aud: fc.array(fc.string(), { maxLength: 4 }) }),
      );

    fc.assert(
      fc.property(claimsArb, audienceArb, (claims, expectedAudience) => {
        const decision = decideParentAccess(claims, expectedAudience);

        if (claims === null || claims === undefined) {
          // Absent identity is always denied with 401.
          expect(decision).toEqual({ ok: false, status: 401 });
          return;
        }

        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        const matches =
          expectedAudience.length > 0 && audiences.includes(expectedAudience);

        if (matches) {
          expect(decision).toEqual({ ok: true });
        } else {
          // Present but mismatched identity is denied with 403.
          expect(decision).toEqual({ ok: false, status: 403 });
        }
      }),
    );
  });

  it("allows a matching audience and denies absent/mismatched identities", () => {
    expect(decideParentAccess({ aud: "app-123" }, "app-123")).toEqual({ ok: true });
    expect(
      decideParentAccess({ aud: ["other", "app-123"] }, "app-123"),
    ).toEqual({ ok: true });
    expect(decideParentAccess({ aud: "other" }, "app-123")).toEqual({
      ok: false,
      status: 403,
    });
    expect(decideParentAccess(null, "app-123")).toEqual({ ok: false, status: 401 });
  });
});
