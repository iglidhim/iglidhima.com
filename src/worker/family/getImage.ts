// src/worker/family/getImage.ts
// Parent-only route handler that streams a stored Family Corner drawing PNG.
//
//   GET /api/family/submissions/:id/image
//
// This serves a family's private content, so it is gated two ways:
//   1. Cloudflare Access at the edge (owner deployment step), and
//   2. `verifyParentIdentity` here, as defense in depth — the handler refuses
//      to touch storage until a valid parent identity is confirmed.
//
// On an allowed request the handler looks up the submission's R2 key in D1,
// fetches the R2 object, and streams its body back with `image/png`. Every
// response carries `X-Robots-Tag: noindex` so private content is never indexed
// (Requirement 8.4) and `Cache-Control: private, no-store` so it is never
// retained in a shared/CDN cache. Missing rows or objects yield 404; the
// handler never throws (an unexpected failure becomes a 500).

import { verifyParentIdentity } from "./identity";
import { getImageKey, getImageObject } from "./storage";
import type { Env } from "../index";

/** Headers applied to every image response to keep private content private. */
function privateImageHeaders(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    // Keep the image out of search-engine indexes (Requirement 8.4).
    "x-robots-tag": "noindex",
    // Keep private content out of shared/CDN caches.
    "cache-control": "private, no-store",
  };
}

/**
 * Handle `GET /api/family/submissions/:id/image` (parent-only).
 *
 * Steps:
 *   1. `verifyParentIdentity` first; on failure return its status (401/403).
 *   2. Look up the submission's `r2_key`; a missing row -> 404.
 *   3. Fetch the R2 object; a missing object -> 404.
 *   4. Stream the object body with `image/png` (from the object's stored
 *      `httpMetadata` when available, else `image/png`) plus the privacy
 *      headers.
 *
 * Never throws: any unexpected error is converted to a 404/500 response.
 */
export async function handleGetImage(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  // 1. Parent-only: verify identity before touching storage.
  const access = await verifyParentIdentity(request, env);
  if (!access.ok) {
    return new Response(null, { status: access.status });
  }

  try {
    // 2. Resolve the R2 key for this submission id.
    const r2Key = await getImageKey(env, id);
    if (r2Key === null) {
      return new Response(null, { status: 404 });
    }

    // 3. Fetch the stored object.
    const object = await getImageObject(env, r2Key);
    if (object === null) {
      return new Response(null, { status: 404 });
    }

    // 4. Stream the body with the correct content-type and privacy headers.
    const contentType = object.httpMetadata?.contentType ?? "image/png";
    return new Response(object.body, {
      status: 200,
      headers: privateImageHeaders(contentType),
    });
  } catch {
    // Defensive: never surface an exception to the caller.
    return new Response(null, { status: 500 });
  }
}
