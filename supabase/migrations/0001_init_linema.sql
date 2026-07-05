-- LINE MAエージェント（linema） 初期スキーマ
-- 命名規則: 既存プロジェクト（Tavera=menu_, FoodAI=foodai_）に倣い linema_ プレフィックスを使用
-- 共有Supabaseプロジェクト: sfhtvtcmgueystyuhzvd を想定
--
-- 【重要・要確認】
-- CRM君の customers / tags テーブルの実スキーマが未共有のため、
-- 本マイグレーションでは tenant_id / customer_id は text 型の緩い参照として扱う。
-- 実スキーマ確定後、外部キー制約と linema_segment_customer_ids() 関数のJOIN条件を要修正。

-- 1. テナントごとのLINEチャネル認証情報
create table if not exists linema_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null unique, -- CRM君側のテナント/顧客企業ID
  channel_id text not null,
  channel_secret text not null,   -- TODO: 本番ではSupabase Vault等で暗号化保存に移行
  channel_access_token text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. LINEユーザー ⇔ CRM君顧客 の連携マッピング
create table if not exists linema_line_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references linema_channels(tenant_id) on delete cascade,
  line_user_id text not null,
  customer_id text, -- CRM君側の顧客ID（連携完了後にセット）
  display_name text,
  linked_at timestamptz,
  blocked boolean not null default false, -- ブロックされたら配信対象から除外
  created_at timestamptz not null default now(),
  unique (tenant_id, line_user_id)
);

-- 3. 連携コード（顧客がLINEでコードを送ると customer_id と紐付く）
create table if not exists linema_linking_codes (
  code text primary key, -- 6桁英数字
  tenant_id text not null references linema_channels(tenant_id) on delete cascade,
  customer_id text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- 4. セグメント定義（CRM君のタグ・属性条件をJSONBで保持）
create table if not exists linema_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references linema_channels(tenant_id) on delete cascade,
  name text not null,
  description text,
  -- 例: {"tags": ["vip", "repeat_3plus"], "match": "any"}
  condition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. シナリオ配信（Phase 2、テーブルのみ先行作成）
create table if not exists linema_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references linema_channels(tenant_id) on delete cascade,
  name text not null,
  trigger_type text not null, -- 'days_after_registration' | 'days_after_visit' 等
  trigger_value int not null default 0,
  message jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- 6. 配信（ブロードキャスト）
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

-- 7. 配信ログ（個別の送信結果）
create table if not exists linema_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  broadcast_id uuid references linema_broadcasts(id) on delete cascade,
  line_user_id text not null,
  status text not null, -- sent | failed | skipped_low_score
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_linema_line_users_tenant on linema_line_users(tenant_id);
create index if not exists idx_linema_delivery_logs_broadcast on linema_delivery_logs(broadcast_id);

-- 8. セグメント該当ユーザー抽出関数（プレースホルダー）
-- 【要修正】CRM君の customers/tags 実スキーマが確定次第、JOIN条件を実装する。
-- 現状はタグ条件を無視して「連携済み・非ブロックの全ユーザー」を返すダミー実装。
create or replace function linema_segment_customer_ids(p_tenant_id text, p_segment_id uuid)
returns table(line_user_id text) as $$
begin
  return query
    select lu.line_user_id
    from linema_line_users lu
    where lu.tenant_id = p_tenant_id
      and lu.customer_id is not null
      and lu.blocked = false;
  -- TODO: p_segment_id の condition (linema_segments.condition) を読み、
  --       CRM君 customers/tags と実際にJOINして絞り込むロジックに差し替える
end;
$$ language plpgsql;
