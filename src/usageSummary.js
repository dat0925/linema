// サイトマイスター本体（御社→クライアント向けLINEエージェント）が
// 提案文生成時に読みに行くための軽量サマリー。
// 「導入していないなら効果イメージを、導入済みなら実績を」提案に織り込むための最小限のデータを返す。
//
// 【設計方針】LINE MAエージェントは自己完結型のため、ここで返す指標はすべて
// LINE MAエージェント自身が持つデータ（友だち数・アンケート回答状況・配信実績）に限る。
// CRM君や予約GO等、他システムのデータは一切参照しない。

export async function getUsageSummary(supabase, tenantId) {
  const channelRows = await supabase.select("linema_channels", `?tenant_id=eq.${tenantId}&limit=1`);
  const onboarded = Boolean(channelRows && channelRows[0]);

  if (!onboarded) {
    return { tenantId, onboarded: false };
  }

  const [lineUsers, broadcasts] = await Promise.all([
    supabase.select(
      "linema_line_users",
      `?tenant_id=eq.${tenantId}&select=blocked,survey_state,gender,age_group,interests`
    ),
    supabase.select(
      "linema_broadcasts",
      `?tenant_id=eq.${tenantId}&select=id,status,target_count,sent_count,created_at&order=created_at.desc&limit=5`
    ),
  ]);

  const friendCount = lineUsers.length;
  const surveyCompletedCount = lineUsers.filter((u) => u.survey_state === "completed").length;
  const blockedCount = lineUsers.filter((u) => u.blocked).length;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const broadcastsLast30d = broadcasts.filter((b) => new Date(b.created_at) >= thirtyDaysAgo).length;
  const lastBroadcast = broadcasts[0] || null;

  return {
    tenantId,
    onboarded: true,
    friendCount,
    surveyCompletedCount,
    surveyCompletionRate:
      friendCount > 0 ? Math.round((surveyCompletedCount / friendCount) * 1000) / 10 : 0,
    blockedCount,
    broadcastsLast30d,
    lastBroadcast: lastBroadcast
      ? {
          status: lastBroadcast.status,
          targetCount: lastBroadcast.target_count,
          sentCount: lastBroadcast.sent_count,
          createdAt: lastBroadcast.created_at,
        }
      : null,
    // 注: LINE Messaging APIはpush配信に対する開封率を直接提供しないため、
    // 「開封率」はここには含めない。
  };
}
