/// <reference types="@cloudflare/workers-types" />
// src/worker/index.ts
// Cloudflare Worker entry for the arcade hub (module syntax).
//
// This Worker serves two purposes:
//   1. A tiny same-origin JSON API for the global Like/Love voting system:
//        GET  /api/votes  -> aggregate counts for all four games
//        POST /api/vote   -> apply a +1/-1 delta to one game's like|love count
//      Counts are anonymous aggregate integers stored in a KV namespace
//      (`VOTES`). No personal data is collected.
//   2. A pass-through to the static assets binding (`ASSETS`) for every other
//      route, so the Vite-built SPA in ./dist (plus its single-page-application
//      fallback) is served exactly as before.
//
// The API is same-origin (the assets and the Worker share one origin), so no
// CORS handling is required.
//
// NOTE ON CONSISTENCY: Cloudflare KV is eventually consistent and offers no
// atomic increment primitive. The POST handler therefore does read-modify-write
// (read current count, apply delta, put back). Concurrent votes can race and
// lose an increment. This is acceptable for a low-traffic "likes" counter; if
// exact counts under high concurrency were required, a Durable Object would be
// the correct primitive instead.
//
// FAMILY CORNER ROUTES: the Worker also serves the Family Corner API under
// `/api/family/*` (see ./family/*). One public create route
// (POST /api/family/submit) plus three parent-only routes under
// /api/family/submissions are dispatched here before the ASSETS fallback. The
// public submit route lives on its own path so Cloudflare Access can protect
// the parent-only /api/family/submissions routes by path without blocking the
// public submit. The
// `/inbox` HTML page falls through to ASSETS but is tagged `X-Robots-Tag:
// noindex` so the private Parent Inbox is never indexed by search engines
// (Requirement 8.4).

import { handleCreateSubmission } from "./family/createSubmission";
import { handleDeleteSubmission } from "./family/deleteSubmission";
import { handleGetImage } from "./family/getImage";
import { handleListSubmissions } from "./family/listSubmissions";

/** Runtime bindings provided by Cloudflare (see wrangler.jsonc). */
export interface Env {
  /** Static-assets binding serving the Vite `dist/` bundle (+ SPA fallback). */
  ASSETS: Fetcher;
  /** KV namespace holding the anonymous aggregate vote counts. */
  VOTES: KVNamespace;
  /** KV namespace holding Family Corner per-client rate-limit counters (TTL windows). */
  FAMILY_RATE: KVNamespace;
  /** R2 bucket holding Family Corner drawing PNG blobs. */
  FAMILY_MEDIA: R2Bucket;
  /** D1 database holding the Family Corner submissions index. */
  FAMILY_DB: D1Database;
  /** Cloudflare Access team domain, used for Access JWT verification. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application audience (aud) tag. */
  ACCESS_AUD?: string;
}

/**
 * The known votable targets: the four canvas games plus the Chess destination.
 * A vote for any other id is rejected. Chess is not a canvas game, but it has
 * its own global Like/Love counts alongside the games; its KV keys
 * (`count:chess:like` / `count:chess:love`) are created on demand and default
 * to 0, so adding it is backward compatible.
 */
const GAME_IDS = [
  "block-cascade",
  "serpent",
  "maze-muncher",
  "brick-buster",
  "chess",
] as const;
type GameId = (typeof GAME_IDS)[number];

/** The two supported reactions, each with its own global count. */
const REACTIONS = ["like", "love"] as const;
type Reaction = (typeof REACTIONS)[number];

/** Per-game vote counts returned by the API. */
interface VoteCounts {
  like: number;
  love: number;
}

function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && (GAME_IDS as readonly string[]).includes(value);
}

function isReaction(value: unknown): value is Reaction {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value);
}

/** delta must be exactly +1 or -1 (toggle on / off). */
function isDelta(value: unknown): value is 1 | -1 {
  return value === 1 || value === -1;
}

/** The KV key holding one game's count for one reaction. */
function countKey(gameId: GameId, reaction: Reaction): string {
  return `count:${gameId}:${reaction}`;
}

/** Read a single count from KV, defaulting to 0 for missing/corrupt values. */
async function readCount(
  env: Env,
  gameId: GameId,
  reaction: Reaction,
): Promise<number> {
  const raw = await env.VOTES.get(countKey(gameId, reaction));
  if (raw === null) {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Read both reaction counts for one game. */
async function readGameCounts(env: Env, gameId: GameId): Promise<VoteCounts> {
  const [like, love] = await Promise.all([
    readCount(env, gameId, "like"),
    readCount(env, gameId, "love"),
  ]);
  return { like, love };
}

/** Build a JSON response with the correct content-type and status. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** GET /api/votes -> aggregate counts for every votable target (games + chess). */
async function handleGetVotes(env: Env): Promise<Response> {
  const result: Record<GameId, VoteCounts> = {} as Record<GameId, VoteCounts>;
  for (const id of GAME_IDS) {
    result[id] = await readGameCounts(env, id);
  }
  return jsonResponse(result);
}

/** POST /api/vote -> validate, apply the delta (clamped >= 0), return counts. */
async function handlePostVote(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonResponse({ error: "Body must be a JSON object" }, 400);
  }

  const { gameId, reaction, delta } = body as {
    gameId?: unknown;
    reaction?: unknown;
    delta?: unknown;
  };

  if (!isGameId(gameId)) {
    return jsonResponse({ error: "Unknown gameId" }, 400);
  }
  if (!isReaction(reaction)) {
    return jsonResponse({ error: "reaction must be 'like' or 'love'" }, 400);
  }
  if (!isDelta(delta)) {
    return jsonResponse({ error: "delta must be 1 or -1" }, 400);
  }

  // Read-modify-write. KV is eventually consistent with no atomic increment,
  // so this can race under concurrency (acceptable for low-traffic likes).
  const current = await readCount(env, gameId, reaction);
  const updated = Math.max(0, current + delta); // clamp so counts never go negative
  await env.VOTES.put(countKey(gameId, reaction), String(updated));

  return jsonResponse(await readGameCounts(env, gameId));
}

/** A minimal JSON error response for unmatched Family Corner routes. */
function familyError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Dispatch a request whose path starts with `/api/family/`.
 *
 * Recognized routes:
 *   - POST   /api/family/submit                 -> handleCreateSubmission (public)
 *   - GET    /api/family/submissions            -> handleListSubmissions  (parent-only)
 *   - GET    /api/family/submissions/:id/image  -> handleGetImage         (parent-only)
 *   - DELETE /api/family/submissions/:id        -> handleDeleteSubmission (parent-only)
 *
 * The public create route lives on its own `/api/family/submit` path (separate
 * from the parent-only `/api/family/submissions` routes) so Cloudflare Access
 * can protect the parent routes by path without blocking the public submit.
 *
 * The `:id` segment is parsed positionally from the path segments. Any
 * `/api/family/*` request that does not match a known route returns a 404
 * (unknown path) or 405 (known path, wrong method) rather than falling through
 * to the static ASSETS binding.
 */
async function handleFamilyRoute(request: Request, env: Env, url: URL): Promise<Response> {
  // Split the pathname into non-empty segments, e.g.
  //   "/api/family/submissions/abc/image" -> ["api","family","submissions","abc","image"]
  const segments = url.pathname.split("/").filter((s) => s.length > 0);

  // Public create route: POST /api/family/submit (segments ["api","family","submit"]).
  // Kept on its own path, separate from the parent-only /api/family/submissions
  // routes, so Cloudflare Access can gate the parent routes by path.
  if (segments.length === 3 && segments[2] === "submit") {
    if (request.method === "POST") {
      return handleCreateSubmission(request, env);
    }
    return familyError("Method not allowed", 405);
  }

  // All remaining family routes live under /api/family/submissions...
  // segments: ["api", "family", "submissions", ...rest]
  if (segments.length < 3 || segments[2] !== "submissions") {
    return familyError("Not found", 404);
  }

  const rest = segments.slice(3); // segments after "submissions"

  // /api/family/submissions (parent-only list; POST is no longer a create path)
  if (rest.length === 0) {
    if (request.method === "GET") {
      return handleListSubmissions(request, env);
    }
    return familyError("Method not allowed", 405);
  }

  // The remaining routes carry an id in rest[0]. An empty id segment (e.g. a
  // trailing slash producing "") is not a valid submission id -> 404.
  const idSegment = rest[0];
  if (idSegment === undefined || idSegment.length === 0) {
    return familyError("Not found", 404);
  }
  const id = decodeURIComponent(idSegment);

  // /api/family/submissions/:id
  if (rest.length === 1) {
    if (request.method === "DELETE") {
      return handleDeleteSubmission(request, env, id);
    }
    return familyError("Method not allowed", 405);
  }

  // /api/family/submissions/:id/image
  if (rest.length === 2 && rest[1] === "image") {
    if (request.method === "GET") {
      return handleGetImage(request, env, id);
    }
    return familyError("Method not allowed", 405);
  }

  // Anything else under /api/family/* is an unknown path.
  return familyError("Not found", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/votes" && request.method === "GET") {
      return handleGetVotes(env);
    }

    if (url.pathname === "/api/vote" && request.method === "POST") {
      return handlePostVote(request, env);
    }

    // Family Corner API: dispatch every /api/family/* request here (never fall
    // through to ASSETS for these), returning 404/405 for unmatched combos.
    if (url.pathname === "/api/family" || url.pathname.startsWith("/api/family/")) {
      return handleFamilyRoute(request, env, url);
    }

    // The private Parent Inbox HTML page is served by ASSETS like any other SPA
    // route, but must not be indexed by search engines (Requirement 8.4). Fetch
    // it from ASSETS and return a copy with the X-Robots-Tag header added.
    if (url.pathname === "/inbox") {
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      headers.set("X-Robots-Tag", "noindex");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }

    // Everything else: serve the static site (and SPA fallback) from ASSETS.
    return env.ASSETS.fetch(request);
  },
};
