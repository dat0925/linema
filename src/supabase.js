// Supabase REST(PostgREST) / RPC への薄いラッパー
// Workers環境では supabase-js のフル機能は不要なため、fetchベースで実装する。

export function createSupabaseClient(env) {
  const baseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase error ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    // テーブルへの単純なselect（PostgREST構文）
    select(table, query = "") {
      return request(`/rest/v1/${table}${query}`, { method: "GET" });
    },
    insert(table, rows) {
      return request(`/rest/v1/${table}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(rows),
      });
    },
    update(table, query, patch) {
      return request(`/rest/v1/${table}${query}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
    },
    rpc(fnName, args) {
      return request(`/rest/v1/rpc/${fnName}`, {
        method: "POST",
        body: JSON.stringify(args),
      });
    },
  };
}
