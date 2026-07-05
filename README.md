# linema（LINE MAエージェント）

サイトマイスターの追加商材として、既存顧客（CRM君利用企業）向けにLINEセグメント配信・シナリオ配信を提供するCloudflare Workerバックエンド。

企画背景・競合比較・機能仕様は以下を参照:
- `docs/spec.md`（企画仕様書）
- `HANDOVER.md`（開発の申し送り・現状）

## アーキテクチャ

```
LINE公式アカウント（テナントごと）
  ⇅ Messaging API
Cloudflare Worker（このリポジトリ）
  ⇅ REST/RPC
Supabase（sfhtvtcmgueystyuhzvd 共有プロジェクト、linema_* テーブル）
  ⇅
CRM君（customers/tags等、参照のみ。実スキーマ確認中）
```

マルチテナント設計: 1テナント（サイトマイスター顧客企業）＝1つのLINE公式アカウント。
`linema_channels` テーブルにテナントごとのChannel Secret / Access Tokenを保存する。

## セットアップ

```bash
npm install
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run dev     # ローカル開発
npm run deploy  # Cloudflareへデプロイ
```

Supabase側は `supabase/migrations/0001_init_linema.sql` を実行してテーブルを作成する
（Supabase MCPからは直接流し込めないため、SQL Editorから手動実行を推奨）。

## LINE公式アカウント側の設定（テナント追加時）

1. LINE Developersでチャネル作成、Messaging API有効化
2. Webhook URLに `https://<worker-domain>/webhook/<tenantId>` を設定
3. `linema_channels` にそのテナントの `channel_id` / `channel_secret` / `channel_access_token` をINSERT

## APIエンドポイント（MVP）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/webhook/:tenantId` | LINEからのWebhook受信 |
| POST | `/api/tenants/:tenantId/linking-codes` | 顧客への連携コード発行（CRM君から呼ぶ） |
| GET | `/api/tenants/:tenantId/segments/:segmentId/preview` | セグメント該当人数プレビュー |
| POST | `/api/tenants/:tenantId/broadcasts` | セグメント配信の作成・即時送信 |

## 未確定・要対応（詳細はHANDOVER.md）

- CRM君の customers/tags 実スキーマ未確認 → `linema_segment_customer_ids()` はダミー実装
- channel_secret等の暗号化保存（現状は平文カラム）
- シナリオ配信（トリガー実行のCron/Queue設計）は未実装
