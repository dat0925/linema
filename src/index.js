import { createSupabaseClient } from "./supabase.js";
import { handleWebhook } from "./webhook.js";
import { previewSegment, createAndSendBroadcast } from "./broadcast.js";
import { issueLinkingCode } from "./linking.js";

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

      // 連携コード発行: /api/tenants/:tenantId/linking-codes
      const linkingMatch = path.match(/^\/api\/tenants\/([^/]+)\/linking-codes$/);
      if (linkingMatch && method === "POST") {
        const { customerId } = await request.json();
        if (!customerId) return jsonResponse({ error: "customerId is required" }, 400);
        const result = await issueLinkingCode(supabase, linkingMatch[1], customerId);
        return jsonResponse(result);
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

      return jsonResponse({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return jsonResponse({ error: String(err && err.message ? err.message : err) }, 500);
    }
  },
};
