import { writeFileSync } from "node:fs";

const output = process.argv[2];
if (!output) throw new Error("请指定 Worker 密钥文件路径。");

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少部署密钥 ${name}。`);
  return value;
};

const secrets = {
  TURNSTILE_SECRET_KEY: required("TURNSTILE_SECRET_KEY"),
  ACCESS_AUD: required("ACCESS_AUD"),
  ACCESS_TEAM_DOMAIN: required("ACCESS_TEAM_DOMAIN"),
  LOCAL_ADMIN_BYPASS: "false",
};

if (secrets.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA") {
  throw new Error("TURNSTILE_SECRET_KEY 不能使用测试密钥。");
}
const teamDomain = new URL(secrets.ACCESS_TEAM_DOMAIN);
if (teamDomain.protocol !== "https:" || teamDomain.origin !== secrets.ACCESS_TEAM_DOMAIN) {
  throw new Error("ACCESS_TEAM_DOMAIN 必须是无路径的 HTTPS 域名。");
}

writeFileSync(output, `${JSON.stringify(secrets)}\n`, { mode: 0o600, flag: "wx" });
