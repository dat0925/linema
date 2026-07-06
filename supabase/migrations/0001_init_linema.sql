-- LINE MAエージェント（linema） 初期スキーマ
-- 命名規則: 既存プロジェクト（Tavera=menu_, FoodAI=foodai_）に倣い linema_ プレフィックスを使用
-- 共有Supabaseプロジェクト: sfhtvtcmgueystyuhzvd を想定
--
-- 【設計方針・2026-07-06確定】
-- LINE MAエージェントは外部システム（CRM君・予約GO等）に依存しない自己完結型。
-- セグメントの元データは以下の2つのみ:
--   1. 友だち登録時のアンケート（性別・年代・趣味嗜好）
--   2. LINE上の行動（登録日・最終メッセージ日時）
-- CRM君はこちら側のデータを usage-summary API 経由で「取りに来る」だけの一方通行。
-- （旧版でCRM君の顧客IDと紐付ける連携コード機構を作っていたが、前提が誤りだったため廃止）

-- 1. テナントごとのLINEチャネル認証情報
create table if not exists linema_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null unique, -- サイトマイスター側のテナント/顧客企業ID
  channel_id text not null,
  channel_secret text not null,   -- TODO: 本番ではSupabase Vault等で暗号化保存に移行
  channel_access_token text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. LINE友だち（LINE MAエージェント内で完結するプロフィール）
create table if not exists linema_line_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references linema_channels(tenant_id) on delete cascade,
  line_user_id text not null,
  display_name text,
  blocked boolean not null default false, -- ブロックされたら配信対象から除外

  -- 友だち登録時アンケートで収集する属性
  gender text,          -- 'male' | 'female' | 'other' | null(未回答)
  age_group text,        -- '10s' | '20s' | '30s' | '40s' | '50s' | '60s_plus' | null
  interests jsonb not null default '[]'::jsonb, -- 例: ["ヘアケア", "カラー", "頭皮ケア"]
  survey_state text not null default 'not_started', -- not_started | asked_gender | asked_age | asked_interests | completed
  survey_completed_at timestamptz,

  -- 店舗スタッフによる手動タグ（アンケート以外の補助情報、任意）
  staff_tags jsonb not null default '[]'::jsonb,

  last_message_at timestamptz, -- LINE上の最終メッセージ日時（行動データ）
  created_at timestamptz not null default now(), -- 友だち登録日
  unique (tenant_id, line_user_id)
);

-- 3. セグメント定義
create table if not exists linema_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references linema_channels(tenant_id) on delete cascade,
  name text not null,
  description text,
  -- 例:
  -- {"gender": "female", "age_groups": ["20s","30s"], "interests_any": ["ヘアケア"]}
  -- {"registered_within_days": 30}
  -- {"inactive_days_gte": 90}  -- last_message_at基準
  condition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. シナリオ配信（Phase 2、テーブルのみ先行作成）
create table if not exists linema_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references linema_channels(tenant_id) on delete cascade,
  name text not null,
  trigger_type text not null, -- 'days_after_registration' | 'survey_completed' 等
  trigger_value int not null default 0,
  message jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- 5. 配信（ブロードキャスト）
create table if not exists linema_broadcasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references linema_channels(tenant_id) on delete cascade,
  segment_id uuid references linema_segments(id),
  message jsonb not null,
  status text not null default 'draft', -- draft | sending | completed | failed
  target_count int,
  sent_count int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- 6. 配信ログ（個別の送信結果）
create table if not exists linema_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  broadcast_id uuid references linema_broadcasts(id) on delete cascade,
  line_user_id text not null,
  status text not null, -- sent | failed
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_linema_line_users_tenant on linema_line_users(tenant_id);
create index if not exists idx_linema_delivery_logs_broadcast on linema_delivery_logs(broadcast_id);

-- 7. セグメント該当ユーザー抽出関数
-- linema_segments.condition (jsonb) を読み、linema_line_users を直接フィルタする。
-- 外部テーブルとのJOINは一切不要（自己完結設計）。
create or replace function linema_segment_line_user_ids(p_tenant_id text, p_segment_id uuid)
returns table(line_user_id text) as $$
declare
  v_condition jsonb;
begin
  select condition into v_condition from linema_segments
  where id = p_segment_id and tenant_id = p_tenant_id;

  if v_condition is null then
    v_condition := '{}'::jsonb;
  end if;

  return query
    select lu.line_user_id
    from linema_line_users lu
    where lu.tenant_id = p_tenant_id
      and lu.blocked = false
      and (
        not (v_condition ? 'gender')
        or lu.gender = v_condition->>'gender'
      )
      and (
        not (v_condition ? 'age_groups')
        or lu.age_group in (select jsonb_array_elements_text(v_condition->'age_groups'))
      )
      and (
        not (v_condition ? 'interests_any')
        or lu.interests ?| (select array_agg(x) from jsonb_array_elements_text(v_condition->'interests_any') x)
      )
      and (
        not (v_condition ? 'registered_within_days')
        or lu.created_at >= now() - ((v_condition->>'registered_within_days')::int || ' days')::interval
      )
      and (
        not (v_condition ? 'inactive_days_gte')
        or lu.last_message_at is null
        or lu.last_message_at <= now() - ((v_condition->>'inactive_days_gte')::int || ' days')::interval
      );
end;
$$ language plpgsql;
