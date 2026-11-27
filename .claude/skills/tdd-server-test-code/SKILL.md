---
name: tdd-server-test-code
description: TDD実装フロー(5フェーズ)の第3フェーズの後半。`/tdd-server-test-outline` で作成・確認済みのアウトライン(it.todo)を実行可能なサーバー側のテストに書き換え、Redを目視する。実装は書かない。ユーザーが `/tdd-server-test-code` と明示的に指示したときだけ使う。「〇〇を実装して」等の依頼だけで自動的に起動してはいけない。
---

# tdd-server-test-code — サーバー側のテストコード実装

`tdd-front-test-outline → tdd-front-test-code → tdd-front-impl → tdd-server-test-outline → tdd-server-test-code → tdd-server-impl → tdd-refactor` の5番目。
`tdd-server-test-outline` が作った `it.todo` のアウトラインを、実行可能なテストにして**Redを目で確認する**。
実装(本番コード)は書かない — それは `tdd-server-impl` の仕事。仕様が変わったなら `tdd-server-test-outline` に戻る。

進め方の全体規約は `CLAUDE.md`、層とテストの方針は `.claude/rules/architecture.md` と `.claude/rules/testing.md` を前提知識として
読むこと。ここには**手順**だけを書く。

## 0. 作業ノートとアウトラインを読む

`docs/work/<機能名>.md` を読む。次を確認する。満たさなければ、先へ進まずユーザーに伝える:

- 「テストのアウトライン(`tdd-server-test-outline`)」の節があり、**確認状況が「確認済み」**であること
  (無い・確認待ちなら `tdd-server-test-outline` に戻る)
- 「決定事項」のデータモデル・権限・バリデーションの節が埋まっていて、「未決事項」が空であること

アウトラインのファイルを開き、`it.todo` の件数が作業ノートの記載と合っていることを確認する。

サーバー側は、`tdd-server-test-outline` で更新した「ローダーの props 契約」が、画面の実装コード(`Props`)と一致しているかも再確認する
(食い違いがあれば実装コードを正とし、ノートを直してから書く)。

## 1. テストコードを実装する

すべての `it.todo` を実行可能な `it` に変える(`vite-plus/test` から import する)。

- **AAA**(Arrange/Act/Assert)を空行で区切る。
- **モック禁止**: 対象コードの内部モジュール(`packages/*`、自作のクライアント)への `vi.mock()` / `vi.spyOn()` は使わない。
  **実 Postgres**(`make db-up`)で検証する。**外部サービスとの HTTP 境界に限り** `fetch` の差し替えを使ってよい
  (Stripe・LINE。送信内容を外から観測する。偽装応答の形は `packages/*/test/fixtures/` に集約して出典を書く)。
- **① 単体**(`packages/core/test/…`): `domain` の純粋関数に値を渡して戻り値を確認する。金額は整数の円(`assertYen` を通す)。
  異常系は `toThrow` で、メッセージや型まで確認する。
- **② 結合**(`packages/db/test/….integration.test.ts`): 手本は `packages/db/test/rls.integration.test.ts`。**ユースケース(`core/application`)は、実 DB につないだ repositories(`createRepositories(tx)`)を渡して検証する**(ports をモックしない)。
  - **ファイルごとに専用の一時データベースを作り**(`create database t_xxx owner app_admin`)、終わったら削除する(並行実行で衝突しない)
  - 管理用ロール(`app_admin`)でテーブルとデータを用意し、**アプリ用ロール(`app_user`、RLS を強制される)の接続**で検証する
  - テナントの設定は `withTenant`(`packages/db`)を使う。**自テナントは見える / 他テナントは見えない / 他テナントの `tenant_id` での書き込みを拒否 /
    テナント未設定は失敗(安全側)**を必ず含める
  - 2 つ目の結合テストから、一時データベースの作成・削除を `packages/db/test/support/` に切り出す(3 か所目を待たない: 同じ準備を 2 つのファイルで書くなら切り出す)
  - 事後条件(戻り値＋DB の更新後の状態)と、異常系の不変条件(例外時に DB が中途半端に変わっていない)の両方をアサートする
- **③ ルートのハンドラ**(`apps/<app>/tests/routes/….test.ts`): 素の `defineHandler` のハンドラは**素の戻り値を返す関数**なので、偽のコンテキストを渡して直接呼ぶ。
  **`defineHandler.withValidator({ body })` のハンドラは、自分でリクエストを検証して `Response` を返す**(有効なら 200 と JSON、無効なら 400 と Valibot のメッセージ。
  第 2 引数は無視される)ので、偽のコンテキストの `req.json()` に本文を返させ、`res.status` と `await res.json()` を確認する。
  手本は `apps/admin/tests/routes/handler-pattern.test.ts`。テナントのトランザクション(`c.get('tx')`)は、実 DB の接続(②と同じ一時データベース)を渡す。
  **ハンドラの中で `void/db` の `db` を使っていないこと**(`tx` を使う。`CLAUDE.md`「テナント分離」)も、このテストで担保する
- **ルート・画面のテストを `pages/` `routes/` の中に置かない**(ルートとして扱われる。`architecture/architecture.test.ts` が検出する)

### ルートを追加・変更する機能なら、更新が要る既存のテストを先に洗い出す

実装(`tdd-server-impl`)で初めて落ちて気付くと、「テストは変更しない」という実装フェーズの原則と衝突する。**このフェーズで見つけて直しておく**
(ルートが無い今は、これらのテストは直しても Red のままでよい):

- 権限キーとルートの対応を固定しているテスト(認可の宣言テスト。フェーズ 3 で導入する)
- ルート数やページの一覧を決め打ちしているテスト
- 権限の表示名を固定しているアサーション(カタログの文言を変えるとき)

## 2. Red を目視する

```bash
make db-up                                         # 結合テストを含むときは先に起動
vp test run packages/core/test/<ファイル>             # ① 単体
vp test run packages/db/test/<ファイル>.integration.test.ts   # ② 結合
vp run -F @club/<app> test tests/routes/<ファイル>     # ③ ルートのハンドラ
```

**必ず実行して落ちることを目で確認する。** 既存コードにテストを後から足す場合(先にテストが書けず Red から始められない場合)は:

```bash
# 検証したい行をコメントアウト or 改変してから
vp test run <対象のテストファイル>           # → 落ちること
git checkout -- <対象ファイル>                # → 必ず元へ戻す
git diff -- packages apps                    # → 差分が残っていないこと
```

この代替手順は省略不可(`CLAUDE.md`「開発の進め方」参照。過去に、この確認を飛ばして、別の副作用でたまたま緑になっていた
回帰テストの事故がある)。

### ユーザーへの見せ方(スマホなど、遠隔の端末からでも読めるように)

ユーザーは端末から遠隔で操作していることがある。Red を確認したら、次の2つを行う:

1. **実行結果の要約を、会話にコードブロックで貼る**: 件数(pass / fail / todo)、落ちたテストの代表的な理由、
   **最初から通ったテストとその理由**(実装前でも成立する性質のものか)。
2. **実装したテストファイルを `SendUserFile` で送る**(`display: "attach"`、`status: "normal"`、caption に件数)。
   `SendUserFile` が未ロードなら、先に `ToolSearch` で `select:SendUserFile` を読み込む

テストコードの全文は会話に貼らない(長く、小さい画面で読みにくい)。ユーザーが特定の範囲を見たいと言ったら、
その範囲だけをコードブロックで見せる。

## 3. 作業ノートを更新する

「進捗」の3番目のチェックボックスを付ける。次は `tdd-server-impl` を明示的に起動する。

## 4. GitHub Issueに記録する

`docs/work/README.md`「GitHub Issue への記録」を参照。**Red目視・判断に迷った点・想定外の挙動に遭遇するたびに
都度コメントする**(このステップまで溜めない)。フェーズ完了時(作業ノートの進捗チェックを付けるとき)には、
`tdd-server-test-outline` での仕様確定を含めて、詰めたデータモデル・権限・バリデーション・実装したテストファイル・起きた問題の総括を1件書く。
