# Void 検証スパイク（フェーズ0）

## 目的
Void（`npm i -D void`）を本プロジェクトの土台に採用できるかを 1〜2 日で判断する。
本番コードは書かない。各項目を最小のコードで確かめ、結果を `docs/void-spike-result.md` に記録する。

## 進め方のルール
- まず Void の公式ドキュメント（`node_modules/void/docs/` 同梱の Markdown を優先）を読み、各項目の想定実装を計画として提示してから着手する
- 1 項目ずつ「✅ 可 / ⚠️ 回避策あり / ❌ 不可」で判定し、根拠（動いたコード・エラー・ドキュメントの該当箇所）を残す
- Void の内部実装を書き換える・非公開 API に触るなど「抽象化と戦う」解決しかない場合は ⚠️ ではなく ❌ とする
- ドキュメントに書いていないことを推測で「できる」としない

## 検証項目

### 1. Neon（Postgres）+ Drizzle 接続
- `void/db` で Postgres を使う設定にし、ローカル開発 DB と、Neon への Hyperdrive 経由接続の両方で `select 1` が通るか
- D1 が勝手にプロビジョニングされないことを確認

### 2. テナントトランザクションと RLS【最重要】
- テスト用テーブル `notes(id, tenant_id, body)` に RLS ポリシー `tenant_id = current_setting('app.tenant_id')::uuid` を設定
- RLS を強制される一般ロールでアプリが接続できるか
- リクエスト単位でトランザクションを開始し `SET LOCAL app.tenant_id` を設定、ハンドラ内のクエリが同じトランザクション（同じコネクション）で実行されるか
- テナント A のリクエストからテナント B の行が見えないことをテストで確認

### 3. 全 API 共通の Hono ミドルウェア
- セッション取得 → tenant_id 決定 → トランザクション開始、をすべての API ルートに一箇所で差し込めるか
- 特定ルート（Stripe / LINE Webhook）だけ除外できるか

### 4. Better Auth + organization
- organization プラグインを有効化し、組織の作成・メンバー招待・アクティブ組織の切り替えができるか
- Better Auth のテーブルが Drizzle スキーマ・マイグレーションと共存できるか

### 5. Stripe Webhook
- 生ボディを取得し `stripe.webhooks.constructEventAsync` で署名検証できるか（Stripe CLI の `stripe listen` で確認）

### 6. Queue と Cron
- Queue の producer / consumer、Cron ハンドラを Void のアプリ内で定義でき、`void deploy` で自動プロビジョニングされるか
- consumer 内で（RLS バイパス用ロールで）DB にアクセスできるか

### 7. React 管理画面
- Void Pages + `@void/react` で、認証ガード付きのページと TanStack Query を組み合わせられるか
- サーバーの型がクライアントまで通るか

### 8. モノレポと LIFF
- pnpm モノレポで `apps/admin` と `apps/liff` を別々の Void アプリとしてデプロイでき、`packages/*` を共有できるか

### 9. デプロイと環境分離
- `void deploy` で dev / stg / prod を分けられるか（Hyperdrive 設定・シークレット・ドメインを環境ごとに）
- GitHub Actions から非対話でデプロイできるか

## 判定基準
- **採用**：2・3・5 がすべて ✅、その他に ❌ がない
- **条件付き採用**：2・3・5 が ✅、その他に ⚠️ があり回避策のコストが小さい
- **不採用**：2・3・5 のいずれかが ⚠️ 以下、または ❌ が 2 つ以上 → `CLAUDE.md` のフォールバック構成へ

## 成果物
- `docs/void-spike-result.md`：項目ごとの判定・根拠・回避策、最終判定、採用時の `CLAUDE.md` 修正案
- 検証用コードは `spike/` ディレクトリに置き、本実装には持ち込まない
