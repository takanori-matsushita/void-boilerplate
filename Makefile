# Docker のコマンド（ローカル開発環境: アプリ 2 つ + Postgres）。使い方は `make help`。
# 本番は Cloudflare Workers で動く。この Makefile は開発専用。
#
# - 開発サーバー（admin / liff）は、アプリ用ロール（app_user。RLS を強制される）で動く。
# - DDL・DB のリセット・シーダー・結合テストは、管理用ロール（app_admin）の `tools` サービスで動く（一度きりのコンテナ）。
#   コマンドは、すべてコンテナの中で実行される（ホストに Node・pnpm は要らない）。

COMPOSE := docker compose -f docker-compose.dev.yml
# 一度きりのコマンド。TOOLS は apps/admin、TOOLS_ROOT はリポジトリのルートで実行する
TOOLS := $(COMPOSE) run --rm tools
TOOLS_ROOT := $(COMPOSE) run --rm -w /workspace tools

# DB をリセットすると、Void が「開発サーバーを再起動して」と案内するので、起動中のアプリを再起動する（起動していなければ何もしない）
RESTART_APPS := $(COMPOSE) ps -q admin liff | grep -q . && $(COMPOSE) restart admin liff || true

# コンテナ専用の node_modules のマウント先。ホスト側に先に作っておかないと、Docker が root 所有で作ってしまう
NODE_MODULES_DIRS := node_modules apps/admin/node_modules apps/liff/node_modules \
	packages/db/node_modules packages/core/node_modules packages/shared/node_modules \
	packages/line/node_modules packages/stripe/node_modules

.DEFAULT_GOAL := help
.PHONY: help dirs \
	up down restart rebuild clean logs ps shell \
	db-up db-down db-reset db-rebuild migrate generate seed psql psql-app \
	check fix typecheck build test test-integration test-apps test-all ci

help: ## このヘルプを表示する
	@awk 'BEGIN {FS = ":.*## "} \
		/^##@ / {printf "\n%s\n", substr($$0, 5)} \
		/^[a-zA-Z_-]+:.*## / {printf "  make %-17s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo

dirs:
	@mkdir -p $(NODE_MODULES_DIRS)

##@ 環境（アプリ + Postgres）

up: dirs ## アプリ（admin :5301 / liff :5302）と Postgres を起動する（初回は依存のインストールで数分）
	$(COMPOSE) --profile tools build tools
	$(COMPOSE) up -d --build --wait --wait-timeout 900

down: ## 停止してコンテナを削除する（node_modules・キャッシュは残る。DB のデータは消える。次の up の後に make seed / migrate）
	$(COMPOSE) down

restart: ## アプリ（admin / liff）を再起動する
	$(COMPOSE) restart admin liff

rebuild: ## イメージをキャッシュなしで作り直して起動する（Dockerfile.dev を変えたとき）
	$(COMPOSE) --profile tools build --no-cache
	$(MAKE) up

clean: ## 停止して、ボリューム（node_modules・キャッシュ）まで削除する（DB のデータも消える）。次の up は依存の再インストールになる
	$(COMPOSE) --profile tools down -v

logs: ## アプリのログを表示する（Ctrl+C で終了）
	$(COMPOSE) logs -f admin liff

ps: ## コンテナの状態を表示する
	$(COMPOSE) ps

shell: ## 管理用ロールの一度きりのコンテナで、リポジトリのルートの bash を開く
	$(TOOLS_ROOT) bash

##@ データベース

db-up: ## Postgres だけを起動する（結合テスト用。アプリをホストで動かすとき）
	$(COMPOSE) up -d --wait postgres

db-down: ## Postgres だけを停止して削除する（データも消える）
	$(COMPOSE) rm -sfv postgres

db-reset: ## テーブルを全部消して、マイグレーションを適用し直す（データは消える。Postgres のコンテナは残す）
	$(TOOLS) vp exec void db reset --yes
	@$(RESTART_APPS)

db-rebuild: ## Postgres のコンテナ（とデータ）を作り直し、ロールを初期化して、マイグレーションを適用する
	$(MAKE) db-down
	$(MAKE) db-up
	$(MAKE) migrate

migrate: ## マイグレーションを、管理用ロールで適用する
	$(TOOLS) vp exec void db migrate

generate: ## スキーマの変更から、マイグレーション（SQL）を生成する。生成後、tenant_id のあるテーブルは RLS の SQL を追記する
	$(TOOLS) vp exec void db generate

seed: ## DB をリセット → マイグレーション → シーダー（apps/admin/db/seed.ts）を実行する（データは消える）
	$(TOOLS) vp exec void db seed --yes
	@$(RESTART_APPS)

psql: ## 管理用ロール（app_admin。RLS をバイパス）で psql を開く
	$(COMPOSE) exec postgres psql -U app_admin -d club

psql-app: ## アプリ用ロール（app_user。RLS を強制される）で psql を開く。RLS の確認用
	$(COMPOSE) exec postgres psql -U app_user -d club

##@ 品質（整形・リント・型・テスト・ビルド）

check: ## 整形・リント・型を検査する（Oxfmt / Oxlint）
	$(TOOLS_ROOT) vp check

fix: ## 整形・リントを自動で直す
	$(TOOLS_ROOT) vp check --fix

typecheck: ## 全パッケージ・アプリ・デプロイスクリプトの型を検査する
	$(TOOLS_ROOT) vp run typecheck

build: ## admin / liff をビルドする
	$(TOOLS_ROOT) vp run build

test: ## 単体テスト + 依存方向のテスト（外部依存なし）
	$(TOOLS_ROOT) vp run test:unit

test-integration: ## 結合テスト（実 Postgres。RLS・ロール・クエリ）
	$(TOOLS_ROOT) vp run test:integration

test-apps: ## 画面・ルートのハンドラのテスト（apps/*/tests）
	$(TOOLS_ROOT) vp run test:apps

test-all: ## すべてのテスト（単体 + 依存方向 + 結合 + アプリ）
	$(TOOLS_ROOT) vp run test:all

ci: ## CI と同じ検査を、まとめて実行する（check → typecheck → test-all → build）
	$(MAKE) check
	$(MAKE) typecheck
	$(MAKE) test-all
	$(MAKE) build
