---
name: tdd-front-impl
description: TDD実装フロー(5フェーズ)の第2フェーズ。tdd-front-test-codeが書いたテストをGreenにする画面(Void Pages / React)の実装を、frontend-designの視覚設計を踏まえてコンポーネント分割しながら行い、デザインを実機で確認できるよう暫定の loader / action まで足す。ユーザーが `/tdd-front-impl` と明示的に指示したときだけ使う。「〇〇を実装して」等の依頼だけで自動的に起動してはいけない。
---

# tdd-front-impl — 画面の実装

`tdd-front-test-outline → tdd-front-test-code → tdd-front-impl → tdd-server-test-outline → tdd-server-test-code → tdd-server-impl → tdd-refactor` の3番目。
`tdd-front-test-code` が書いたテストを Green にする画面実装を行い、**デザインを実機で確認できるよう、
ページに暫定の `loader` / `action` まで足す**(下の「5.」)。テストの追加・変更はここでは行わない
(仕様が変わったなら `tdd-front-test-outline` に戻る)。

## 0. 作業ノートを読む

`docs/work/<機能名>.md` を読む。存在しない、または「進捗」1番目が未チェックならユーザーに
ノートの場所を確認する — 仕様が固まっていない状態で実装に入らない。「ローダーの props 契約」
「画面仕様」の節を実装の設計図として使う。

## 1. 視覚設計の方針を得る

Skill ツールで `frontend-design` を起動し、タイポグラフィ・配色・レイアウトの方向性を決める。

**UI の土台**: React Aria Components(RAC)+ Tailwind CSS(`CLAUDE.md`「技術スタック」。日付・カレンダー中心でモバイルと国際化が要るため選んだ)。**shadcn/ui など、他の UI ライブラリは入れない。**
**導入済み**(`apps/admin` と `apps/liff`。ルートのレイアウト `pages/layout.tsx` が `styles/app.css` を 1 回だけ読み込み、ブラウザで適用されることを確認済み)。
新しいアプリを足すとき、または抜けているときは、次を入れる(**別コミット**。Void 上で動作を実測済み):

- `react-aria-components`、`tailwindcss`、`@tailwindcss/vite`、`tailwindcss-react-aria-components`(いずれも `vp add -D -E` で固定する)
- `vite.config.ts` の `plugins` に `tailwindcss()`(`@tailwindcss/vite`)を足す
- `apps/<app>/styles/app.css`: `@import 'tailwindcss';` と `@plugin 'tailwindcss-react-aria-components';`、**`@theme { … }` にデザイントークン**(色・余白・文字サイズ・角丸など。
  この節の「視覚設計の方針」〈`frontend-design`〉で決めた値)。ルートのレイアウト(`pages/layout.tsx`)で読み込む(ページごとには読み込まない。動作確認済み)
- **見た目はユーティリティで書く**。**部品の状態**は、RAC の状態を表す接頭辞で書く(`pressed:` `focus-visible:` `selected:` `disabled:` `invalid:` など)。値の直書きではなく、`@theme` のトークンから選ぶ
- **`components/ui/` に、このプロジェクトの見た目を付けた薄いラッパー**(Button・Dialog・Select・DatePicker など)を、**必要になった順に**作る(YAGNI。使わない部品を先回りして作らない)。
  **長いクラスの文字列は、ここに閉じ込める**(ページには、レイアウトのユーティリティだけを書く)。2 つ目のアプリで要るまで `packages/` へ共有しない
- ユーティリティで書けないもの(アニメーションの定義など)だけ、`styles/app.css` に素の CSS を足す(CSS Modules は使わない。方式を 1 つに保つ)
- `*.css` の import の型は、`apps/<app>/types/vite-env.d.ts`(`/// <reference types="vite/client" />`。設定済み)で解決する

**最初の画面で、次の未検証事項を確かめて、結果を作業ノートと `CLAUDE.md` に残す**:

1. Void の `Link`(クライアントナビゲーション)と RAC の連携(RAC の `RouterProvider` で、Void のナビゲーションを渡す)
2. 日本語入力(IME)の変換中に、Enter などが誤動作しないか(テキスト入力・コンボボックス)
3. LIFF のページごとのバンドルサイズ(`vp build` の出力で測る。極端に増えたら、部品の選び方やコード分割を見直す)
4. コンポーネントテスト(happy-dom)で RAC の部品が動くか ── **`Button` は動作確認済み**(Void のアプリで描画・クエリできた)。他の部品(Select・DatePicker・Dialog など)は、使うときに確かめ、動かない部品の扱いを決める

### モバイルファースト

**スマホ幅を基準に作り、広い幅へ足していく。** 主な端末は画面ごとに違う。作業ノートの「画面仕様」の**主な端末**を確認し、無ければ書く。
主な端末が PC の画面も、CSS は同じくスマホ基準で書く(スマホで開いても壊れない)。

- **Tailwind はスマホ基準で書く**: 接頭辞なしがスマホ、`sm:`(640px)/ `md:`(768px)/ `lg:`(1024px)で広い幅へ**上書き**する。
  `max-sm:` のような、広い幅から縮める書き方はしない。**360px 幅で成立すること**(横スクロールが出ない。表は、横スクロールを
  意図して `overflow-x-auto` で包む場合だけ例外)
- **指で操作できる大きさ**: ボタン・リンク・チェックの当たりは、高さ 44px 程度を目安にする。隣り合う操作の間隔を詰めすぎない
- **hover に頼らない**: 情報や操作を、ツールチップ・hover だけに置かない(タッチでは開かない)。必要な情報は、画面上に出すか、タップで開く形にする
- **入力欄**: 文字サイズ 16px 未満だと、iOS で入力時に拡大される。`components/ui/` のラッパーの既定のまま使い、小さくしない

#### レスポンシブか、専用のデザインか

**既定はレスポンシブ**(1 つのコンポーネントを、クラスだけで幅に合わせる)。**複雑にならないなら、専用のデザインにしてよい**
(KISS・YAGNI・DRY: `docs/design-principles.md`)。次の**両方**を満たす時だけ、専用にする:

1. **幅で変わるのが、見た目の調整を超えている**: 情報の構造や操作そのものが違う
   (例: 表 → カードの一覧、ダイアログ → 下から出るシート、サイドバー → 下部のナビ)。余白・列数・文字サイズの違いなら、レスポンシブで足りる
2. **切り替えが複雑にならない**(次をすべて満たす):
   - 切り替える場所が**1 か所**(親のページ・一覧だけが分岐する)
   - 専用の部品に渡すのは**同じ props**で、**ロジック(状態・計算・送信)は共有**する(hook や共通部品に出す)。分けるのは見た目だけ。
     ロジックが二重になりそうなら、専用にしない(DRY)
   - テストが書ける(下の「切り替えの方式」)

**迷ったら、まずレスポンシブで作る。** スマホ幅のスクリーンショット(下の「5.」)で破綻したときだけ、専用にする(YAGNI)。
専用にしたときは、**理由と方式を作業ノートに書く**。

**専用の部品の形**: `<XxxMobile>` / `<XxxDesktop>`(または表なら `<XxxTable>` / `<XxxList>`)に分け、親が同じ props を渡す。
切り替えの方式は、次の 2 つから選ぶ:

| 方式 | 内容 | 向くもの | 注意 |
|---|---|---|---|
| **CSS で切り替える** | `md:hidden` と `hidden md:block` で片方を隠す | 表示だけの部品(一覧・カード) | **DOM が二重になる**。happy-dom は CSS を評価しないので、両方が見えて `getByRole` が複数ヒットする → テストでは region などで範囲を絞る。**入力欄・フォーム・ダイアログなど、状態を持つ部品には使わない**(`id` と状態が二重になる) |
| **JS で切り替える** | 幅を見る hook(例: `matchMedia` で幅を見る自作の `useIsMobile()`)で片方だけ描画する | 状態を持つ部品、DOM を二重にしたくないもの | SSR なし(クライアントで描画)なので、初回のちらつきは小さい。テストでは幅を指定する方法を決めて、作業ノートに残す |

## 2. コンポーネントを分割しながら実装する

**1 コンポーネント 1 責務。** 次のいずれかに当てはまったら切り出す:

- JSX が長くなってきた
- 同じ塊が 2 箇所目に現れた
- props による表示分岐が増えてきた

**置き場所**(Void は `pages/` の中のファイルをルートにする。**ルートにしないファイルは名前を `_` で始める**。実測済み):

- ページ本体 → `apps/<app>/pages/<パス>/index.tsx`(URL がそのままパス)。ローダー・アクションは同じ場所の `index.server.ts`
- そのページでしか使わないもの → `apps/<app>/pages/<パス>/_<名前>.tsx`(`_` 付き。ルートにならない)
- 複数のページで再利用する単位 → `apps/<app>/components/**`
- UI 部品(Button・Dialog・Select・DatePicker など)は `components/ui/` の RAC のラッパーから使う。ページで `react-aria-components` を直接組み立てない(見た目と挙動を 1 か所にそろえる)。無い部品は、ラッパーを足す
- **ブラウザに配信されるコード(`pages/` `components/`。`.server.ts` を除く)から、サーバー専用(`void/db`、`@club/db`、`pg`、`void/auth` など)を
  import しない**(`architecture/architecture.test.ts` が検出する)。サーバー側の処理は `.server.ts` と `routes/` に置く

権限による出し分けは、`loader` が真偽値(例: `canEdit`)で渡し、ページはそれを見て出す(権限判定のロジックをブラウザに持たせない)。
**ナビゲーションは権限が無ければ消す**。**画面内のアクションは無効化して理由を出す**(消してユーザーに何もできない画面を見せない)。
権限のキーと scope は `packages/shared` の権限カタログ(`tdd-server-impl` の①)が正本。

**コード内コメントは最小限にする。** 読めば分かることを説明するコメントは書かない。書いてよいのは、
コードだけでは伝わらない最重要な意図(トリッキーな回避策の理由など)と `TODO` コメントだけ。

**設計原則**(詳細と判断基準は `docs/design-principles.md`。優先順位は、プロジェクトの規約 > KISS > YAGNI > DRY > SOLID):

- **KISS**: JSX の中に複雑な式を書かない。三項演算子は入れ子にせず、変数や小さなコンポーネントに切り出す。早期 return で条件を浅くする
- **YAGNI**: テストと画面仕様が要求するものだけ作る。使われない props・オプション・状態・汎用化を足さない
- **DRY**: 重複は 2 か所目までは許し、**3 か所目で共通化**する。実装中に先回りして抽象化しない。
  見た目が同じでも、変わる理由が別なら共通化しない。共通化の形は、まず小さな関数・コンポーネントから
- **S**: 1 コンポーネント 1 責務。長くなる・分岐が増える・同じ塊が 2 箇所目に出たら切り出す。ページは「データを受けて、部品を並べる」だけに近づける
- **O**: 種別ごとに表示が変わるなら、`if` を増やし続けず、種別ごとの小さなコンポーネントを足す形に(2 つ目が現れてから)
- **I**: props は必要なものだけ渡す。大きなオブジェクトをそのまま下へ流さない
- **D**: 副作用(送信・ナビゲーション)は、決まった場所(`<Form>`・`useForm`・既存の共通部品)に任せ、部品に直接書かない

## 3. テストを Green にする

```bash
vp run -F @club/<app> test tests/pages/<対象>.test.tsx
```

`tdd-front-test-code` が書いたテストの assert 内容は変更しない。テストが実装の意図と食い違うと
感じたら、コードを合わせるのではなくユーザーに確認する(仕様変更は `tdd-front-test-outline` の担当)。

## 4. 静的チェック

```bash
vp check             # 整形(Oxfmt)・リント(Oxlint)・型。直すときは vp check --fix
vp run typecheck     # 全パッケージ・アプリの型(ルートの型 .void/routes.d.ts を含む)
vp run test:unit     # 依存方向のテストを含む(architecture/architecture.test.ts)
```

## 5. デザイン確認用に、暫定の loader / action を足す

このプロジェクトは画面先行なので、このフェーズの時点ではサーバー側に本物のデータを返す処理が無く、**実ブラウザで画面を開けない**
(コンポーネントテストでは見た目を確認できない)。デザインを実機で確認できるよう、**画面を開くための最小限だけ**足す。
本実装(DB・バリデーション・権限の中身)は `tdd-server-test-*` → `tdd-server-impl` の仕事で、ここでは書かない。

**足してよいのは、ページの `index.server.ts` の `loader` / `action` の暫定版と、権限カタログのキーの 2 つだけ。** `routes/` のハンドラ・
`packages/` の関数・マイグレーション・Valibot スキーマの本実装は作らない(テストが先にあって初めて書く — TDD)。

- **`loader`**(`apps/<app>/pages/<パス>/index.server.ts`): 作業ノートの「ローダーの props 契約」の形を**そのまま**返す。DB は読まず、空の一覧と、
  デザインの確認に要る最小限の固定サンプル(1〜2 件)を返す。`ssr = false` と `Props` の型を必ず書く:

  ```ts
  import { defineHandler, type InferProps } from 'void';

  export const ssr = false;
  export type Props = InferProps<typeof loader>;

  // TODO(tdd-server-impl): 暫定。本実装に置き換える
  export const loader = defineHandler(() => ({ classes: [{ id: '…', name: '小学生' }], canEdit: true }));
  ```

- **`action`**(書き込みがあるとき): `throw new HTTPException(501, { message: '未実装' })`(`hono/http-exception`)。ページが `useForm('<URL>', …)` で
  引くため、無いと描画時に落ちる。暫定の箇所すべてに `// TODO(tdd-server-impl): 暫定。本実装に置き換える` を付ける(`grep` で見つけられるように)
- **URL は、ファイルのパスで確定する**(Void にルート定義ファイルは無い)。以降のフェーズはこの URL を変えない。型付きルート(`routing.typedRoutes`)の定義
  `.void/routes.d.ts` は、開発サーバーの起動中に自動で更新される
- **権限キーが新規なら、カタログに足す**(`packages/shared` の権限カタログ。`tdd-server-impl` の①と同じ。無ければ、このときに作る)。
  カタログに無いキーを使わない。プリセット役割への付与はまだしない(deny by default。確認は管理者〈全権役割〉で行う)

**実機での確認**

1. ローカル Postgres を起動し(`make db-up`)、対象アプリの開発サーバーを起動する(`vp run -F @club/<app> dev`。admin は `http://localhost:5301`、liff は `5302`。
   同時には起動できない)
2. 認証が必要な画面は、シード済みのサンプルテナントでログインする(認証はフェーズ 3 で導入する。それまでは認証なしの画面だけ)。
   `SHOT_EMAIL` / `SHOT_PASSWORD` / `SHOT_ORG_SLUG` で指定する(`.claude/scripts/capture/capture.mjs` の冒頭を参照)
3. **スクリーンショットを撮って、ユーザーに送る。** ユーザーはスマホなど遠隔の端末から操作していることがあり、
   `localhost` の URL は端末から開けない。**PC 幅(1280px)とスマホ幅(390px)の両方を、毎回必ず撮って、両方送る**
   (片方だけにしない。レイアウトは幅で大きく変わる):

   ```bash
   node .claude/scripts/capture/capture.mjs <パス> <出力先>/mobile/<ページ>.png --mobile --full   # スマホ幅を先に(モバイルファースト)
   node .claude/scripts/capture/capture.mjs <パス> <出力先>/pc/<ページ>.png --full
   ```

   - **出力先は `.claude/tmp/pr-media/<ブランチ名の `/` を `-` にしたもの>/pc/`(PC 幅)と `.../mobile/`(スマホ幅)**
     (`.gitignore` 済みで、リポジトリには残らない)。**撮るのは画像だけ**で、動画は撮らない(サーバーは暫定で、操作の通しを動かせない)。
     ファイル名は、PC・スマホで同じ `<ページ>.png` にそろえる(`pr` スキルが、サフィックスを付けて上げる)。
     この画像は、デザイン確認の記録で、`/pr` が PR に載せるのは本実装で撮り直したもの
     (`apps` `packages` が撮影後に変わっていなければ、そのまま使われる。`.claude/skills/pr/media.md` の「2.」)
   - ポートは `SHOT_PORT`(admin は既定の 5301、liff は `SHOT_PORT=5302`)で指定する。前提は、開発サーバーの起動済みと、
     `vp exec playwright install chromium` 済みであること
   - **送る前に、スマホ幅・PC 幅の両方の画像を、自分で開いて確認する**(`Read` で画像を読める)。出力の `<ステータス> <URL>` が `200` で、
     URL が エラーページでないこと、画面が意図どおりに写っていること。**スマホ幅では特に**: スクリプトが出す
     「横スクロール」が「なし」であること、操作要素が小さすぎない・詰まりすぎていないこと、文字が切れていないこと。
     破綻していたら、レスポンシブの調整で直せるかを先に試し、直せないときだけ専用のデザインを検討する(「モバイルファースト」の基準)
   - 暫定のサンプルで出せない状態(権限なし・エラーなど)は、無理に再現しない(YAGNI。表示条件はテストが担保している)。
     画面の状態が複数あって、暫定のサンプルで出せるもの(空・一覧など)は、状態ごとに撮る
   - **`SendUserFile` で送る**(画像なので `display: "render"`、`status: "normal"`、caption に画面名と幅〔PC / スマホ〕)。
     `SendUserFile` が未ロードなら、先に `ToolSearch` で `select:SendUserFile` を読み込む。**PC 幅とスマホ幅の 2 枚は 1 回の呼び出しにまとめる**
4. 画像と URL を伝え、**デザインの確認を依頼する**。修正の依頼があれば反映し、テストを Green に保つ
   (assert を変える必要が出たら `tdd-front-test-outline` に戻る)。修正したら、**撮り直して送り直す**。
   **進捗のチェックは、ユーザーの確認が取れてから付ける**

**作業ノートに「デザイン確認用の暫定サーバー」の節を書く**(`tdd-server-test-outline` / `tdd-server-impl` が読む):
足したページの URL、暫定の `loader` / `action`(`grep -rn "TODO(tdd-server-impl)" apps packages` で全部出ること)、カタログに足した権限キー。

## 6. 作業ノートを更新する

「進捗」の 2 番目のチェックボックスを付ける(デザインの確認が取れてから)。次は `tdd-server-test-outline` を明示的に起動する。

## 7. GitHub Issueに記録する

`docs/work/README.md`「GitHub Issue への記録」を参照。**このフェーズ(1〜6)を通じて、視覚設計の
方針が決まった・コンポーネントを 1 つ切り出した・テストが Green になった・静的チェックで問題が出た、
デザインの確認で修正の依頼があった、といった節目のたびに都度コメントする**(このステップまで溜めない)。フェーズ完了時
にはさらに、分割したコンポーネント構成・実装した内容・起きた問題の総括を 1 件書く。
