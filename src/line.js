// LINE Messaging API 関連ユーティリティ
// Cloudflare Workers は Node crypto が使えないため、Web Crypto API (crypto.subtle) を使用する。

/**
 * LINE Webhookの署名検証
 * @param {string} channelSecret
 * @param {string} rawBody - リクエストボディの生文字列（JSON.parse前）
 * @param {string} signatureHeader - x-line-signature ヘッダー値（base64）
 */
export async function verifyLineSignature(channelSecret, rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = base64Encode(signatureBuffer);
  return computed === signatureHeader;
}

function base64Encode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 単一ユーザーへのプッシュメッセージ送信
 */
export async function pushMessage(channelAccessToken, lineUserId, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: lineUserId, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE push error ${res.status}: ${text}`);
  }
}

/**
 * マルチキャスト送信（最大500件/回、LINE APIの制限に準拠）
 * 呼び出し側で500件ごとにチャンク分割すること
 */
export async function multicastMessage(channelAccessToken, lineUserIds, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/multicast", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: lineUserIds, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE multicast error ${res.status}: ${text}`);
  }
}

export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * 返信メッセージ送信（Webhookイベントへの即時応答用）
 */
export async function replyMessage(channelAccessToken, replyToken, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE reply error ${res.status}: ${text}`);
  }
}
