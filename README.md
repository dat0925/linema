# linema（LINE MAエージェント）

サイトマイスターの追加商材として、クライアント企業（美容室・飲食店等）向けにLINEセグメント配信を提供するCloudflare Workerバックエンド。単体販売も行う。

企画背景・競合比較・機能仕様は以下を参照:
- `docs/spec.md`（企画仕様書）
- `HANDOVER.md`（開発の申し送り・現状）

## アーキテクチャ（2026-07-06確定）

LINE MAエージェントは**外部システムに依存しない自己完結型**。CRM君・予約GO等、サイトマイスター側の他ツールのデータは一切参照しない。

```
LINE公式アカウント（テナント=クライアント企業ごと）
  ⇅ Messaging API
Cloudflare Worker（このリポジトリ）
  ⇅ REST/RPC
Supabase（sfhtvtcmgueystyuhzvd 共有プロジェクト、linema_* テーブル）
  ↑
  usage-summary API（読み取り専用・一方通行）
  ↑
サイトマイスター本体のLINEエージェント（御社→クライアント向け、更新依頼・Web提案担当）
```

セグメントの元データは2つだけ:
1. **友だち登録時アンケート**（性別・年代・趣味嗜好） — LINE MAエージェントが自前でLINE上のquick reply/テキストで収集
2. **LINE上の行動**（登録日・最終メッセージ日時）

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

## 友だち登録時アンケートの流れ

友だち追加 → 性別質問(quick reply) → 年代質問(quick reply) → 趣味嗜好(自由入力) → 完了。
`src/survey.js` がフロー全体を管理し、`linema_line_users` に `gender` / `age_group` / `interests` として保存する。

## APIエンドポイント（MVP）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/webhook/:tenantId` | LINEからのWebhook受信（follow/postback/message） |
| GET | `/api/tenants/:tenantId/segments/:segmentId/preview` | セグメント該当人数プレビュー |
| POST | `/api/tenants/:tenantId/broadcasts` | セグメント配信の作成・即時送信 |
| GET | `/api/tenants/:tenantId/usage-summary` | サイトマイスター本体（提案エンジン）向けの軽量利用状況サマリー |

## サイトマイスター本体との連携（提案への織り込み）

サイトマイスター本体のLINEエージェントが `usage-summary` エンドポイントを読みに行くことで、
クライアントへの提案文に「未導入なら効果イメージ」「導入済みなら実績」を織り込める。
データは**LINE MAエージェント → サイトマイスター本体の一方通行**。逆方向（CRM君のデータをLINE MAエージェントのセグメント条件に使う）は行わない。

**重要な制約**: LINE Messaging APIのpush配信には開封率（既読率）を取得する仕組みがない。
`usage-summary` は友だち数・アンケート完了率・配信回数など実際に取得可能な指標のみを返す。
フロントエンドのデモ画面にある「開封率」表示は削除済み。

## 未確定・要対応（詳細はHANDOVER.md）

- channel_secret等の暗号化保存（現状は平文カラム）
- シナリオ配信（トリガー実行のCron/Queue設計）は未実装
- アンケートの「趣味嗜好」入力は現状自由テキスト。将来的にはLIFFフォームでの選択式UIも検討
