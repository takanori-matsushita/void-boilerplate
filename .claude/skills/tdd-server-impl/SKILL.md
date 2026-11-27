---
name: tdd-server-impl
description: TDD実装フロー(5フェーズ)の第4フェーズ。tdd-server-test-codeが書いたテストをGreenにするサーバー側(API・ドメイン・DB)の実装を、shared(Valibot・権限カタログ)→マイグレーション→domain→ports / application→db→最外周(routes)→ページの loader / action→認可の固定順序で行う。ユーザーが `/tdd-server-impl` と明示的に指示したときだけ使う。「〇〇を実装して」等の依頼だけで自動的に起動してはいけない。
---

# tdd-server-impl — サーバー側の実装

`tdd-front-test-outline → tdd-front-test-code → tdd-front-impl → tdd-server-test-outline → tdd-server-test-code → tdd-server-impl → tdd-refactor` の6番目。
`tdd-server-test-code` が書いたテストを Green にする実装を行う。テストの追加・変更はここでは行わない
(仕様が変わったなら `tdd-server-test-outline` に戻る)。

## 0. 作業ノートと画面の実装コードを読む

`docs/work/<機能名>.md` を読む。存在しない、または「進捗」3番目が未チェックならユーザーに
ノートの場所を確認する。「データモデル」「権限」「バリデーション」「層の配置」の節を設計図として使う。

**加えて、実装に入る前に対応する画面の実装コード(`apps/<app>/pages/<パス>/**`、参照している `apps/<app>/components/**`、暫定の
`index.server.ts` の `Props`)を必ず実際に開いて読む。** 特に ⑦(ページの `loader` / `action`)を書く段階で、`loader` が返す props の
**キー名・ネスト構造・型(配列かオブジェクトか、null になりうるか)**を、作業ノートの記述だけでなく、画面が実際に分割代入・参照している形に
厳密に一致させること。作業ノートは grilling 時点のスナップショットで、`tdd-front-impl` 側で変わっている場合がある。
ノートと実装コードが食い違っていたら実装コードを正とし、実装後に作業ノートを合わせて更新する。

**コード内コメントは最小限にする。** 読めば分かることを説明するコメントは書かない。書いてよいのは、
コードだけでは伝わらない最重要な意図(トリッキーな回避策の理由など)と `TODO` コメントだけ。

**`tdd-front-impl` が入れた暫定のサーバー側を、本実装に置き換える。** 作業ノートの「デザイン確認用の暫定サーバー」と
`grep -rn "TODO(tdd-server-impl)" apps packages` を見て、暫定の `loader` / `action`(固定の props・501)を把握する。
ページの URL(= ファイルのパス)と `Props` の形は**変えない**(画面とテストが依存している)。置き換え終えたら、この grep が空になること。

## 設計原則(実装中に守ること)

詳細と判断基準は `docs/design-principles.md`。**優先順位は、プロジェクトの規約・アーキテクチャテスト > KISS > YAGNI > DRY > SOLID。**

- **KISS**: 一番単純で読める形で書く。関数は 1 つのこと、ネストは早期 return で浅く、三項演算子は入れ子にしない
- **YAGNI**: テストが要求するものだけ作る。使われない引数・設定・権限を先回りして足さない(権限カタログも、その機能が実装される時に足す)
- **DRY**: 重複は 2 か所目までは許す。**実装中に先回りして抽象化しない** — 3 か所目の重複は `tdd-refactor` で扱う。
  ただし**同じ知識の二重管理**(定義元が複数ある)は、最初から 1 つにする(Valibot スキーマ・権限カタログは `packages/shared` が正本)
- **S**: 最外周(ルートのハンドラ・loader)は「受け取る → Valibot で検証 → ports を組み立てる → ユースケースか読み取りクエリを呼ぶ → 返す」だけ。`db` はデータアクセスだけ。判断は `domain`、1 操作の流れは `application`
- **O**: 規約のある所は**追加**で拡張する(例: 新しい割引はルールを 1 つ足す)。ただし分岐を戦略に分けるのは、2 つ目が現れてから
- **L**: ports の実装(`db/repositories`)は、port の契約(戻り値・投げる例外。「見つからなければ null」など)を守る
- **I**: 関数の引数は用途ごとに小さく。使わない値を持たせない
- **D**: `core` は外側を知らない。データアクセスは ports(interface)に依存し、`db` がそれを実装する(`architecture/architecture.test.ts` が落ちたら、テストを緩めず設計を直す)

Green にするコードは**最小限**。きれいにする整理は、全部が緑になってから `tdd-refactor` で行う(ここでは、明らかな違反を作らないことだけ)。

## 1. 実装順序(内→外で固定)

`CLAUDE.md`「レイヤー構成」に沿って、次の順で書く。順序を守る理由: 内側(`shared` → `core`)を先に決めることで、外側がその契約に従う形になり、
後から内側を実装都合で歪める手戻りを防ぐ。

### ① shared(Valibot スキーマ・権限カタログ)

- バリデーションは `packages/shared` の Valibot スキーマに書く(日本語のエラーメッセージ付き)。**API とフォームで共用する**
- 新しい機能アクセス制御が要るなら、権限カタログ(`packages/shared/src/permissions.ts`。無ければ、このときに作る)にキーと scope を足す。
  **カタログがフロントとサーバーの唯一の正本**(ミラーを作らない)。未実装の機能の権限を先回りして足さない(deny by default)

### ② マイグレーション

- スキーマを `packages/db/src/schema/<文脈>.ts` に定義する(`drizzle-orm/pg-core`。**Void に依存させない**)。`apps/admin/db/schema.ts` が再エクスポートする。
  **`void db generate` がこの定義を拾うこと、`void/db` の `eq` や `void/drizzle-valibot` と型が合うこと、ビルドが通ることは、実測で確認済み**
  (Void のプラグインが `drizzle-orm` の import を自前のコピーに解決する。`packages/db` の `drizzle-orm` は、Void が使うバージョンに固定する。
  アプリの `tsconfig.json` には `allowImportingTsExtensions` が要る。設定済み)。想定外に拾えない・型が合わないなどで、
  Void の仕組みと戦うハックが要るなら、**手を止めてユーザーに報告する**
- 生成: `vp run -F @club/admin db:generate`。生成された SQL を必ず読む
- **`tenant_id` を持つテーブルなら、そのマイグレーションの末尾に `tenantTableRlsSql('<table>')`(`packages/db`)の出力を追記する**
  (`ENABLE ROW LEVEL SECURITY` + ポリシー + アプリ用ロールへの GRANT)。`tenant_id` を持たない全テナント共通のマスタには RLS を掛けない
- ローカルに適用: `vp run db:migrate`(アプリ用ロールは DDL できないので、管理用ロールで流すスクリプト)
- **RLS の適用漏れを検知するテスト**(`tenant_id` を持つ全テーブルが RLS 有効であることを、マイグレーションを適用した一時データベースで確認する結合テスト)が
  まだ無ければ、**最初の `tenant_id` を持つテーブルを作るこの機能で追加する**。既にあるなら、緑であること

### ③ domain(`packages/core/src/domain/`)

作業ノート「層の配置」の決定に従う:

- 拒否条件を伴う**複数フィールドにまたがる状態遷移**があるなら、関連する関数群(と型)にまとめる。
- **単発の不変条件チェック**で完結するなら、小さな純粋関数に留める(過剰な構造化を避ける)。
- 拒否を伴わない単純な読み書き・計算は、`domain` に置かず素通しでよい。
- **import してよいのは `@club/shared` と、同じ `domain/` の中だけ。** I/O・DB・Void・Hono・Node の API・ports を使わない(`architecture/architecture.test.ts` が
  機械的に強制する)。金額は整数の円(`assertYen`)、日付境界は Asia/Tokyo で、時刻は引数で受け取る(`Date.now()` を直接呼ばない)

### ④ ports と application(`packages/core/src/ports/`、`application/`)

**書き込み、または業務ルールを伴う処理だけ**をユースケースにする(画面用の読み取りは、ユースケースを作らず ⑤ の `queries/` を直接呼ぶ。YAGNI)。

- **ports**: ユースケースが必要とするデータアクセスの interface。**関数を持つ小さなオブジェクト型**で、用途ごとに小さく作る
  (例: `ClassRepository = { findById(id: ClassId): Promise<Class | null>; save(c: Class): Promise<void> }`)。Drizzle・`tx`・SQL を知らない。使われない関数を足さない
- **application**: ユースケース = **1 操作 1 関数** `(ports, input, ctx) => Promise<結果>`。ports 経由で読み、`domain` で判断し、ports 経由で書く。
  `ctx` は時刻・実行者など。**`tx` も `db` も知らない**。失敗は、意味のある例外か結果の型で返す(最外周が HTTP のステータスへ変換する)
- クラス・DI コンテナを使わない。`domain` / `ports` は `application` を import しない(アーキテクチャテストが強制する)

### ⑤ db(`packages/db/src/`)

- **repositories/**: ports の実装。`createRepositories(tx)` のように、**テナントのトランザクション(`tx`)を束縛した ports を作る**。`db`(Void)を import しない。
  契約(見つからないとき null か例外か)は、port の定義に従う。生 SQL・DB 固有の処理は、ここにしか置かない
- **queries/**: 画面用の**読み取り専用**のクエリ(一覧・詳細)。`tx` を引数で受け取り、DTO を返す。最外周(loader など)が**直接**呼ぶ

### ⑥ 最外周: routes(`apps/<app>/routes/`)

- `defineHandler.withValidator({ body: <Valibot スキーマ> })` で入力を検証し、**`c.get('tx')`** から `createRepositories(tx)` で ports を作り、ユースケースか読み取りクエリを呼ぶ。
  **`void/db` の `db` を使わない**(`max: 1` のプールで詰まる。`CLAUDE.md`「テナント分離」)。トランザクション中に `getAuth(c).api.*` も呼ばない
- ハンドラは素の値を返す。失敗は `HTTPException`(`hono/http-exception`)で、ステータスと日本語のメッセージを返す
- Webhook・認証・ヘルスチェックなど、テナントのトランザクションの対象外のパスは、ミドルウェアの除外リストに明示する
- `void/queues` `void/db` などの `void/*` は、ここ(`apps/*`)でだけ import する(Void のリソース推論は `apps/*` を走査する)
- 個人情報(子どもの氏名・生年月日など)をログに出さない

### ⑦ ページの loader / action(`apps/<app>/pages/<パス>/index.server.ts`)

暫定版を本実装に置き換える。`loader` は `db/queries` で読んだ値を、**作業ノートの props 契約の形**で返す(読み取りは、ユースケースを通さない)。
`action` は Valibot で検証し、ユースケースを呼ぶ。`ssr = false` と `Props` の型は維持する。

### ⑧ 認可

最外周(`routes/`)と、ページの `loader` / `action` ごとに、**必要な権限を宣言する**(権限カタログのキー。認可の仕組みはフェーズ 3 で導入する。
導入前は、宣言の置き場所と形を作業ノートに書き、`TODO` を残す)。どの層(法人全体 / 拠点)で判定するかは、ルートではなくカタログの scope が決める。
宣言の漏れを機械的に検知するテストがあれば、緑にする。

## 2. テストを Green にする

```bash
make db-up                       # 結合テストを含むときは先に起動
vp run test:unit <今回のファイル>    # まず対象だけ
vp run test:integration <今回のファイル>
vp run -F @club/<app> test tests/routes/<ファイル>
vp run test:all                    # 最後に全件
```

特に次を必ず緑にする(横断的なルールを機械的に検証しているテスト):

- `architecture/architecture.test.ts`(層の依存方向。`vp run test:unit`)
- RLS の適用漏れ検知(②)と、認可の宣言漏れ検知(⑧。導入済みなら)
- 既存の結合テスト(他の機能のテナント分離が壊れていないこと)

`tdd-server-test-code` が書いたテストの assert 内容は変更しない。テストが実装の意図と食い違うと
感じたら、コードを合わせるのではなく、ユーザーに確認する。

**例外: 実装したことで機械的に更新が要るだけの既存テストは、直してよい。** 例は、ルート数・ページの一覧の決め打ち・権限キーとルートの対応表・
カタログの表示名の固定。次を守る:

- 直すのは**数・名前・対応先だけ**で、検証の意図は変えない(アサートを弱める・消すのは例外にならない)
- 直したものは、最終報告と GitHub Issue のコメントに**必ず書く**(何を・なぜ直したか)
- 迷ったら例外にせず、ユーザーに確認する

(本来は `tdd-server-test-outline` が「ルートを追加・変更する機能なら、更新が要る既存テストを先に洗い出す」節で
見つけておく。ここで落ちたなら、その見落としも報告する)

## 3. 権限の追加を、環境へ反映する

権限カタログに新しい権限を追加した場合、**既存のテナントのロールへは自動では届かない**(プリセットは作成時にコピーで配る設計)。
配り直す仕組み(同期コマンド)はフェーズ 3 で導入する。導入前は、追加したキーを作業ノートの「権限」と PR の「リリース時の注意」に書き残す。

## 4. 静的チェック

```bash
vp check             # 整形・リント・型。直すときは vp check --fix
vp run typecheck
```

## 5. ④ E2E(実ブラウザの通し)

作業ノートの「検証を置く層の割り振り」に ④ が書かれていたら、ここで書く(無ければ飛ばす)。**1 ページにつき 1 件程度**で、フォームの実送信・
確認ダイアログ・送信後のトーストや表示の入れ替えなど、実ブラウザでしか観測できないものだけ(権限・冪等・404・DB は結合テスト、
表示条件はコンポーネントテストが済み)。

**E2E の基盤(Playwright の配置・起動・シード・認証)は、まだ無い。** 最初に必要になった機能で、基盤を決めて整え(**別コミット**)、
`.claude/rules/testing.md` と `CLAUDE.md` に追記する。決めるのは、配置(例: `apps/<app>/e2e/`)、開発サーバーとローカル DB の起動方法、
サンプルテナントのシード、ログインの方法(Better Auth の API で Cookie を得る。`.claude/scripts/capture/capture.mjs` の `login` が手本)。

**書き方の注意**: 作ったデータは自分で消す(開発用 DB のテナントを cascade で消す、など)/ 失敗しても必ずログアウトする /
ハイドレーション(React の描画完了)を待つ / セレクタは実際の DOM に合わせる。

**Red の代わりに変異テストをする**(実装が先にあるため、省略不可)。実装を一時的に壊し、E2E が落ちることを確認して戻す。
全件で落ちたテストが今回の変更と無関係に見えたら、単独・ファイル全体・全件で再実行して切り分け、再現しなければ不安定さとして報告する
(原因調査までは求めない)。

## 6. 作業ノートを更新する

「進捗」の4番目のチェックボックスを付ける。次は `tdd-refactor` を明示的に起動する。

## 7. GitHub Issueに記録する

`docs/work/README.md`「GitHub Issue への記録」を参照。**①〜⑧を 1 つ実装し終えるたび、
テストが想定通りに落ちた/通った、といった節目のたびに都度コメント
する**(このステップまで溜めない)。フェーズ完了時にはさらに、①〜⑧のどこに何を実装したか・
起きた問題の総括を 1 件書く。
