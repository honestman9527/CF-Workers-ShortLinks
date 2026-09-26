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
pnpm build
pnpm dev
```

打开 `http://127.0.0.1:5173/`。`pnpm dev` 使用 Wrangler 提供 Worker 和本地服务，前端资源读取 `dist/client`；首次启动及修改前端后先运行 `pnpm build` 更新资源。`.dev.vars.example` 使用 Cloudflare 官方测试用 Turnstile 密钥；`LOCAL_ADMIN_BYPASS=true` 只会在请求主机为 `localhost` 或 `127.0.0.1` 时生效，供本地查看 `/admin`。`.dev.vars` 已加入 `.gitignore`。本地测试密钥会显示测试提示，正式部署必须换成真实密钥。

运行验证：

```powershell
pnpm test
pnpm typecheck
pnpm build
```

## 部署到 Cloudflare

部署前需要一个已接入 Cloudflare 的域名，例如 `s.example.com`。Turnstile 小组件和 Access 应用需先创建；部署脚本会复用或自动创建 D1。

1. D1 默认使用 `wrangler.jsonc` 中的名称 `shortlived-links`；如果使用其他名称，可在部署时设置 `D1_DATABASE_NAME`。部署脚本会在目标账户中复用同名数据库，找不到时自动创建，无需填写数据库 ID。若需要指定 D1 的主位置或数据驻留范围，请提前手动创建同名数据库，脚本会复用它。
2. 设置 `PUBLIC_ORIGIN` 为自定义域名（如 `https://s.example.com`），并设置正式的 `TURNSTILE_SITE_KEY`。自动部署使用下文的 GitHub Variables；手动部署使用同名环境变量。部署脚本会填写 `wrangler.jsonc` 中的域名、站点密钥和自定义域名路由。保持 `workers_dev: false`，以免产生未受域名 Access 策略保护的公开入口。短链以 `PUBLIC_ORIGIN` 为准，配置错误时创建接口会拒绝请求。
3. 在 Turnstile 中创建限制到 `s.example.com` 的小组件，保存私有密钥。公开页面使用 `create_link` action，Worker 会验证 action 和 hostname。
4. 在 Cloudflare Zero Trust 创建 self-hosted Access 应用，路径设置为 `s.example.com/admin*`，Allow 策略仅包含指定管理员邮箱。复制应用的 AUD 与团队域名（如 `https://team.cloudflareaccess.com`）。上线后分别访问 `/admin` 和 `/admin/api/links`，确认两者均被 Access 保护。
5. 设置 Worker 密钥。`LOCAL_ADMIN_BYPASS` 在生产环境必须设置为 `false`：

   ```powershell
   pnpm wrangler secret put TURNSTILE_SECRET_KEY
   pnpm wrangler secret put ACCESS_AUD
   pnpm wrangler secret put ACCESS_TEAM_DOMAIN
   pnpm wrangler secret put LOCAL_ADMIN_BYPASS
   ```

6. 手动部署时，先设置 `PUBLIC_ORIGIN`、`TURNSTILE_SITE_KEY`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` 环境变量；使用其他数据库名时再设置 `D1_DATABASE_NAME`。运行 `node scripts/configure-deploy.mjs`，让脚本查找或创建 D1 并生成部署配置。暂时移走本地 `.dev.vars`，再执行 `pnpm cf:typegen`、`pnpm db:migrate:remote`、`pnpm deploy`。部署脚本会检查真实域名、D1 绑定和正式 Turnstile 站点密钥。上线后确认公开页生成、短链跳转、后台登录、停用后立即返回 `404`，以及 Cron 正常清理。

不要把 `.dev.vars`、真实 Turnstile 私钥或 Access 信息提交到仓库。部署时请使用真实 Turnstile 密钥；Worker 对非本地主机拒绝官方测试站点密钥。

### GitHub Actions 自动部署

仓库的 [部署工作流](.github/workflows/deploy.yml) 会在推送到 `master` 后先运行测试和类型检查，再创建或复用 D1、构建、执行远程迁移并部署 Worker。Pull Request 只运行验证；也可在 `master` 上手动触发工作流。首次启用前，先按上文创建 Turnstile 小组件及保护 `/admin*` 的 Access 应用。

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中设置：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | 部署目标的 Cloudflare Account ID |
| Secret | `CLOUDFLARE_API_TOKEN` | 限定到该账户和域名的部署 API Token |
| Secret | `TURNSTILE_SECRET_KEY` | 正式 Turnstile 私钥 |
| Secret | `ACCESS_AUD` | Access 应用的 AUD |
| Secret | `ACCESS_TEAM_DOMAIN` | 如 `https://team.cloudflareaccess.com` |
| Variable | `PUBLIC_ORIGIN` | 如 `https://s.example.com`，不要以 `/` 结尾 |
| Variable（可选） | `D1_DATABASE_NAME` | 要复用或创建的 D1 数据库名称；默认使用 `wrangler.jsonc` 中的 `shortlived-links` |
| Variable | `TURNSTILE_SITE_KEY` | 正式 Turnstile 站点密钥 |

API Token 可从 Cloudflare 的 **Edit Cloudflare Workers** 模板创建；因为工作流会查询或创建 D1、执行迁移和首次绑定自定义域名，需补充目标账户的 **D1 Write** 权限和目标 Zone 的 Workers Routes 写权限。尽量只授权本项目使用的账户和 Zone。核对 `CLOUDFLARE_ACCOUNT_ID`，自动创建会发生在这个账户中。Account ID 与 API Token 都不写入 `wrangler.jsonc`。工作流默认查询 `shortlived-links`，设置 `D1_DATABASE_NAME` 时则查询指定名称；找到唯一同名数据库便复用，找不到便创建，然后把 UUID 写入临时检出的 Wrangler 配置。随后通过 `wrangler deploy --secrets-file` 上传 Worker 密钥；`LOCAL_ADMIN_BYPASS` 固定为 `false`。

配置完成后，推送到 `master` 即触发自动部署。首次运行后检查 Actions 日志、公开页、短链跳转和 `/admin` 的 Access 登录。缺少任一必填配置时工作流会失败，不会使用仓库中的本地测试值部署。

## 行为与边界

- 1、3、7 天分别是生成起的 24、72、168 小时，不按自然日计算。
- 到期瞬间停止跳转；D1 中过期记录可能额外保留不到 15 分钟，待下一次 Cron 删除。停用记录也在原到期时间清理。
- 不记录访问次数或创建者 IP。限流使用 Cloudflare Workers Rate Limiting，它按 Cloudflare 节点工作，属于防刷措施而非全局精确配额。
- 只接受 HTTP/HTTPS 目标，拒绝带账号密码、IP 地址、本机域名和服务自身域名的 URL。创建接口不抓取目标页面。
