import { describe, expect, it } from "vitest";
import {
  allocateCode,
  expiresAtFor,
  getStatus,
  isCode,
  makeCode,
  parseCreateInput,
  parseCursor,
  parseTargetUrl,
  type LinkRecord,
} from "../worker/link";

const origin = "https://s.example.com";

describe("temporary links", () => {
  it("allows only the three exact 24-hour durations", () => {
    const now = Date.UTC(2026, 8, 23, 12);
    expect(expiresAtFor(1, now)).toBe(now + 86_400_000);
    expect(expiresAtFor(3, now)).toBe(now + 3 * 86_400_000);
    expect(expiresAtFor(7, now)).toBe(now + 7 * 86_400_000);
    expect(() => expiresAtFor(2, now)).toThrow("INVALID_DAYS");
  });

  it("rejects unsafe or unusable target URLs", () => {
    for (const target of [
      "javascript:alert(1)", "ftp://example.com", "https://user:pass@example.com",
      "http://localhost", "https://app.local", "http://127.0.0.1", "http://[::1]",
      "https://s.example.com/loop", "https://intranet", "x".repeat(2049),
    ]) {
      expect(() => parseTargetUrl(target, origin), target).toThrow("INVALID_URL");
    }
    expect(parseTargetUrl("  https://example.com/a?q=1  ", origin)).toBe("https://example.com/a?q=1");
  });

  it("validates creation fields and cursor shape", () => {
    expect(parseCreateInput({ url: "https://example.com", days: 3, turnstileToken: "token" }, origin).days).toBe(3);
    expect(() => parseCreateInput({ url: "https://example.com", days: 2, turnstileToken: "token" }, origin)).toThrow("INVALID_DAYS");
    expect(() => parseCreateInput({ url: "https://example.com", days: 3, turnstileToken: "" }, origin)).toThrow("INVALID_TURNSTILE_TOKEN");
    expect(parseCursor("1790150400000_Ab34Cd56")).toEqual({ createdAt: 1790150400000, code: "Ab34Cd56" });
    expect(() => parseCursor("bad")).toThrow("INVALID_CURSOR");
  });

  it("generates valid codes and retries a collision", async () => {
    expect(isCode(makeCode())).toBe(true);
    const codes = ["AAAAAAAA", "BBBBBBBB"];
    const seen: string[] = [];
    const result = await allocateCode(async (code) => {
      seen.push(code);
      return code === "BBBBBBBB";
    }, () => codes.shift()!);
    expect(result).toBe("BBBBBBBB");
    expect(seen).toEqual(["AAAAAAAA", "BBBBBBBB"]);
  });

  it("never treats a disabled or expired record as active", () => {
    const now = 100_000;
    const row: LinkRecord = { code: "Ab34Cd56", target_url: "https://example.com", created_at: 1, expires_at: now + 1, disabled_at: null };
    expect(getStatus(row, now)).toBe("active");
    expect(getStatus({ ...row, disabled_at: now }, now)).toBe("disabled");
    expect(getStatus(row, now + 1)).toBe("expired");
  });
});
