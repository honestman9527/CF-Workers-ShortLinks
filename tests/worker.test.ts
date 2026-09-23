import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import type { LinkRecord } from "../worker/link";

// Keep the fake statement small while preserving D1's bind → run/first/all chain.
function fakeDatabase() {
  const rows = new Map<string, LinkRecord>();
  return {
    rows,
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...args: unknown[]) { values = args; return this; },
        async run() {
        if (sql.startsWith("INSERT")) {
          const [code, target_url, created_at, expires_at] = values as [string, string, number, number];
          if (rows.has(code)) return { meta: { changes: 0 } };
          rows.set(code, { code, target_url, created_at, expires_at, disabled_at: null });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE")) {
          const [disabled_at, code] = values as [number | null, string];
          rows.set(code, { ...rows.get(code)!, disabled_at });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE") && sql.includes("expires_at")) {
          let changes = 0;
          for (const row of rows.values()) if (row.expires_at <= Number(values[0])) { rows.delete(row.code); changes++; }
          return { meta: { changes } };
        }
        if (sql.startsWith("DELETE")) return { meta: { changes: rows.delete(String(values[0])) ? 1 : 0 } };
        throw new Error(`Unexpected SQL: ${sql}`);
        },
        async first() { return rows.get(String(values[0])) ?? null; },
        async all() { return { results: [...rows.values()] }; },
      };
    },
  };
}

const baseUrl = "http://127.0.0.1:5173";

function env(db: ReturnType<typeof fakeDatabase>, options: { rateAllowed?: boolean; adminBypass?: boolean } = {}) {
  return {
    LINKS_DB: db,
    CREATE_RATE_LIMITER: { limit: async () => ({ success: options.rateAllowed !== false }) },
    ASSETS: { fetch: async () => new Response("asset") },
    PUBLIC_ORIGIN: baseUrl,
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: "secret-key",
    ACCESS_AUD: "aud",
    ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    LOCAL_ADMIN_BYPASS: options.adminBypass ? "true" : "false",
  } as unknown as Env;
}

function request(path: string, init?: RequestInit) {
  return new Request(`${baseUrl}${path}`, init);
}

async function dispatch(path: string, environment: Env, init?: RequestInit) {
  return worker.fetch(request(path, init), environment, {} as ExecutionContext);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, action: "create_link", hostname: "test" })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Worker behavior", () => {
  it("creates, redirects, disables, restores, expires, then cleans a link", async () => {
    const db = fakeDatabase();
    const environment = env(db, { adminBypass: true });
    const created = await dispatch("/api/links", environment, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/path", days: 1, turnstileToken: "token" }),
    });
    expect(created.status).toBe(201);
    const data = await created.json() as { code: string; shortUrl: string; expiresAt: string };
    expect(data.shortUrl).toBe(`${baseUrl}/${data.code}`);
    expect(data.expiresAt).toBe("2026-09-24T12:00:00.000Z");

    const redirected = await dispatch(`/${data.code}`, environment);
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("Location")).toBe("https://example.com/path");
    expect(redirected.headers.get("Cache-Control")).toBe("no-store");

    const patchHeaders = { "Content-Type": "application/json", Origin: baseUrl };
    expect((await dispatch(`/admin/api/links/${data.code}`, environment, {
      method: "PATCH", headers: patchHeaders, body: JSON.stringify({ disabled: true }),
    })).status).toBe(200);
    expect((await dispatch(`/${data.code}`, environment)).status).toBe(404);
    expect((await dispatch(`/admin/api/links/${data.code}`, environment, {
      method: "PATCH", headers: patchHeaders, body: JSON.stringify({ disabled: false }),
    })).status).toBe(200);
    expect((await dispatch(`/${data.code}`, environment)).status).toBe(302);

    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
    expect((await dispatch(`/${data.code}`, environment)).status).toBe(404);
    await worker.scheduled({} as ScheduledController, environment, {} as ExecutionContext);
    expect(db.rows.has(data.code)).toBe(false);
  });

  it("blocks creation when rate limited or Turnstile fails", async () => {
    const body = JSON.stringify({ url: "https://example.com", days: 3, turnstileToken: "token" });
    const headers = { "Content-Type": "application/json" };
    expect((await dispatch("/api/links", env(fakeDatabase(), { rateAllowed: false }), { method: "POST", headers, body })).status).toBe(429);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false })));
    expect((await dispatch("/api/links", env(fakeDatabase()), { method: "POST", headers, body })).status).toBe(400);
  });

  it("rejects unverified admin access and cross-origin writes", async () => {
    const db = fakeDatabase();
    const protectedEnv = env(db);
    expect((await dispatch("/admin", protectedEnv)).status).toBe(403);
    expect((await dispatch("/admin/api/links", protectedEnv)).status).toBe(403);
    const localEnv = env(db, { adminBypass: true });
    expect((await dispatch("/admin/api/links/Ab34Cd56", localEnv, {
      method: "DELETE", headers: { Origin: "https://evil.example" },
    })).status).toBe(403);
  });
});
