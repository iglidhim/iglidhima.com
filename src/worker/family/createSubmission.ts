/// <reference types="@cloudflare/workers-types" />
// src/worker/family/createSubmission.ts
// Public POST /api/family/submit handler — the create-and-send endpoint
// the children use (no Cloudflare Access, no login). It is the authoritative
// enforcement point for abuse limiting, size, content-type, and field
// validation, and it is the only place that orchestrates the R2 (image) + D1
// (index row) writes for a new submission.
//
// Runs on the Cloudflare Workers runtime and is type-checked by
// tsconfig.worker.json against @cloudflare/workers-types (Request, Response,
// File, crypto.randomUUID, TextEncoder are all runtime globals). It reuses the
// shared pure rules in ../validation.ts so the client pre-check and this server
// check never drift.
//
// PIPELINE (in order, so a rejection always names the most fundamental problem):
//   1. Rate limit (KV counter) ............ 429 rate_limited
//   2. Content-type is multipart/form-data . 415 unsupported_type
//   3. Content-Length cap (when present) ... 413 too_large  (cheap pre-parse guard)
//   4. Parse the multipart body ............ sender / note / image (PNG only)
//   5. Shared validateSubmission ........... 400/413/415 with the matching reason
//   6. Persist: R2 put (if image) then D1 .. 500 storage_error on failure
//   7. Success ............................. 201 { ok, id, created_at }
//
// STORAGE ORDERING / ORPHAN CLEANUP (Requirement 6.5): the image blob is written
// to R2 first, then the index row to D1. If the D1 insert fails after a
// successful R2 put we best-effort delete the just-written blob so a failed
// submission never leaves a dangling object. Any storage failure returns an
// error and NEVER reports the submission as sent.

import type { Env } from "../index";
import {
  MAX_TOTAL_BYTES,
  validateSubmission,
  type Reason,
  type SubmissionInput,
} from "../validation";
import {
  checkAndIncrement,
  clientKeyFromRequest,
} from "./rateLimiter";
import { deleteImage, insertSubmission, putImage } from "./storage";

/**
 * Every reason this endpoint can reject with. Extends the shared validation
 * `Reason` with `storage_error`, which only arises server-side when an R2 or D1
 * write fails (it has no client pre-check equivalent).
 */
type SubmitErrorReason = Reason | "storage_error";

/** Successful create confirmation body (Requirement 6.4). */
interface SubmitResult {
  ok: true;
  id: string;
  created_at: number;
}

/** Structured error body; `reason` names the single rule that was violated. */
interface SubmitError {
  ok: false;
  reason: SubmitErrorReason;
}

/** Build a JSON response with the correct content-type and status. */
function jsonResponse(body: SubmitResult | SubmitError, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Map a rejection reason to its HTTP status (Requirements 9.1–9.4, 6.5). */
function statusForReason(reason: SubmitErrorReason): number {
  switch (reason) {
    case "too_large":
      return 413;
    case "rate_limited":
      return 429;
    case "unsupported_type":
      return 415;
    case "storage_error":
      return 500;
    case "empty":
    case "invalid_sender":
    case "note_too_long":
      return 400;
  }
}

/** Shorthand: build the { ok: false, reason } response with the mapped status. */
function reject(reason: SubmitErrorReason): Response {
  return jsonResponse({ ok: false, reason }, statusForReason(reason));
}

/**
 * Handle POST /api/family/submit.
 *
 * Public (no Access). Never throws — every failure path returns a structured
 * JSON `SubmitError` with the appropriate status. On success returns `201` with
 * the new submission id and its `created_at` timestamp.
 */
export async function handleCreateSubmission(
  request: Request,
  env: Env,
): Promise<Response> {
  // 1. Rate limit (per-client KV counter, 20 / 60s). Denied -> 429.
  const clientKey = clientKeyFromRequest(request);
  const decision = await checkAndIncrement(env, clientKey, Date.now());
  if (!decision.allow) {
    return reject("rate_limited");
  }

  // 2. Content-type must be a multipart form. Reject anything else up front.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.trim().toLowerCase().startsWith("multipart/form-data")) {
    return reject("unsupported_type");
  }

  // 3. Cheap pre-parse size guard: if the client declares a Content-Length that
  //    already exceeds the cap, reject before buffering the body.
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > MAX_TOTAL_BYTES) {
      return reject("too_large");
    }
  }

  // 4. Parse the multipart body. A body that cannot be read as a multipart form
  //    (despite the header) is unusable -> unsupported_type.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reject("unsupported_type");
  }

  const senderField = form.get("sender");
  const sender = typeof senderField === "string" ? senderField : null;

  const noteField = form.get("note");
  const note = typeof noteField === "string" ? noteField : "";

  // The Workers `FormData.get()` is typed as `string | null`, but a file part
  // arrives at runtime as a `File` (a Blob subclass). Widen the field type so we
  // can distinguish a text field (string) from an uploaded image (object) and
  // narrow via `typeof` rather than `instanceof File`.
  const imageField = form.get("image") as string | File | null;
  const image: File | null =
    imageField !== null && typeof imageField !== "string" ? imageField : null;

  // A drawing, when present, must be a PNG (the only image type we accept).
  if (image !== null && image.type !== "image/png") {
    return reject("unsupported_type");
  }

  // 5. Compute the real total size (note bytes + image bytes) and run the shared
  //    validation rules. This re-checks the size cap post-parse (the declared
  //    Content-Length is advisory) and enforces sender / note / empty rules.
  const noteBytes = new TextEncoder().encode(note).length;
  const imageBytes = image !== null ? image.size : 0;
  const totalBytes = noteBytes + imageBytes;

  const input: SubmissionInput = {
    sender,
    note,
    hasImage: image !== null,
    totalBytes,
    contentType,
  };

  const result = validateSubmission(input);
  if (!result.ok) {
    return reject(result.reason);
  }

  // 6. Persist. Write the R2 blob first (if any), then the D1 index row. On any
  //    storage failure return 500 and do NOT report success; if the D1 insert
  //    fails after a successful R2 put, best-effort delete the orphaned blob.
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const hasImage = image !== null;
  let r2Key: string | null = null;

  try {
    if (image !== null) {
      const bytes = await image.arrayBuffer();
      r2Key = await putImage(env, id, bytes);
    }

    try {
      await insertSubmission(env, {
        id,
        sender: result.sender,
        created_at: createdAt,
        has_note: result.note !== null,
        note_text: result.note,
        has_image: hasImage,
        r2_key: r2Key,
      });
    } catch (insertError) {
      // D1 insert failed after the R2 put succeeded: clean up the orphan blob
      // so a failed submission leaves no dangling object, then surface the error.
      if (r2Key !== null) {
        try {
          await deleteImage(env, r2Key);
        } catch {
          // Best-effort: nothing more we can do if cleanup also fails.
        }
      }
      throw insertError;
    }
  } catch {
    return reject("storage_error");
  }

  // 7. Success.
  return jsonResponse({ ok: true, id, created_at: createdAt }, 201);
}
