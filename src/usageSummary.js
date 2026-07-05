// サイトマイスター本体（御社→クライアント向けLINEエージェント）が
// 提案文生成時に読みに行くための軽量サマリー。
// 「導入していないなら効果イメージを、導入済みなら実績を」提案に織り込むための最小限のデータを返す。

export async function getUsageSummary(supabase, tenantId) {
  const channelRows = await supabase.select("linema_channels", `?tenant_id=eq.${tenantId}&limit=1`);
  const onboarded = Boolean(channelRows && channelRows[0]);

  if (!onboarded) {
    // 未導入テナント: 提案側で「導入すればこうなる」を語るための最小限の情報のみ返す
    return {
      tenantId,
      onboarded: false,
    };
  }

  const [lineUsers, broadcasts] = await Promise.all([
    supabase.select("linema_line_users", `?tenant_id=eq.${tenantId}&select=customer_id,blocked`),
    supabase.select(
      "linema_broadcasts",
      `?tenant_id=eq.${tenantId}&select=id,status,target_count,sent_count,created_at&order=created_at.desc&limit=5`
    ),
  ]);

  const friendCount = lineUsers.length;
  const linkedCount = lineUsers.filter((u) => u.customer_id).length;
  const blockedCount = lineUsers.filter((u) => u.blocked).length;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const broadcastsLast30d = broadcasts.filter((b) => new Date(b.created_at) >= thirtyDaysAgo).length;
  const lastBroadcast = broadcasts[0] || null;

  return {
    tenantId,
    onboarded: true,
    friendCount,
    linkedCount,
    linkedRate: friendCount > 0 ? Math.round((linkedCount / friendCount) * 1000) / 10 : 0,
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
    // 「開封率」はここには含めない（フロントの配信履歴上の開封率はデモ用のモック値）。
    // 本番で開封率相当の指標が必要な場合は、リッチメニュー/LIFF経由のトラッキングを別途設計する。
  };
}
