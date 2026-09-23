import { readFileSync, writeFileSync } from "node:fs";
import { ensureD1Id } from "./resolve-d1.mjs";

const configPath = process.argv[2] ?? new URL("../wrangler.jsonc", import.meta.url);
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少部署变量 ${name}。`);
  return value;
};

const origin = required("PUBLIC_ORIGIN");
const siteKey = required("TURNSTILE_SITE_KEY");
const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const apiToken = required("CLOUDFLARE_API_TOKEN");
const url = new URL(origin);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const configuredName = config.d1_databases?.[0]?.database_name;
const databaseName = process.env.D1_DATABASE_NAME?.trim()
  || (typeof configuredName === "string" ? configuredName.trim() : "");

if (!databaseName) {
  throw new Error("缺少 D1 数据库名称；请在 wrangler.jsonc 中设置 database_name，或设置 D1_DATABASE_NAME。");
}

if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.port) {
  throw new Error("PUBLIC_ORIGIN 必须是无路径、端口和凭据的 HTTPS 域名。");
}
if (!/^[0-9a-f]{32}$/i.test(accountId)) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID 必须是 32 位账户 ID。");
}
if (siteKey === "1x00000000000000000000AA") {
  throw new Error("TURNSTILE_SITE_KEY 不能使用测试密钥。");
}

const database = await ensureD1Id({ accountId, apiToken, name: databaseName });
config.vars.PUBLIC_ORIGIN = origin;
config.vars.TURNSTILE_SITE_KEY = siteKey;
config.d1_databases[0].database_name = databaseName;
config.d1_databases[0].database_id = database.id;
config.routes = [{ pattern: url.hostname, custom_domain: true }];
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`D1 数据库 ${databaseName} ${database.created ? "已创建" : "已存在"}。`);
