# 陸上クラブ管理SaaS

陸上クラブ（運営者・コーチ）と保護者をつなぐ管理アプリ。外販前提のマルチテナントSaaS。
最初のテナントは自社クラブ（BabbinoBrillare）。

> **現在の状態：Void を条件付きで採用（フェーズ0 完了）**
> Void（Vite + Hono + Better Auth + Drizzle を束ねる Cloudflare 向けフルスタック SDK）を、`docs/void-spike.md` の手順で検証した（`void@1.11.0` で実施し、`void@1.12.0` で回帰なしを確認）。
> 検証結果と根拠は `docs/void-spike-result.md`。採用の条件は、本ファイルの各ルール（「Void の使い方」「テナント分離」「デプロイと環境分離」）に反映済み。
> 検証コードは `spike/`（本実装には持ち込まない）。Void の更新時は `spike/regress.sh` 相当の回帰確認を行う。

## 初回リリースの機能
- 会員管理：保護者 1 : 子ども N（兄弟対応）。ステータスは 体験 → 入会 → 休会 → 退会、履歴を残す。規約同意日時を記録
- 売上管理：月謝・入会金・年会費・大会参加費などを「請求」として発行し入金を消し込む。Stripe入金と手動消込（現金・振込）を同じ形で記録
- メッセージ管理：全体・クラス別・個別配信、既読管理、保護者との返信スレッド
- スケジュール管理：繰り返し練習日＋個別上書き（雨天中止など）、出欠、振替
- イベント管理：大会ごとの種目エントリー受付・締切。参加費は確定時に請求へ自動連携
- マスタ管理：会場、クラス（学年帯）、料金プラン・割引ルール、種目、コーチ、学年繰り上げ

## 技術スタック
- フレームワーク：Void SDK（`void` + `@void/react`、**バージョンは `1.12.0` に固定**）。Vite+ ツールチェーン。Node.js 24.22 以上
- 実行環境：Cloudflare Workers（Queues / Cron / R2 / Hyperdrive）。デプロイは `void deploy` で自社の Cloudflare アカウントへ直接（Void Platform は使わない）。本番は Workers Paid（Workers Free は CPU 10ms/リクエストで、パスワードハッシュ等が収まらない恐れがある）
- API：Void のサーバールート（内部は Hono）+ **Valibot**（`defineHandler.withValidator` は Standard Schema を受ける）。**バリデーションは Valibot に統一し、`zod` を直接 import しない**（`architecture/architecture.test.ts` が強制）。理由: 共有スキーマはブラウザ（特に LINE アプリ内の LIFF）にも配信され、同じスキーマのバンドルが Valibot 1.9 KB / Zod mini 6.6 KB / Zod 23.1 KB（gzip、実測）。Better Auth が内部で Zod を使うため、管理画面のサーバー側には Zod が入るが、こちらのコードでは使わない。表をそのまま映す入力は `void/drizzle-valibot` で導出してよい（最外周のみ）
- DB：Neon（PostgreSQL）+ Drizzle（`void/db`）。本番は Hyperdrive 経由。**D1 は使わない**
- 管理者認証：Better Auth（organization プラグイン：クラブ＝組織、コーチ・事務＝メンバー）。`better-auth` はアプリの直接依存にする
- 保護者認証：LIFF IDトークンをサーバーで検証 → 自前セッション発行
- 決済：Stripe Connect（**Express アカウント。プラットフォームが保護者から集金し、各クラブへ送金する**。Destination charges か Separate charges and transfers かは、フェーズ 8 で決める。application fee）。クラブに Stripe の知識を要求しないため。**制度面・責任面は確認待ち**（下の「Stripe」）
- 管理画面：React（Void Pages のルーティング、**SSR なし**：各ページの `.server.ts` で `export const ssr = false`）+ TanStack Query / Form / Table + **React Aria Components**
- 保護者画面：LIFF（Void + React、同じく SSR なし）、管理画面とは別アプリ・別 Worker
- UI 部品：**React Aria Components（RAC）+ Tailwind CSS**（RAC は Adobe 製。スタイル無しのアクセシブルな部品で、カレンダー・日付ピッカー・テーブル・コンボボックスを含み、ロケールとモバイルのタッチ操作に強い）。選定の根拠は、日付・カレンダー中心の業務アプリで、モバイル（LIFF）と国際化が要ること。代償は、Radix 系（shadcn/ui）より大きいこと（ダイアログ + セレクトで gzip 約 +56 KB 対 +30 KB、日付ピッカーで +74 KB。実測）と、見た目を自前で作ること。**shadcn/ui など、他の UI ライブラリは導入しない**
  - **見た目は Tailwind のユーティリティで書く**。Tailwind 4 + `@tailwindcss/vite` + `tailwindcss-react-aria-components`（RAC の状態を `pressed:` `focus-visible:` `selected:` `disabled:` などの接頭辞で書けるプラグイン）。**Void 上で、ビルド・状態の接頭辞の展開・モバイルファーストの `md:`・RAC のコンポーネントテストが動くことを実測済み**。ページのレイアウト（余白・並び・スマホと PC の切り替え）が大半なので、ここを速く一貫して書くのが採用の理由
  - **導入済み**（`apps/admin` と `apps/liff`。`react-aria-components`、`tailwindcss`、`@tailwindcss/vite`、`tailwindcss-react-aria-components` を exact で固定）。CSS は、各アプリのルートのレイアウト（`pages/layout.tsx`）で 1 回だけ読み込み、ブラウザで適用されることを確認済み
  - デザイントークン（色・余白など）は、`apps/<app>/styles/app.css` の `@theme` に集める。値は、最初の画面で決める。ユーティリティで書けないもの（アニメーションの定義など）だけ、同じ CSS ファイルに素の CSS を足す（YAGNI）
  - 部品は `apps/<app>/components/ui/` に、自分たちの薄いラッパーとして、必要になった順に置く。長いクラスの文字列は、ここに閉じ込める
  - **最初の画面で確かめる**（未検証）: Void の `Link`（クライアントナビゲーション）との連携、日本語入力（IME）中の挙動、LIFF のページごとのバンドルサイズ（極端に増えたら見直す）
- 整形・リント・型：Vite+ の **`vp check`**（Oxfmt = 整形、Oxlint = リント、型チェック。Biome・ESLint・Prettier は使わない）。設定はルートの `vite.config.ts`。Oxlint は `typescript` `unicorn` `oxc` に加えて **`react`（フック・React Compiler の規則）と `jsx-a11y`（アクセシビリティ。React Aria と合わせて守る）**を有効にし、型を使う検査（`typeAware` / `typeCheck`）も有効。Oxfmt は **Tailwind のクラスを公式（prettier-plugin-tailwindcss）と同じ順に並べる**。Markdown・YAML・JSON・SQL は整形の対象外。CI で `vp check` を実行し、コミット前のフックは Lefthook（`vp install` で自動有効）
- モノレポ：pnpm **10 以上**（Void スターターの `pnpm-workspace.yaml` は pnpm 8 で読めない）。**操作は `vp` に統一する**（`vp install` / `vp run` / `vp test`）。`vp` は `package.json` の `packageManager`（`pnpm@10.34.9`）に従い pnpm を自動で選ぶ（PATH の pnpm は使わない）。CI は `voidzero-dev/setup-vp`（コミットで固定。`v1` タグは更新されないので使わない）
- テスト：Vitest（**`vp test`**、テストは `vite-plus/test` から import する。`vitest` を別途入れない：Vite+ が vitest 5.1 を取り込むため、二重化するとバージョンがずれる）、E2E は Playwright
- 監視・CI：Sentry（`@sentry/cloudflare`。**パッケージは導入済みだが、Void への組み込みは未検証**＝最初の機能で、Void のワーカーのエントリと合わせて確認する）、GitHub Actions + `void deploy`（dev / stg / prod）。直接デプロイのログはライブテールのみで履歴が残らないため、Sentry を必須とする
- 日付：**計算は `@internationalized/date`**（`packages/core` の `domain/date.ts`。React Aria の日付部品と型が揃う。日本は夏時間がないので Asia/Tokyo 固定）、表示は標準の `Intl`。「日付」（練習日・誕生日・請求月）は Postgres の `date` 型、時刻だけ `timestamptz`。date-fns は、足りない計算が出たときだけ足す
- テストの補助：`fast-check`（性質ベース。`packages/core`。請求・割引・学年・日付の境界）、`drizzle-seed` と `@faker-js/faker`（`make seed` の中身。`apps/admin`。実在の個人情報は使わない）
- 依存の更新：**Dependabot**（`.github/dependabot.yml`。毎週月曜、グループ化）。`void` と `@void/*` は対象外（リリースノートと回帰確認の後に手で上げる）。PostgreSQL のメジャー（Docker）も手で決める
- 秘密情報の混入検査：gitleaks（CI は `gitleaks-action` をコミット固定。ローカルは Lefthook が、入っていれば実行する。入れる: `brew install gitleaks`）

### フォールバック構成（Void を使えなくなった場合のみ）
Hono + `@cloudflare/vite-plugin` + wrangler で同じ構成を組む。React は Vite SPA + TanStack Router、Worker の Static Assets で配信し `/api/*` は Worker 優先。
`packages/` 以下（スキーマ・ドメインロジック・Valibot）はどちらの構成でもそのまま使えるよう、Void 固有の API に依存させない。

## ディレクトリ構成
```
apps/
  admin/        管理画面 + 管理API（1 Worker）
  liff/         保護者向け LIFF + 保護者用API（1 Worker）
packages/
  db/           Drizzle スキーマ（正本）、repositories（ports の実装）、queries（読み取り用）、テナントトランザクションヘルパ、RLS の SQL
  core/         domain（純粋関数: 請求計算・割引・振替など）/ ports（データアクセスの interface）/ application（ユースケース）。フレームワーク非依存
  shared/       Valibot スキーマ、型、定数
  line/         LINE Messaging API / IDトークン検証クライアント
  stripe/       Stripe Connect ラッパ
deploy/
  <env>/<app>/  環境（dev / stg / prod）× アプリごとの void.lock.json（コミットする）
  scripts/      環境切替・マイグレーション・Hyperdrive 作成・デプロイ後検証のスクリプト（`cli.mts`）
  sql/          ローカル Postgres の初期化（アプリ用・管理用ロール）
architecture/        層の依存方向を機械的に守るテスト（architecture.test.ts と rules.ts）
.github/            ワークフロー（ci / provision / deploy）、PR テンプレート
.claude/            rules（architecture / testing）、skills（commit / pr / tdd-*）、scripts（スクショ撮影）
lefthook.yml        コミット前フック（Lefthook。ホストで、ステージされた TS を vp check で検査）
docs/
  work/                 機能ごとの作業ノート（README.md がテンプレート）
  design-principles.md  設計原則（KISS・YAGNI・DRY・SOLID）
  void-spike.md         検証手順
  void-spike-result.md  検証結果（フェーズ0）
spike/                  検証用コード（本実装に持ち込まない。回帰確認 regress.sh を含む）
```

## 必ず守る設計ルール

### Void の使い方
- Void は「ルーティング・リソース定義・マイグレーション・デプロイ」の層として使う。ドメインロジックは `packages/core` に置き Void に依存させない
- Void の仕組みで書けない処理（テナントトランザクション、Webhook の生ボディ検証など）は、Void が露出する Hono コンテキストで素直に書く。抽象化と戦うようなハックが必要になったら、手を止めて報告する
- Void のバージョンは固定し、更新時は GitHub のリリースノートとドキュメントの差分を確認してから上げる。更新後は `spike/regress.sh` 相当の回帰確認（テナント分離、トランザクション、Webhook、Queue / Cron、デプロイ）を必ず通す
- ドキュメントは `node_modules/void/docs/`（同梱）と `https://void.cloud/<パス>.md`（最新）。同梱版は固定バージョンのものなので、挙動を疑うときはソース（`node_modules/void/dist`）も確認する
- テストは `vp test`（Vitest。Node 上で動き Worker を起動しない）。バインディングは `vi.mock` で差し替える。RLS・トランザクションのテストは `packages/db` から実 Postgres（Neon ブランチ）へ直接接続して行う

### テナント分離
- テナントに属する全テーブルに `tenant_id` を持たせ、Postgres の RLS で絞る（`ENABLE ROW LEVEL SECURITY` + `USING` / `WITH CHECK`）
- リクエストごとにトランザクションを開始し `set_config('app.tenant_id', ..., true)`（= `SET LOCAL`）を設定する。これは全 API 共通のミドルウェアで一箇所に行う。ミドルウェアはパス判定で Webhook（`/api/stripe/webhook`、`/webhook/line/*`）、`/api/auth/*`、ヘルスチェックを除外する
- **トランザクション中のハンドラは `c.get('tx')` だけを使い、`void/db` の `db` を直接使わない**。Void の `db` はリクエスト単位の `max: 1` のプールで、トランザクションがその唯一の接続を握るため、`db` を使うと応答が返らなくなる（検証済み。ドキュメント未記載）。`packages/core` や `packages/db` のヘルパにも `tx` を引数で渡す
- **トランザクション中に Better Auth の API（`getAuth(c).api.*` など DB に触れるもの）を呼ばない**（同じ理由で詰まる）。リクエスト冒頭で読み込み済みの `getUser()` / `getSession()` は使える。認証系の操作は、トランザクションの対象外ルート（`/api/auth/*` など）で行う
- ミドルウェアは `await next()` の後で `c.error` / `status >= 500` を見て、明示的にロールバックする（Hono はハンドラの例外を握りつぶして 500 を返すため）
- `db` に `BEGIN` / `SET LOCAL` を流す方式は使わない（プールの `idleTimeoutMillis: 1000` により、1 秒以上クエリが空くとトランザクションが失われる）
- `neon-http` ドライバは対話的トランザクションが使えないため使用しない
- アプリ用 DB ロール（`NOBYPASSRLS`、非スーパーユーザー）は RLS を強制される一般ロールにする。RLS をバイパスする管理用ロールは、マイグレーション・Cron・Queue consumer・Webhook など明示した箇所でのみ使い、`createDb(env.DATABASE_URL_ADMIN)` で別接続にする
- テナント未設定のクエリは `current_setting` のエラーで失敗する（安全側に倒れる）設計を維持する
- テナント配下に「拠点（会場・教室）」を持てる2階層構造にする

### デプロイと環境分離
Void に名前付き環境はない（ドキュメントにも「ターゲットごとに別の設定を使う」とある）。環境は次の組合せで分ける。dev / stg / prod で同じ手順を使う。

- **Worker 名**：`void.config.ts` の `cloudflare.name` を環境変数から切り替える。キュー名は `<Worker名>-<キュー名>`（63 文字以内）になる
- **lock**：`void.lock.json` は 1 ファイルでアカウント ID・Worker 名・Hyperdrive ID を持つ。環境 × アプリごとに `deploy/<env>/<app>/void.lock.json` を管理し、デプロイ直前に配置する。別環境の lock を流用すると、その環境の Hyperdrive（= DB）に接続してしまう
- **DB**：環境ごとに別の Neon ブランチ（または別プロジェクト）にする
- **Hyperdrive は事前に作る（必須）**：Void が自動作成する Hyperdrive は**クエリキャッシュが有効のまま**で、トランザクション外の読み取りが最大約 1 分古くなる（Better Auth の組織作成直後の切替が失敗する等、実害を確認済み）。そのため、`<Worker名>-hyperdrive` という名前で、**キャッシュ無効（`caching.disabled = true`）・アプリ用ロール**の Hyperdrive を Cloudflare API で事前に作成し、Void に引き継がせる（`adopted existing Hyperdrive config` と表示される）。lock がなくても引き継がれる。Hyperdrive の接続数上限（既定 20）は Neon の接続数に合わせて調整する
- **Worker のシークレットに `DATABASE_URL` を入れない**：`DATABASE_URL` があると Hyperdrive より優先され、Hyperdrive を迂回して直接接続になる。`env.ts` にも宣言しない（ローカルは `.env`、本番は Hyperdrive の自動解決）
- **管理用の接続**は `DATABASE_URL_ADMIN` という別名のシークレットにし、環境ごとに `void secret put`（標準入力から投入）する。`void secret sync <file> --yes` も使える
- **マイグレーションは `void deploy` に任せない**：`void deploy` は同じ `DATABASE_URL` を Hyperdrive の作成とマイグレーションの両方に使うため、管理用の URL を渡すと本番アプリが RLS をバイパスするロールで動く。`DATABASE_URL=<管理用> void db migrate --remote` を別ジョブで実行し、デプロイは `void deploy --skip-migrations`（アプリ用 Hyperdrive があれば `DATABASE_URL` は不要）で行う
- **デプロイ後の検証**：`/api/health` 相当で接続ロールが `app_user` であること、Hyperdrive のキャッシュが無効であること（Cloudflare API）、Queue と Cron の登録を確認する。デプロイ直後の数十秒は一時的に 404（`error code: 1042`）が返ることがあるので、スモークテストにはリトライを入れる
- **CI の認証は `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`**（環境ごとに GitHub Environments のシークレット）。`void cloudflare login` は WSL / Linux で `secret-tool` と D-Bus が必要になり不安定なため使わない。デプロイジョブには DB 資格情報を渡さない。マイグレーションジョブだけが `DATABASE_URL_ADMIN` を持つ
- 新しい Cron は、デプロイから初回発火まで約 10 分かかることがある（以降は定刻）。デプロイ後の即時確認の対象にしない
- 本番ロールバックは `void project rollback`（Worker の版のみ。DB は戻らない）。デプロイは既定の `staged`（readiness 確認後に切替え、失敗時は自動で元の版に戻る）

### 認証
- **権限モデルは `docs/design/permissions.md`**（標準ロール = 運営者・事務・コーチ、クラブが作れるカスタムロール、拠点の絞り込みはメンバーごと、権限カタログ、昇格の防止、保護者は関係で決まる）。権限カタログは `packages/shared`、認可の純粋関数（`authorize` / `siteScope` / `canDefineRole` / `leavesAtLeastOneAdmin`）は `packages/core/src/domain`。
- Better Auth は organization プラグインを有効にし、アクティブな組織から tenant_id を決定する
- Better Auth の組織 ID は uuid ではなくランダム文字列。`tenant` テーブル（UUID v7）に `organization.id` との対応を持たせて `tenant_id` に変換する（検証時の SHA-256 による写像は使わない）。検証用の `x-tenant-id` ヘッダによる上書きは本実装に持ち込まない
- 認証系のテーブルは `void db generate` のマイグレーションに含まれる。アプリ用ロールに必要な GRANT（`ALTER DEFAULT PRIVILEGES` 等）をマイグレーションに含める
- 保護者は `liff.getProfile()` の結果を信用しない。必ず IDトークンをサーバーへ送り、LINE の検証エンドポイントでテナントのチャネルIDと照合する
- 保護者と会員（子ども）の紐付けは招待コード / QR 経由で行う

### LINE
- LINEログインチャネル・Messaging APIチャネル・LIFF ID はテナントごとに保存。両チャネルは同一プロバイダー配下（ユーザーIDがプロバイダー単位のため）
- シークレット類は暗号化して保存
- Webhook は `/webhook/line/:tenantId`、署名検証必須
- 一斉配信は Queue に積み、レート制限内で順次送信。送信結果・通数をDBに記録
- 通知は短文＋LIFFへのリンク。本文はLIFFで表示し既読を取る

### Stripe
**方針（決定済み）**: Stripe Connect の **Express アカウント**で、**プラットフォームが保護者から集金し、各クラブ（連結アカウント）へ送金する**。クラブは Stripe のフル機能のダッシュボードを使わず、入金先の登録（本人確認・銀行口座）だけを、Stripe のホスト型フローで行う。資金は Stripe の残高上を動き、プラットフォームは自前の銀行口座で預からない。

**確認待ち（フェーズ 8 の実装の前に解消する）**
- Stripe サポートに、**任意団体・個人事業主の Express 登録の可否**と、Express の追加費用の額を確認する（公式の記述が見つかっていない）。
- **弁護士**に、収納代行の整理（資金決済法）と、特商法の表記（売主がプラットフォームかクラブか。`on_behalf_of` の有無）を確認する。**税理士**に、インボイス（請求書の発行者。免税事業者のクラブには、媒介者交付特例が使えない）を確認する。
- **責任の移動を設計する**: Express では、返金・チャージバック・不正利用・残高不足の責任がプラットフォームに移る。クラブの審査、差戻し（送金の取消）できない場合の損失の扱い（契約・保証金・与信）を決める。
- 手数料: 「料金体系を貴社が管理」する場合、アクティブなアカウント 1 つにつき月 ¥200、入金 1 件ごとに 0.25% + ¥250（2026-11-28 時点。公式の料金ページ）。

**実装の規約**
- 請求・入金は、**決済の ports（「請求を決済する」「入金を記録する」など）の裏に隠す**。`packages/core` は Stripe を知らない（`packages/stripe` が ports の実装）。結果次第で、アカウントタイプや課金方式を差し替えられるようにする。
- 月謝は Stripe Subscriptions に依存しない。請求は自前 DB で確定させ（兄弟割引・休会・日割り・振替で毎月変わるため）、保存した支払い方法に対して PaymentIntent で off-session 決済する（保護者には「毎月自動で引き落とされる」体験）。この方式の公式ドキュメントの確認は、フェーズ 8 で行う。
- Webhook は `/api/stripe/webhook`、認証の外。生ボディを取得し `constructEventAsync` で検証（同期版は Workers で不可）。
- イベントの `account`（連結アカウント）からテナントを特定する。処理済みイベント ID を保存し冪等にする。Stripe API 呼び出しには冪等キーを付ける。
- 現金・振込の手動消込は、Stripe 入金と同じ形で記録する（ports の別の実装）。

### データ・コーディング規約
- TypeScript strict。`any` 禁止
- 金額は円の整数（`integer`）。浮動小数点は使わない
- 日時は `timestamptz`（UTC保存）、表示と日付境界の計算は Asia/Tokyo
- ID は **UUID v7**（時刻順に並ぶ）。**DB が採番する**: `uuid` 型で、既定値は `uuidv7()`（**PostgreSQL 18 の標準関数**。拡張・ライブラリは不要。ローカルは `postgres:18`、Neon も 18 を使う）。Drizzle は `uuid('id').primaryKey().default(sql\`uuidv7()\`)`。アプリで採番しない（ID ライブラリを入れない）。`tenant_id` も `uuid`。Postgres 17 以前には `uuidv7()` がないので、本番・stg・dev の Neon は **18 以上**にする
- 入力バリデーションは `packages/shared` の Valibot スキーマを API とフォームで共用
- 業務ルールは `packages/core/src/domain` に純粋関数として置き、単体テストを書く。I/O を伴う書き込みの流れは `application`（ユースケース）に置く
- 重い処理（PDF生成、一斉配信、月次請求生成）は Queue 経由。Workers の CPU 制限に注意
- Queue は 1 キューにつき consumer 1 つ。Void 管理のキューには DLQ がなく、再試行を使い切ったメッセージは削除される。処理の成否と失敗理由は必ず DB に記録し（`message_delivery` など）、`msg.retry({ delaySeconds })` と `maxRetries` / `retryDelay` / `maxConcurrency` を明示する。consumer は冪等にする
- Queue consumer と Cron は管理用ロールで動く（RLS をバイパスする）。テナントの条件は SQL で明示的に付け、他テナントのデータに触れないことをテストで確認する
- 個人情報（子どもの氏名・生年月日など）をログに出さない
- シークレットは `.dev.vars` 等に置き、git に含めない

## レイヤー構成

**Void の規約を最外周に置き、その内側に、関数ベースの改良オニオンを収める。** 迷ったら Void の推奨に合わせ、オニオンの規則はその内側で適用する。
**内側は外側を知らない**（`architecture/architecture.test.ts` が機械的に強制する）。

```
最外周（Void の規約。薄く保つ）: apps/<app>/routes・pages/*.server.ts・middleware・queues・crons
    │ 書き込み・業務ルール                   │ 読み取り（画面用）
    ▼                                       ▼
 core/application（ユースケース）        db/queries（読み取りクエリ）
    │ ports（関数型 interface）◀── 実装 ── db/repositories
    ▼
 core/domain（純粋関数）  →  shared（Valibot・型・権限カタログ）
```

- 最外周は、検証（Valibot）・認可・テナントの `tx`・ports の組み立て・ユースケースの呼び出し・応答の整形だけを行う。Void の型パイプライン（Drizzle のスキーマ → ハンドラ・loader → 型付き `fetch` / `InferProps`）を活かす。
- 改良点: クラス・DI コンテナを使わない / **読み取りは直接クエリ、書き込みと業務ルールはユースケース**（CQRS-lite）/ `tx` は明示的に ports へ束縛して渡す。
- `void/*` を import できるのは最外周だけ（Void のリソース推論は `apps/*` の `routes/` `pages/` `queues/` `crons/` `middleware/` `src/` だけを走査するため）。

詳細・責務・割引ルールの拡張方法は `.claude/rules/architecture.md`、テストの層は `.claude/rules/testing.md`、設計の物差しは `docs/design-principles.md`。

## 開発の進め方

### コマンド（アプリは `vp` に統一、Docker は `make`。ホストで動かす初回は `npx -y -p vite-plus@1.7.0 vp install`）

| 目的 | コマンド |
|---|---|
| 依存のインストール | `vp install` |
| 開発サーバー | `vp run -F @club/admin dev`（http://localhost:5301）/ `vp run -F @club/liff dev`（5302）。ポートは固定（他プロジェクトと衝突しない）。同時起動はインスペクタのポートが衝突するので別々に |
| ローカル環境（Docker。アプリ 2 つ + Postgres） | **`make up`** / `make down` / `make logs` / `make db-reset` / `make seed` / `make migrate` / `make test-all` / `make ci`（`make help`）。Docker のコマンドは **Makefile に集約**する（`package.json` に Docker のスクリプトを置かない） |
| ローカル Postgres だけ（結合テスト用） | `make db-up` / `make db-down` |
| 静的チェック（整形・リント・型） | `vp check`（直す: `vp check --fix`） |
| 型チェック（全パッケージ・アプリ） | `vp run typecheck` |
| テスト | `vp run test:unit`（単体 + 依存方向）、`vp run test:integration`（実 Postgres）、`vp run test:apps`（画面）、`vp run test:all` |
| ビルド | `vp run build` |

コミット前のフックは Lefthook（`lefthook.yml`）。**ホストで動く**（コンテナ内では動かさない）ので、コミットする人は、ホストで `vp install` しておく（`prepare` で自動的に有効になる。手動: `vp exec lefthook install`）。検査のみで、ファイルは書き換えない。違反は `make fix` / `vp check --fix` で直す。

### 機能ごとの TDD（5 フェーズ。1 つずつ、明示的に起動する）

作業ノート `docs/work/<機能名>.md`（`docs/work/README.md` のテンプレート）に状態を残し、会話に頼らない。
**画面** = Void Pages（`apps/<app>/pages`）、**サーバー** = API・ドメイン・DB（`routes` などの最外周、`packages/core`〈domain / ports / application〉、`packages/db`）。

`/tdd-front-test-outline` → `/tdd-front-test-code`（Red を目視）→ `/tdd-front-impl`（デザイン確認）→ `/tdd-server-test-outline` → `/tdd-server-test-code`（Red を目視）→ `/tdd-server-impl`（全層 Green）→ `/tdd-refactor`

- **Red を必ず目視する**（落ちるところを見ていないテストは、対象を検証できていなくても気付けない）。
- テストの assert は、実装フェーズで弱めない。食い違ったらユーザーに確認し、仕様の変更はアウトラインに戻る。
- 仕様は grilling で詰め、「未決事項」が空になるまで次へ進まない。

### Git・PR

- ブランチ: `feature/<Issue番号>-<英語のスラッグ>`（他は `fix/` `chore/` `docs/`）。`main` に直接コミットしない。
- コミット: `/commit`（`[種別]#Issue番号 日本語の要約`。種別は `[add]` `[fix]` `[refactor]` `[test]` `[docs]` `[chore]`）。push はしない。
- PR: `/pr`（`--draft` / 通常 / `--ready`）、レビュー対応は `/pr-review-respond`。本文の書式は `.github/PULL_REQUEST_TEMPLATE.md`。

## ドメイン用語
| 日本語 | コード上の名前 |
|---|---|
| テナント（クラブ） | tenant / organization |
| 拠点 | site |
| 保護者 | guardian |
| 会員（子ども） | member |
| クラス | class_group |
| 料金プラン | fee_plan |
| 請求 | invoice / invoice_item |
| 入金 | payment |
| 練習日程 | session（繰り返しは session_series） |
| 出欠 | attendance |
| 振替 | makeup |
| 大会・イベント | event / event_entry |
| 種目 | discipline |
| 配信 | broadcast / message_delivery |

## 実装の進め方（フェーズ）
0. ~~Void 検証スパイク~~ **完了**（条件付き採用。`docs/void-spike-result.md`）
1. ~~モノレポ雛形、CI、dev / stg / prod 環境~~ **雛形・スクリプト・CI は完了**（`README.md`）。クラウド上の dev / stg / prod の実環境の作成（Neon、Hyperdrive、GitHub Environments）は、承認のうえ別途実施
2. DBスキーマ（テナント・拠点・マスタ）、RLS、テナントミドルウェア — **`tenant`・`site`、RLS、組織 ID → `tenant_id` の引き当て関数、テナントトランザクション（`runInTenantTransaction`）、ミドルウェア（`apps/admin/middleware/tenant.ts`）、権限カタログと認可の純粋関数は完了**。マスタのテーブルは未着手。ミドルウェアが使う「アクティブな組織」は、認証（フェーズ 3）で差し替える（いまは常に未決定 = 401）。liff 側のミドルウェア（テナントを URL から決める）はフェーズ 10
3. 管理者認証（Better Auth + organization）、権限
4. マスタ管理画面
5. 会員・保護者管理、招待コード
6. スケジュール・出欠・振替
7. イベント・エントリー
8. 請求・入金消込、Stripe Connect オンボーディングと決済
9. LINE 連携（Webhook、配信、Queue）、メッセージ管理
10. LIFF 保護者画面（ログイン、紐付け、お知らせ、出欠、エントリー、支払い）

各フェーズは計画 → 実装 → テスト → 動作確認の順で進め、フェーズをまたぐ大きな変更はしない。
