# HANDOVER.md — linema（LINE MAエージェント）

最終更新: 2026-07-06

## 現状

Phase 0〜MVPの初期スキャフォールドをこのセッションで作成。まだ**未デプロイ・未検証**。

作成したもの:
- `supabase/migrations/0001_init_linema.sql` — テーブル定義（linema_channels, linema_line_users, linema_linking_codes, linema_segments, linema_scenarios, linema_broadcasts, linema_delivery_logs）
- `src/index.js` — Workerルーター
- `src/webhook.js` — LINE Webhook受信・署名検証・連携コード処理
- `src/linking.js` — 連携コード発行・検証
- `src/broadcast.js` — セグメントプレビュー・配信送信
- `src/line.js` — LINE Messaging APIラッパー（署名検証はWeb Crypto使用、Node crypto非依存）
- `src/supabase.js` — Supabase REST/RPCの薄いラッパー
- `docs/spec.md` — 企画仕様書（競合比較・CRM連携アーキテクチャ・料金モデル等）

Node.js `--check` で全JSファイルの構文検証済み。

## 次にやること（優先順）

1. **CRM君の実スキーマ共有・確認**
   `linema_segment_customer_ids()` はダミー実装（タグ条件を無視して連携済み全員を返す）。
   CRM君の customers / tags の実テーブル名・カラム構成が分かり次第、JOIN条件を書き直す。
   → これが終わらないとセグメント配信の本質的な価値（CRM連携）が機能しない。

2. **Supabaseへのマイグレーション適用**
   `sfhtvtcmgueystyuhzvd` プロジェクトのSQL Editorで `0001_init_linema.sql` を実行。
   Supabase MCPからは直接流し込めない前提（ダッシュボード手動実行）。

3. **テスト用LINE公式アカウントでの疎通確認**
   - LINE Developersでテスト用チャネル作成
   - `linema_channels` にレコードを手動INSERT
   - Webhook URLを `https://<worker-domain>/webhook/<tenantId>` に設定して友だち追加→follow event確認
   - 連携コード発行→LINEでコード送信→`linema_line_users.customer_id` が更新されるか確認

4. **channel_secret / channel_access_token の暗号化保存**
   現状は平文カラム。本番投入前にSupabase Vaultへの移行、またはCloudflare Workers側のKV+暗号化を検討。

5. **シナリオ配信（Phase 2）の実行基盤**
   `linema_scenarios` テーブルは作成済みだが、トリガー判定・実行の仕組み（Cloudflare Cron Triggers想定）は未着手。

## 設計上の注意点（引き継ぎ時に忘れがちなポイント）

- LINE multicast APIは1回**最大500件**。`chunkArray()`で分割済みだが、大量顧客企業では配信に時間がかかる点に留意
- Webhookの署名検証は**Web Crypto API**（`crypto.subtle`）を使用。Node.js `crypto`モジュールはWorkers環境で使えないため要注意（他プロジェクトからのコード流用時に混同しやすい）
- マルチテナント設計のため、全APIパスに `tenantId` を含む。CRM君側からAPIを叩く際は必ずテナントIDを渡すこと
- 連携コードの有効期限は30分固定（`src/linking.js` の `CODE_TTL_MINUTES`）

## デプロイ前チェックリスト

- [ ] Supabaseマイグレーション適用
- [ ] `wrangler secret put SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 設定
- [ ] CRM君スキーマ確認・JOIN条件修正
- [ ] テスト用LINEチャネルでE2E疎通確認
- [ ] PAT失効（このセッションで使用したPATは作業後に無効化推奨）
