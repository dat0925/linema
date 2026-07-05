import { multicastMessage, chunkArray } from "./line.js";

async function getChannel(supabase, tenantId) {
  const rows = await supabase.select("linema_channels", `?tenant_id=eq.${tenantId}&limit=1`);
  return rows && rows[0];
}

/**
 * セグメント該当ユーザー数のプレビュー
 */
export async function previewSegment(supabase, tenantId, segmentId) {
  const result = await supabase.rpc("linema_segment_customer_ids", {
    p_tenant_id: tenantId,
    p_segment_id: segmentId,
  });
  return { count: Array.isArray(result) ? result.length : 0 };
}

/**
 * セグメント配信を作成し即時送信する（MVP: スケジュール配信は非対応）
 */
export async function createAndSendBroadcast(supabase, tenantId, segmentId, message) {
  const channel = await getChannel(supabase, tenantId);
  if (!channel) throw new Error("channel not found for tenant");

  const targets = await supabase.rpc("linema_segment_customer_ids", {
    p_tenant_id: tenantId,
    p_segment_id: segmentId,
  });
  const lineUserIds = (targets || []).map((r) => r.line_user_id);

  const broadcastRows = await supabase.insert("linema_broadcasts", [
    {
      tenant_id: tenantId,
      segment_id: segmentId,
      message,
      status: "sending",
      target_count: lineUserIds.length,
    },
  ]);
  const broadcast = broadcastRows[0];

  // LINE multicast APIは1回あたり最大500件
  const chunks = chunkArray(lineUserIds, 500);
  let sentCount = 0;
  let failed = false;

  for (const chunk of chunks) {
    try {
      await multicastMessage(channel.channel_access_token, chunk, [message]);
      sentCount += chunk.length;
      await supabase.insert(
        "linema_delivery_logs",
        chunk.map((lineUserId) => ({
          tenant_id: tenantId,
          broadcast_id: broadcast.id,
          line_user_id: lineUserId,
          status: "sent",
        }))
      );
    } catch (err) {
      failed = true;
      await supabase.insert(
        "linema_delivery_logs",
        chunk.map((lineUserId) => ({
          tenant_id: tenantId,
          broadcast_id: broadcast.id,
          line_user_id: lineUserId,
          status: "failed",
          error_message: String(err),
        }))
      );
    }
  }

  await supabase.update("linema_broadcasts", `?id=eq.${broadcast.id}`, {
    status: failed ? "failed" : "completed",
    sent_count: sentCount,
    sent_at: new Date().toISOString(),
  });

  return { broadcastId: broadcast.id, targetCount: lineUserIds.length, sentCount, failed };
}
