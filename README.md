# 陸上クラブ管理SaaS

設計ルール・技術スタックは [`CLAUDE.md`](./CLAUDE.md)、Void の検証結果は [`docs/void-spike-result.md`](./docs/void-spike-result.md) を参照。

## 実装の状況

フェーズ（`CLAUDE.md`「実装の進め方」）の進み具合。

| フェーズ | 状態 |
|---|---|
| 0. Void の検証 | 完了（条件付き採用。[`docs/void-spike-result.md`](./docs/void-spike-result.md)） |
| 1. モノレポ雛形・CI・環境 | 雛形・スクリプト・CI は完了。**クラウド上の dev / stg / prod は未作成**（Neon・Hyperdrive・GitHub Environments は承認のうえ別途） |
| 2. DB スキーマ・RLS・テナントミドルウェア | `tenant`・`site`、RLS、組織 → `tenant_id` の引き当て、テナントトランザクション、ミドルウェア、権限カタログ・認可の純粋関数は完了。**マスタのテーブルは未着手**。ミドルウェアが使う「アクティブな組織」は、認証（フェーズ 3）で差し替える（いまは常に 401） |
| 3 以降 | 未着手（認証、マスタ管理、会員、スケジュール、イベント、請求・Stripe、LINE、LIFF） |

### 導入済み

| 領域 | 内容 |
|---|---|
| フレームワーク・ツールチェーン | Void 1.12.0（固定）、Vite+（`vp` 1.7.0）、pnpm 10、Node 24.22 |
| UI | React（SSR なし）、React Aria Components、Tailwind CSS 4（`components/ui/` に薄いラッパー） |
| DB | PostgreSQL 18（ローカルは `postgres:18`）、Drizzle。主キーは **UUID v7（DB の `uuidv7()` で採番**。ID ライブラリは使わない） |
| テナント分離 | RLS（アプリ用 `app_user` は強制、管理用 `app_admin` はバイパス）。ミドルウェア（`apps/admin/middleware/tenant.ts`）が、1 リクエスト = 1 テナントトランザクションを張る（`runInTenantTransaction`。組織 ID → `tenant_id` は `SECURITY DEFINER` の関数で引く）。テナント未設定は失敗する（安全側） |
| 権限 | 設計は [`docs/design/permissions.md`](./docs/design/permissions.md)。権限カタログ・標準ロール（`packages/shared`）、認可の純粋関数（`packages/core`） |
| バリデーション | Valibot（Zod は直接使わない） |
| 日付 | `@internationalized/date`（`packages/core` の `domain/date.ts`。Asia/Tokyo の日付境界） |
| テスト | Vitest（`vp test`）、Testing Library + happy-dom、実 Postgres の結合テスト、`fast-check`（性質ベース）、依存方向のテスト |
| 品質 | `vp check`（Oxfmt + Oxlint + 型）、Lefthook（コミット前に検査）、gitleaks（CI） |
| 依存の更新 | Dependabot（毎週月曜。`void` と `@void/*` は対象外） |
| 開発環境 | Docker Compose（admin・liff・Postgres・管理用 `tools`）を `make` で操作 |
| 導入のみ（未検証） | `@sentry/cloudflare`（Void への組み込みは最初の機能で確認）、`drizzle-seed` / `@faker-js/faker`（シーダーはまだ使っていない） |

### データベース（現状）

| テーブル | 内容 |
|---|---|
| `tenant` | クラブ。`id` がそのまま `tenant_id`。Better Auth の組織 ID との対応（`organization_id`）を持つ（認証はフェーズ 3） |
| `site` | 拠点（会場・教室）。テナントの配下。テナント内で名前は一意 |

- マイグレーションは `apps/admin/db/migrations`（`make generate` で生成し、テナントに属するテーブルは末尾に `tenantTableRlsSql` の RLS を追記する）。
- **全テーブルの RLS 漏れは、`packages/db/test/schema.integration.test.ts` が検出する**（実際のマイグレーションを空の DB に適用して検査）。
- `make seed` は、サンプルのクラブ 2 つと拠点を入れる（テナント分離を手で確かめるため。実在の個人情報は使わない）。

### 検証済み・未検証

- 検証済み: `vp check`、型チェック、全テスト（単体・結合 88 件、アプリ 8 件）、ビルド、Docker 上でのマイグレーション・シード・起動（admin と liff の同時起動、接続ロールが `app_user`）。
- 未検証: GitHub Actions 上の CI の実行、gitleaks の動作、Sentry の組み込み、macOS / Windows ホストでの Docker、Neon が PostgreSQL 18 であること（環境を作る段階で `select uuidv7()` を確認する）。

## セットアップ手順

初めて環境を作る人向けの、最初から最後までの手順。Docker で動かす方法（推奨）と、ホストで直接動かす方法がある。**どちらの場合も、コミットする人は手順 4（ホストの依存のインストール）が要る。**

### 0. 必要なもの

| 必要なもの | 用途 | 備考 |
|---|---|---|
| Git | ソースの取得・コミット | |
| Docker（Compose v2） | ローカルの Postgres・アプリの起動 | 動作確認は Docker 29 / Compose 2.40。初回のイメージ取得に数分 |
| make | Docker のコマンドの入口 | Windows は **WSL 2（Ubuntu など）の中**で作業する（Docker Desktop の WSL 連携を有効にする） |
| Node.js 24.22 以上 | **コミット前フックと、ホストで動かす場合**に必要。Docker だけで動かすだけなら不要 | `.node-version` / `.tool-versions` は 24.22.0。asdf・mise・nvm などで入れる |
| gitleaks（任意） | ローカルで秘密情報の混入を検査 | `brew install gitleaks`。無くても警告だけ（CI では必ず検査される） |

- ポートは固定: **5301**（admin）、**5302**（liff）、**54329**（Postgres）。他のアプリが使っていないこと。
- ホストのユーザー ID が 1000 でない場合（macOS など）、コンテナ内で作ったファイルの所有者がずれることがある（Linux / WSL の最初のユーザーは通常 1000）。

### 1. ソースを取得する

```sh
git clone <リポジトリの URL> void-boilerplate
cd void-boilerplate
git switch -c feature/<Issue番号>-<英語のスラッグ>   # main に直接コミットしない（作業を始めるとき）
```

### 2. ローカル環境を起動する（Docker）

```sh
make up
```

- 初回は、イメージのビルドと依存のインストール（`node_modules` はコンテナ専用のボリューム）で**数分**かかる。2 回目以降は数秒。
- 起動するもの: `postgres`（PostgreSQL 18。アプリ用 `app_user` と管理用 `app_admin` のロールを初期化）、`admin`（:5301）、`liff`（:5302）。**3 つとも `healthy` になるまで待つ**（`make up` が待つ）。
- `Ctrl+C` で止まるのではなく、バックグラウンドで動く。ログは `make logs`、状態は `make ps`。

### 3. 動作を確認する

```sh
make migrate                              # マイグレーションを、管理用ロールで適用
make seed                                 # サンプルのクラブ 2 つ + 拠点を入れる（DB をリセットしてから入れる）
curl http://localhost:5301/api/health     # {"ok":true,"app":"admin","role":"app_user"}
curl http://localhost:5302/api/health     # {"ok":true,"app":"liff","role":"app_user"}
make psql-app                             # アプリ用ロール（RLS を強制）で入る。次の確認を行う
```

RLS（テナント分離）を確かめる。まず管理用ロール（`make psql`。RLS をバイパス）で、サンプルのテナントの ID を調べる。

```sql
select id, name from tenant order by name;      -- サンプル陸上クラブ A / B の ID（UUID v7）
```

次に、アプリ用ロール（`make psql-app`。RLS を強制される）で試す。

```sql
select * from site;
-- ERROR: unrecognized configuration parameter "app.tenant_id"（テナント未設定は、空ではなくエラーになる＝安全側）

begin;
select set_config('app.tenant_id', '<クラブ A の ID>', true);
select name from site;                           -- クラブ A の拠点（中央競技場・市民体育館）だけが見える
rollback;
```

アプリ用ロールは、テナントを設定したトランザクションの中でだけ、そのテナントの行を読み書きできる（`set_config` の第 3 引数 `true` は、トランザクション終了で設定が消える `SET LOCAL` 相当）。

ブラウザで http://localhost:5301 と http://localhost:5302 を開く（画面はまだ雛形のみ）。

### 4. ホストの依存をインストールする（コミットする人は必須）

コミット前フック（Lefthook）が、ホストの `node_modules/.bin/vp` を使うため、ホストにも依存を入れる。

```sh
node -v                                   # v24.22.0 以上であること
npx -y -p vite-plus@1.7.0 vp install      # 初回だけ。以後は node_modules/.bin/vp が使える
```

- `vp install` の `prepare` が、`lefthook install` を実行してフックを有効にする（`.git/hooks/pre-commit` ができる）。確認: `ls .git/hooks/pre-commit`。
- `vp` が見つからないときは `node_modules/.bin/vp` を使うか、公式のインストーラ（`curl -fsSL https://vite.plus | bash`）で入れる。
- フックは**検査だけ**で、ファイルを書き換えない。違反で止まったら `make fix`（または `vp check --fix`）で直して、ステージし直す。

### 5. 全体が通ることを確認する

```sh
make ci          # 整形・リント・型 → 型チェック → 全テスト（単体・結合・アプリ） → ビルド
```

すべて通れば、セットアップは完了。日々の開発は、`make up` → 編集（ホットリロード）→ `make test-all` / `make fix` → コミット。

### 6. （参考）ホストで直接動かす場合

Docker を使わずアプリをホストで動かす場合は、手順 2〜3 の代わりに次を行う。手順 4 は同じ。

```sh
make db-up                                            # Postgres だけを起動
cp .env.example apps/admin/.env && cp .env.example apps/liff/.env
vp run -F @club/admin dev                             # http://localhost:5301
vp run -F @club/liff dev                              # http://localhost:5302（admin と同時に起動するとインスペクタのポートが衝突するので、別の端末で、admin を止めてから）
vp run db:migrate                                     # ローカル DB へマイグレーション
```

`.env` は git に含めない（`.env.example` だけが管理対象）。

### 7. （参考）クラウドの環境（dev / stg / prod）を作る

ローカルでの開発には要らない。デプロイするときだけ、承認のうえ行う。

1. **Neon**: 環境ごとに、別のブランチ（または別プロジェクト）を作る。**PostgreSQL 18 以上**にして、`select uuidv7()` が動くことを確認する。
2. **Cloudflare**: アカウントを用意し（本番は Workers Paid）、API トークンを作る（`void cloudflare login` は WSL / Linux で不安定なので使わない）。
3. **GitHub**: Environments（`dev` / `stg` / `prod`）を作り、シークレット（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`DATABASE_URL_ADMIN`、`APP_DB_PASSWORD`）を設定する。`prod` には承認者の保護ルールを付ける。組織のアカウントなら `GITLEAKS_LICENSE` も。
4. **Provision**（Actions）を実行 → アプリ用ロールと Hyperdrive（キャッシュ無効）を作る。続けて **Deploy**。詳細は下の「環境（dev / stg / prod）」。

### トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `make up` が途中で止まる・`install` が失敗する | `make logs` と `docker compose -f docker-compose.dev.yml logs install` を見る。ボリュームが壊れた疑いなら `make clean` して `make up`（`node_modules` を入れ直す。DB のデータも消える） |
| `EACCES: permission denied, mkdir .../node_modules/.pnpm` | `node_modules` のボリュームの所有者の問題。`make up` が `init` サービスで直す。直らなければ `make clean` → `make up` |
| ポートが使用中（`address already in use`） | 5301 / 5302 / 54329 を使っているプロセスを止める（`ss -ltnp \| grep -E '5301\|5302\|54329'`）。ホストで `vp run … dev` を動かしたままにしていないか |
| ホスト側に root 所有の空ディレクトリ（`packages/*/node_modules`）がある | Docker が作ったもの。`make up` の事前処理が先に自分の所有で作るので、一度 `sudo rmdir` して `make up` し直す |
| `workerd` が起動しない（`No CA certificates were loaded`） | イメージに `ca-certificates` が無い。`make rebuild`（`Dockerfile.dev` を変えたとき） |
| `make test-apps` で `Cannot find package 'happy-dom'` | グローバルの `vp` を使っている。イメージの `PATH` を直した後は `make up`（`tools` イメージも再ビルドされる） |
| 結合テストが `ECONNREFUSED` | Postgres が起動していない。`make db-up`（ホストで `vp run test:integration` を使う場合）。コンテナ内なら `make test-integration` |
| `uuidv7() does not exist` | Postgres が 17 以下。ローカルは `postgres:18`（`docker-compose.dev.yml`）。古いボリューム・コンテナが残っていたら `make db-down` → `make db-up` |
| コミットが「ホストに node_modules がありません」で止まる | 手順 4 を行う（ホストで `vp install`） |
| コミットが整形・リントの違反で止まる | `make fix`（または `vp check --fix`）で直して、`git add` し直す |
| 開発サーバーのログに `Migration error: permission denied for schema public` | 無害。開発サーバーの起動時に、Void がアプリ用ロールでマイグレーションを試して失敗するだけ（マイグレーションは `make migrate` が管理用ロールで適用する） |
| 開発サーバーが `Failed to load url …/.void/entry.ts`（ホストの絶対パス）で失敗する | `.void` がホストとコンテナで共有されていた場合の症状。いまは、コンテナ専用のボリュームに分けてある。`make down` → `make up` で直る |
| `make db-reset` / `make seed` の後にアプリが古い | 自動で再起動される。されなければ `make restart` |
| 最初からやり直したい | `make clean`（`node_modules` のボリュームを削除）→ `make up` → `make seed`（DB は、コンテナを消すと空になるので、`make migrate` か `make seed` が要る） |

## 開発の始め方

### Docker で起動する（推奨。Node・pnpm・Postgres を手元に入れなくてよい）

必要なもの: Docker（Compose v2）、`make`。

```sh
make up        # admin（http://localhost:5301）・liff（http://localhost:5302）・Postgres（localhost:54329）を起動。初回は依存のインストールで数分
make logs      # アプリのログ（Ctrl+C で終了）
make db-reset  # DB のテーブルを消してマイグレーションを適用し直す（make seed は、さらにシーダーも実行）
make migrate   # マイグレーションを、管理用ロールで適用（make generate は、スキーマの変更から SQL を生成）
make psql      # 管理用ロールで psql（make psql-app は、RLS を強制されるアプリ用ロール）
make test-all  # 全テスト（make ci は、check → typecheck → test-all → build）
make down      # 停止（node_modules は残る。**DB のデータは消える**ので、次の make up の後に make seed / migrate）  /  make clean: node_modules のボリュームまで削除
make help      # コマンドの一覧
```

- ソースはコンテナにマウントされるので、**編集するとホットリロード**される。`node_modules` はコンテナ専用のボリューム（ホストの OS・Node と混ざらない）。
- admin と liff は、**同時に起動できる**（ホストで起動すると、インスペクタのポートが衝突する）。
- コンテナ内の `.env` は `deploy/docker/app.env`（Postgres のホスト名が `postgres`）。ホストの `.env` とは別。
- Docker は**ローカル開発専用**。本番は Cloudflare Workers で動く。
- **コミットするには、ホストでも `vp install` が要る**（Node 24.22 以上）。コミット前フック（Lefthook）はホストで動き、`vp install` の `prepare` で有効になる。フックは検査のみ（`make fix` で直す）。
- ローカルでも秘密情報を検査するには `brew install gitleaks`（入っていなければ警告だけ。CI では必ず検査する。組織のアカウントでは、`GITLEAKS_LICENSE` のシークレットが要る）。
- **PostgreSQL は 18 以上が必要**（`uuidv7()` を使うため。Neon も 18 以上にする）。

### ホストで直接動かす

必要なもの: Docker（Postgres 用）、Node.js 24.22 以上。パッケージマネージャは pnpm 10（`package.json` の `packageManager` で固定）で、`vp`（Vite+）が自動で選んで呼ぶ。
Void のドキュメントのとおり、Vite+ のグローバルインストールは不要。

```sh
npx -y -p vite-plus@1.7.0 vp install   # 初回だけ。以後は node_modules/.bin/vp が使える
make db-up                             # ローカル Postgres だけを起動（アプリ用 app_user / 管理用 app_admin を初期化）
cp .env.example apps/admin/.env && cp .env.example apps/liff/.env
vp run -F @club/admin dev              # 管理画面 + 管理 API（http://localhost:5301）
vp run -F @club/liff dev               # LIFF + 保護者用 API（http://localhost:5302。同時に起動するとインスペクタのポートが衝突するので、別々に）
```

`vp` をどこからでも使いたい場合は、公式のグローバルインストーラ（`curl -fsSL https://vite.plus | bash`）を使ってもよい（任意）。

### コマンド

Docker のコマンドは `make`（`make help`）、アプリのコマンド（テスト・ビルド・型チェック）は `vp run <script>`。

| コマンド | 内容 |
|---|---|
| `vp check` | 整形（Oxfmt）・リント（Oxlint）・型。直すときは `vp check --fix` |
| `vp run typecheck` | 全パッケージ・アプリ・デプロイスクリプトの型チェック |
| `vp run test` | 単体テスト + 結合テスト（`vp test run`。結合テストは `make db-up` が必要） |
| `vp run test:unit` | 単体テストのみ（外部依存なし） |
| `vp run test:integration` | 結合テストのみ（実 Postgres で RLS・ロール作成を検証） |
| `vp run test:apps` | 画面・ルートのハンドラのテスト（`apps/*/tests/`） |
| `vp run test:all` | すべて（結合テストの前に `make db-up`） |
| `vp run db:migrate` | ローカル DB へマイグレーション（管理用ロールで適用。`.env` は元に戻る） |
| `vp run build` | admin / liff のビルド |
| `make db-up` / `make db-down` | ローカル Postgres だけの起動 / 破棄（`make up` は、アプリも含めて起動する） |

テストは Vite+ の `vp test`（Vitest 5.1）で実行し、`vite-plus/test` から import する。設定はルートの `vite.config.ts`。

## 構成

```
apps/admin     管理画面 + 管理 API（1 Worker）。マイグレーションを所有する
apps/liff      保護者向け LIFF + 保護者用 API（1 Worker）。常に --skip-migrations でデプロイ
packages/      db, core, shared, line, stripe（Void に依存させない）
deploy/        環境（dev / stg / prod）ごとの lock、デプロイスクリプト
.github/       CI、プロビジョニング、デプロイ
```

## 環境（dev / stg / prod）

Void に名前付き環境はないため、次の組合せで分ける（詳細な理由は `CLAUDE.md`「デプロイと環境分離」）。

| 要素 | 命名 / 保管先 |
|---|---|
| Worker | `club-<app>-<env>`（例: `club-admin-stg`） |
| Hyperdrive | `club-<app>-<env>-hyperdrive`（事前に作る。キャッシュ無効・アプリ用ロール） |
| Queue | `<Worker名>-<キュー名>`（Void が自動作成） |
| lock | `deploy/<env>/<app>/void.lock.json`（コミットする） |
| DB | 環境ごとに別の Neon ブランチ（または別プロジェクト） |

### 1. 環境を作る（初回。べき等）
GitHub の **Environments**（`dev` / `stg` / `prod`）を作り、次のシークレットを設定する。

| シークレット | 用途 | 使うワークフロー |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers / Hyperdrive / Queues の編集（初回は Workers Admin、更新は Workers Editor） | すべて |
| `CLOUDFLARE_ACCOUNT_ID` | アカウントの固定 | すべて |
| `DATABASE_URL_ADMIN` | 管理用ロール（DDL・ロール作成・RLS バイパス） | provision / migrate |
| `APP_DB_PASSWORD` | アプリ用ロール `app_user` のパスワード（新規に決める） | provision |

`prod` には Environment の保護ルール（承認者の指定）を必ず設定する。`deploy` ジョブには DB の資格情報を渡さない設計。

**Actions → Provision → 環境を選んで実行**。DB のアプリ用ロールを作り、全アプリの Hyperdrive を作成（または検証・キャッシュ無効化）する。

### 2. デプロイする
- `main` への push → `dev` に自動デプロイ
- `stg` / `prod` → **Actions → Deploy → 環境を選んで実行**

順序は、マイグレーション（管理用ロール）→ デプロイ（DB 資格情報なし）→ 検証（接続ロールが `app_user`、Hyperdrive のキャッシュ無効）。
デプロイ後に `deploy/<env>/<app>/void.lock.json` が更新されたら、差分をコミットする（ワークフローが警告する）。

### 3. 手元から実行する場合
```sh
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
node deploy/scripts/cli.mts provision dev   # + DATABASE_URL_ADMIN, APP_DB_PASSWORD
node deploy/scripts/cli.mts migrate dev     # + DATABASE_URL_ADMIN
node deploy/scripts/cli.mts deploy dev admin
node deploy/scripts/cli.mts verify dev admin
```
`void cloudflare login` は WSL / Linux で不安定なため使わない（API トークンを使う）。
