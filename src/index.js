import { createSupabaseClient } from "./supabase.js";
import { handleWebhook } from "./webhook.js";
import { previewSegment, createAndSendBroadcast } from "./broadcast.js";
import { getUsageSummary } from "./usageSummary.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const supabase = createSupabaseClient(env);

    try {
      // LINE Webhook受信: /webhook/:tenantId
      const webhookMatch = path.match(/^\/webhook\/([^/]+)$/);
      if (webhookMatch && method === "POST") {
        return await handleWebhook(request, env, supabase, webhookMatch[1]);
      }

      // セグメントプレビュー: /api/tenants/:tenantId/segments/:segmentId/preview
      const previewMatch = path.match(/^\/api\/tenants\/([^/]+)\/segments\/([^/]+)\/preview$/);
      if (previewMatch && method === "GET") {
        const result = await previewSegment(supabase, previewMatch[1], previewMatch[2]);
        return jsonResponse(result);
      }

      // 配信作成・即時送信: /api/tenants/:tenantId/broadcasts
      const broadcastMatch = path.match(/^\/api\/tenants\/([^/]+)\/broadcasts$/);
      if (broadcastMatch && method === "POST") {
        const { segmentId, message } = await request.json();
        if (!segmentId || !message) {
          return jsonResponse({ error: "segmentId and message are required" }, 400);
        }
        const result = await createAndSendBroadcast(supabase, broadcastMatch[1], segmentId, message);
        return jsonResponse(result);
      }

      if (path === "/health") {
        return jsonResponse({ status: "ok", service: "linema" });
      }

      // 提案エンジン向け軽量サマリー: /api/tenants/:tenantId/usage-summary
      const usageMatch = path.match(/^\/api\/tenants\/([^/]+)\/usage-summary$/);
      if (usageMatch && method === "GET") {
        const result = await getUsageSummary(supabase, usageMatch[1]);
        return jsonResponse(result);
      }

      return jsonResponse({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return jsonResponse({ error: String(err && err.message ? err.message : err) }, 500);
    }
  },
};
