// test/worker.family.routing.test.ts
// Routing tests for the Cloudflare Worker entry (src/worker/index.ts), focused
// on how the exported `fetch(request, env)` dispatches requests between the
// Family Corner API, the existing votes API, the `/inbox` noindex branch, and
// the static ASSETS fallback (Requirements 11.1, 8.3, 8.4).
//
// Runs under the default `node` Vitest environment and is type-checked by
// tsconfig.worker.json. Following the pattern in test/worker.api.test.ts, the
// Worker is driven directly with a mock `Env`: a sentinel `ASSETS.fetch` stub
// plus minimal Map-backed KV stubs. The Family Corner storage bindings
// (FAMILY_MEDIA / FAMILY_DB) are intentionally left as no-op stubs — every
// assertion here exercises a routing decision or an early rejection (404 / 405 /
// 401 / 415) that is reached before any real storage access, so full R2/D1
// behaviour is not needed.
import { describe, it, expect, vi } from "vitest";
import worker, { type Env } from "../src/worker/index";

/** A minimal Map-backed KV stub implementing just get/put (as the Worker uses). */
function createKvStub(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    kv: {
      get: async (key: string): Promise<string | null> =>
        store.has(key) ? (store.get(key) as string) : null,
      put: async (key: string, value: string): Promise<void> => {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
  };
}

/**
 * Build a mock Env with:
 *   - a sentinel `ASSETS.fetch` that returns a single known Response instance
 *     (so we can assert identity for the fall-through paths),
 *   - Map-backed VOTES and FAMILY_RATE KV stubs (the rate limiter reads/writes
 *     FAMILY_RATE; an empty store means the first request is always allowed),
 *   - inert FAMILY_MEDIA / FAMILY_DB stubs that are never reached in these tests.
 */
function createEnv() {
  const { kv: votes } = createKvStub();
  const { kv: familyRate } = createKvStub();
  const assetsResponse = new Response("ASSET", { status: 200 });
  const assetsFetch = vi.fn(async () => assetsResponse);
  const env = {
    VOTES: votes,
    FAMILY_RATE: familyRate,
    // Never reached in routing/early-rejection tests, but present for typing.
    FAMILY_MEDIA: {} as unknown as R2Bucket,
    FAMILY_DB: {} as unknown as D1Database,
    ASSETS: { fetch: assetsFetch } as unknown as Fetcher,
  } as Env;
  return { env, assetsFetch, assetsResponse };
}

const ORIGIN = "https://arcade.example";

function request(method: string, path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method, ...init });
}

describe("/api/family/* is handled by the Worker (never falls through to ASSETS)", () => {
  it("returns 404 for an unknown /api/family path without touching ASSETS", async () => {
    const { env, assetsFetch } = createEnv();
    const res = await worker.fetch(request("GET", "/api/family/nope"), env);
    expect(res.status).toBe(404);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("returns 405 for a known family path with the wrong method", async () => {
    const { env, assetsFetch } = createEnv();
    const res = await worker.fetch(request("PUT", "/api/family/submissions"), env);
    expect(res.status).toBe(405);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("routes GET /api/family/submissions with no identity to the list handler (401)", async () => {
    const { env, assetsFetch } = createEnv();
    const res = await worker.fetch(request("GET", "/api/family/submissions"), env);
    // The list handler is parent-only; with no Cf-Access-Jwt-Assertion header
    // present it denies with 401 rather than delegating to ASSETS.
    expect(res.status).toBe(401);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("returns 405 for POST /api/family/submissions (no longer the public create path)", async () => {
    const { env, assetsFetch } = createEnv();
    const res = await worker.fetch(request("POST", "/api/family/submissions"), env);
    // The public create path moved to /api/family/submit; POST on /submissions
    // is now method-not-allowed (the path is GET-only, parent list).
    expect(res.status).toBe(405);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("routes POST /api/family/submit with a bad content-type to create (415)", async () => {
    const { env, assetsFetch } = createEnv();
    const res = await worker.fetch(
      request("POST", "/api/family/submit", {
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      env,
    );
    // The create handler passes the (empty) rate-limit check, then rejects the
    // non-multipart content-type with 415 — proving the request was routed to
    // the create path and not to ASSETS.
    expect(res.status).toBe(415);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("returns 405 for GET /api/family/submit (public create is POST-only)", async () => {
    const { env, assetsFetch } = createEnv();
    const res = await worker.fetch(request("GET", "/api/family/submit"), env);
    expect(res.status).toBe(405);
    expect(assetsFetch).not.toHaveBeenCalled();
  });
});

describe("/inbox noindex branch", () => {
  it("fetches ASSETS and adds X-Robots-Tag: noindex", async () => {
    const { env, assetsFetch } = createEnv();
    const res = await worker.fetch(request("GET", "/inbox"), env);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.status).toBe(200);
  });
});

describe("static asset fall-through", () => {
  it("delegates the root route to ASSETS.fetch unchanged (sentinel)", async () => {
    const { env, assetsFetch, assetsResponse } = createEnv();
    const req = request("GET", "/");
    const res = await worker.fetch(req, env);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(assetsFetch).toHaveBeenCalledWith(req);
    expect(res).toBe(assetsResponse);
  });

  it("delegates a normal asset path to ASSETS.fetch unchanged (sentinel)", async () => {
    const { env, assetsFetch, assetsResponse } = createEnv();
    const req = request("GET", "/index.html");
    const res = await worker.fetch(req, env);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(res).toBe(assetsResponse);
  });
});

describe("existing votes routes still work", () => {
  it("routes GET /api/votes to the votes handler, not ASSETS", async () => {
    const { env, assetsFetch } = createEnv();
    const res = await worker.fetch(request("GET", "/api/votes"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(assetsFetch).not.toHaveBeenCalled();
  });
});
