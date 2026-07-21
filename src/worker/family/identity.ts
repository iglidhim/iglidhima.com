/// <reference types="@cloudflare/workers-types" />
// src/worker/family/identity.ts
// Server-side Cloudflare Access identity verification for the Family Corner
// parent-only routes (defense in depth on top of the edge Access gate).
//
// Cloudflare Access, when it allows a request through to the origin, injects a
// signed JWT in the `Cf-Access-Jwt-Assertion` header. This module verifies that
// token cryptographically against the team's published public keys (JWKS) and
// then delegates the final allow/deny to the PURE `decideParentAccess` decision
// in `../validation.ts` (audience match). Keeping the impure crypto/JWKS logic
// here and the decision pure elsewhere is deliberate: the decision is directly
// property-tested, while this module is exercised by handler tests that stub
// identity (full JWKS verification cannot be unit-tested without live keys).
//
// PRIVACY / FAIL-CLOSED POSTURE
// The parent inbox holds a family's private content, so every ambiguous or
// error path denies rather than allows:
//   - Missing `Cf-Access-Jwt-Assertion` header      -> 401 (no identity).
//   - `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` not set    -> 403 (fail closed; we
//     refuse to serve the parent inbox without a configured Access app rather
//     than silently allowing unauthenticated access).
//   - Signature / expiry / structural verification fails, or the JWKS fetch or
//     parse throws                                   -> 403 (treated as invalid).
// This module NEVER throws to its caller: fetch/parse/verify failures are
// caught and converted into a denial.

import {
  decideParentAccess,
  type AccessDecision,
  type VerifiedParentClaims,
} from "../validation";
import type { Env } from "../index";

/** The header Cloudflare Access injects on allowed requests. */
const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

/**
 * How long (ms) a fetched JWKS is trusted before we refetch. Access keys rotate
 * infrequently, so a short in-module cache avoids fetching the certs on every
 * request without risking long staleness. If verification ever fails against
 * the cached keys we refetch once (keys may have just rotated) before denying.
 */
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** A single RSA JWK as published at the Access `/cdn-cgi/access/certs` endpoint. */
interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface JwksResponse {
  keys?: Jwk[];
}

/** In-module JWKS cache, keyed by team domain (impure module state). */
interface JwksCacheEntry {
  fetchedAt: number;
  keys: Jwk[];
}
const jwksCache = new Map<string, JwksCacheEntry>();

/**
 * Verify parent identity for a parent-only request.
 *
 * 1. Read `Cf-Access-Jwt-Assertion`; absent -> `{ ok: false, status: 401 }`.
 * 2. Require `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`; either missing -> deny 403
 *    (fail closed — privacy is paramount).
 * 3. Verify the JWT signature (RS256) and expiry against the team's JWKS using
 *    WebCrypto. Any failure (bad signature, expired, malformed, fetch/parse
 *    error) -> deny 403.
 * 4. On success, hand the verified claims (`aud`) to the pure
 *    `decideParentAccess` for the final audience match.
 */
export async function verifyParentIdentity(
  request: Request,
  env: Env,
): Promise<AccessDecision> {
  // 1. Header presence — no identity at all is a 401.
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (token === null || token.length === 0) {
    return { ok: false, status: 401 };
  }

  // 2. Configuration presence — fail closed if the Access app is not configured.
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const expectedAudience = env.ACCESS_AUD;
  if (
    teamDomain === undefined ||
    teamDomain.length === 0 ||
    expectedAudience === undefined ||
    expectedAudience.length === 0
  ) {
    return { ok: false, status: 403 };
  }

  // 3. Cryptographically verify the token. Any failure denies with 403; this
  //    call never throws (all error paths return null).
  const claims = await verifyAccessJwt(token, teamDomain);
  if (claims === null) {
    return { ok: false, status: 403 };
  }

  // 4. Final allow/deny is the pure audience decision.
  return decideParentAccess(claims, expectedAudience);
}

/**
 * Verify a Cloudflare Access JWT and return its verified claims, or `null` when
 * verification fails for any reason. Never throws.
 *
 * Checks performed: RS256 header alg, structural validity, signature against a
 * matching JWKS key (by `kid`), and `exp`/`nbf` time bounds.
 */
async function verifyAccessJwt(
  token: string,
  teamDomain: string,
): Promise<VerifiedParentClaims | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const headerB64 = parts[0] ?? "";
    const payloadB64 = parts[1] ?? "";
    const signatureB64 = parts[2] ?? "";

    const header = decodeJson(headerB64) as { alg?: string; kid?: string } | null;
    if (header === null || header.alg !== "RS256") {
      return null;
    }

    const payload = decodeJson(payloadB64) as
      | { aud?: string | string[]; exp?: number; nbf?: number }
      | null;
    if (payload === null) {
      return null;
    }

    // Expiry / not-before bounds (seconds since epoch). A small clock-skew
    // allowance keeps borderline-fresh tokens from being rejected.
    const nowSec = Math.floor(Date.now() / 1000);
    const skewSec = 60;
    if (typeof payload.exp === "number" && payload.exp + skewSec < nowSec) {
      return null; // expired
    }
    if (typeof payload.nbf === "number" && payload.nbf - skewSec > nowSec) {
      return null; // not yet valid
    }

    if (payload.aud === undefined) {
      return null;
    }

    // Verify the signature against the team's JWKS. Try the cache first; if the
    // matching key is absent or verification fails, refetch once (keys rotate).
    const signed = `${headerB64}.${payloadB64}`;
    const signatureBytes = base64UrlToBytes(signatureB64);
    if (signatureBytes === null) {
      return null;
    }

    const verified = await verifyAgainstJwks(
      teamDomain,
      header.kid,
      signed,
      signatureBytes,
    );
    if (!verified) {
      return null;
    }

    return { aud: payload.aud };
  } catch {
    // Defensive: any unexpected error is treated as a failed verification.
    return null;
  }
}

/**
 * Verify `signed` against the team's JWKS. Uses the cached keys when fresh;
 * refetches once when the key is missing or verification fails (to tolerate key
 * rotation). Returns `false` on any failure.
 */
async function verifyAgainstJwks(
  teamDomain: string,
  kid: string | undefined,
  signed: string,
  signatureBytes: Uint8Array,
): Promise<boolean> {
  let keys = await getJwks(teamDomain, false);
  if (await tryVerifyWithKeys(keys, kid, signed, signatureBytes)) {
    return true;
  }

  // Cache may be stale after a key rotation — force a refetch and retry once.
  keys = await getJwks(teamDomain, true);
  return tryVerifyWithKeys(keys, kid, signed, signatureBytes);
}

/** Try every candidate key (matching `kid` first) and report any success. */
async function tryVerifyWithKeys(
  keys: Jwk[],
  kid: string | undefined,
  signed: string,
  signatureBytes: Uint8Array,
): Promise<boolean> {
  // Prefer the key whose `kid` matches the token header; fall back to all keys.
  const candidates =
    kid !== undefined
      ? keys.filter((k) => k.kid === kid).concat(keys.filter((k) => k.kid !== kid))
      : keys;

  const data = new TextEncoder().encode(signed);
  for (const jwk of candidates) {
    if (jwk.kty !== "RSA" || jwk.n === undefined || jwk.e === undefined) {
      continue;
    }
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const ok = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        signatureBytes,
        data,
      );
      if (ok) {
        return true;
      }
    } catch {
      // Ignore this key and try the next candidate.
    }
  }
  return false;
}

/**
 * Return the JWKS for a team domain, using the in-module cache unless
 * `forceRefresh` is set or the cache entry has expired. On fetch/parse failure
 * returns any still-cached keys, else an empty array (never throws).
 */
async function getJwks(teamDomain: string, forceRefresh: boolean): Promise<Jwk[]> {
  const cached = jwksCache.get(teamDomain);
  const now = Date.now();
  if (
    !forceRefresh &&
    cached !== undefined &&
    now - cached.fetchedAt < JWKS_CACHE_TTL_MS
  ) {
    return cached.keys;
  }

  try {
    const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
    const response = await fetch(certsUrl);
    if (!response.ok) {
      return cached?.keys ?? [];
    }
    const body = (await response.json()) as JwksResponse;
    const keys = Array.isArray(body.keys) ? body.keys : [];
    jwksCache.set(teamDomain, { fetchedAt: now, keys });
    return keys;
  } catch {
    // Network/parse failure: fall back to any cached keys, else deny (empty).
    return cached?.keys ?? [];
  }
}

/** Decode a base64url JWT segment into parsed JSON, or `null` on failure. */
function decodeJson(segment: string): unknown {
  const bytes = base64UrlToBytes(segment);
  if (bytes === null) {
    return null;
  }
  try {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Decode a base64url string to bytes, or `null` on malformed input. */
function base64UrlToBytes(input: string): Uint8Array | null {
  try {
    // base64url -> base64, then pad to a multiple of 4.
    let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad === 2) {
      base64 += "==";
    } else if (pad === 3) {
      base64 += "=";
    } else if (pad === 1) {
      return null; // invalid base64url length
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}
