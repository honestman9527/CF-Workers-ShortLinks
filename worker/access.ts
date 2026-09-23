import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAccess(request: Request, env: Env): Promise<boolean> {
  const hostname = new URL(request.url).hostname;
  const localBypass = (hostname === "localhost" || hostname === "127.0.0.1") &&
    env.LOCAL_ADMIN_BYPASS === "true";
  if (localBypass) return true;

  const token = request.headers.get("cf-access-jwt-assertion");
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!token || !teamDomain || !audience) return false;

  let teamUrl: URL;
  try {
    teamUrl = new URL(teamDomain);
  } catch {
    return false;
  }
  if (teamUrl.protocol !== "https:" || !teamUrl.hostname.endsWith(".cloudflareaccess.com")) return false;
  const issuer = teamUrl.origin;
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    jwksCache.set(issuer, jwks);
  }

  try {
    await jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256"] });
    return true;
  } catch {
    return false;
  }
}
