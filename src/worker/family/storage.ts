// src/worker/family/storage.ts
// Family Corner storage layer over Cloudflare R2 (drawing PNG blobs) and D1
// (the submissions index). This module is the single place that knows the R2
// key scheme and the D1 `submissions` table shape; the route handlers call
// these functions instead of touching the bindings directly.
//
// Runs on the Cloudflare Workers runtime and is type-checked by
// tsconfig.worker.json against @cloudflare/workers-types (R2Bucket, R2Object,
// D1Database, etc.). No TTL is applied to any persisted write: submissions are
// retained until the parent explicitly deletes them (Requirement 6.3).

import type { Env } from "../index";
import type { SenderName } from "../validation";

/**
 * A submission summary as returned to the Parent Inbox (Requirement 7.2). D1
 * stores the boolean flags as 0/1 integers; `listSubmissions` maps them back to
 * real booleans so callers get a clean typed shape. Does not include `r2_key`
 * (the image is fetched through a separate parent-only route).
 */
export interface SubmissionSummary {
  id: string;
  sender: SenderName;
  created_at: number;
  has_note: boolean;
  note_text: string | null;
  has_image: boolean;
}

/**
 * The full row inserted into the D1 `submissions` table. `r2_key` is the R2
 * object key when `has_image` is true, otherwise `null`; `note_text` is the
 * trimmed note when `has_note` is true, otherwise `null`.
 */
export interface SubmissionRow {
  id: string;
  sender: SenderName;
  created_at: number;
  has_note: boolean;
  note_text: string | null;
  has_image: boolean;
  r2_key: string | null;
}

/** The raw column shape D1 returns (booleans stored as 0/1 integers). */
interface SubmissionDbRow {
  id: string;
  sender: string;
  created_at: number;
  has_note: number;
  note_text: string | null;
  has_image: number;
  r2_key: string | null;
}

/** Zero-pad a 1- or 2-digit number to a 2-character string ("3" -> "03"). */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Build the R2 object key for a submission's drawing, partitioned by UTC year
 * and month for cheap human browsing in the R2 console:
 *
 *   submissions/{yyyy}/{mm}/{id}.png
 *
 * The authoritative reference is always the `r2_key` column in D1; this scheme
 * is only a convenience layout.
 */
export function buildImageKey(id: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = pad2(now.getUTCMonth() + 1);
  return `submissions/${yyyy}/${mm}/${id}.png`;
}

/**
 * Write a drawing PNG to R2 under `submissions/{yyyy}/{mm}/{id}.png` with the
 * `image/png` content type, and return the key used so the caller can persist
 * it in D1 (Requirement 6.1). No TTL / expiry is set — the object is retained
 * until explicitly deleted.
 */
export async function putImage(
  env: Env,
  id: string,
  pngBytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const r2Key = buildImageKey(id);
  await env.FAMILY_MEDIA.put(r2Key, pngBytes, {
    httpMetadata: { contentType: "image/png" },
  });
  return r2Key;
}

/**
 * Insert one submission index row into D1 using a prepared statement with bound
 * parameters (Requirement 6.2). Booleans are stored as 0/1 integers to match
 * the table schema. No TTL — the row is retained until deleted.
 */
export async function insertSubmission(env: Env, row: SubmissionRow): Promise<void> {
  await env.FAMILY_DB.prepare(
    `INSERT INTO submissions
       (id, sender, created_at, has_note, note_text, has_image, r2_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.sender,
      row.created_at,
      row.has_note ? 1 : 0,
      row.note_text,
      row.has_image ? 1 : 0,
      row.r2_key,
    )
    .run();
}

/**
 * List all submissions newest-first (Requirement 7.1). Maps the D1 0/1 integer
 * flags to booleans so the result matches the `SubmissionSummary` shape used by
 * the Parent Inbox. `r2_key` is intentionally not returned.
 */
export async function listSubmissions(env: Env): Promise<SubmissionSummary[]> {
  const { results } = await env.FAMILY_DB.prepare(
    `SELECT id, sender, created_at, has_note, note_text, has_image
       FROM submissions
       ORDER BY created_at DESC`,
  ).all<SubmissionDbRow>();

  return (results ?? []).map((r) => ({
    id: r.id,
    sender: r.sender as SenderName,
    created_at: r.created_at,
    has_note: r.has_note === 1,
    note_text: r.note_text,
    has_image: r.has_image === 1,
  }));
}

/**
 * Look up the R2 key for a submission id, or `null` when the id is unknown or
 * the submission has no stored image. Used by the parent-only image route and
 * by `deleteSubmission`.
 */
export async function getImageKey(env: Env, id: string): Promise<string | null> {
  const row = await env.FAMILY_DB.prepare(
    `SELECT r2_key FROM submissions WHERE id = ?`,
  )
    .bind(id)
    .first<{ r2_key: string | null }>();

  return row?.r2_key ?? null;
}

/**
 * Fetch the R2 object for a stored image key so the caller can stream it, or
 * `null` when the object is missing (e.g. already deleted).
 */
export async function getImageObject(
  env: Env,
  r2Key: string,
): Promise<R2ObjectBody | null> {
  return env.FAMILY_MEDIA.get(r2Key);
}

/**
 * Best-effort delete of a single R2 object. Exposed so the create path can
 * clean up an orphaned blob when the D1 insert fails after a successful R2 put
 * (leaving no dangling image). R2 `delete` is idempotent for a missing key.
 */
export async function deleteImage(env: Env, r2Key: string): Promise<void> {
  await env.FAMILY_MEDIA.delete(r2Key);
}

/**
 * Delete a submission by id (Requirement 7.4): look up its `r2_key`, delete the
 * R2 object when present, then delete the D1 row. Deleting the blob first means
 * a failure never leaves a listed row pointing at an already-removed object.
 */
export async function deleteSubmission(env: Env, id: string): Promise<void> {
  const r2Key = await getImageKey(env, id);
  if (r2Key !== null) {
    await deleteImage(env, r2Key);
  }
  await env.FAMILY_DB.prepare(`DELETE FROM submissions WHERE id = ?`).bind(id).run();
}
