---
name: tdd-server-test-outline
description: TDD実装フロー(5フェーズ)の第3フェーズの前半。サーバー側(API・ドメイン・DB)のテストについて、grillingで仕様を詰め、テストのアウトライン(it.todo)を作ってユーザーの確認を取るところまで行う。テストコードの実装は `/tdd-server-test-code` が担当する。ユーザーが `/tdd-server-test-outline` と明示的に指示したときだけ使う。「〇〇を実装して」等の依頼だけで自動的に起動してはいけない。
---

# tdd-server-test-outline — サーバー側のテストのアウトライン作成

`tdd-front-test-outline → tdd-front-test-code → tdd-front-impl → tdd-server-test-outline → tdd-server-test-code → tdd-server-impl → tdd-refactor` の4番目。
このスキルは**仕様を確定し、アウトライン(`it.todo`)を作ってユーザーの確認を取るところまで**。
テストのロジック(Arrange/Act/Assert)は書かない — それは `tdd-server-test-code` の仕事。実装も書かない。

「サーバー側」= 最外周(`apps/<app>/routes` などの Void の規約)、`packages/core`(domain / ports / application)、`packages/db`(repositories・queries・RLS)、`packages/shared`(Valibot・権限カタログ)。
進め方の全体規約は `CLAUDE.md`「レイヤー構成」、層とテストの方針は `.claude/rules/architecture.md` と `.claude/rules/testing.md` を
前提知識として読むこと。ここには**手順**だけを書く。

## 0. 作業ノートと画面の実装コードを読む

**ブランチと draft PR を確認する**: 作業ブランチにいて、draft PR があること(`gh pr list --head <ブランチ> --json url,isDraft`)。
`tdd-front-test-outline` を通っていない機能(画面が無い等)で、まだ無ければ、`tdd-front-test-outline` の「0. ブランチを切り、
作業ノートを開く」と「コミットして、draft PR を作る」と同じ手順で作る(draft PR はこのフェーズの最初のコミットの後)。

`docs/work/<機能名>.md` を読む。「ローダーの props 契約」「画面仕様」(`tdd-front-test-outline` が確定済み)を前提に、
サーバー側の仕様を詰める。

**加えて、作業ノートの「対象」節が指すページの実装コード(`apps/<app>/pages/<パス>/**`、参照している `apps/<app>/components/**`)と、
暫定の `index.server.ts`(`loader` の戻り値の型 = `Props`)を必ず実際に開いて読む。** 作業ノートの「ローダーの props 契約」は
grilling 時点の合意であり、`tdd-front-impl` でのコンポーネント分割・実装の過程で props の名前・ネスト構造・オプショナルかどうかが
変わっていることがある。ノートの記述だけを信じてサーバー側のテストを書くと、実装済みの画面が実際に読んでいる構造と食い違ったまま
気づけない。ノートと実装コードが食い違っていたら**実装コードを正**とし、ノートの「ローダーの props 契約」を実装に合わせて
更新してからテストを書く(食い違いが仕様変更に見える場合はユーザーに確認する)。

**`tdd-front-impl` が入れた暫定のサーバー側(作業ノートの「デザイン確認用の暫定サーバー」、
`grep -rn "TODO(tdd-server-impl)" apps packages`)も確認する。** ページの URL(= ファイルのパス)は確定済みなので、grilling で変えない
(変える必要が出たらユーザーに確認し、画面のテストも直す)。暫定の props(固定値)は、サーバーの本実装で置き換わる前提でテストを書く。

## 1. grilling でサーバー側の仕様を詰める

Skill ツールで `grilling` を起動し、frontier が空になるまで次を確定させる:

- DB スキーマ(テーブル・カラム・型。金額は円の整数、日時は `timestamptz`、ID は UUID v7。DB が `uuidv7()` で採番)
- `tenant_id` の有無(= RLS が要るか。`CLAUDE.md`「テナント分離」)
- 権限キー(`packages/shared` の権限カタログの命名規約)と scope
- バリデーションルール(`packages/shared` の Valibot スキーマ)と日本語エラーメッセージ
- 成功時・失敗時の遷移(`action` の戻り値、エラーの返し方)
- 異常系(誰が何を送るとどう失敗するか。他テナントの ID を指定されたときなど)
- 層の配置 — **`core/domain` に置く判断**(DB 不要の計算・判定。純粋関数)、**`core/application` のユースケース**(書き込み・業務ルールを伴う処理。1 操作 1 関数)、
  **`core/ports`**(ユースケースが要るデータアクセスの interface)、`db/repositories`(ports の実装)、`db/queries`(画面用の読み取り。ユースケースを通さない)。
  拒否条件を伴う状態遷移なら、関数群としてどう表すか。**`core` は `tx` も `db` も知らない**(`.claude/rules/architecture.md`)
- トランザクション: リクエスト全体がテナントのトランザクションの中で動くので、通常は追加の境界は不要。Queue consumer・Cron は別
  (管理用ロール。RLS をバイパスするので、テナントの条件を SQL で明示する)

結論を作業ノートの「決定事項」の該当節(データモデル / 権限 / バリデーション / 層の配置)へ書き、ユーザーに確認を取る。
「未決事項」が残っていたら埋まるまで進めない。

## 2. どの層のテストかを振り分ける

`.claude/rules/testing.md`「層の使い分け」に従う:

- **① 単体**(`packages/core/test/<文脈>.test.ts`)— DB にも Void にも触れない `domain` の純粋関数・値の検証。金額の計算・割引・学年繰り上げなど
- **② 結合**(`packages/db/test/<文脈>.integration.test.ts`)— 実 Postgres での RLS・クエリ・トランザクション・**ユースケースと repositories の組み合わせ**(ports をモックしない)。**このスキルが書く中心**
- **③ ルートのハンドラ**(`apps/<app>/tests/routes/<文脈>.test.ts`)— 偽のコンテキストでハンドラを直接呼び、入力の検証・ユースケース / クエリの呼び出し・
  戻り値を確認する(手本: `apps/admin/tests/routes/handler-pattern.test.ts`)。`db` の関数に実 DB が要る検証は②に置く
- **④ API / E2E**(Playwright)— HTTP の応答・認可・Webhook・実ブラウザでしか観測できないもの。基盤が未整備なので、必要な機能で最初に整える
  (整える場合は別コミットにし、作業ノートに書く)

判断を作業ノートの「検証を置く層の割り振り」へ書く。**テストファイルを `pages/` `routes/` の中に置かない**(ルートとして扱われる)。

## 3. アウトラインを生成する(テストロジックはまだ書かない)

`describe('文脈', () => { ... })` の階層構造と `it.todo('〜の時、〜であること')` だけを並べる(`vite-plus/test` から import する)。
テスト名はそれ自体が仕様書として読めるように書く。Arrange/Act/Assert の中身はこの段階では書かない。ユーザーに確認を取ってから次へ。

**テナントに属するデータを扱うなら、次のケースを必ず含める**: 自テナントの行だけが見える / 他テナントの行は見えない(読み・更新・削除とも) /
他テナントの `tenant_id` での書き込みを拒否する / テナント未設定では失敗する(安全側)。

**ルートを追加・変更する機能なら、更新が要る既存のテスト(権限とルートの対応表など。フェーズ 3 で導入する認可の宣言テストがあれば)の
洗い出しも、アウトラインの時点で行い、作業ノートに書く**(直すのは `tdd-server-test-code` の「ルートを追加・変更する機能なら…」の小節)。

### ユーザーへの見せ方(スマホなど、遠隔の端末からでも読めるように)

ユーザーは端末から遠隔で操作していることがある。**ローカルのファイルパスは端末から開けない**ので、確認を求める前に、
次の2つを**両方**行う:

1. **アウトラインの一覧を、会話にコードブロックで貼る。** ファイル全文ではなく、`describe` の階層とテスト名だけのツリー
   (1行1ケース。件数も添える)。`grep -nE "describe\(|it\.todo" <ファイル>` の出力を整形すればよい。意図を示すコメントは、
   必要なケースにだけ添える
2. **テストファイルそのものを `SendUserFile` で送る**(`display: "attach"`、`status: "normal"`、caption に件数)。
   複数ファイルは1回の呼び出しにまとめる。`SendUserFile` が未ロードなら、先に `ToolSearch` で `select:SendUserFile` を読み込む

修正の依頼を反映したら、変更したファイルだけ送り直し、変更点を短く伝える。

## 4. 作業ノートへ記録して引き継ぐ

`tdd-server-test-code` は別のセッションで起動されうるため、アウトラインの所在と確認状況を**会話ではなく作業ノート**に書く。
`docs/work/<機能名>.md` に次の節を足す(ユーザーが確認した後に「確認済み」にする):

```markdown
### テストのアウトライン(`tdd-server-test-outline`、YYYY-MM-DD)

- ファイル: <パスと件数>(`it.todo` のみ。ロジックは未実装)
- 確認状況: 確認済み / 確認待ち(<修正依頼があれば内容>)
- データモデル・権限・バリデーションの決定事項: 上の「決定事項」の各節に記載済み
```

「進捗」のチェックボックスは**ここでは付けない**(付けるのは `tdd-server-test-code` がRedを目視した後)。
次は `tdd-server-test-code` を明示的に起動する。

## 5. GitHub Issueに記録する

`docs/work/README.md`「GitHub Issue への記録」を参照。**grilling での仕様確定・判断に迷った点・想定外の挙動に
遭遇するたびに都度コメントする**(このステップまで溜めない)。アウトラインの確認が取れたら、詰めた仕様と
アウトラインの構成(ファイルと件数)を1件書く。フェーズの総括(Red目視を含む)は `tdd-server-test-code` が書く。
