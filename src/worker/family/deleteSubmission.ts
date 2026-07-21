/// <reference types="@cloudflare/workers-types" />
// src/worker/family/deleteSubmission.ts
// Parent-only route handler for DELETE /api/family/submissions/:id.
//
// Removes one submission from storage entirely: the R2 drawing object (when the
// submission has one) and the D1 index row (Requirement 7.4). Access is gated
// both at the Cloudflare Access edge and again here via `verifyParentIdentity`
// (defense in depth) so the stored family content can never be deleted without
// a verified parent identity (Requirements 8.1, 8.2).
//
// Contract:
//   - No verified identity  -> respond with the status from verifyParentIdentity
//     (401 when the Access assertion is absent, 403 when it is invalid).
//   - Allowed               -> deleteSubmission(env, id) then 204 No Content.
//     `deleteSubmission` is idempotent for a missing id, so deleting an unknown
//     id also returns 204.
//   - Any storage error     -> 500 (this handler never throws to its caller).

import { verifyParentIdentity } from "./identity";
import { deleteSubmission } from "./storage";
import type { Env } from "../index";

/**
 * Handle DELETE /api/family/submissions/:id (parent-only).
 *
 * @param request the incoming request (carries the Access assertion header)
 * @param env     the Worker bindings (R2 + D1)
 * @param id      the submission id parsed from the route path
 * @returns 204 on success, 401/403 when identity is not verified, 500 on error
 */
export async function handleDeleteSubmission(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  // Defense in depth: verify the parent identity before touching storage.
  const decision = await verifyParentIdentity(request, env);
  if (!decision.ok) {
    return new Response(null, { status: decision.status });
  }

  try {
    // Deletes the R2 object (if any) and the D1 row; idempotent for a missing id.
    await deleteSubmission(env, id);
    return new Response(null, { status: 204 });
  } catch {
    // Never throw to the caller: a storage failure is reported as a 500.
    return new Response(null, { status: 500 });
  }
}
