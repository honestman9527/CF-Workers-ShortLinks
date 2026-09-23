import { describe, expect, it, vi } from "vitest";
import { ensureD1Id } from "../scripts/resolve-d1.mjs";

const databaseId = "12345678-1234-1234-1234-123456789abc";
const input = {
  accountId: "a".repeat(32),
  apiToken: "test-token",
  name: "shortlived-links",
};

describe("D1 name lookup and creation", () => {
  it("reuses only the exact existing name", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      success: true,
      result: [
        { name: "shortlived-links-copy", uuid: "different" },
        { name: input.name, uuid: databaseId },
      ],
    }));

    await expect(ensureD1Id({ ...input, fetchImpl })).resolves.toEqual({ id: databaseId, created: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url.searchParams.get("name")).toBe(input.name);
    expect(options.headers.Authorization).toBe("Bearer test-token");
  });

  it("creates a missing database in the configured account", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, result: [] }))
      .mockResolvedValueOnce(Response.json({
        success: true,
        result: { name: input.name, uuid: databaseId },
      }));

    await expect(ensureD1Id({ ...input, fetchImpl })).resolves.toEqual({ id: databaseId, created: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, options] = fetchImpl.mock.calls[1];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/d1/database`);
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ name: input.name });
  });

  it("fails closed if the name is ambiguous", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      success: true,
      result: [
        { name: input.name, uuid: databaseId },
        { name: input.name, uuid: "87654321-1234-1234-1234-123456789abc" },
      ],
    }));
    await expect(ensureD1Id({ ...input, fetchImpl })).rejects.toThrow("多个");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops on a lookup API error", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(ensureD1Id({ ...input, fetchImpl })).rejects.toThrow("HTTP 403");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed database ID returned by Cloudflare", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      success: true,
      result: [{ name: input.name, uuid: "invalid" }],
    }));
    await expect(ensureD1Id({ ...input, fetchImpl })).rejects.toThrow("database_id 无效");
  });

  it("uses a database created by another deployment after a create conflict", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, result: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({
        success: true,
        result: [{ name: input.name, uuid: databaseId }],
      }));
    await expect(ensureD1Id({ ...input, fetchImpl })).resolves.toEqual({ id: databaseId, created: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reports a failed create when the database remains absent", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, result: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ success: true, result: [] }));
    await expect(ensureD1Id({ ...input, fetchImpl })).rejects.toThrow("D1 Write");
  });

  it("accepts a valid created ID when Cloudflare omits the optional name", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, result: [] }))
      .mockResolvedValueOnce(Response.json({ success: true, result: { uuid: databaseId } }));
    await expect(ensureD1Id({ ...input, fetchImpl })).resolves.toEqual({ id: databaseId, created: true });
  });

  it("rejects a malformed create response", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, result: [] }))
      .mockResolvedValueOnce(Response.json({ success: true, result: { name: input.name, uuid: "invalid" } }));
    await expect(ensureD1Id({ ...input, fetchImpl })).rejects.toThrow("无效的 D1 数据库创建结果");
  });
});
