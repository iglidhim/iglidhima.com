// test/worker.family.create.test.ts
// Worker handler tests for the Family Corner create path
// (POST /api/family/submit, src/worker/family/createSubmission.ts).
//
// Runs under the default `node` Vitest environment and is type-checked by
// tsconfig.worker.json against @cloudflare/workers-types (Request, Response,
// FormData, Blob, File are Workers/undici runtime globals). Following the
// pattern in test/worker.api.test.ts, the exported Worker `fetch` is driven
// directly with a mock `Env` whose Family Corner bindings are stubs:
//
//   - FAMILY_RATE : a Map-backed KVNamespace stub (get/put; put records its
//                   options so the 60s TTL window can be observed loosely).
//   - FAMILY_MEDIA: an R2Bucket stub recording put/get/delete calls, with an
//                   injectable put failure for the storage-error path.
//   - FAMILY_DB   : a D1Database stub recording prepare().bind().run()/all()/
//                   first() calls, with an injectable run() failure.
//   - ASSETS      : a sentinel Fetcher stub (never hit on the create path).
//
// The assertions cover Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 9.1, 9.2, 9.3, 9.4.

import { describe, it, expect, vi } from "vitest";
import worker, { type Env } from "../src/worker/index";
import {
  MAX_NOTE_LENGTH,
  MAX_TOTAL_BYTES,
  RATE_LIMIT,
} from "../src/worker/validation";

// ---------------------------------------------------------------------------
// Binding stubs
// ---------------------------------------------------------------------------

/** A recorded KV put, capturing the options so TTL usage can be inspected. */
interface KvPut {
  key: string;
  value: string;
  options: unknown;
}

/** A Map-backed KV stub implementing the get/put surface the Worker uses. */
function createKvStub(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const puts: KvPut[] = [];
  const kv = {
    get: async (key: string): Promise<string | null> =>
      store.has(key) ? (store.get(key) as string) : null,
    put: async (key: string, value: string, options?: unknown): Promise<void> => {
      puts.push({ key, value, options });
      store.set(key, value);
    },
  } as unknown as KVNamespace;
  return { store, puts, kv };
}

/** A recorded R2 put, capturing the options so we can assert no expiry is set. */
interface R2Put {
  key: string;
  options: unknown;
}

/** A stub R2 bucket recording put/get/delete; put failure is injectable. */
function createR2Stub() {
  const store = new Map<string, unknown>();
  const puts: R2Put[] = [];
  const gets: string[] = [];
  const deletes: string[] = [];
  let putShouldFail = false;

  const bucket = {
    put: async (key: string, value: unknown, options?: unknown): Promise<unknown> => {
      puts.push({ key, options });
      if (putShouldFail) {
        throw new Error("R2 unavailable");
      }
      store.set(key, value);
      return {};
    },
    get: async (key: string): Promise<unknown> => {
      gets.push(key);
      return store.get(key) ?? null;
    },
    delete: async (key: string): Promise<void> => {
      deletes.push(key);
      store.delete(key);
    },
  } as unknown as R2Bucket;

  return {
    bucket,
    store,
    puts,
    gets,
    deletes,
    setPutFail: (v: boolean): void => {
      putShouldFail = v;
    },
  };
}

/** One recorded D1 statement execution. */
interface D1Call {
  sql: string;
  args: unknown[];
  method: "run" | "all" | "first";
}

/** A stub D1 database recording prepare().bind().run()/all()/first() calls. */
function createD1Stub() {
  const calls: D1Call[] = [];
  let runShouldFail = false;

  const db = {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        run: async (): Promise<unknown> => {
          calls.push({ sql, args: boundArgs, method: "run" });
          if (runShouldFail) {
            throw new Error("D1 unavailable");
          }
          return { success: true };
        },
        all: async (): Promise<unknown> => {
          calls.push({ sql, args: boundArgs, method: "all" });
          return { results: [] };
        },
        first: async (): Promise<unknown> => {
          calls.push({ sql, args: boundArgs, method: "first" });
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return {
    db,
    calls,
    setRunFail: (v: boolean): void => {
      runShouldFail = v;
    },
  };
}

/** Build a mock Env wiring the four Family Corner bindings plus ASSETS. */
function createEnv(rateSeed: Record<string, string> = {}) {
  const kv = createKvStub(rateSeed);
  const r2 = createR2Stub();
  const d1 = createD1Stub();
  const assetsFetch = vi.fn(async () => new Response("ASSET", { status: 200 }));
  const env = {
    FAMILY_RATE: kv.kv,
    FAMILY_MEDIA: r2.bucket,
    FAMILY_DB: d1.db,
    ASSETS: { fetch: assetsFetch } as unknown as Fetcher,
  } as unknown as Env;
  return { env, kv, r2, d1, assetsFetch };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

const ORIGIN = "https://arcade.example";
const SUBMIT_PATH = "/api/family/submit";
const WINDOW_MS = 60_000;

/** A tiny PNG-typed blob standing in for a drawing export. */
function pngBlob(bytes: Uint8Array = new Uint8Array([0x89, 0x50, 0x4e, 0x47])): Blob {
  return new Blob([bytes], { type: "image/png" });
}

interface MultipartFields {
  sender?: string;
  note?: string;
  image?: Blob | null;
}

/**
 * Build a real multipart/form-data POST via FormData + Request. The runtime
 * (undici) sets the `multipart/form-data; boundary=...` content-type from the
 * FormData body automatically. Extra headers (e.g. CF-Connecting-IP) may be
 * supplied without disturbing that.
 */
function multipartRequest(
  fields: MultipartFields,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  if (fields.sender !== undefined) {
    form.set("sender", fields.sender);
  }
  if (fields.note !== undefined) {
    form.set("note", fields.note);
  }
  if (fields.image) {
    form.set("image", fields.image, "drawing.png");
  }
  return new Request(`${ORIGIN}${SUBMIT_PATH}`, {
    method: "POST",
    body: form,
    headers,
  });
}

/** Seed the FAMILY_RATE counter for a client key in the current 60s window. */
function seedRateCounter(store: Map<string, string>, ip: string, count: number): void {
  const window = Math.floor(Date.now() / WINDOW_MS);
  store.set(`rate:${ip}:${window}`, String(count));
}

interface SubmitOkBody {
  ok: true;
  id: string;
  created_at: number;
}
interface SubmitErrBody {
  ok: false;
  reason: string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/family/submit — valid submissions", () => {
  it("accepts sender + note + PNG image: 201, persists to R2 and D1 with no TTL (Req 6.1, 6.2, 6.3, 6.4)", async () => {
    const { env, r2, d1 } = createEnv();
    const res = await worker.fetch(
      multipartRequest({ sender: "Eloise", note: "hi dad", image: pngBlob() }),
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as SubmitOkBody;
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
    expect(typeof body.created_at).toBe("number");

    // Wrote the PNG to R2 exactly once (Req 6.1) with no expiry option (Req 6.3).
    expect(r2.puts).toHaveLength(1);
    const put = r2.puts[0];
    expect(put).toBeDefined();
    expect(put?.options).toBeDefined();
    const putOptions = (put?.options ?? {}) as Record<string, unknown>;
    expect(putOptions.expirationTtl).toBeUndefined();
    expect(putOptions.expiration).toBeUndefined();

    // Inserted exactly one index row into D1 (Req 6.2), also without any expiry.
    const inserts = d1.calls.filter(
      (c) => c.method === "run" && c.sql.includes("INSERT"),
    );
    expect(inserts).toHaveLength(1);
    const insert = inserts[0];
    expect(insert).toBeDefined();
    // The bound args carry the persisted row; none of them is an expiry option
    // object (D1 run() takes no options at all).
    expect(insert?.args.some((a) => typeof a === "object" && a !== null)).toBe(false);
  });

  it("accepts a note-only submission: 201, inserts D1 row, no R2 write (Req 6.2)", async () => {
    const { env, r2, d1 } = createEnv();
    const res = await worker.fetch(
      multipartRequest({ sender: "Kian", note: "just a note" }),
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as SubmitOkBody;
    expect(body.ok).toBe(true);

    // No image -> no R2 put.
    expect(r2.puts).toHaveLength(0);
    // But the index row is still inserted.
    const inserts = d1.calls.filter(
      (c) => c.method === "run" && c.sql.includes("INSERT"),
    );
    expect(inserts).toHaveLength(1);
  });
});

describe("POST /api/family/submit — storage failures (Req 6.5)", () => {
  it("returns 500 storage_error and does not report sent when the R2 put fails", async () => {
    const { env, r2, d1 } = createEnv();
    r2.setPutFail(true);

    const res = await worker.fetch(
      multipartRequest({ sender: "Kian", note: "hi", image: pngBlob() }),
      env,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as SubmitErrBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("storage_error");

    // The R2 put was attempted, but no D1 row was inserted and no cleanup delete
    // was needed (the object never landed).
    expect(r2.puts).toHaveLength(1);
    expect(r2.deletes).toHaveLength(0);
    const inserts = d1.calls.filter(
      (c) => c.method === "run" && c.sql.includes("INSERT"),
    );
    expect(inserts).toHaveLength(0);
  });

  it("deletes the orphan R2 object when the D1 insert fails after a successful put (Req 6.5)", async () => {
    const { env, r2, d1 } = createEnv();
    d1.setRunFail(true);

    const res = await worker.fetch(
      multipartRequest({ sender: "Eloise", note: "hi", image: pngBlob() }),
      env,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as SubmitErrBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("storage_error");

    // The blob was written, the insert failed, and the orphan was cleaned up.
    expect(r2.puts).toHaveLength(1);
    expect(r2.deletes).toHaveLength(1);
    expect(r2.deletes[0]).toBe(r2.puts[0]?.key);
  });
});

describe("POST /api/family/submit — abuse and validation rejections", () => {
  it("rejects a submission over 5 MB with 413 too_large (Req 9.1)", async () => {
    const { env, r2, d1 } = createEnv();
    // A note whose byte length exceeds the 5 MB cap. The size check precedes the
    // note-length check, so this surfaces as too_large.
    const bigNote = "a".repeat(MAX_TOTAL_BYTES + 1);
    const res = await worker.fetch(
      multipartRequest({ sender: "Kian", note: bigNote }),
      env,
    );

    expect(res.status).toBe(413);
    const body = (await res.json()) as SubmitErrBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("too_large");
    // Nothing persisted on a rejected submission.
    expect(r2.puts).toHaveLength(0);
    expect(d1.calls).toHaveLength(0);
  });

  it("rejects when the rate limit is exceeded with 429 rate_limited (Req 9.2)", async () => {
    const { env, kv } = createEnv();
    const ip = "203.0.113.7";
    // Pre-seed the counter at the limit so the next request would exceed it.
    seedRateCounter(kv.store, ip, RATE_LIMIT);

    const res = await worker.fetch(
      multipartRequest(
        { sender: "Kian", note: "hi" },
        { "CF-Connecting-IP": ip },
      ),
      env,
    );

    expect(res.status).toBe(429);
    const body = (await res.json()) as SubmitErrBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("rate_limited");
  });

  it("rejects an unsupported content-type with 415 unsupported_type (Req 9.3)", async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      new Request(`${ORIGIN}${SUBMIT_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender: "Kian", note: "hi" }),
      }),
      env,
    );

    expect(res.status).toBe(415);
    const body = (await res.json()) as SubmitErrBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("unsupported_type");
  });

  it("rejects an invalid sender with 400 invalid_sender (Req 4.5, 9.4)", async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      multipartRequest({ sender: "Stranger", note: "hi" }),
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as SubmitErrBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("invalid_sender");
  });

  it("rejects an empty submission (no image, blank note) with 400 empty (Req 9.4)", async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      multipartRequest({ sender: "Kian", note: "   " }),
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as SubmitErrBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("empty");
  });

  it("rejects a too-long note with 400 note_too_long (Req 9.4)", async () => {
    const { env } = createEnv();
    const longNote = "a".repeat(MAX_NOTE_LENGTH + 1);
    const res = await worker.fetch(
      multipartRequest({ sender: "Eloise", note: longNote }),
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as SubmitErrBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("note_too_long");
  });
});
