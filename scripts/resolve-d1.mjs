const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveD1Id({ accountId, apiToken, name, fetchImpl = fetch }) {
  const matches = [];

  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`);
    url.searchParams.set("name", name);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`查询 D1 数据库失败：HTTP ${response.status}。`);

    const body = await response.json();
    if (body.success !== true || !Array.isArray(body.result)) {
      throw new Error("Cloudflare 返回了无效的 D1 数据库列表。");
    }
    matches.push(...body.result.filter((database) => database.name === name));
    if (body.result.length < 100) break;
    if (page === 100) throw new Error("D1 数据库列表过长，无法安全解析名称。");
  }

  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? `未找到名为 ${name} 的 D1 数据库；请先创建它。`
      : `找到多个名为 ${name} 的 D1 数据库；请使用唯一名称。`);
  }
  const id = matches[0].uuid;
  if (typeof id !== "string" || !UUID.test(id)) {
    throw new Error("Cloudflare 返回的 D1 database_id 无效。");
  }
  return id;
}
