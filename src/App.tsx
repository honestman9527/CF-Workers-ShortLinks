import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, Link2, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Turnstile } from "./turnstile";

type Days = 1 | 3 | 7;
type CreatedLink = { code: string; shortUrl: string; expiresAt: string };
type AdminLink = {
  code: string;
  targetUrl: string;
  createdAt: string;
  expiresAt: string;
  status: "active" | "disabled" | "expired";
};
type AdminList = { items: AdminLink[]; nextCursor: string | null };

const days: Days[] = [1, 3, 7];
const statusLabels = { active: "生效中", disabled: "已停用", expired: "已过期" };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

async function messageFromResponse(response: Response): Promise<string> {
  if (response.status === 403) return "管理员登录已失效，请刷新页面重新登录。";
  try {
    const data = await response.json() as { message?: string; error?: string };
    if (data.message) return data.message;
    if (data.error === "RATE_LIMITED") return "生成太频繁，请一分钟后重试。";
    if (data.error === "TURNSTILE_FAILED") return "人机验证未通过，请重新验证。";
  } catch { /* Cloudflare Access may return an HTML sign-in page. */ }
  return "请求未能完成，请稍后重试。";
}

function Brand({ admin = false }: { admin?: boolean }) {
  return <header className="site-header">
    <a className="brand" href="/" aria-label="短时链首页">
      <span className="brand-mark"><Link2 size={20} strokeWidth={2.5} /></span>
      <span>短时链</span>
    </a>
    <span className="header-context">{admin ? "管理后台" : "限时分享，过期即止"}</span>
  </header>;
}

function PublicPage() {
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState<Days>(3);
  const [siteKey, setSiteKey] = useState("");
  const [configError, setConfigError] = useState(false);
  const [verificationError, setVerificationError] = useState(false);
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const onToken = useCallback((value: string) => {
    setToken(value);
    if (value) setError("");
  }, []);
  const onVerificationFailure = useCallback((failed: boolean) => setVerificationError(failed), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{ siteKey: string }>;
      })
      .then((config) => {
        if (!config.siteKey) throw new Error("Missing Turnstile site key");
        setSiteKey(config.siteKey);
      })
      .catch((reason) => { if (reason?.name !== "AbortError") setConfigError(true); });
    return () => controller.abort();
  }, []);

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) { setError("请先完成人机验证。"); return; }
    setLoading(true);
    setError("");
    setResult(null);
    setCopied(false);
    try {
      const response = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, days: duration, turnstileToken: token }),
      });
      if (!response.ok) throw new Error(await messageFromResponse(response));
      setResult(await response.json() as CreatedLink);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求未能完成，请稍后重试。");
    } finally {
      setLoading(false);
      setToken("");
      setResetKey((value) => value + 1);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shortUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("无法自动复制，请选中短链手动复制。");
    }
  }

  return <div className="page-shell">
    <Brand />
    <main className="public-main">
      <div className="public-layout">
        <section className="create-section" aria-label="生成短链接">
        <form onSubmit={createLink}>
          <div className="field-group">
            <label htmlFor="target-url" className="field-label">要分享的网址</label>
            <Input
              id="target-url"
              className="url-input"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://example.com/your-long-link"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setResult(null); setError(""); }}
              required
              maxLength={2048}
            />
          </div>

          <fieldset className="duration-fieldset">
            <legend className="field-label">保留多久</legend>
            <div className="duration-track">
              {days.map((day) => <label
                key={day}
                className={`duration-option ${duration === day ? "selected" : ""}`}
              >
                <input
                  className="duration-radio"
                  type="radio"
                  name="duration"
                  value={day}
                  checked={duration === day}
                  onChange={() => { setDuration(day); setResult(null); }}
                />
                <span className="duration-value"><span className="duration-number">{day}</span><span className="duration-unit">天</span></span>
                <span className="duration-caption">{day * 24} 小时</span>
              </label>)}
            </div>
            <p className="field-hint">从生成时开始计时，失效后自动清理。</p>
          </fieldset>

          <div className="verification-section">
            <div className="verification-heading">
              <span className="field-label">人机验证</span>
              <span className={`verification-status ${token ? "verified" : configError || verificationError ? "failed" : ""}`} aria-live="polite">
                {token ? "已完成" : configError ? "暂不可用" : verificationError ? "验证失败" : siteKey ? "等待验证" : "加载中"}
              </span>
            </div>
            {siteKey && !verificationError && <Turnstile siteKey={siteKey} onToken={onToken} onFailure={onVerificationFailure} resetKey={resetKey} />}
            <p className={`verification-hint ${configError || verificationError ? "failed" : ""}`} role={configError || verificationError ? "alert" : undefined} aria-live="polite">
              {configError ? "验证服务暂时不可用，请刷新页面重试。" :
                verificationError ? "人机验证未能完成，请刷新页面重试。" :
                !siteKey ? "正在加载验证服务…" :
                  token ? "验证完成，现在可以生成短链接。" : "完成验证后即可生成短链接。"}
            </p>
          </div>
          {error && <p role="alert" className="form-error">{error}</p>}
          <Button type="submit" size="lg" className={`create-button ${loading ? "is-loading" : ""}`} disabled={loading || !siteKey || !token}>
            {loading ? "正在生成…" : token ? "生成短链接" : "验证后生成短链接"}
          </Button>
        </form>

        {result && <div className="result-panel" aria-live="polite">
          <div className="result-heading"><Check size={18} />短链接已生成</div>
          <div className="result-link-row">
            <input aria-label="生成的短链接" readOnly value={result.shortUrl} onFocus={(event) => event.target.select()} />
            <Button type="button" onClick={copyLink} className="copy-button" variant="secondary">
              {copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "已复制" : "复制"}
            </Button>
          </div>
          <p>有效至 {dateTime(result.expiresAt)}（本地时间）</p>
        </div>}
        </section>
      </div>
    </main>
    <footer className="site-footer">临时链接只保留所选天数。请勿用于违法或欺骗性内容。</footer>
  </div>;
}

function AdminPage() {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [items, setItems] = useState<AdminLink[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminLink | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ query, status });
    if (cursor) params.set("cursor", cursor);
    setLoading(true);
    setError("");
    fetch(`/admin/api/links?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await messageFromResponse(response));
        return response.json() as Promise<AdminList>;
      })
      .then((page) => { setItems(page.items); setNextCursor(page.nextCursor); })
      .catch((reason) => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "列表加载失败。") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, status, cursor, refresh]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(draftQuery.trim());
    setCursor(null);
    setHistory([]);
  }

  async function updateLink(link: AdminLink, disabled: boolean) {
    setPending(link.code);
    setError("");
    try {
      const response = await fetch(`/admin/api/links/${link.code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      if (!response.ok) throw new Error(await messageFromResponse(response));
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新失败。");
    } finally {
      setPending("");
    }
  }

  async function deleteLink() {
    if (!deleteTarget) return;
    const code = deleteTarget.code;
    setPending(code);
    setError("");
    try {
      const response = await fetch(`/admin/api/links/${code}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await messageFromResponse(response));
      setDeleteTarget(null);
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败。");
    } finally {
      setPending("");
    }
  }

  return <div className="page-shell admin-shell">
    <Brand admin />
    <main className="admin-main">
      <div className="admin-heading">
        <div><h1>短链管理</h1><p>查找、停用或删除公开生成的链接。</p></div>
        <Button variant="secondary" size="sm" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
          <RefreshCw size={15} />刷新
        </Button>
      </div>
      <div className="admin-toolbar">
        <form onSubmit={search} className="search-form">
          <Search size={18} aria-hidden="true" />
          <Input aria-label="搜索短码或目标地址" placeholder="搜索短码或目标地址" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} maxLength={100} />
          <Button type="submit" size="sm">搜索</Button>
        </form>
        <label className="status-select-wrap">状态
          <select value={status} onChange={(event) => { setStatus(event.target.value); setCursor(null); setHistory([]); }}>
            <option value="all">全部</option>
            <option value="active">生效中</option>
            <option value="disabled">已停用</option>
            <option value="expired">已过期</option>
          </select>
        </label>
      </div>
      {error && <p role="alert" className="form-error admin-error">{error}</p>}
      <div className="admin-list" aria-busy={loading}>
        <div className="admin-list-head"><span>短链与目标地址</span><span>时间</span><span>状态与操作</span></div>
        {loading ? <p className="empty-state">正在加载短链…</p> : items.length === 0 ?
          <p className="empty-state">没有符合条件的短链。试试其他搜索词或状态。</p> :
          items.map((link) => <div className="admin-row" key={link.code}>
            <div className="admin-link-cell">
              <span className="code-label">/{link.code}</span>
              <a href={link.targetUrl} target="_blank" rel="noopener noreferrer" title={link.targetUrl}>
                {link.targetUrl}<ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </div>
            <div className="admin-time-cell"><span>创建 {dateTime(link.createdAt)}</span><span>到期 {dateTime(link.expiresAt)}</span></div>
            <div className="admin-action-cell">
              <span className={`status-badge ${link.status}`}>{statusLabels[link.status]}</span>
              {link.status !== "expired" && <Button
                variant="ghost" size="sm" disabled={pending === link.code}
                onClick={() => updateLink(link, link.status === "active")}
              >{link.status === "active" ? "停用" : "恢复"}</Button>}
              <Button variant="ghost" size="icon" aria-label={`删除 ${link.code}`} disabled={pending === link.code} onClick={() => setDeleteTarget(link)}>
                <Trash2 size={16} />
              </Button>
            </div>
          </div>)}
      </div>
      <div className="pagination">
        <Button variant="ghost" size="sm" disabled={loading || history.length === 0} onClick={() => {
          const previous = history.at(-1) ?? null;
          setHistory((value) => value.slice(0, -1));
          setCursor(previous);
        }}>上一页</Button>
        <Button variant="ghost" size="sm" disabled={loading || !nextCursor} onClick={() => {
          setHistory((value) => [...value, cursor]);
          setCursor(nextCursor);
        }}>下一页</Button>
      </div>
    </main>
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这条短链？</AlertDialogTitle>
          <AlertDialogDescription>/{deleteTarget?.code} 将立即失效，删除后无法恢复。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="secondary">取消</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={deleteLink} disabled={!!pending}>删除短链</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

export default function App() {
  return window.location.pathname === "/admin" ? <AdminPage /> : <PublicPage />;
}
