// src/worker/validation.ts
// Pure, dependency-free submission validation and decision logic shared by the
// Family Corner client pre-check and the Cloudflare Worker server enforcement.
//
// This module intentionally uses NO DOM globals and NO Cloudflare Workers
// globals so it compiles under BOTH tsconfig programs:
//   - tsconfig.json         (client / DOM libs)
//   - tsconfig.worker.json  (Worker / @cloudflare/workers-types)
// The client imports it for an optimistic pre-check before posting; the Worker
// imports it as the authoritative security boundary. Keeping the rules in one
// place guarantees the two never drift.
//
// Everything here is a pure function: same input -> same output, no I/O, no
// side effects. That makes each rule directly property-testable.

/** Maximum accepted note length, measured on the trimmed string (Req 3.3). */
export const MAX_NOTE_LENGTH = 500;

/** Maximum accepted total submission size in bytes: 5 MB (Req 9.1). */
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

/** Abuse policy: at most 20 submissions per client per 60s window (Req 9.2). */
export const RATE_LIMIT = 20;

/** The only accepted sender identities (Reqs 4.1, 4.5, 8.6). */
export const ALLOWED_SENDERS = ["Kian", "Eloise"] as const;

/** A validated sender name — exactly one of the predefined options. */
export type SenderName = (typeof ALLOWED_SENDERS)[number];

/**
 * The reason a submission (or a request) was rejected. Each value names the
 * single rule that was violated so the client can show a specific message and
 * the Worker can pick the matching HTTP status (Req 9.4).
 */
export type Reason =
  | "empty"
  | "invalid_sender"
  | "note_too_long"
  | "too_large"
  | "rate_limited"
  | "unsupported_type";

/**
 * The pure inputs needed to decide whether a submission is acceptable. This is
 * deliberately a flat value object (no File/Blob/FormData) so both environments
 * can build it: the client from its in-memory draft, the Worker from the parsed
 * multipart body.
 */
export interface SubmissionInput {
  /** Chosen sender; `null` when the child has not picked one yet. */
  sender: string | null;
  /** Raw typed note (untrimmed); empty string when there is no note. */
  note: string;
  /** Whether a drawing image is part of the submission. */
  hasImage: boolean;
  /** Total submission size in bytes (image + note + envelope). */
  totalBytes: number;
  /** The request content-type (e.g. `multipart/form-data; boundary=...`). */
  contentType: string;
}

/**
 * The result of validating a submission: either an accepted, normalized value
 * (sender narrowed to a `SenderName`, note trimmed or `null` when blank) or a
 * rejection carrying the single violated rule.
 */
export type ValidationResult =
  | { ok: true; sender: SenderName; note: string | null }
  | { ok: false; reason: Reason };

/** Narrowing guard: is `value` exactly one of the allowed sender names? */
function isAllowedSender(value: string | null): value is SenderName {
  return value !== null && (ALLOWED_SENDERS as readonly string[]).includes(value);
}

/**
 * The only supported request envelope is a multipart form carrying an optional
 * PNG image and/or an optional text note. We accept exactly the
 * `multipart/form-data` media type (any boundary/charset parameters); every
 * other content-type is rejected as unsupported (Req 9.3).
 */
function isSupportedContentType(contentType: string): boolean {
  return contentType.trim().toLowerCase().startsWith("multipart/form-data");
}

/**
 * Validate a submission against every rule and return the first violation (or
 * acceptance).
 *
 * Documented precedence — checks run outermost-envelope first so a rejection
 * always names the most fundamental problem, and so the reason is deterministic
 * when an input breaks several rules at once:
 *
 *   1. `unsupported_type` — if we cannot trust the envelope format, nothing
 *      else about the payload is meaningful, so this is checked first.
 *   2. `too_large`        — reject oversized payloads before inspecting fields.
 *   3. `invalid_sender`   — the sender must be exactly `Kian` or `Eloise`.
 *   4. `note_too_long`    — the trimmed note must be at most 500 characters.
 *   5. `empty`            — reject only when there is no image AND the trimmed
 *      note is blank (Req 3.5).
 *
 * On success the sender is narrowed to `SenderName` and the note is trimmed,
 * becoming `null` when it is blank/whitespace-only.
 */
export function validateSubmission(input: SubmissionInput): ValidationResult {
  if (!isSupportedContentType(input.contentType)) {
    return { ok: false, reason: "unsupported_type" };
  }

  if (input.totalBytes > MAX_TOTAL_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  if (!isAllowedSender(input.sender)) {
    return { ok: false, reason: "invalid_sender" };
  }

  const trimmedNote = input.note.trim();
  if (trimmedNote.length > MAX_NOTE_LENGTH) {
    return { ok: false, reason: "note_too_long" };
  }

  const noteIsBlank = trimmedNote.length === 0;
  if (!input.hasImage && noteIsBlank) {
    return { ok: false, reason: "empty" };
  }

  return {
    ok: true,
    sender: input.sender,
    note: noteIsBlank ? null : trimmedNote,
  };
}

/** The outcome of a rate-limit decision; a denial names the `rate_limited` reason. */
export type RateLimitDecision =
  | { allow: true }
  | { allow: false; reason: "rate_limited" };

/**
 * Decide whether one more submission may be accepted given how many have
 * already been accepted in the current window.
 *
 * `count` is the number already accepted within the 60-second window;
 * accepting this request would make the total `count + 1`. The request is
 * denied if and only if accepting it would exceed `limit` (Req 9.2). With the
 * default `limit` of 20 that means the 21st submission in a window is the first
 * one denied.
 */
export function decideRateLimit(count: number, limit: number): RateLimitDecision {
  if (count + 1 > limit) {
    return { allow: false, reason: "rate_limited" };
  }
  return { allow: true };
}

/**
 * The already-signature-verified claims extracted from a Cloudflare Access
 * assertion. Signature/JWT verification is performed OUTSIDE this module (it
 * needs crypto + the team public keys and is not pure); this shape represents
 * the trusted claims once that check has passed.
 */
export interface VerifiedParentClaims {
  /** The audience(s) the assertion was issued for. */
  aud: string | string[];
}

/**
 * The parent-access decision: allow, or deny with the HTTP status the Worker
 * should return — `401` when no identity was presented, `403` when an identity
 * was presented but does not match the configured audience.
 */
export type AccessDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 };

/**
 * Pure parent-only access decision.
 *
 * Given the already-verified claims (or their absence) and the audience the
 * Access application is configured for, decide whether the request may reach a
 * parent-only resource. The request is allowed if and only if verified claims
 * are present AND their audience matches the configured audience (Reqs 8.1,
 * 8.2, 8.5). An absent identity denies with `401`; a present-but-mismatched (or
 * unconfigured-audience) identity denies with `403`.
 *
 * This function performs NO cryptography — signature verification happens
 * before it is called and produces the `claims` argument (or `null`/`undefined`
 * when verification failed or no assertion was present).
 */
export function decideParentAccess(
  claims: VerifiedParentClaims | null | undefined,
  expectedAudience: string,
): AccessDecision {
  if (claims === null || claims === undefined) {
    return { ok: false, status: 401 };
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (expectedAudience.length > 0 && audiences.includes(expectedAudience)) {
    return { ok: true };
  }

  return { ok: false, status: 403 };
}
