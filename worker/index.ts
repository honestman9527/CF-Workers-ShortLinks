import { Hono } from "hono";
import { verifyAccess } from "./access";
import {
  allocateCode,
  expiresAtFor,
  formatCursor,
  getStatus,
  isCode,
  makeCode,
  parseCreateInput,
  parseCursor,
  type LinkRecord,
} from "./link";

type Bindings = Env;
const app = new Hono<{ Bindings: Bindings }>();

const errorMessages: Record<string, string> = {
  INVALID_BODY: "请求内容无效。",
  INVALID_DAYS: "请选择 1、3 或 7 天。",
  INVALID_URL: "请输入可公开访问的 HTTP 或 HTTPS 地址，最长 2048 个字符。",
  INVALID_TURNSTILE_TOKEN: "请完成人机验证后重试。",
  INVALID_CURSOR: "分页参数无效。",
  RATE_LIMITED: "生成太频繁，请一分钟后重试。",
  TURNSTILE_FAILED: "人机验证未通过，请重新验证。",
  CODE_ALLOCATION_FAILED: "短码暂时无法分配，请稍后重试。",
  SERVER_NOT_CONFIGURED: "服务暂时不可用。",
  FORBIDDEN: "管理员登录已失效，请刷新页面重新登录。",
  BAD_ORIGIN: "请求来源不符合要求。",
  EXPIRED: "短链已经过期。",
};

function jsonError(code: string, status: number) {
  return Response.json({ error: code, message: errorMessages[code] ?? "请求未能完成，请重试。" }, { status });
}

function publicOrigin(env: Env): string | null {
  try {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (!url.hostname || !["http:", "https:"].includes(url.protocol) || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function readJson(request: Request, maxBytes = 4096): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("INVALID_BODY");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error("INVALID_BODY");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("INVALID_BODY");
  }
}

async function verifyTurnstile(token: string, env: Env, request: Request, origin: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return false;
  const expectedHost = new URL(origin).hostname;
  const local = expectedHost === "localhost" || expectedHost === "127.0.0.1";
  const testMode = local && env.TURNSTILE_SITE_KEY === "1x00000000000000000000AA" &&
    env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA";
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    if (!result.success || (result.action !== "create_link" && !(testMode && result.action === "test"))) return false;
    if (!local && result.hostname !== expectedHost) return false;
    return true;
  } catch {
    return false;
  }
}

async function serveApp(request: Request, env: Env): Promise<Response> {
  return env.ASSETS.fetch(request);
}

app.get("/", (c) => serveApp(c.req.raw, c.env));

app.get("/api/config", (c) => c.json({ siteKey: c.env.TURNSTILE_SITE_KEY }, 200, {
  "Cache-Control": "no-store",
}));

app.post("/api/links", async (c) => {
  const origin = publicOrigin(c.env);
  if (!origin) return jsonError("SERVER_NOT_CONFIGURED", 503);
  if (new URL(c.req.url).origin !== origin) return jsonError("SERVER_NOT_CONFIGURED", 503);
  const local = ["127.0.0.1", "localhost"].includes(new URL(origin).hostname);
  if (!local && (c.env.TURNSTILE_SITE_KEY === "1x00000000000000000000AA" ||
    c.env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA")) {
    return jsonError("SERVER_NOT_CONFIGURED", 503);
  }
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const rate = await c.env.CREATE_RATE_LIMITER.limit({ key: ip });
  if (!rate.success) return jsonError("RATE_LIMITED", 429);

  let input: ReturnType<typeof parseCreateInput>;
  try {
    input = parseCreateInput(await readJson(c.req.raw), origin);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "INVALID_BODY", 400);
  }
  if (!await verifyTurnstile(input.turnstileToken, c.env, c.req.raw, origin)) {
    return jsonError("TURNSTILE_FAILED", 400);
  }

  const now = Date.now();
  const expiresAt = expiresAtFor(input.days, now);
  const code = await allocateCode(async (candidate) => {
    const result = await c.env.LINKS_DB.prepare(
      "INSERT INTO links (code, target_url, created_at, expires_at, disabled_at) VALUES (?, ?, ?, ?, NULL) ON CONFLICT(code) DO NOTHING",
    ).bind(candidate, input.targetUrl, now, expiresAt).run();
    return result.meta.changes === 1;
  }, makeCode);
  if (code) return c.json({ code, shortUrl: `${origin}/${code}`, expiresAt: new Date(expiresAt).toISOString() }, 201, {
    "Cache-Control": "no-store",
  });
  return jsonError("CODE_ALLOCATION_FAILED", 503);
});

app.use("/admin", async (c, next) => {
  if (!await verifyAccess(c.req.raw, c.env)) return jsonError("FORBIDDEN", 403);
  await next();
});
app.use("/admin/*", async (c, next) => {
  if (!await verifyAccess(c.req.raw, c.env)) return jsonError("FORBIDDEN", 403);
  await next();
});

app.get("/admin", (c) => serveApp(c.req.raw, c.env));

app.get("/admin/api/links", async (c) => {
  const query = (c.req.query("query") ?? "").trim();
  const status = c.req.query("status") ?? "all";
  if (query.length > 100 || !["all", "active", "disabled", "expired"].includes(status)) {
    return jsonError("INVALID_FILTER", 400);
  }
  let cursor: ReturnType<typeof parseCursor>;
  try {
    cursor = parseCursor(c.req.query("cursor"));
  } catch {
    return jsonError("INVALID_CURSOR", 400);
  }
  const now = Date.now();
  const search = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await c.env.LINKS_DB.prepare(`
    SELECT code, target_url, created_at, expires_at, disabled_at FROM links
    WHERE (? = '' OR code LIKE ? ESCAPE '\\' OR target_url LIKE ? ESCAPE '\\')
      AND (? = 'all' OR (? = 'active' AND expires_at > ? AND disabled_at IS NULL)
        OR (? = 'disabled' AND expires_at > ? AND disabled_at IS NOT NULL)
        OR (? = 'expired' AND expires_at <= ?))
      AND (? IS NULL OR created_at < ? OR (created_at = ? AND code < ?))
    ORDER BY created_at DESC, code DESC LIMIT 31
  `).bind(
    query, search, search,
    status, status, now, status, now, status, now,
    cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.code ?? null,
  ).all<LinkRecord>();
  const page = rows.results.slice(0, 30);
  const items = page.map((row) => ({
    code: row.code,
    targetUrl: row.target_url,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    status: getStatus(row, now),
  }));
  return c.json({ items, nextCursor: rows.results.length > 30 ? formatCursor(page[page.length - 1]) : null }, 200, {
    "Cache-Control": "no-store",
  });
});

function hasValidOrigin(request: Request, env: Env): boolean {
  const origin = publicOrigin(env);
  return !!origin && request.headers.get("origin") === origin;
}

app.patch("/admin/api/links/:code", async (c) => {
  if (!hasValidOrigin(c.req.raw, c.env)) return jsonError("BAD_ORIGIN", 403);
  const code = c.req.param("code");
  if (!isCode(code)) return jsonError("NOT_FOUND", 404);
  let body: unknown;
  try {
    body = await readJson(c.req.raw);
  } catch {
    return jsonError("INVALID_BODY", 400);
  }
  if (!body || typeof body !== "object" || !Object.hasOwn(body, "disabled") || typeof (body as { disabled?: unknown }).disabled !== "boolean") {
    return jsonError("INVALID_BODY", 400);
  }
  const disabled = (body as { disabled: boolean }).disabled;
  const existing = await c.env.LINKS_DB.prepare("SELECT * FROM links WHERE code = ?").bind(code).first<LinkRecord>();
  if (!existing) return jsonError("NOT_FOUND", 404);
  if (existing.expires_at <= Date.now()) return jsonError("EXPIRED", 409);
  await c.env.LINKS_DB.prepare("UPDATE links SET disabled_at = ? WHERE code = ?")
    .bind(disabled ? Date.now() : null, code).run();
  return c.json({ code, status: disabled ? "disabled" : "active" }, 200, { "Cache-Control": "no-store" });
});

app.delete("/admin/api/links/:code", async (c) => {
  if (!hasValidOrigin(c.req.raw, c.env)) return jsonError("BAD_ORIGIN", 403);
  const code = c.req.param("code");
  if (!isCode(code)) return jsonError("NOT_FOUND", 404);
  const result = await c.env.LINKS_DB.prepare("DELETE FROM links WHERE code = ?").bind(code).run();
  return result.meta.changes === 0 ? jsonError("NOT_FOUND", 404) : new Response(null, { status: 204 });
});

app.get("/:code", async (c) => {
  const code = c.req.param("code");
  if (!isCode(code)) return c.env.ASSETS.fetch(c.req.raw);
  const row = await c.env.LINKS_DB.prepare(
    "SELECT code, target_url, created_at, expires_at, disabled_at FROM links WHERE code = ?",
  ).bind(code).first<LinkRecord>();
  if (!row || getStatus(row) !== "active") return new Response("链接不存在或已失效。", {
    status: 404,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
  return new Response(null, {
    status: 302,
    headers: { Location: row.target_url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
});

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error) => {
  console.error(JSON.stringify({ event: "request_error", message: error.message }));
  return jsonError("INTERNAL_ERROR", 503);
});

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller, env) {
    const result = await env.LINKS_DB.prepare("DELETE FROM links WHERE expires_at <= ?").bind(Date.now()).run();
    console.log(JSON.stringify({ event: "expired_links_deleted", count: result.meta.changes }));
  },
} satisfies ExportedHandler<Env>;
