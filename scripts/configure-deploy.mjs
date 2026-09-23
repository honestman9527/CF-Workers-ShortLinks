import { readFileSync, writeFileSync } from "node:fs";
import { resolveD1Id } from "./resolve-d1.mjs";

const configPath = process.argv[2] ?? new URL("../wrangler.jsonc", import.meta.url);
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少部署变量 ${name}。`);
  return value;
};

const origin = required("PUBLIC_ORIGIN");
const databaseName = required("D1_DATABASE_NAME");
const optionalDatabaseId = process.env.D1_DATABASE_ID?.trim();
const siteKey = required("TURNSTILE_SITE_KEY");
const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const apiToken = required("CLOUDFLARE_API_TOKEN");
const url = new URL(origin);

if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.port) {
  throw new Error("PUBLIC_ORIGIN 必须是无路径、端口和凭据的 HTTPS 域名。");
}
if (!/^[0-9a-f]{32}$/i.test(accountId)) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID 必须是 32 位账户 ID。");
}
if (optionalDatabaseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(optionalDatabaseId)) {
  throw new Error("可选的 D1_DATABASE_ID 必须是 D1 数据库 UUID。");
}
if (siteKey === "1x00000000000000000000AA") {
  throw new Error("TURNSTILE_SITE_KEY 不能使用测试密钥。");
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const databaseId = await resolveD1Id({ accountId, apiToken, name: databaseName, expectedId: optionalDatabaseId });
config.vars.PUBLIC_ORIGIN = origin;
config.vars.TURNSTILE_SITE_KEY = siteKey;
config.d1_databases[0].database_name = databaseName;
config.d1_databases[0].database_id = databaseId;
config.routes = [{ pattern: url.hostname, custom_domain: true }];
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
