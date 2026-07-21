// test/worker.family.parent.test.ts
// Worker handler tests for the three PARENT-ONLY Family Corner routes
// (Requirements 7.1, 7.4, 8.1, 8.2, 8.4, 8.5):
//
//   GET    /api/family/submissions            -> handleListSubmissions
//   GET    /api/family/submissions/:id/image  -> handleGetImage
//   DELETE /api/family/submissions/:id         -> handleDeleteSubmission
//
// Runs under the default `node` Vitest environment and the Worker tsconfig
// (this file matches `test/worker.*.test.ts` in tsconfig.worker.json). Requests
// are driven through the exported `fetch` router with a mock `Env`, following
// the pattern in `test/worker.api.test.ts`.
//
// THE IDENTITY CHALLENGE
// These handlers call `verifyParentIdentity(request, env)`, which does real
// JWKS/WebCrypto verification that cannot run in a unit test. We split the
// coverage into deterministic real paths plus a stubbed allow path:
//
//   1. Identity ABSENT (no `Cf-Access-Jwt-Assertion` header) -> the REAL
//      `verifyParentIdentity` returns 401 before any crypto, regardless of
//      config. We exercise the real function here (no override).
//   2. Identity PRESENT but Access NOT configured (`ACCESS_TEAM_DOMAIN` /
//      `ACCESS_AUD` unset) -> the REAL function fails closed with 403 before
//      any crypto. Again exercised with the real function.
//   3. ALLOWED path -> since real JWKS verification can't run in-unit, we stub
//      `verifyParentIdentity` at the module boundary via `vi.mock` to resolve
//      `{ ok: true }`. This is the documented mechanism (approach b): no
//      handler signatures change and the `index.ts` routing keeps working.
//
// The mock delegates to the REAL implementation unless a per-test override is
// installed, so the 401/403 tests run genuine deterministic logic while only
// the allow path is stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../src/worker/index";
import type { AccessDecision } from "../src/worker/validation";

// A hoisted, mutable override slot. `null` means "use the real
// verifyParentIdentity"; a function replaces it for the allow-path tests.
const identityControl = vi.hoisted(() => ({
  override: null as
    | ((request: Request, env: Env) => Promise<AccessDecision>)
    | null,
}));

// Mock the identity module: keep every real export, but route
// verifyParentIdentity through the override slot (falling back to the real
// implementation) so most tests exercise genuine deterministic behavior.
vi.mock("../src/worker/family/identity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/worker/family/identity")>();
  return {
    ...actual,
    verifyParentIdentity: (request: Request, env: Env): Promise<AccessDecision> =>
      (identityControl.override ?? actual.verifyParentIdentity)(request, env),
  };
});

// Imported after the mock is declared (vitest hoists vi.mock regardless).
import worker from "../src/worker/index";

const ORIGIN = "https://arcade.example";
const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

/** The raw D1 column shape the storage layer reads (booleans as 0/1). */
interface DbRow {
  id: string;
  sender: string;
  created_at: number;
  has_note: number;
  note_text: string | null;
  has_image: number;
  r2_key: string | null;
}

/**
 * A D1 stub backed by an in-memory row array. Each storage call uses a distinct
 * terminal method, so we dispatch by method rather than by SQL text:
 *   - listSubmissions -> prepare(...).all()      (newest-first, simulated here)
 *   - getImageKey     -> prepare(...).bind(id).first()
 *   - delete row      -> prepare(...).bind(id).run()
 */
function createD1Stub(initialRows: DbRow[]) {
  const rows = [...initialRows];
  const deletedIds: string[] = [];

  const db = {
    prepare(_sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        // listSubmissions: return rows newest-first, simulating ORDER BY
        // created_at DESC (the ordering the handler delegates to storage/D1).
        async all<T>(): Promise<{ results: T[] }> {
          const sorted = [...rows].sort((a, b) => b.created_at - a.created_at);
          return { results: sorted as unknown as T[] };
        },
        // getImageKey: SELECT r2_key WHERE id = ?
        async first<T>(): Promise<T | null> {
          const id = bound[0];
          const row = rows.find((r) => r.id === id);
          return (row ? { r2_key: row.r2_key } : null) as T | null;
        },
        // delete: DELETE WHERE id = ?
        async run(): Promise<unknown> {
          const id = bound[0] as string;
          deletedIds.push(id);
          const idx = rows.findIndex((r) => r.id === id);
          if (idx >= 0) {
            rows.splice(idx, 1);
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };

  return { db: db as unknown as D1Database, rows, deletedIds };
}

/** A minimal R2 stub with get/put/delete over a Map. */
function createR2Stub(
  initial: Record<string, { bytes: Uint8Array; contentType: string }> = {},
) {
  const store = new Map(Object.entries(initial));
  const deletedKeys: string[] = [];

  const bucket = {
    async get(key: string) {
      const obj = store.get(key);
      if (obj === undefined) {
        return null;
      }
      return {
        body: obj.bytes,
        httpMetadata: { contentType: obj.contentType },
      };
    },
    async put(
      key: string,
      value: Uint8Array,
      opts?: { httpMetadata?: { contentType?: string } },
    ) {
      store.set(key, {
        bytes: value,
        contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream",
      });
    },
    async delete(key: string) {
      deletedKeys.push(key);
      store.delete(key);
    },
  };

  return { bucket: bucket as unknown as R2Bucket, store, deletedKeys };
}

/** Build a mock Env. Access config is omitted by default (fail-closed 403). */
function createEnv(
  d1: ReturnType<typeof createD1Stub>,
  r2: ReturnType<typeof createR2Stub>,
  access?: { teamDomain?: string; aud?: string },
): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("ASSET")) } as unknown as Fetcher,
    VOTES: {} as unknown as KVNamespace,
    FAMILY_RATE: {} as unknown as KVNamespace,
    FAMILY_MEDIA: r2.bucket,
    FAMILY_DB: d1.db,
    ACCESS_TEAM_DOMAIN: access?.teamDomain,
    ACCESS_AUD: access?.aud,
  } as Env;
}

function req(method: string, path: string, withIdentity: boolean): Request {
  const headers: Record<string, string> = {};
  if (withIdentity) {
    // A structurally-present (but not cryptographically valid) assertion. Its
    // content never reaches crypto in these tests: either config is unset (403)
    // or verifyParentIdentity is stubbed for the allow path.
    headers[ACCESS_HEADER] = "header.payload.signature";
  }
  return new Request(`${ORIGIN}${path}`, { method, headers });
}

/** Convenience: install an allow-all identity override for the allow path. */
function allowIdentity() {
  identityControl.override = async () => ({ ok: true });
}

beforeEach(() => {
  // Default: use the REAL verifyParentIdentity (deterministic 401/403 paths).
  identityControl.override = null;
});

describe("parent-only routes: identity ABSENT -> 401", () => {
  // No Cf-Access-Jwt-Assertion header -> the real verifyParentIdentity returns
  // 401 before any crypto, regardless of Access config (Requirements 8.1, 8.2).
  it("GET /api/family/submissions returns 401", async () => {
    const env = createEnv(createD1Stub([]), createR2Stub());
    const res = await worker.fetch(req("GET", "/api/family/submissions", false), env);
    expect(res.status).toBe(401);
  });

  it("GET /api/family/submissions/:id/image returns 401", async () => {
    const env = createEnv(createD1Stub([]), createR2Stub());
    const res = await worker.fetch(
      req("GET", "/api/family/submissions/abc/image", false),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("DELETE /api/family/submissions/:id returns 401", async () => {
    const env = createEnv(createD1Stub([]), createR2Stub());
    const res = await worker.fetch(
      req("DELETE", "/api/family/submissions/abc", false),
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("parent-only routes: identity present but Access unconfigured -> 403", () => {
  // Header present but ACCESS_TEAM_DOMAIN / ACCESS_AUD unset -> the real
  // verifyParentIdentity fails closed with 403 before any crypto (Req 8.1, 8.2).
  it("GET /api/family/submissions returns 403", async () => {
    const env = createEnv(createD1Stub([]), createR2Stub());
    const res = await worker.fetch(req("GET", "/api/family/submissions", true), env);
    expect(res.status).toBe(403);
  });

  it("GET /api/family/submissions/:id/image returns 403", async () => {
    const env = createEnv(createD1Stub([]), createR2Stub());
    const res = await worker.fetch(
      req("GET", "/api/family/submissions/abc/image", true),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("DELETE /api/family/submissions/:id returns 403", async () => {
    const env = createEnv(createD1Stub([]), createR2Stub());
    const res = await worker.fetch(
      req("DELETE", "/api/family/submissions/abc", true),
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe("handleListSubmissions: verified identity -> 200 newest-first", () => {
  it("returns 200 JSON { submissions } newest-first with X-Robots-Tag: noindex", async () => {
    allowIdentity();
    // Seed rows deliberately out of created_at order; storage/D1 orders DESC.
    const d1 = createD1Stub([
      {
        id: "old",
        sender: "Kian",
        created_at: 100,
        has_note: 1,
        note_text: "hi",
        has_image: 0,
        r2_key: null,
      },
      {
        id: "new",
        sender: "Eloise",
        created_at: 300,
        has_note: 0,
        note_text: null,
        has_image: 1,
        r2_key: "submissions/2024/01/new.png",
      },
      {
        id: "mid",
        sender: "Kian",
        created_at: 200,
        has_note: 1,
        note_text: "yo",
        has_image: 1,
        r2_key: "submissions/2024/01/mid.png",
      },
    ]);
    const env = createEnv(d1, createR2Stub());

    const res = await worker.fetch(req("GET", "/api/family/submissions", true), env);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");

    const body = (await res.json()) as {
      submissions: Array<{ id: string; has_note: boolean; has_image: boolean }>;
    };
    // Newest-first ordering delegated to storage.
    expect(body.submissions.map((s) => s.id)).toEqual(["new", "mid", "old"]);
    // 0/1 flags mapped back to booleans by the storage layer.
    expect(body.submissions[0]).toMatchObject({ has_note: false, has_image: true });
    expect(body.submissions[2]).toMatchObject({ has_note: true, has_image: false });
  });

  it("returns 200 with an empty array when there are no submissions", async () => {
    allowIdentity();
    const env = createEnv(createD1Stub([]), createR2Stub());
    const res = await worker.fetch(req("GET", "/api/family/submissions", true), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { submissions: unknown[] };
    expect(body.submissions).toEqual([]);
  });
});

describe("handleGetImage: verified identity", () => {
  it("streams the R2 object as image/png with X-Robots-Tag: noindex", async () => {
    allowIdentity();
    const key = "submissions/2024/01/pic.png";
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // fake PNG magic
    const d1 = createD1Stub([
      {
        id: "pic",
        sender: "Kian",
        created_at: 1,
        has_note: 0,
        note_text: null,
        has_image: 1,
        r2_key: key,
      },
    ]);
    const r2 = createR2Stub({ [key]: { bytes, contentType: "image/png" } });
    const env = createEnv(d1, r2);

    const res = await worker.fetch(
      req("GET", "/api/family/submissions/pic/image", true),
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const got = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(bytes));
  });

  it("returns 404 when the D1 row is missing", async () => {
    allowIdentity();
    const env = createEnv(createD1Stub([]), createR2Stub());
    const res = await worker.fetch(
      req("GET", "/api/family/submissions/missing/image", true),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the row exists but the R2 object is missing", async () => {
    allowIdentity();
    const key = "submissions/2024/01/gone.png";
    const d1 = createD1Stub([
      {
        id: "gone",
        sender: "Eloise",
        created_at: 1,
        has_note: 0,
        note_text: null,
        has_image: 1,
        r2_key: key,
      },
    ]);
    // R2 has no object for `key`.
    const env = createEnv(d1, createR2Stub());
    const res = await worker.fetch(
      req("GET", "/api/family/submissions/gone/image", true),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("handleDeleteSubmission: verified identity -> 204", () => {
  it("deletes the D1 row and the R2 object then returns 204", async () => {
    allowIdentity();
    const key = "submissions/2024/01/del.png";
    const d1 = createD1Stub([
      {
        id: "del",
        sender: "Kian",
        created_at: 1,
        has_note: 0,
        note_text: null,
        has_image: 1,
        r2_key: key,
      },
    ]);
    const r2 = createR2Stub({
      [key]: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" },
    });
    const env = createEnv(d1, r2);

    const res = await worker.fetch(
      req("DELETE", "/api/family/submissions/del", true),
      env,
    );

    expect(res.status).toBe(204);
    // D1 row removed and R2 object removed (storage.deleteSubmission effects).
    expect(d1.deletedIds).toContain("del");
    expect(d1.rows.find((r) => r.id === "del")).toBeUndefined();
    expect(r2.deletedKeys).toContain(key);
    expect(r2.store.has(key)).toBe(false);
  });

  it("returns 204 for a submission with no stored image (D1 row only)", async () => {
    allowIdentity();
    const d1 = createD1Stub([
      {
        id: "noteonly",
        sender: "Eloise",
        created_at: 1,
        has_note: 1,
        note_text: "hello",
        has_image: 0,
        r2_key: null,
      },
    ]);
    const r2 = createR2Stub();
    const env = createEnv(d1, r2);

    const res = await worker.fetch(
      req("DELETE", "/api/family/submissions/noteonly", true),
      env,
    );

    expect(res.status).toBe(204);
    expect(d1.deletedIds).toContain("noteonly");
    // No R2 object existed, so nothing was deleted from R2.
    expect(r2.deletedKeys).toEqual([]);
  });
});
