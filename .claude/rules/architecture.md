---
description: アーキテクチャのルール（Void の規約を最外周にした、関数ベースの改良オニオン）
globs: ["packages/**", "apps/*/routes/**", "apps/*/middleware/**", "apps/*/queues/**", "apps/*/crons/**", "apps/*/pages/**/*.server.ts", "architecture/**"]
---

# アーキテクチャ

**Void の規約を最外周に置き、その内側にオニオンを収める。** 迷ったら Void の推奨に合わせ、オニオンの規則はその内側で適用する。

- **最外周（Void の規約）**: `apps/<app>/routes/`、`pages/**/*.server.ts`（loader / action）、`middleware/`、`queues/`、`crons/`。**薄く保つ。**
  Void の型パイプライン（Drizzle のスキーマ → ハンドラ・loader の戻り値 → 型付き `fetch` / `InferProps`）と、`defineHandler.withValidator` を使う。
- **その内側（`packages/`）**: ドメインとデータアクセス。**内側は外側を知らない。** Void に依存させない。

```
┌─ 最外周: Void の規約（apps/<app>）────────────────────────────────────────────┐
│  routes/  pages/*.server.ts  middleware/  queues/  crons/                    │
│  検証（Valibot）・認可・テナントの tx・ports の組み立て・ユースケースの呼び出し・応答の整形  │
└──────────────┬──────────────────────────────────────┬────────────────────────┘
               │ 書き込み・業務ルール                    │ 読み取り（画面用の一覧・詳細）
               ▼                                      ▼
   packages/core ─ application/（ユースケース）    packages/db ─ queries/（読み取り用のクエリ）
        │  ports/（関数型の interface）  ◀── 実装 ── packages/db ─ repositories/（ports の実装）
        ▼
   packages/core ─ domain/（純粋関数・値・ルール）
        │
        ▼
   packages/shared（Valibot・型・権限カタログ）   ※ line / stripe は db と同じ外側（ports の実装・外部 SDK）
```

## 層と依存

| 場所 | 責務 | 依存してよいもの |
|---|---|---|
| `packages/shared` | Valibot スキーマ・型・定数・権限カタログ（フロントとサーバーで共用） | `valibot` のみ |
| `packages/core/src/domain/` | **純粋関数・値・ルール**（請求計算・割引・振替・学年繰り上げなど）。I/O を持たない。時刻は引数で受け取る | `@club/shared`、`@internationalized/date`（日付計算）、同じ `domain/` 内のみ |
| `packages/core/src/ports/` | ユースケースが必要とする**データアクセスの interface**（関数型。例: `findClass(id)`）。実装は `db` | `domain/`、`@club/shared` |
| `packages/core/src/application/` | **ユースケース**（1 操作 = 1 関数。`(ports, input, ctx) => result`）。ports 経由で読み、domain で判断し、ports 経由で書く | `domain/`、`ports/`、`@club/shared` |
| `packages/db` | Drizzle スキーマ（**正本**）、`repositories/`（ports の実装。`tx` を受け取る）、`queries/`（読み取り用）、RLS の SQL、テナントのトランザクションヘルパ | `@club/shared`、`@club/core`、`drizzle-orm`（**Void に依存しない**） |
| `packages/line` / `packages/stripe` | 外部サービスのクライアント（ports の実装・Webhook の検証） | `@club/shared`、`@club/core`（と、その外部 SDK） |
| `apps/<app>/routes` など | Void の規約どおりの受け口。**検証 → 認可 → ports を組み立てる → ユースケースか読み取りクエリを呼ぶ → 返す** | 上のすべて（Void・Hono を使ってよい） |
| `apps/<app>/pages`, `components` | 画面（React、SSR なし）。`.server.ts` は loader / action | `@club/shared`、`void/client`、`components/ui/` のラッパー。**サーバー専用（`void/db`、`@club/db`、`pg` など）は import しない。React Aria は `components/ui/` の中でだけ import する**（ページや他の部品は、ラッパーを使う） |

**内側は外側を一切知らない。** `architecture/architecture.test.ts` で機械的に強制されており、破るとテストが落ちる（`vp run test:unit`）。
パッケージ・層を追加・変更したら `architecture/rules.ts` も更新すること。テストを緩めず、設計を直す。

## 古典的なオニオンからの改良点

1. **関数ベース**: クラス・DI コンテナを使わない。ユースケースは関数、ポートは関数を持つオブジェクト型。
2. **読み取りと書き込みを分ける（CQRS-lite）**: 画面用の**読み取り**（一覧・詳細）は、loader やハンドラが `db` の `queries/` を**直接**呼んでよい（Void の loader の標準形。ユースケースを作らない）。
   **書き込み、または業務ルールを伴う処理は、ユースケースを通す。** 迷ったら読み取りは直接、書き込みはユースケース。
3. **トランザクションは明示的に渡す**: Void のミドルウェアが「1 リクエスト = 1 テナントトランザクション」を張る。最外周が `createRepositories(tx)`（`db`）で、`tx` を束縛した ports を作ってユースケースへ渡す。
   `core` は `tx` を知らない。**ハンドラは `c.get('tx')` だけを使い、`void/db` の `db` を直接使わない**（`max: 1` のプールで詰まる）。
4. **Void の型パイプラインを壊さない**: Drizzle のスキーマ（`packages/db/src/schema`）が正本。`tenant_id` などのカラムの型・Valibot の導出（`void/drizzle-valibot`。表をそのまま映す単純な入力に使ってよい。
   **`void/*` を import できるのは最外周だけ**）は、ここから流れる。ハンドラ・loader の戻り値の型は、そのままクライアントへ届く（`Date` などシリアライズで変わる型に注意）。
5. **Void のリソース推論のため、`void/queues` `void/db` `void/storage` などの import は最外周（`apps/*`）に置く**。Void は `apps/*` の `routes/` `pages/` `queues/` `crons/` `middleware/` `src/` だけを走査してバインディングを推論する
   （`packages/` は走査されない。`packages/` が Void に依存しないルールとも一致する）。

## テナントとトランザクション

- テナントに属するテーブルは、マイグレーションの末尾に `tenantTableRlsSql('<table>')`（`packages/db`）を追記する。適用漏れは結合テストが検知する。
- Queue consumer・Cron は管理用ロール（RLS をバイパス）で動く。テナントの条件は SQL で明示し、他テナントに触れないことをテストで確認する。
- 認証系の API（`getAuth(c).api.*`）は、テナントのトランザクション中に呼ばない（詰まる）。対象外のルートで行う。

## 割引ルール（新しい料金ルールは追加で拡張する）

新しい割引は、ルールを 1 つ足す（`domain/`）。既存を書き換えない。

```ts
// 例（フェーズ 8 で型を確定する）
interface DiscountRule {
  code: string;
  isApplicable(ctx: BillingContext): boolean;
  amount(ctx: BillingContext): Yen;
  exclusionGroup: string | null;
  effectivePeriod: Period;
}
```

マスタ（DB）が持つのは **金額・適用期間・排他グループ**だけ。**要件の判定ロジックをマスタの JSON や DSL で表現しない**（自作言語になる）。

## テスト

詳細は `.claude/rules/testing.md`。

- `domain/` は単体テスト（DB・Void を起動しない）。ユースケースと `db` は、**実 Postgres** の結合テストで検証する（ports をモックしない）。
- 金額を変える PR には、必ず回帰テストを追加する。正解データは実データを手計算したもの（`packages/core/test/fixtures/`）。
- 取消・返金・遅延請求・二重入金を後回しにしない。正常系だけの請求は現場で使えない。
