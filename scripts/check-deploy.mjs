import { existsSync, readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`部署检查失败：${message}`); };

if (existsSync(new URL("../.dev.vars", import.meta.url))) {
  fail("请先移走本地 .dev.vars，避免将测试密钥带入部署构建。");
}

let origin;
try { origin = new URL(config.vars.PUBLIC_ORIGIN); } catch { fail("PUBLIC_ORIGIN 必须是有效 URL。"); }
if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
  fail("PUBLIC_ORIGIN 必须是无路径的 HTTPS 域名。");
}
if (config.workers_dev !== false) fail("workers_dev 必须保持 false。");
if (!config.routes?.some((route) => route.pattern === origin.hostname && route.custom_domain === true)) {
  fail("请在 routes 中配置与 PUBLIC_ORIGIN 一致的自定义域名。");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.d1_databases?.[0]?.database_id ?? "")) {
  fail("请填写真实的 D1 database_id。");
}
if (!config.vars.TURNSTILE_SITE_KEY || config.vars.TURNSTILE_SITE_KEY === "1x00000000000000000000AA") {
  fail("请配置正式 Turnstile 站点密钥。");
}

console.log(`部署配置检查通过：${origin.origin}`);
