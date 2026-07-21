/// <reference types="@cloudflare/workers-types" />
// src/worker/family/listSubmissions.ts
// Parent-only handler for GET /api/family/submissions — the Parent Inbox
// listing (Requirements 7.1, 8.1, 8.2).
//
// This route exposes a family's private submissions, so it is gated by
// `verifyParentIdentity` (defense in depth on top of the edge Cloudflare Access
// gate). Only after identity is confirmed does it read the D1-backed index via
// `listSubmissions`, which already returns rows newest-first.
//
// FAIL-CLOSED / PRIVACY POSTURE
//   - Identity missing/invalid -> the exact status from the decision (401 when
//     no identity was presented, 403 when it was present but not authorized).
//   - Storage failures are caught defensively and surfaced as a 500 rather than
//     throwing to the router (this handler never throws).
// The successful response is tagged `X-Robots-Tag: noindex` so the private
// listing is never indexed by search engines.

import { verifyParentIdentity } from "./identity";
import { listSubmissions } from "./storage";
import type { Env } from "../index";

/**
 * Handle a parent-only request for the submission list.
 *
 * PARENT-ONLY: verifies identity first; on denial returns a JSON error with the
 * decision's status (401 or 403) and no body content that leaks state. On
 * allow, returns `200` with `{ submissions }` (already newest-first) as JSON,
 * tagged `X-Robots-Tag: noindex`.
 */
export async function handleListSubmissions(
  request: Request,
  env: Env,
): Promise<Response> {
  // 1. PARENT-ONLY gate. Deny before touching any storage.
  const access = await verifyParentIdentity(request, env);
  if (!access.ok) {
    return jsonError(access.status);
  }

  // 2. Read the index defensively — a storage failure must not throw out of the
  //    handler; surface it as a 500 instead.
  let submissions;
  try {
    submissions = await listSubmissions(env);
  } catch {
    return jsonError(500);
  }

  // 3. Success: newest-first list as JSON, not indexable.
  return new Response(JSON.stringify({ submissions }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}

/** Build a minimal JSON error response with the given status. */
function jsonError(status: number): Response {
  return new Response(JSON.stringify({ error: statusMessage(status) }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Map a status code to a short, non-leaky message. */
function statusMessage(status: number): string {
  switch (status) {
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    default:
      return "Internal Server Error";
  }
}
