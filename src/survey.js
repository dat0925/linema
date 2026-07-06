// 友だち登録時アンケート（LINE MAエージェント内で完結、外部システム連携なし）
// フロー: follow → 性別質問(quick reply) → 年代質問(quick reply) → 趣味嗜好(自由入力テキスト) → 完了

const GENDER_LABELS = { male: "男性", female: "女性", other: "その他", skip: "回答しない" };
const AGE_LABELS = {
  "10s": "10代", "20s": "20代", "30s": "30代", "40s": "40代", "50s": "50代", "60s_plus": "60代以上", skip: "回答しない",
};

function quickReplyMessage(text, options) {
  return {
    type: "text",
    text,
    quickReply: {
      items: options.map((opt) => ({
        type: "action",
        action: { type: "postback", label: opt.label, data: opt.data, displayText: opt.label },
      })),
    },
  };
}

function genderQuestion() {
  return quickReplyMessage(
    "友だち登録ありがとうございます！\nより良い情報をお届けするため、簡単なアンケートにご協力ください。\n\nまず、性別を教えてください。",
    Object.entries(GENDER_LABELS).map(([key, label]) => ({ label, data: `survey:gender:${key}` }))
  );
}

function ageQuestion() {
  return quickReplyMessage(
    "ありがとうございます。次に、年代を教えてください。",
    Object.entries(AGE_LABELS).map(([key, label]) => ({ label, data: `survey:age:${key}` }))
  );
}

function interestsQuestion() {
  return {
    type: "text",
    text: "最後に、興味のあることやお悩みがあれば教えてください（自由入力・カンマ区切りでも可）。\n特になければ「なし」とお送りください。",
  };
}

function thankYouMessage() {
  return { type: "text", text: "ご回答ありがとうございました！今後、お得な情報をお届けします。" };
}

async function getOrCreateLineUser(supabase, tenantId, lineUserId) {
  const existing = await supabase.select(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}&limit=1`
  );
  if (existing && existing[0]) return existing[0];

  const created = await supabase.insert("linema_line_users", [
    { tenant_id: tenantId, line_user_id: lineUserId },
  ]);
  return created[0];
}

/**
 * follow イベント時: プロフィール作成 + アンケート開始
 */
export async function handleFollow(supabase, tenantId, lineUserId) {
  const user = await getOrCreateLineUser(supabase, tenantId, lineUserId);

  await supabase.update(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
    { blocked: false, survey_state: "asked_gender" }
  );

  return genderQuestion();
}

/**
 * postback イベント時: アンケート回答の処理
 * @returns 次に送るメッセージ、または対象外の場合 null
 */
export async function handlePostback(supabase, tenantId, lineUserId, data) {
  const parts = (data || "").split(":"); // ["survey", "gender", "female"]
  if (parts[0] !== "survey") return null;

  const [, field, value] = parts;

  if (field === "gender") {
    const gender = value === "skip" ? null : value;
    await supabase.update(
      "linema_line_users",
      `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
      { gender, survey_state: "asked_age" }
    );
    return ageQuestion();
  }

  if (field === "age") {
    const ageGroup = value === "skip" ? null : value;
    await supabase.update(
      "linema_line_users",
      `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
      { age_group: ageGroup, survey_state: "asked_interests" }
    );
    return interestsQuestion();
  }

  return null;
}

/**
 * message(text) イベント時: アンケート「趣味嗜好」待ちの状態ならテキストをタグ化して保存
 * @returns アンケート回答として処理した場合はサンクスメッセージ、対象外なら null
 */
export async function handleTextMessage(supabase, tenantId, lineUserId, text) {
  const rows = await supabase.select(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}&limit=1`
  );
  const user = rows && rows[0];
  if (!user || user.survey_state !== "asked_interests") return null;

  const normalized = (text || "").trim();
  const interests =
    normalized === "" || normalized === "なし"
      ? []
      : normalized
          .split(/[、,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);

  await supabase.update(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
    {
      interests,
      survey_state: "completed",
      survey_completed_at: new Date().toISOString(),
    }
  );

  return thankYouMessage();
}

export async function touchLastMessageAt(supabase, tenantId, lineUserId) {
  await supabase.update(
    "linema_line_users",
    `?tenant_id=eq.${tenantId}&line_user_id=eq.${lineUserId}`,
    { last_message_at: new Date().toISOString() }
  );
}
