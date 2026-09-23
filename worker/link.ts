export const LINK_DAYS = [1, 3, 7] as const;
export type LinkDays = (typeof LINK_DAYS)[number];

const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LENGTH = 8;
const DAY_MS = 86_400_000;
const MAX_URL_LENGTH = 2048;

export type LinkRecord = {
  code: string;
  target_url: string;
  created_at: number;
  expires_at: number;
  disabled_at: number | null;
};

export type LinkStatus = "active" | "disabled" | "expired";

export function getStatus(link: LinkRecord, now = Date.now()): LinkStatus {
  if (link.expires_at <= now) return "expired";
  if (link.disabled_at !== null) return "disabled";
  return "active";
}

export function expiresAtFor(days: number, now: number): number {
  if (!LINK_DAYS.includes(days as LinkDays)) throw new Error("INVALID_DAYS");
  return now + days * DAY_MS;
}

export function makeCode(randomBytes = crypto.getRandomValues(new Uint8Array(32))): string {
  let code = "";
  for (const byte of randomBytes) {
    // Rejection sampling avoids favoring the first eight characters.
    if (byte >= 248) continue;
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    if (code.length === CODE_LENGTH) return code;
  }
  return code + makeCode().slice(0, CODE_LENGTH - code.length);
}

export async function allocateCode(
  insert: (code: string) => Promise<boolean>,
  generate: () => string = makeCode,
  attempts = 6,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const code = generate();
    if (await insert(code)) return code;
  }
  return null;
}

function isBlockedHostname(hostname: string, ownHostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === ownHostname || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  // Public links should point at DNS names, not IP literals or numeric host aliases.
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return true;
  return !host.includes(".");
}

export function parseTargetUrl(input: unknown, publicOrigin: string): string {
  if (typeof input !== "string") throw new Error("INVALID_URL");
  const value = input.trim();
  if (value.length === 0 || value.length > MAX_URL_LENGTH) throw new Error("INVALID_URL");

  let target: URL;
  let ownHost: string;
  try {
    target = new URL(value);
    ownHost = new URL(publicOrigin).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error("INVALID_URL");
  }
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    isBlockedHostname(target.hostname, ownHost)
  ) {
    throw new Error("INVALID_URL");
  }
  return target.toString();
}

export function parseCreateInput(value: unknown, publicOrigin: string): {
  targetUrl: string;
  days: LinkDays;
  turnstileToken: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BODY");
  const body = value as Record<string, unknown>;
  const days = body.days;
  if (typeof days !== "number" || !LINK_DAYS.includes(days as LinkDays)) throw new Error("INVALID_DAYS");
  if (typeof body.turnstileToken !== "string" || body.turnstileToken.length < 1 || body.turnstileToken.length > 2048) {
    throw new Error("INVALID_TURNSTILE_TOKEN");
  }
  return {
    targetUrl: parseTargetUrl(body.url, publicOrigin),
    days: days as LinkDays,
    turnstileToken: body.turnstileToken,
  };
}

export function isCode(value: string): boolean {
  return /^[0-9A-Za-z]{8}$/.test(value);
}

export function parseCursor(value: string | undefined): { createdAt: number; code: string } | null {
  if (!value) return null;
  const match = /^(\d{13})_([0-9A-Za-z]{8})$/.exec(value);
  if (!match) throw new Error("INVALID_CURSOR");
  return { createdAt: Number(match[1]), code: match[2] };
}

export function formatCursor(link: LinkRecord): string {
  return `${link.created_at}_${link.code}`;
}
