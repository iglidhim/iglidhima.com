/// <reference types="@cloudflare/workers-types" />
// src/worker/family/rateLimiter.ts
// Family Corner abuse rate-limiter, backed by the `FAMILY_RATE` KV namespace.
//
// Policy (Requirement 9.2): at most 20 accepted submissions per client per
// rolling 60-second window; the 21st within a window is rejected until the
// window elapses. This module is the ONLY place that touches KV for
// rate-limiting; the actual allow/deny arithmetic is delegated to the pure,
// property-tested `decideRateLimit` in `../validation` so the rule lives in one
// place and never drifts between client pre-check and server enforcement.
//
// This is a Worker-typed module (KVNamespace, Request come from
// @cloudflare/workers-types), so it compiles only under tsconfig.worker.json.
//
// CONSISTENCY / DURABILITY CAVEAT: like the votes counter in ../index.ts, KV is
// eventually consistent and has no atomic increment. `checkAndIncrement` does a
// read-modify-write (read count, decide, put count+1), so concurrent
// submissions from the same client can race and each read a stale count,
// letting a few extra requests slip through a window. That over-counting is
// acceptable for coarse abuse protection — the goal is to stop flooding, not to
// enforce an exact quota. If exact counts were required, a Durable Object would
// be the correct primitive instead.
//
// FAIL-OPEN CHOICE: if KV read or write throws, `checkAndIncrement` fails OPEN
// (returns allow). Rationale — this endpoint is how the kids send drawings to
// their dad; a transient KV blip should never silently block a child's
// submission. The rate limiter exists to blunt flooding, not to be a hard
// security gate (size, content-type, and validation checks still apply), so
// availability is preferred over strict enforcement when the counter store is
// unavailable.

import type { Env } from "../index";
import {
  decideRateLimit,
  RATE_LIMIT,
  type RateLimitDecision,
} from "../validation";

/** Fixed rate-limit window length in milliseconds (60 seconds, Req 9.2). */
const WINDOW_MS = 60_000;

/**
 * TTL (seconds) applied to each window counter. Set one window long so an idle
 * client's counter self-expires shortly after its window ends and never
 * lingers in KV. KV requires a minimum TTL of 60s, which matches our window.
 */
const WINDOW_TTL_SECONDS = 60;

/** Fallback client key when no client IP can be derived from the request. */
const UNKNOWN_CLIENT_KEY = "unknown";

/**
 * Derive a stable per-client key from a request, used to bucket rate-limit
 * counters. Uses Cloudflare's `CF-Connecting-IP` header (the real client IP at
 * the edge); when absent (e.g. local dev or a stripped header) it falls back to
 * a single shared constant so limiting still degrades to a global bucket rather
 * than failing.
 */
export function clientKeyFromRequest(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP");
  const trimmed = ip?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : UNKNOWN_CLIENT_KEY;
}

/** The KV key for one client's counter within the window containing `now`. */
function windowKey(clientKey: string, now: number): string {
  const window = Math.floor(now / WINDOW_MS);
  return `rate:${clientKey}:${window}`;
}

/** Read the current window count from KV, defaulting to 0 for missing/corrupt values. */
async function readWindowCount(env: Env, key: string): Promise<number> {
  const raw = await env.FAMILY_RATE.get(key);
  if (raw === null) {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Check the fixed-window rate limit for `clientKey` at time `now` and, when the
 * request is allowed, record it by incrementing the window counter.
 *
 * Behaviour:
 *   - Reads the current count for the 60-second window containing `now`
 *     (default 0).
 *   - Delegates the allow/deny decision to the pure `decideRateLimit(count,
 *     RATE_LIMIT)`.
 *   - If allowed: writes `count + 1` back with a ~60s `expirationTtl` (so the
 *     counter self-expires when the window is over) and returns the allow
 *     decision.
 *   - If denied: returns the deny decision WITHOUT incrementing, so a
 *     rate-limited client cannot keep pushing its own counter higher.
 *
 * KV access is wrapped in try/catch; on any KV error this fails OPEN (returns
 * `{ allow: true }`) — see the module header for the rationale.
 */
export async function checkAndIncrement(
  env: Env,
  clientKey: string,
  now: number,
): Promise<RateLimitDecision> {
  const key = windowKey(clientKey, now);
  try {
    const count = await readWindowCount(env, key);
    const decision = decideRateLimit(count, RATE_LIMIT);
    if (decision.allow) {
      await env.FAMILY_RATE.put(key, String(count + 1), {
        expirationTtl: WINDOW_TTL_SECONDS,
      });
    }
    return decision;
  } catch {
    // Fail open: a KV blip must never block a child's submission.
    return { allow: true };
  }
}
