# Void 検証スパイク 結果（途中経過）

- 検証日: 2026-11-25
- 対象: `void@1.12.0`（回帰確認済み。初期検証は 1.11.0）、`@void/react@1.12.0`、`vite-plus@1.7.0`、`better-auth@1.7.28`、Node 24.22.0、pnpm 10.34.9
- 検証コード: `spike/`（ローカル検証）、`spike/mono/`（モノレポ検証）
- DB: Neon プロジェクト `void-spike`（`rough-salad-19719470`、`aws-ap-southeast-1`）。ロールは `app_user`（NOBYPASSRLS）と `neondb_owner`（バイパス用）

> **ステータス: ローカルと Cloudflare 実デプロイ（`spike-dev` / `spike-stg`）の検証を実施。未確認は GitHub Actions 実機と `stripe listen` 実機のみ。**

## 判定サマリ

| # | 項目 | ローカル | デプロイ/Hyperdrive | 暫定判定 |
|---|---|---|---|---|
| 1 | Neon + Drizzle | ✅ | ✅ | ✅ |
| 2 | テナントトランザクション + RLS | ✅（制約あり） | ✅（Hyperdrive 経由） | ✅ 条件付き（制約は項目 2 参照） |
| 3 | 共通 Hono ミドルウェア | ✅ | — | ✅ |
| 4 | Better Auth + organization | ✅（要対応事項あり） | — | ✅ |
| 5 | Stripe Webhook | ✅（署名は疑似生成） | — | ✅（`stripe listen` 実機は未確認） |
| 6 | Queue / Cron | ✅ | ✅（Cron は初回発火まで約 10 分） | ✅ |
| 7 | React 管理画面 | ✅（SSR なし前提。ブラウザ描画は未確認） | — | ✅ |
| 8 | モノレポ / LIFF | ✅ | ✅（`spike-admin` / `spike-liff`） | ✅ |
| 9 | デプロイと環境分離 | — | ✅（dev/stg 分離・非対話デプロイ）／GitHub Actions 未実施 | ⚠️ 回避策あり |

最重要の 2・3・5 はすべて ✅（2 は Hyperdrive 経由の本番でも確認、5 は署名の疑似生成による確認）。❌ はなく、不採用の条件には該当しない。残る ⚠️ は 9（環境分離の運用回避策）の 1 件で、回避策のコストは小さい。判定基準に照らすと **「条件付き採用」**（下記「最終判定」）。

---

## 1. Neon（Postgres）+ Drizzle 接続

- `void.config.ts` に `database: "pg"` を設定。`void init --starter postgresql` の構成そのまま。
- ローカル: `.env` の `DATABASE_URL` から Neon に直接接続し、`select 1` が通った（`/api/health` → `current_user = app_user`）。
- **D1 は作られない**: `vp build` の `worker.config.json` に D1 バインディングは無い。`better-sqlite3` のビルドも `allowBuilds: false` で不要。
- Hyperdrive 経由（本番 `spike-dev`）: `void deploy` が Hyperdrive を自動作成し、`/api/health` が `current_user = app_user` で `select 1` を返した。
- **重要**: `void deploy` は同じ `DATABASE_URL` を **Hyperdrive の作成とマイグレーションの両方**に使う。DDL 権限のある管理用 URL を渡すと本番のアプリが RLS をバイパスするロールで動いてしまう。アプリ用ロールの URL を渡すとマイグレーションが `permission denied for schema public` で失敗する。→ **`void deploy --skip-migrations` + アプリ用 `DATABASE_URL` で Hyperdrive を作り、マイグレーションは管理用ロールで別ステップとして適用する**運用にする。
- 気づき:
  - `void db migrate` はシェルの `DATABASE_URL` ではなく `.env` を読む。DDL 権限のあるロールで流すには `.env` の `DATABASE_URL` を管理用ロールにする必要がある。アプリ用ロールでは `permission denied for schema public`。
  - `vp dev` 起動時にも自動でローカル DB へマイグレーションを試みるため、アプリ用ロール（DDL 不可）だとエラーログが出る（動作には影響なし）。
  - `pg` が `sslmode=require` について警告を出す（libpq 互換への仕様変更予告）。

## 2. テナントトランザクションと RLS【最重要】

- `notes(id, tenant_id, body)` + `ENABLE ROW LEVEL SECURITY` + ポリシー `tenant_id = current_setting('app.tenant_id')::uuid`（USING / WITH CHECK）。マイグレーションは Drizzle 生成 SQL に追記。
- `app_user`（`rolbypassrls=false`、非スーパーユーザー）で接続できることを確認。
- ミドルウェア `db.transaction()` + `set_config('app.tenant_id', $1, true)`（= `SET LOCAL` 相当）で、同一コネクション（`pg_backend_pid` が一致）でハンドラが実行される。
- 確認できた挙動（`spike/middleware/01.tenant.ts`、`spike/routes/api/notes/`）:
  - テナント A / B の一覧が互いに見えない
  - A のリクエストから B の `tenant_id` で INSERT → RLS の WITH CHECK で拒否（500）
  - ハンドラが例外 → ロールバックされ書き込みが残らない
  - A/B 40 リクエスト並行でも混線なし
  - リクエスト中に 3 秒待機しても同一トランザクションを維持
  - テナント未設定で `notes` を読むと `unrecognized configuration parameter` で失敗（fail-closed）
- **制約（重要）**:
  1. `void/db` の `db` はリクエスト単位の **`max: 1` のプール**（`void/dist` のソースで確認。ドキュメントには記載なし）。テナントトランザクションがその唯一のコネクションを握るため、トランザクション中に `db` を直接使うコードは**待ち続ける（デッドロック）**。ハンドラは `c.get('tx')` だけを使う規約が必要。`packages/core` などにも `tx` を渡す設計にする。
  2. Hono はハンドラの例外を握りつぶして 500 を返すため、`await next()` の後に `c.error` / `status >= 500` を見て明示的にロールバックする必要がある。
  3. 案B（`db` に `BEGIN` / `SET LOCAL` を流し、ハンドラは素の `db` を使う）は、通常は動くが、プールの `idleTimeoutMillis: 1000` により**リクエスト途中で 1 秒以上クエリが空くと接続が閉じ、トランザクションが失われる**。採用不可。
- 「ルートハンドラはテナントを意識しない」は、`tx` をコンテキストから取る形で近似できるが、`db` 直接利用は不可という制約が残る。
- Hyperdrive 経由（本番）でも同じ結果: A/B の分離、偽装書き込みの拒否（500）、ロールバック（`/api/boom` の行が残らない）、3 秒待機でのトランザクション維持を確認。

## 3. 全 API 共通の Hono ミドルウェア

- `middleware/01.tenant.ts`（`defineMiddleware`）で、セッション取得 → `tenant_id` 決定 → トランザクション開始を一箇所で全ルートに適用できた。
- 除外: ミドルウェア内のパス判定で `/api/auth/*`、`/api/stripe/webhook`、`/webhook/line/*`、`/api/health` を除外できた（Webhook は `hasTx:false` を確認）。Void に除外専用の機構は無いが、公式ドキュメントも「公開 Webhook は自前ミドルウェア内で分岐」と案内している。
- `declare module 'void' { interface CloudContextVariables { ... } }` で `c.get('tx')` が型付けされる。

## 4. Better Auth + organization

- `auth.ts` の `defineAuth(({ defaults }) => ({ ...defaults, plugins: [organization()] }))` で有効化。`better-auth@1.7.28` をアプリに直接追加する必要がある（推移依存のため `better-auth/plugins` を解決できない）。
- 動作確認: サインアップ / サインイン、組織作成、アクティブ組織の切替（`set-active`）、メンバー招待（`invite-member`）、組織一覧。
- `void db generate` が Better Auth のテーブル（`user` `session` `account` `verification` `organization` `member` `invitation`）を Drizzle マイグレーションに含める。アプリのスキーマと同じマイグレーション系列で共存できた。
- **セッション → テナント連携**: ミドルウェアで `getSession()` から `activeOrganizationId` を取り、テナントトランザクションを張る流れが動いた（未ログイン・組織未選択は 401）。
- 要対応:
  - Better Auth の組織 ID は uuid ではなく 32 文字のランダム文字列。`CLAUDE.md` の「`tenant_id` は UUID v7」と合わない。検証では SHA-256 で uuid に写像したが、本実装は `tenant` テーブル（uuid v7）と `organization.id` の対応を持つ設計にする。
  - 生成された auth テーブルに `app_user` への GRANT が要る（`ALTER DEFAULT PRIVILEGES` で対応可）。
  - 検証用の `x-tenant-id` ヘッダ上書きは本実装では必ず削除する。

## 5. Stripe Webhook

- `c.req.text()` で生ボディを取得し、`stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, Stripe.createSubtleCryptoProvider())` で検証（workerd 上）。
- 正しい署名は 200（`event.account` も取得可）。ボディ改ざん・別シークレットは 400。ミドルウェア対象外。
- 制約: Stripe CLI が未導入のため `stripe listen` は未実施。署名は `generateTestHeaderString` で生成した。本番相当の疎通は Stripe CLI で別途確認する。

## 6. Queue と Cron

- `queues/count-notes.ts`（`defineQueue`）と `crons/heartbeat.ts`（`export const cron` + `defineScheduled`）を定義。
- ビルド成果物（`worker.config.json`）に `scheduled` トリガー、`queue` の consumer、`QUEUE_COUNT_NOTES` バインディングが自動導出されている。
- ローカル: producer（`queues['count-notes'].send`）→ consumer が動作。Cron は `/__void/scheduled`（開発用トークン）で起動。どちらも `createDb(env.DATABASE_URL_ADMIN)`（RLS バイパス用ロール）で全テナント横断の集計ができた（4 件）。
- 気づき: 新しい `queues/` を追加した後は dev サーバーの再起動が必要（`Missing Cloudflare binding 'QUEUE_*'`）。
- 本番（`void deploy`）: Queue（`spike-dev-count-notes`）と Cron トリガーが自動作成された。Queue は producer → consumer が動作し、`DATABASE_URL_ADMIN`（RLS バイパス用ロール）で専用テナントへ書き込めた（`queue-ran total=5`）。Worker 名が Queue 名に付く（`spike-stg-count-notes` も別に作成）。
- Cron（本番）: Cloudflare API でスケジュール登録を確認。**登録から初回発火まで約 10 分かかった**（登録直後の約 9 分間は発火せず、`wrangler tail` も無音）。その後 dev・stg の両方で `cron-ran` が管理用ロール経由で DB に書き込まれ、動作を確認した。デプロイ直後の Cron は遅れて始まる前提で運用・確認する。

## 7. React 管理画面

- `pages/dashboard.server.ts` の `requireAuth(c, { throwRedirect: '/login' })` で認証ガード。未認証は `/login` へ 302、認証済みは 200 で SSR。
- `@tanstack/react-query` の `useQuery` と `void/client` の型付き `fetch('/api/notes')` を組み合わせられた。`tsc --noEmit` が通り、サーバーの戻り値型（`rows[0].body: string`）がクライアントまで届く。
- SSR を使う場合のみ問題あり: SSR（dev）で React が二重に読み込まれ `useEffect` が null で 500 になる。`vite.config.ts` の `resolve.dedupe: ['react', 'react-dom']` で解消する。
- **SSR を使わない（`export const ssr = false`、ページ単位）場合は、`dedupe` なしで問題なし**: 認証ガード（未認証は 302）、認証済みの 200、`tsc` がすべて通り、ログに `useEffect` エラーなし。ローダーのデータは埋め込まれ、コンポーネントはクライアントでマウントされる。ブラウザでの実描画（ハイドレーション）は未確認（ブラウザ検証は未実施）。
- 方針（SSR 不要）では回避策が要らないため、項目 7 は ✅ とする。
- 気づき: `void prepare` を実行するまで `env` の型が `unknown` になる（`postinstall` で実行される）。

## 8. モノレポと LIFF

- `spike/mono/`（`apps/admin`、`apps/liff`、`packages/shared`）を pnpm 10 のワークスペースにした。
- 2 アプリとも `vp build` が成功し、それぞれ別の `.cloudflare/output` と Worker を生成。`@spike/shared`（TS ソース、Zod）が両方のバンドルに含まれ、`/api/hello` が共有コードを使って応答した。
- 気づき: 2 アプリを同時に `vp dev` するとワーカーのインスペクタポート（9230）が衝突する。個別起動なら問題なし。
- 本番: `cloudflare.name` を `spike-admin` / `spike-liff` にして `void deploy --skip-migrations` で別 Worker としてデプロイ。共有パッケージ経由の `/api/hello` がどちらも応答した。

## 9. デプロイと環境分離

- **非対話デプロイ**: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（または lock の固定）で、標準入力なし（`</dev/null`）の `void deploy` が完走した。`void cloudflare login` は Void が `CLOUDFLARE_AUTH_USE_KEYRING=true` を強制するため、Linux/WSL では `secret-tool` と D-Bus のシークレットサービスが必要で失敗した。**API トークンが確実**で、GitHub Actions もこの方式になる。GitHub Actions の実機実行は未実施（このディレクトリは git リポジトリではない）。
- **環境分離**: ドキュメントに「名前付き Cloudflare 環境は未対応。ターゲットごとに別の Void プロジェクト設定を使う」とある。`void.config.ts` の `cloudflare.name` を `process.env.SPIKE_WORKER_NAME` で切り替え、`spike-dev` と `spike-stg` を別 Worker としてデプロイできた。
  - Worker・Hyperdrive（`ae6fcdf1…` / `ba7dcd86…`）・Queue・シークレットが環境ごとに別。
  - Neon ブランチ（`main` / `stg`）を Hyperdrive の接続先にして、データも分離（stg にだけ書いた行が dev に出ない）。
  - **注意**: リソース ID・Worker 名・アカウント ID は `void.lock.json` が 1 ファイルで保持する。環境ごとに lock を分けて管理（`void.lock.dev.json` / `void.lock.stg.json` を deploy 前に `void.lock.json` へ配置）しないと、別環境が同じ Hyperdrive を再利用する。lock なしだと `No Cloudflare account is pinned` になるため `CLOUDFLARE_ACCOUNT_ID` も必要。→ ⚠️ 回避策あり（運用ルールで吸収できるが、自動化スクリプトが要る）。
  - シークレットは `void secret put <NAME>` が対象 Worker（`cloudflare.name`）ごとに設定される。事前に `void connect --platform cloudflare` が必要。標準入力からの投入が可能。
  - `env.ts` に `DATABASE_URL` を宣言すると本番で別途シークレットを要求される。さらに Void の接続先は「`DATABASE_URL` があればそれ、なければ Hyperdrive」の優先順（`void` のソースで確認）なので、**シークレット化すると Hyperdrive を迂回して直接接続になる**。pg では宣言せず、ローカル `.env` / 本番 Hyperdrive の自動解決に任せる。
- 気づき: デプロイ直後の数十秒、workers.dev が `error code: 1042`（404）を返す一時的な現象があった。

## 追加検証（ドキュメント精読後）

`node_modules/void/docs/` を全体にわたり確認し、実装・運用で効く点を追加で実測した。

### A. Hyperdrive のクエリキャッシュが有効のまま作られる（影響: 大）
- Void が直接デプロイで作る Hyperdrive は `caching.disabled = false`（Cloudflare API で確認）。ドキュメントには「Void platform は Hyperdrive のクエリキャッシュをオフにする」とあるが、**直接デプロイでは無効化されない**。
- 実測（本番 `spike-dev`）: トランザクション外の読み取り（`select count(*) from verification`）が、管理用ロールで行を追加した後も約 40 秒間古い値を返した。
- トランザクション内の読み取り（`/api/notes`）は、挿入直後でも常に最新だった。影響はトランザクション外の読み取りに限られる（Better Auth のセッション確認など。サインアウトや組織切替が最大約 1 分遅れる恐れ）。
- 対処（後から）: Cloudflare API で `PATCH /accounts/{id}/hyperdrive/configs/{id}` に `{"caching":{"disabled":true}}` を送る。無効化後は読み取りが即時に最新となり、**再デプロイ後も設定は維持された**。反映が各拠点に伝わるまで数秒〜十数秒の揺れがあった。環境ごとに実施する（初回デプロイ後のステップに組み込む）。
- **推奨**: Hyperdrive を事前に（キャッシュ無効・アプリ用ロールで）作成して Void に引き継がせる（G を参照。実測済み）。

### B. トランザクション中に Better Auth API を呼ぶと待ち続ける（影響: 中）
- `getAuth(c).api.getSession(...)` をテナントトランザクション中のハンドラで呼ぶと、`max: 1` のプールが詰まり応答しない（ローカルで確認、20 秒でタイムアウト）。
- `getUser()` / `getSession()`（リクエスト冒頭で読み込み済みの状態を返す）は問題なし。
- 対策: 認証系の API 呼び出しは `/api/auth/*` などテナントトランザクションの対象外ルートで行う。テナント内の処理では `getUser()` と `c.get('tx')` のみを使う。

### C. デプロイ・マイグレーションの分離はドキュメントどおり動く（落とし穴 2 の解消）
- 既存の Hyperdrive バインディングがあれば、`void deploy --skip-migrations` は **`DATABASE_URL` なしで成功**した（実測）。CI のデプロイジョブに DB 資格情報を持たせなくてよい。
- `DATABASE_URL=<管理用> void db status` / `void db migrate --remote` が、シェルの管理用 URL でリモート DB に対して動作した（実測。`Remote database is up to date.`）。自作スクリプトは不要。
- したがって CI は「マイグレーションジョブ（管理用 URL）」と「デプロイジョブ（DB 資格情報なし）」に分けられる。アプリ用 URL が必要なのは初回の Hyperdrive 作成時のみ。

### D. ドキュメントから分かった、設計に効く点
- **Queue**: 1 キューにつき consumer は 1 つ。Void 管理のキューに DLQ は設定されず、再試行を使い切ったメッセージは Cloudflare に削除される。一斉配信・月次請求は、失敗をDBに記録する設計が必要（`msg.retry({ delaySeconds })`、`maxRetries`、`retryDelay`、`maxConcurrency` は設定可）。キュー名は `<Worker名>-<キュー名>`（63 文字以内）。
- **デプロイの安全性**: 既定は `staged`（新 Worker の readiness 確認後にトラフィックを切替え、失敗時は直前の版へ自動復元）。`void project status|rollback` で版の確認と復元ができる。ただしロールバックは DB を戻さない。
- **ログ**: 直接デプロイの `void project logs` はライブテールのみで履歴はない。履歴は Sentry、または `cloudflare` 設定でのオブザーバビリティで補う（Worker 設定を素通しできる）。
- **Workers の CPU 制限**: Workers Free は 1 リクエスト 10ms まで（`worker.limits.cpu_ms`）。Better Auth のパスワードハッシュなどで超える恐れがあるため、本番は Workers Paid を前提にする。
- **テスト**: Vitest は Node 上で動き Worker を起動しない。バインディングは `vi.mock` で差し替える。RLS・トランザクションのテストは `packages/db` が実 Postgres（Neon ブランチ）に直接 `pg` で接続して行う。
- **Hyperdrive の接続上限**: 既定 20。Neon の接続数に合わせて調整する。
- **`DATABASE_URL` の優先順位**: Worker のシークレット `DATABASE_URL` があれば Hyperdrive より優先される（直接接続になる）。

### E. 検討した代替案
| 案 | 評価 |
|---|---|
| Void Platform（自社 Cloudflare への self-host） | プロジェクト単位の環境分離、保持されるログ・ロールバック、OIDC デプロイが得られる。ただし Workers for Platforms の有料プランと管理用 Postgres、運用負荷が必要で、`CLAUDE.md` の「Void Platform は使わない」と衝突する。現時点では不採用 |
| `DATABASE_URL` をシークレットにして Hyperdrive を使わない | lock の共有問題は軽くなるが、Hyperdrive のプールを失う。接続数・遅延が未検証。採用しない |
| Neon の組み込み連携（`void db connect --provider neon`、`NEON_API_KEY`） | 環境ごとの DB 作成を自動化できる候補。ブランチ運用との組合せは未検証 |
| Neon ブランチを PR ごとに作成して統合テスト・E2E | 本スパイクで stg ブランチ運用が機能。CI 設計に有望 |
| `void/live`（SSE + Durable Objects）、`void/durable`、`void/storage`（R2）、`void/kv` | 保護者との返信スレッドの即時反映、冪等性・レート制限、請求 PDF の保管などに使える。初回リリースには不要 |

### F. ウェブ版ドキュメント（void.cloud）との照合
- `https://void.cloud/<path>.md` で全 112 ページの Markdown を取得し、同梱版（1.11.0）と本文を比較した。ページ構成は同一。実質的な差があるのは 37 ページで、**ウェブ版は 1.12.0（2026-11-26 公開）相当**。
- 差の内容: プラットフォーム向けの AI セキュリティ監査、`sendEmail()` のカレンダー招待、`head()` のページ別 `titleTemplate`、`@auth-schema` の自動エイリアス、`useForm()` のネストしたエラー、Cloudflare トークンの権限モデル（初回は **Workers Admin**、既存 Worker の更新は **Workers Editor**、ルート/カスタムドメインを変更する場合は **Workers Routes Write**）。
- DB・トランザクション・Hyperdrive・Queue・Cron・環境変数・シークレット・マイグレーションに関する記述は、実質的に変更なし。本スパイクの結論は 1.12.0 でも変わらない見込み。
- 1.12.0 のソースを確認: リクエスト単位の `max: 1` プールと、`DATABASE_URL` が Hyperdrive より優先される挙動は不変。直接デプロイ側に Hyperdrive のキャッシュを無効化する処理は見当たらない（無効化はプラットフォーム導入処理のみ）。
- 1.12.0 の主な修正（本件に関係するもの）: 「新規アップロードした Worker バージョンの反映待ちでデプロイが失敗する」問題の修正、`inference.appType` を無視してデプロイされる問題の修正、デプロイ拒否時のエラー改善。
- 1.12.0 での再検証は **H で実施済み（全項目で回帰なし）**。

### G. 既存の Hyperdrive を事前作成して引き継がせる（採用推奨）
- Void は `<Worker名>-hyperdrive` という名前の既存の Hyperdrive を**見つけて引き継ぐ**（`adopted existing Hyperdrive config ...`）。実測で確認。
- 手順: Cloudflare API で、**アプリ用ロール・キャッシュ無効（`caching.disabled = true`）**の Hyperdrive を `<Worker名>-hyperdrive` で事前に作成 → `void deploy --skip-migrations`（`DATABASE_URL` なし）。
- 結果（`spike-adopt`）: 引き継ぎ後もキャッシュは無効のまま、接続ロールは `app_user`、トランザクション外の読み取りが挿入直後から最新（truth=8、アプリの読み取り=8）。
- 効果: 落とし穴 2（URL の共用）と、キャッシュ有効の問題（A）を**デプロイ前に断てる**。デプロイの CI には DB 資格情報が不要になる。
- 注意: lock に記録された Hyperdrive ID は、別環境の lock を流用すると引き継がれる。環境別の lock（または lock を使わず名前での引き継ぎに任せる運用）が必要。

### H. 1.12.0 への更新と回帰確認

`void` と `@void/react` を 1.11.0 → 1.12.0 に上げ、`tsc --noEmit` が通ることを確認したうえで、同一の確認スクリプト（`regress.sh`、25 項目）をローカルと本番で実行した。スクリプト自体の妥当性は、更新前の 1.11.0 本番での実行（23 項目成功。失敗 2 件は当時未デプロイの確認用ルートのため）で確認した。

| 実行 | 結果 |
|---|---|
| 1.11.0 本番（基準値） | 23 成功 / 2 失敗（想定どおり） |
| 1.12.0 ローカル（`vp dev`） | **25 / 25 成功** |
| 1.12.0 本番 `spike-dev` | **25 / 25 成功** |
| 1.12.0 本番 `spike-stg`（Hyperdrive キャッシュ有効のまま） | 22 成功 / **3 失敗** |
| 1.12.0 本番 `spike-stg`（キャッシュ無効化後） | **25 / 25 成功** |

確認内容（各 1 回の実行に含む）: 接続ロール `app_user`、A/B のテナント分離、偽装書き込みの拒否、ロールバック、3 秒待機でのトランザクション維持、20 本並行で混線なし、`getUser()` はトランザクション内で可、`getAuth(c).api` は従来どおり詰まる、ミドルウェアの除外、セッション→テナント、認証ガード（302/200）、組織の作成・切替・招待、Stripe 署名（有効 / 改ざん / 別シークレット）、Queue（producer→consumer が管理用ロールで書き込み）。

**項目別の結論（回帰なし）**
- 2: `max: 1` プールの挙動、`c.get('tx')` 経由の RLS、`getAuth(c).api` がトランザクション中に詰まる制約は、1.12.0 でも同じ。
- 3: 除外、セッション→テナント連携は同じ。
- 5: 生ボディ署名検証は同じ。
- 6: Queue は同じ。**Cron**（毎時）は本番で 01:00:20 / 02:00:20 / 03:00:20 / 04:00:20 に定刻発火し success（Cloudflare GraphQL で確認）。毎分 Cron も約 9.7 時間欠けず動作した。
- 9: 次の 6 点を 1.12.0 で確認。(a) 既存のトークン（Workers Scripts: Edit 相当）で非対話デプロイが成功（新しい権限モデルでも問題なし）、(b) `--skip-migrations` は `DATABASE_URL` なしで成功、(c) `DATABASE_URL=<管理用> void db status / migrate --remote` が動作、(d) dev / stg / adopt を別 Worker・別 lock で運用可、(e) **lock なし（新規クローン相当）でも事前作成の Hyperdrive を引き継ぎ（`adopted existing Hyperdrive config`）、キャッシュ無効のまま維持**、(f) モノレポの `spike-admin` / `spike-liff` を 1.12.0 で再デプロイして共有パッケージ経由で応答。
- 7: SSR なしの管理画面ページ（認証ガード 302/200、型）は 1.12.0 でも問題なし。

**新たな重要事項: Hyperdrive のキャッシュ有効は、実運用の操作を壊す**
- `spike-stg` の Hyperdrive（Void が作成、キャッシュ有効）では、「組織を作成した直後に `set-active`」が 400、続く「セッション→テナント」が 401 になった（3 件失敗）。作成直後の読み取りが古い結果を返したため。
- Hyperdrive のキャッシュを無効化すると、同じスクリプトが 25 / 25 成功した。
- したがって、キャッシュ無効化は任意の最適化ではなく**必須**。事前作成して引き継がせる方法（G）を標準手順にする。

**その他の観察**
- Cron のスケジュール変更（毎分→毎時）は Cloudflare 側の一覧には即反映されたが、毎分の旧トリガーが数分間残って発火し続けた（stg）。
- 新規の毎分 Cron は初回発火まで約 10 分（初期検証での観察）。以降は定刻。

---

## 最終判定: 条件付き採用

判定基準との照合:
- 2・3・5 はすべて ✅（2 は本番 Hyperdrive 経由でも確認）。
- ⚠️ は 9（環境ごとの lock・名前・ブランチの切替スクリプト）のみ。回避策のコストは小さい。
- ❌ は 0 件。内部実装の書き換えや非公開 API には触れていない（ただし 2 で `db` が `max: 1` プールであることをソースで確認した。ドキュメント未記載の挙動なので、バージョン固定と更新時の再検証が必要）。
- 手を止めるべき「抽象化と戦うハック」は発生しなかった。

採用にあたっての条件:
1. テナントトランザクション中は `c.get('tx')` のみを使い、`db` を直接使わない（デッドロック）。Void 更新時はこの挙動を回帰テスト（`regress.sh` 相当）で確認する。
2. マイグレーションは `void deploy` に任せず、管理用ロールで別ステップ実行（`--skip-migrations`）。
3. **Hyperdrive は事前にキャッシュ無効・アプリ用ロールで `<Worker名>-hyperdrive` として作成し、Void に引き継がせる（必須）**。
4. 環境分離は `cloudflare.name` + 環境別 `void.lock.<env>.json` + 環境別 Neon ブランチ + `CLOUDFLARE_ACCOUNT_ID` で行い、配置を自動化する。
5. CI の認証は `CLOUDFLARE_API_TOKEN`。
6. Better Auth の組織 ID と `tenant_id`（UUID v7）の対応表を設ける。

---

## `CLAUDE.md` への修正案（採用する場合）

1. **pnpm 10 以上**を前提にする（Void スターターの `pnpm-workspace.yaml` は pnpm 8 では読めない）。Node は 24.22 以上（`void` が要求）。
2. 「テナント分離」に追記: `void/db` の `db` はリクエスト単位の `max: 1` プール。テナントトランザクション中はハンドラ・`packages/core` とも `c.get('tx')` のみを使い、`db` を直接使わない。
3. `tenant_id`（UUID v7）と Better Auth の `organization.id`（文字列）の対応表（`tenant` テーブル）を設計に加える。
4. マイグレーション・Cron・Queue は管理用ロール、アプリは一般ロールに分け、`void db migrate` は管理用 URL で流す。
5. 管理画面は SSR なし（ページごとに `export const ssr = false`）とする。
6. ローカル dev: 初回デプロイ後は lock に Hyperdrive が入り、`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`（ローカル DB の接続文字列）が必要になる。
7. デプロイ手順: アプリ用 `DATABASE_URL` + `void deploy --skip-migrations`、マイグレーションは管理用ロールで別ステップ。環境ごとに `cloudflare.name`・`void.lock.<env>.json`・Neon ブランチ・`CLOUDFLARE_ACCOUNT_ID` を切り替える。CI は `CLOUDFLARE_API_TOKEN` 方式（`void cloudflare login` は WSL で不安定）。
8. `better-auth` はアプリの直接依存にする。

## 残作業

1. GitHub Actions からのデプロイ実機確認（項目 9）、`stripe listen` の疎通（項目 5）。
2. `CLAUDE.md` の更新（上記「`CLAUDE.md` への修正案」を反映）。
3. スパイク終了後のクリーンアップ: Cloudflare の `spike-dev` / `spike-stg` / `spike-admin` / `spike-liff` Worker、Hyperdrive、Queue（`spike-dev-count-notes`、`spike-stg-count-notes`）、Neon の `void-spike` プロジェクト（検証中に接続文字列が一度ログへ出力されたため）を削除。
