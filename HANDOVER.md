# HANDOVER.md — linema（LINE MAエージェント）

最終更新: 2026-07-06

## 現状

Phase 0〜MVPの初期スキャフォールドをこのセッションで作成、その後**設計の重要な軌道修正**を実施済み。まだ**未デプロイ・未検証**。

### 2026-07-06 重大な設計修正の経緯

当初、「CRM君の顧客データ・タグがLINE MAエージェントのセグメント条件になる」という前提でスキーマ・連携コード機構を作った（`customer_id`、`linema_linking_codes`）。

しかし実際の設計はこう:
- LINE MAエージェントは**外部システム（CRM君・予約GO）に一切依存しない自己完結型**
- セグメントの元データは「友だち登録時アンケート（性別・年代・趣味嗜好）」と「LINE上の行動」のみ
- CRM君はLINE MAエージェントの`usage-summary` APIを**読みに行くだけ**（一方通行）。逆方向のデータ連携はない

この修正に伴い、`customer_id`ベースの連携コード機構（`src/linking.js`、`linema_linking_codes`テーブル）を全廃し、
友だち登録時アンケートフロー（`src/survey.js`）に置き換えた。**もし過去の会話ログや古いドキュメントで
「CRM君のデータをLINE MAエージェントに使う」という記述を見つけたら、それは誤った初期設計であり現行仕様ではない。**

### 現在のファイル構成

- `supabase/migrations/0001_init_linema.sql` — テーブル定義。`linema_line_users`に`gender`/`age_group`/`interests`/`survey_state`等のアンケート項目を保持。`linema_segment_line_user_ids()`関数はJOINなしで自己完結フィルタ
- `src/index.js` — Workerルーター
- `src/webhook.js` — LINE Webhook受信・署名検証・アンケートフロー呼び出し
- `src/survey.js` — アンケートフロー本体（follow→性別→年代→趣味嗜好→完了）
- `src/broadcast.js` — セグメントプレビュー・配信送信
- `src/usageSummary.js` — サイトマイスター本体向け軽量サマリー（アンケート完了率ベース）
- `src/line.js` — LINE Messaging APIラッパー
- `src/supabase.js` — Supabase REST/RPCの薄いラッパー
- `docs/spec.md` — 企画仕様書
- `frontend/index.html`（ルートにも同一ファイル配置、GitHub Pages配信用） — 管理画面モックアップ

Node.js `--check` で全JSファイルの構文検証済み。

## 次にやること（優先順）

1. **フロントエンドデモの「顧客連携」画面をアンケート回答状況表示に作り直す**
   現状のデモ画面はまだ旧設計（連携コード・顧客ID）のまま。「友だちプロフィール」（性別・年代・趣味嗜好・アンケート完了状態）を見せる画面に置き換える必要がある。セグメントカードの条件例（「常連」「休眠」等CRM前提の名称）も、アンケート属性・LINE行動データベースの条件名に直す。

2. **Supabaseへのマイグレーション適用**
   `sfhtvtcmgueystyuhzvd` プロジェクトのSQL Editorで `0001_init_linema.sql` を実行。

3. **テスト用LINE公式アカウントでの疎通確認**
   - LINE Developersでテスト用チャネル作成
   - `linema_channels` にレコードを手動INSERT
   - Webhook URL設定→友だち追加→アンケートのquick replyが届くか確認→性別/年代/趣味嗜好の一連の流れをend-to-endで確認

4. **channel_secret / channel_access_token の暗号化保存**
   現状は平文カラム。本番投入前にSupabase Vaultへの移行を検討。

5. **趣味嗜好の入力方式改善**
   現状は自由テキスト入力をそのままタグ化（カンマ区切り分割のみ）。表記ゆれ（例:「ヘアケア」と「髪のケア」が別タグ扱いになる）が起きるため、将来的にはLIFFフォームでの選択式UIか、タグの正規化・名寄せロジックを検討。

6. **シナリオ配信（Phase 2）の実行基盤**
   `linema_scenarios` テーブルは作成済みだが、トリガー判定・実行の仕組み（Cloudflare Cron Triggers想定）は未着手。

## 設計上の注意点

- LINE multicast APIは1回**最大500件**。`chunkArray()`で分割済み
- Webhookの署名検証は**Web Crypto API**（`crypto.subtle`）を使用。Node.js `crypto`モジュールはWorkers環境で使えない
- マルチテナント設計のため、全APIパスに `tenantId` を含む
- アンケートの状態管理は`linema_line_users.survey_state`（not_started→asked_gender→asked_age→asked_interests→completed）。テキストメッセージ受信時、この状態が`asked_interests`の時だけ「趣味嗜好の回答」として扱う設計。それ以外のテキストは今は無視（Phase 2のチャットボット応答で対応予定）

## デプロイ前チェックリスト

- [ ] Supabaseマイグレーション適用
- [ ] `wrangler secret put SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 設定
- [ ] テスト用LINEチャネルでアンケートフローのE2E疎通確認
- [ ] フロントエンドデモの「顧客連携」画面を新設計に合わせて作り直す
- [ ] PAT失効（このセッションで使用したPATは作業後に無効化推奨）
