// CRM君の顧客とLINEユーザーを紐付けるための連携コード機構

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい文字(0,O,1,I)を除外
const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 30;

function generateCode() {
  let code = "";
  const randomValues = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[randomValues[i] % CODE_CHARS.length];
  }
  return code;
}

/**
 * CRM君側から呼ばれる想定: 顧客に見せる連携コードを発行する
 */
export async function issueLinkingCode(supabase, tenantId, customerId) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

  await supabase.insert("linema_linking_codes", [
    { code, tenant_id: tenantId, customer_id: customerId, expires_at: expiresAt },
  ]);

  return { code, expiresAt, ttlMinutes: CODE_TTL_MINUTES };
}

/**
 * LINE上で顧客が送ってきたテキストが連携コードかどうか判定し、
 * 有効なら line_user_id と customer_id を紐付ける
 * @returns {"linked"|"invalid"|"expired"|"not_a_code"}
 */
export async function tryLinkByCode(supabase, tenantId, lineUserId, text) {
  const normalized = (text || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    return "not_a_code";
  }

  const rows = await supabase.select(
    "linema_linking_codes",
    `?code=eq.${normalized}&tenant_id=eq.${tenantId}&limit=1`
  );
  const record = rows && rows[0];
  if (!record) return "invalid";
  if (record.used_at) return "invalid";
  if (new Date(record.expires_at).getTime() < Date.now()) return "expired";

  // linema_line_users に upsert（Prefer: resolution=merge-duplicates 相当を手動で実装）
  const existing = await supabase.select(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}&limit=1`
  );

  if (existing && existing[0]) {
    await supabase.update(
      "linema_line_users",
      `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
      { customer_id: record.customer_id, linked_at: new Date().toISOString() }
    );
  } else {
    await supabase.insert("linema_line_users", [
      {
        tenant_id: tenantId,
        line_user_id: lineUserId,
        customer_id: record.customer_id,
        linked_at: new Date().toISOString(),
      },
    ]);
  }

  await supabase.update("linema_linking_codes", `?code=eq.${normalized}`, {
    used_at: new Date().toISOString(),
  });

  return "linked";
}
