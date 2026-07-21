// test/worker.api.test.ts
// Unit tests for the Cloudflare Worker voting API (src/worker/index.ts).
//
// Runs under the default `node` Vitest environment. The Worker's exported
// `fetch` is driven directly with a mock `Env`: a Map-backed `VOTES` KV stub
// (get/put) and a stub `ASSETS.fetch`. This exercises the routing, validation,
// clamping, and asset delegation without any real Cloudflare bindings.
import { describe, it, expect, vi } from "vitest";
import worker, { type Env } from "../src/worker/index";

/** A minimal Map-backed KV stub implementing just get/put as the Worker uses. */
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

/** Build a mock Env with a KV stub and a sentinel ASSETS.fetch stub. */
function createEnv(initial: Record<string, string> = {}) {
  const { store, kv } = createKvStub(initial);
  const assetsResponse = new Response("ASSET", { status: 200 });
  const assetsFetch = vi.fn(async () => assetsResponse);
  const env = {
    VOTES: kv,
    ASSETS: { fetch: assetsFetch } as unknown as Fetcher,
  } as Env;
  return { env, store, assetsFetch, assetsResponse };
}

const ORIGIN = "https://arcade.example";
const GAME_IDS = ["block-cascade", "serpent", "maze-muncher", "brick-buster"];

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: "GET" });
}

function postVote(body: unknown, raw = false): Request {
  return new Request(`${ORIGIN}/api/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe("GET /api/votes", () => {
  it("returns all four games with numeric like/love defaulting to 0", async () => {
    const { env } = createEnv();
    const res = await worker.fetch(get("/api/votes"), env);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const body = (await res.json()) as Record<
      string,
      { like: number; love: number }
    >;
    expect(Object.keys(body).sort()).toEqual([...GAME_IDS].sort());
    for (const id of GAME_IDS) {
      expect(body[id]).toEqual({ like: 0, love: 0 });
    }
  });

  it("reflects existing counts stored in KV", async () => {
    const { env } = createEnv({
      "count:serpent:like": "5",
      "count:serpent:love": "2",
    });
    const res = await worker.fetch(get("/api/votes"), env);
    const body = (await res.json()) as Record<
      string,
      { like: number; love: number }
    >;
    expect(body["serpent"]).toEqual({ like: 5, love: 2 });
    expect(body["block-cascade"]).toEqual({ like: 0, love: 0 });
  });

  it("treats corrupt/negative stored values as 0", async () => {
    const { env } = createEnv({
      "count:maze-muncher:like": "not-a-number",
      "count:maze-muncher:love": "-4",
    });
    const res = await worker.fetch(get("/api/votes"), env);
    const body = (await res.json()) as Record<
      string,
      { like: number; love: number }
    >;
    expect(body["maze-muncher"]).toEqual({ like: 0, love: 0 });
  });
});

describe("POST /api/vote", () => {
  it("increments a count and returns the updated game counts", async () => {
    const { env, store } = createEnv();
    const res = await worker.fetch(
      postVote({ gameId: "block-cascade", reaction: "like", delta: 1 }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { like: number; love: number };
    expect(body).toEqual({ like: 1, love: 0 });
    expect(store.get("count:block-cascade:like")).toBe("1");
  });

  it("decrements a count", async () => {
    const { env, store } = createEnv({ "count:serpent:love": "3" });
    const res = await worker.fetch(
      postVote({ gameId: "serpent", reaction: "love", delta: -1 }),
      env,
    );
    const body = (await res.json()) as { like: number; love: number };
    expect(body.love).toBe(2);
    expect(store.get("count:serpent:love")).toBe("2");
  });

  it("clamps at 0 when decrementing below zero", async () => {
    const { env, store } = createEnv({ "count:brick-buster:like": "0" });
    const res = await worker.fetch(
      postVote({ gameId: "brick-buster", reaction: "like", delta: -1 }),
      env,
    );
    const body = (await res.json()) as { like: number; love: number };
    expect(body.like).toBe(0);
    expect(store.get("count:brick-buster:like")).toBe("0");
  });

  it("keeps like and love independent", async () => {
    const { env } = createEnv();
    await worker.fetch(
      postVote({ gameId: "serpent", reaction: "like", delta: 1 }),
      env,
    );
    const res = await worker.fetch(
      postVote({ gameId: "serpent", reaction: "love", delta: 1 }),
      env,
    );
    const body = (await res.json()) as { like: number; love: number };
    expect(body).toEqual({ like: 1, love: 1 });
  });

  it("rejects an unknown gameId with 400", async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      postVote({ gameId: "pong", reaction: "like", delta: 1 }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid reaction with 400", async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      postVote({ gameId: "serpent", reaction: "hate", delta: 1 }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid delta with 400", async () => {
    const { env } = createEnv();
    for (const delta of [0, 2, -2, "1", null]) {
      const res = await worker.fetch(
        postVote({ gameId: "serpent", reaction: "like", delta }),
        env,
      );
      expect(res.status).toBe(400);
    }
  });

  it("rejects a malformed JSON body with 400", async () => {
    const { env } = createEnv();
    const res = await worker.fetch(postVote("{not json", true), env);
    expect(res.status).toBe(400);
  });

  it("rejects a non-object JSON body with 400", async () => {
    const { env } = createEnv();
    const res = await worker.fetch(postVote(42), env);
    expect(res.status).toBe(400);
  });
});

describe("asset delegation", () => {
  it("delegates non-API routes to ASSETS.fetch", async () => {
    const { env, assetsFetch, assetsResponse } = createEnv();
    const req = get("/index.html");
    const res = await worker.fetch(req, env);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(assetsFetch).toHaveBeenCalledWith(req);
    expect(res).toBe(assetsResponse);
  });

  it("delegates the root route to ASSETS.fetch", async () => {
    const { env, assetsFetch } = createEnv();
    await worker.fetch(get("/"), env);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });

  it("does not treat GET /api/vote (wrong method) as the vote endpoint", async () => {
    // POST-only endpoint; a GET falls through to ASSETS.
    const { env, assetsFetch } = createEnv();
    await worker.fetch(get("/api/vote"), env);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });
});
