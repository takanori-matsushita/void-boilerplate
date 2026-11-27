---
name: tdd-front-test-code
description: TDD実装フロー(5フェーズ)の第1フェーズの後半。`/tdd-front-test-outline` で作成・確認済みのアウトライン(it.todo)を実行可能な画面のテスト(Testing Library)に書き換え、Redを目視する。実装は書かない。ユーザーが `/tdd-front-test-code` と明示的に指示したときだけ使う。「〇〇を実装して」等の依頼だけで自動的に起動してはいけない。
---

# tdd-front-test-code — 画面のテストコード実装

`tdd-front-test-outline → tdd-front-test-code → tdd-front-impl → tdd-server-test-outline → tdd-server-test-code → tdd-server-impl → tdd-refactor` の2番目。
`tdd-front-test-outline` が作った `it.todo` のアウトラインを、実行可能なテストにして**Redを目で確認する**。
実装(本番コード)は書かない — それは `tdd-front-impl` の仕事。仕様が変わったなら `tdd-front-test-outline` に戻る。

進め方の全体規約は `CLAUDE.md`、テスト方針は `.claude/rules/testing.md` を前提知識として読むこと。ここには**手順**だけを書く。

## 0. 作業ノートとアウトラインを読む

`docs/work/<機能名>.md` を読む。次を確認する。満たさなければ、先へ進まずユーザーに伝える:

- 「テストのアウトライン(`tdd-front-test-outline`)」の節があり、**確認状況が「確認済み」**であること
  (無い・確認待ちなら `tdd-front-test-outline` に戻る)
- 「決定事項」の画面仕様・ローダーの props 契約の節が埋まっていて、「未決事項」が空であること

アウトラインのファイル(`apps/<app>/tests/pages/…`)を開き、`it.todo` の件数が作業ノートの記載と合っていることを確認する。

## 1. テストコードを実装する

すべての `it.todo` を実行可能な `it` に変える(`vite-plus/test` と `@testing-library/react` から import する)。

- 描画は `render(<Page {...props} />)`(手本: `apps/admin/tests/pages/index.test.tsx`)。props は**作業ノートの props 契約の形**で、
  テスト内の小さな関数(例: `props(overrides)`)で組み立て、ケースごとに必要な値だけ上書きする。
  型は `.server.ts` の `Props`(`import type { Props } from '../../pages/<ページ>/index.server'`)を使う。未実装の間は
  import エラーで落ちる ── それが正しい Red
- **Void のコンポーネント(`Link`、`Form`、`useForm` など `@void/react` のもの)を使う画面は、初めてのとき、描画に Void のコンテキストが要るかを
  最初の 1 件で確かめる。** 要るなら、`apps/<app>/tests/support/render.tsx` に描画の補助を切り出し(2 か所目から共通化。3 か所目を待たず、
  同じ準備を 2 つの画面で書くなら切り出す)、方法を作業ノートの「決定事項」に残す
- 後片付けは `afterEach(cleanup)`
- AAA(Arrange/Act/Assert)を空行で区切り、フェーズを混同させない
- 権限による出し分け・空状態・エラー表示は、props を変えて検証する(`getByRole` などアクセシビリティの観点で探す)
- **絶対にやらないこと**:
  - フォーム送信・実際のネットワーク通信を伴うテスト(非同期の応答が別のテストへ漏れる)。送信を伴う検証は、`tdd-server-impl` の後に
    ④ E2E(Playwright)で書く
  - 対象コードの内部モジュール(`components/**`、`packages/*`)への `vi.mock()` / `vi.spyOn()` によるすり替え
  - 実データベースへのアクセスや外部 HTTP 通信の呼び出し ── この層は props を直接渡して描画するだけで、DB にも外部通信にも触れない
  - **`pages/` の中にテストを置く**(ルートとして扱われる。`architecture/architecture.test.ts` が検出する)

## 2. Red を目視する

```bash
vp run -F @club/<app> test tests/pages/<対象>.test.tsx
```

**必ず実行して落ちることを目で確認する。** ページ未実装なら import エラーで落ちるのが正しい Red。
「落ちるところを見ていないテストは、対象を検証できていなくても気付けない」— これは省略不可
(`CLAUDE.md`「開発の進め方」参照)。既存のコンポーネントへテストを後から足す場合(先にテストが書けず Red から始められない場合)は、
対象コンポーネントを一時的に壊してから同じコマンドで落ちることを確認し、確認後に必ず元へ戻す(`git diff` で差分が残っていないこと)。

### ユーザーへの見せ方(スマホなど、遠隔の端末からでも読めるように)

ユーザーは端末から遠隔で操作していることがある。Red を確認したら、次の2つを行う:

1. **実行結果の要約を、会話にコードブロックで貼る**: 件数(pass / fail / todo)、落ちたテストの代表的な理由、
   **最初から通ったテストとその理由**(実装前でも成立する性質のものか)。
2. **実装したテストファイルを `SendUserFile` で送る**(`display: "attach"`、`status: "normal"`、caption に件数)。
   `SendUserFile` が未ロードなら、先に `ToolSearch` で `select:SendUserFile` を読み込む

テストコードの全文は会話に貼らない(長く、小さい画面で読みにくい)。ユーザーが特定の範囲を見たいと言ったら、
その範囲だけをコードブロックで見せる。

## 3. 作業ノートを更新する

「進捗」の1番目のチェックボックスを付け、必要なら「検証を置く層の割り振り」を更新する。
次は `tdd-front-impl` を明示的に起動する。

## 4. GitHub Issueに記録する

`docs/work/README.md`「GitHub Issue への記録」を参照。**Red目視・判断に迷った点・想定外の挙動に遭遇するたびに
都度コメントする**(このステップまで溜めない)。フェーズ完了時(作業ノートの進捗チェックを付けるとき)には、
`tdd-front-test-outline` での仕様確定を含めて、詰めた画面仕様・ローダーの props 契約・実装したテストファイル・起きた問題の総括を1件書く。
