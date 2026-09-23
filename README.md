# 短时链

一个公开使用的临时短链服务。用户无需注册，只能选择 1、3 或 7 天；到期立即停止跳转，D1 记录由每 15 分钟运行的 Cron 清理。后台使用 Cloudflare Access，不提供普通用户账号、访问次数统计或自定义短码。

## 技术结构

- pnpm 12、React 19、Vite、shadcn/ui 风格组件与 Tailwind CSS 4
- TypeScript + Hono Worker，使用 Cloudflare Vite 插件将前端和 Worker 一起部署
- D1 存储，Workers Rate Limiting 限速，Turnstile 保护公开创建接口
- Cloudflare Access 保护 `/admin`；Worker 还会验证 Access JWT

公开接口：

| 请求 | 作用 |
| --- | --- |
| `POST /api/links` | 接收 `{ "url": "https://…", "days": 1\|3\|7, "turnstileToken": "…" }`，返回 `code`、`shortUrl`、`expiresAt` |
| `GET /<8位短码>` | 有效时 `302` 跳转；停用、过期或不存在时 `404` |

管理接口位于 `/admin/api/links`，提供分页查询、`PATCH /:code` 停用或恢复、`DELETE /:code` 删除。所有管理请求必须有有效 Access JWT；写操作还必须来自 `PUBLIC_ORIGIN`。

## 本地运行

需要 Node.js 24 与 pnpm 12。仓库的 `pnpm-workspace.yaml` 只允许 esbuild 和 workerd 运行安装脚本。

```powershell
pnpm install
Copy-Item .dev.vars.example .dev.vars
pnpm cf:typegen
pnpm db:migrate:local
pnpm dev
```

打开 `http://127.0.0.1:5173/`。`.dev.vars.example` 使用 Cloudflare 官方测试用 Turnstile 密钥；`LOCAL_ADMIN_BYPASS=true` 只会在请求主机为 `localhost` 或 `127.0.0.1` 时生效，供本地查看 `/admin`。`.dev.vars` 已加入 `.gitignore`。本地测试密钥会显示测试提示，正式部署必须换成真实密钥。

运行验证：

```powershell
pnpm test
pnpm typecheck
pnpm build
```

## 部署到 Cloudflare

本项目**不会自动创建账户资源或部署**。部署前需要一个已接入 Cloudflare 的域名，例如 `s.example.com`。

1. 创建 D1：`pnpm wrangler d1 create shortlived-links`。将输出的数据库 ID 填入 `wrangler.jsonc` 的 `database_id`。
2. 在 `wrangler.jsonc` 中将 `PUBLIC_ORIGIN` 改成 `https://s.example.com`，将 `TURNSTILE_SITE_KEY` 改成真实站点密钥，并添加自定义域名：

   ```jsonc
   "routes": [{ "pattern": "s.example.com", "custom_domain": true }]
   ```

   保持 `workers_dev: false`，以免产生未受域名 Access 策略保护的公开入口。短链以 `PUBLIC_ORIGIN` 为准，配置错误时创建接口会拒绝请求。
3. 在 Turnstile 中创建限制到 `s.example.com` 的小组件，保存私有密钥。公开页面使用 `create_link` action，Worker 会验证 action 和 hostname。
4. 在 Cloudflare Zero Trust 创建 self-hosted Access 应用，路径设置为 `s.example.com/admin*`，Allow 策略仅包含指定管理员邮箱。复制应用的 AUD 与团队域名（如 `https://team.cloudflareaccess.com`）。上线后分别访问 `/admin` 和 `/admin/api/links`，确认两者均被 Access 保护。
5. 设置 Worker 密钥。`LOCAL_ADMIN_BYPASS` 在生产环境必须设置为 `false`：

   ```powershell
   pnpm wrangler secret put TURNSTILE_SECRET_KEY
   pnpm wrangler secret put ACCESS_AUD
   pnpm wrangler secret put ACCESS_TEAM_DOMAIN
   pnpm wrangler secret put LOCAL_ADMIN_BYPASS
   ```

6. 暂时移走本地 `.dev.vars`，再执行 `pnpm cf:typegen`、`pnpm db:migrate:remote`、`pnpm deploy`。部署脚本会检查真实域名、D1 ID 和正式 Turnstile 站点密钥。上线后确认公开页生成、短链跳转、后台登录、停用后立即返回 `404`，以及 Cron 正常清理。

不要把 `.dev.vars`、真实 Turnstile 私钥或 Access 信息提交到仓库。部署时请使用真实 Turnstile 密钥；Worker 对非本地主机拒绝官方测试站点密钥。

## 行为与边界

- 1、3、7 天分别是生成起的 24、72、168 小时，不按自然日计算。
- 到期瞬间停止跳转；D1 中过期记录可能额外保留不到 15 分钟，待下一次 Cron 删除。停用记录也在原到期时间清理。
- 不记录访问次数或创建者 IP。限流使用 Cloudflare Workers Rate Limiting，它按 Cloudflare 节点工作，属于防刷措施而非全局精确配额。
- 只接受 HTTP/HTTPS 目标，拒绝带账号密码、IP 地址、本机域名和服务自身域名的 URL。创建接口不抓取目标页面。
