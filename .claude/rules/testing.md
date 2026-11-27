---
description: テストのルール（層の使い分け、モックの方針、Red の目視、実行コマンド）
globs: ["**/*.test.ts", "**/*.test.tsx", "architecture/**", "vite.config.ts", "apps/*/vite.config.ts"]
---

# テスト

テストは **`vp test`（Vitest）** で動かし、`vite-plus/test` から import する（`vitest` を別途入れない）。
テスト名は日本語で、それ自体が仕様書として読める形にする（例: `他テナントの tenant_id での書き込みを拒否する`）。AAA（Arrange / Act / Assert）を空行で区切る。

## 層の使い分け

| 層 | 置き場所 | 何を検証するか | 実行 | 状態 |
|---|---|---|---|---|
| ① 単体 | `packages/*/test/**/*.test.ts` | 純粋関数（`core/domain`）、値の検証、DB に触れないもの。Void も DB も起動しないので高速 | `vp run test:unit` | あり |
| ② 結合 | `packages/*/test/**/*.integration.test.ts`、`deploy/test/**` | 実 Postgres（`make db-up`）での RLS・クエリ・トランザクション・ロール・**ユースケース（`core/application`）とリポジトリ（`db/repositories`）の組み合わせ** | `vp run test:integration` | あり |
| ③ アプリ（画面・ルートのハンドラ） | `apps/*/tests/**/*.test.{ts,tsx}`（`pages/` と同じ構成。**`pages/` `routes/` の中には置かない**: ルートとして扱われる） | 画面の表示・権限による出し分け・空状態・エラー表示（props を直接渡して描画。`tests/pages/`）。ルートのハンドラ（偽のコンテキストで直接呼ぶ。`tests/routes/`。手本: `handler-pattern.test.ts`） | `vp run test:apps` | あり（Testing Library + happy-dom） |
| ④ API / E2E | （未整備） | HTTP の応答・認可・Webhook、実ブラウザでしか観測できないもの（Playwright） | — | **未整備**。最初に必要になった機能で基盤を整え、別コミットにする |
| 依存方向 | `architecture/architecture.test.ts` | 層の依存方向（`packages` はフレームワーク非依存など） | `vp run test:unit` | あり |

全部: `vp run test:all`（結合テストの前に `make db-up`）。静的チェック: `vp check`（整形・リント・型）、`vp run typecheck`。

## ルール

- **Red を必ず目視する**: テストを書いたら、実装前に実行して落ちることを確認する。後からテストを足す場合は、対象を一時的に壊して落ちることを確認し、必ず元に戻す（`git diff` で差分が残っていないこと）。落ちるところを見ていないテストは、対象を検証できていなくても気付けない。
- **モック禁止**: 対象コードの内部モジュール（`packages/*`、自作のクライアント）を `vi.mock` / `vi.spyOn` で差し替えない。RLS やトランザクションは**実 Postgres**で検証する（`withTenant` と `pg`）。
- **外部サービスとの HTTP 境界に限り、偽装してよい**（Stripe・LINE。`fetch` を差し替え、送信内容を外から観測する）。偽装応答の形は `packages/*/test/fixtures/` に集約し、出典を書く。
- Void のバインディング（`void/db`、`void/kv` など）を使うコードをテストする場合は、そのモジュールだけ `vi.mock` する（Void のドキュメントの方針）。ただし RLS・トランザクションの検証には使わない。
- **契約による設計**: 事後条件（戻り値＋DB の更新後の状態）と、異常系の不変条件（例外時に DB が中途半端に変わっていない）の両方をアサートする。
- コンポーネントテスト（③）で、実際のネットワーク送信やフォーム送信を伴う検証はしない（非同期の応答が別のテストへ漏れる）。送信を伴う通しは ④ で書く。後片付けは `cleanup`（`afterEach(cleanup)`）。
- **全テーブルの RLS 漏れは `packages/db/test/schema.integration.test.ts` が検出する**（実際のマイグレーションを空の DB に適用し、public の全テーブルで RLS 有効＋ポリシーありを検査。例外は `RLS_EXEMPT` に理由つきで足す）。テーブルを足したら、マイグレーションの末尾に `tenantTableRlsSql` を追記する。
- テナント分離は、**テナント A のデータが B から見えないこと**と、**テナント未設定で失敗すること（安全側）**を必ず含める。
- 並行して他のテストと衝突しないよう、結合テストは専用の一時データベースを作って使い、終わったら削除する（`packages/db/test/rls.integration.test.ts` が手本）。
