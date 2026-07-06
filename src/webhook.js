import { verifyLineSignature, replyMessage } from "./line.js";
import { handleFollow, handlePostback, handleTextMessage, touchLastMessageAt } from "./survey.js";

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
      const question = await handleFollow(supabase, tenantId, lineUserId);
      if (event.replyToken && question) {
        await replyMessage(channel.channel_access_token, event.replyToken, [question]);
      }
      break;
    }
    case "unfollow": {
      await markBlocked(supabase, tenantId, lineUserId);
      break;
    }
    case "postback": {
      const nextQuestion = await handlePostback(supabase, tenantId, lineUserId, event.postback && event.postback.data);
      if (event.replyToken && nextQuestion) {
        await replyMessage(channel.channel_access_token, event.replyToken, [nextQuestion]);
      }
      break;
    }
    case "message": {
      await touchLastMessageAt(supabase, tenantId, lineUserId);
      if (event.message && event.message.type === "text") {
        const thanks = await handleTextMessage(supabase, tenantId, lineUserId, event.message.text);
        if (event.replyToken && thanks) {
          await replyMessage(channel.channel_access_token, event.replyToken, [thanks]);
        }
        // アンケート対象外のテキスト（thanks === null）はPhase 2のチャットボット応答で対応予定。今は無視。
      }
      break;
    }
    default:
      break;
  }
}

async function markBlocked(supabase, tenantId, lineUserId) {
  await supabase.update(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
    { blocked: true }
  );
}
