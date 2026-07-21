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

/** Runtime bindings provided by Cloudflare (see wrangler.jsonc). */
export interface Env {
  /** Static-assets binding serving the Vite `dist/` bundle (+ SPA fallback). */
  ASSETS: Fetcher;
  /** KV namespace holding the anonymous aggregate vote counts. */
  VOTES: KVNamespace;
}

/** The four known games. A vote for any other id is rejected. */
const GAME_IDS = [
  "block-cascade",
  "serpent",
  "maze-muncher",
  "brick-buster",
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

/** GET /api/votes -> aggregate counts for all four games. */
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/votes" && request.method === "GET") {
      return handleGetVotes(env);
    }

    if (url.pathname === "/api/vote" && request.method === "POST") {
      return handlePostVote(request, env);
    }

    // Everything else: serve the static site (and SPA fallback) from ASSETS.
    return env.ASSETS.fetch(request);
  },
};
