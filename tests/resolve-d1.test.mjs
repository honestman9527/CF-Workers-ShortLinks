import { describe, expect, it, vi } from "vitest";
import { resolveD1Id } from "../scripts/resolve-d1.mjs";

const databaseId = "12345678-1234-1234-1234-123456789abc";
const input = {
  accountId: "a".repeat(32),
  apiToken: "test-token",
  name: "shortlived-links",
};

describe("D1 name lookup", () => {
  it("resolves only the exact existing name", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      success: true,
      result: [
        { name: "shortlived-links-copy", uuid: "different" },
        { name: "shortlived-links", uuid: databaseId },
      ],
    }));

    await expect(resolveD1Id({ ...input, fetchImpl })).resolves.toBe(databaseId);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url.searchParams.get("name")).toBe(input.name);
    expect(options.headers.Authorization).toBe("Bearer test-token");
  });

  it("fails closed when the name is absent or ambiguous", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true, result: [] }));
    await expect(resolveD1Id({ ...input, fetchImpl })).rejects.toThrow("未找到");

    fetchImpl.mockImplementation(async () => Response.json({
      success: true,
      result: [
        { name: input.name, uuid: databaseId },
        { name: input.name, uuid: "87654321-1234-1234-1234-123456789abc" },
      ],
    }));
    await expect(resolveD1Id({ ...input, fetchImpl })).rejects.toThrow("多个");
  });

  it("stops on an API error", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(resolveD1Id({ ...input, fetchImpl })).rejects.toThrow("HTTP 403");
  });

  it("rejects a malformed database ID returned by Cloudflare", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      success: true,
      result: [{ name: input.name, uuid: "invalid" }],
    }));
    await expect(resolveD1Id({ ...input, fetchImpl })).rejects.toThrow("database_id 无效");
  });
});
