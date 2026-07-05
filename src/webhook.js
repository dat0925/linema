import { verifyLineSignature, replyMessage } from "./line.js";
import { tryLinkByCode } from "./linking.js";

/**
 * テナントのチャネル情報を取得
 */
async function getChannel(supabase, tenantId) {
  const rows = await supabase.select("linema_channels", `?tenant_id=eq.${tenantId}&limit=1`);
  return rows && rows[0];
}

export async function handleWebhook(request, env, supabase, tenantId) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  const channel = await getChannel(supabase, tenantId);
  if (!channel) {
    return new Response("unknown tenant", { status: 404 });
  }

  const valid = await verifyLineSignature(channel.channel_secret, rawBody, signature);
  if (!valid) {
    return new Response("invalid signature", { status: 401 });
  }

  const body = JSON.parse(rawBody);
  const events = body.events || [];

  for (const event of events) {
    await handleEvent(event, supabase, tenantId, channel);
  }

  return new Response("ok", { status: 200 });
}

async function handleEvent(event, supabase, tenantId, channel) {
  const lineUserId = event.source && event.source.userId;
  if (!lineUserId) return;

  switch (event.type) {
    case "follow": {
      await upsertLineUser(supabase, tenantId, lineUserId);
      break;
    }
    case "unfollow": {
      await markBlocked(supabase, tenantId, lineUserId);
      break;
    }
    case "message": {
      if (event.message && event.message.type === "text") {
        const result = await tryLinkByCode(supabase, tenantId, lineUserId, event.message.text);
        await respondToLinkAttempt(channel, event.replyToken, result);
      }
      break;
    }
    default:
      // postback等はPhase 2で対応
      break;
  }
}

async function upsertLineUser(supabase, tenantId, lineUserId) {
  const existing = await supabase.select(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}&limit=1`
  );
  if (existing && existing[0]) {
    await supabase.update(
      "linema_line_users",
      `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
      { blocked: false }
    );
  } else {
    await supabase.insert("linema_line_users", [{ tenant_id: tenantId, line_user_id: lineUserId }]);
  }
}

async function markBlocked(supabase, tenantId, lineUserId) {
  await supabase.update(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
    { blocked: true }
  );
}

async function respondToLinkAttempt(channel, replyToken, result) {
  if (!replyToken || result === "not_a_code") return; // コードでないメッセージには反応しない（Phase2でチャットボット応答予定）

  const messageByResult = {
    linked: "連携が完了しました。今後、お得な情報をお届けします。",
    invalid: "コードが正しくありません。もう一度ご確認ください。",
    expired: "コードの有効期限が切れています。お手数ですが再度発行をご依頼ください。",
  };

  const text = messageByResult[result];
  if (!text) return;

  await replyMessage(channel.channel_access_token, replyToken, [{ type: "text", text }]);
}
