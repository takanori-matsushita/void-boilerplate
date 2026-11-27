# 作業ノート

機能ごとの作業ノート `docs/work/<機能名>.md`（`<機能名>` は英語のスラッグ。ブランチ名のスラッグと揃える）。
TDD の 5 フェーズ（`tdd-front-test-outline` → … → `tdd-refactor`）の間で、会話ではなく**このノートに状態を残す**（別のセッションで再開できるように）。

- **画面** = Void Pages（`apps/<app>/pages/`、React、SSR なし）。**サーバー** = API・ドメイン・DB（`routes/`、`packages/core`、`packages/db`）。
- コマンドの正本は `CLAUDE.md`「開発の進め方」。

## テンプレート

```markdown
# <機能名の日本語名>

## 対象

- Issue: #<番号>
- ブランチ: feature/<番号>-<スラッグ>
- PR: <draft PR ができたら URL>
- 対象の画面 / API: <例: /admin/classes、routes/api/classes/>

## 決定事項（grilling で確定）

### 画面仕様

- 主な端末: スマホ / PC（幅で構造が変わる所があれば書く）
- 表示項目 / 権限による出し分け / 空状態 / エラー表示

### ローダーの props 契約

ページが受け取る props（`loader` の戻り値。`InferProps` でページへ型が渡る）。フロントとサーバーの境界。

```ts
// 例
type Props = { classes: { id: string; name: string; gradeFrom: number; gradeTo: number }[]; canEdit: boolean };
```

### データモデル / テナント

- テーブル・カラム・型 / `tenant_id` の有無（= RLS が要るか）

### 権限

- 権限キー（`packages/shared` の権限カタログ）と scope

### バリデーション

- Valibot スキーマ（`packages/shared`）と日本語エラーメッセージ。成功・失敗時の遷移

### 層の配置

- `core/domain`（純粋関数）/ `core/application`（ユースケース。書き込み・業務ルールを伴う処理）/ `core/ports`（要るデータアクセス）
- `db/repositories`（ports の実装）/ `db/queries`（画面用の読み取り。ユースケースを通さない）/ 最外周（薄い受け口）
- 拒否条件を伴う状態遷移か（関数群にまとめる）/ 単発の不変条件か

### 検証を置く層の割り振り

| 検証 | 層 |
|---|---|
| 計算・判定（DB 不要） | ① 単体（`core/domain`） |
| ユースケース・リポジトリ・RLS・トランザクション | ② 結合（実 Postgres。ports をモックしない） |
| 画面の表示・出し分け | ③ コンポーネント（Testing Library） |
| API の応答・認可・実ブラウザの通し | ④ API / E2E（Playwright） |

### デザイン確認用の暫定サーバー

（`tdd-front-impl` が書く）暫定の `loader` / ルート、`TODO(tdd-server-impl)` の場所、足した権限キー。

## 未決事項

（空になるまで次のフェーズへ進まない）

### テストのアウトライン（`tdd-front-test-outline`、YYYY-MM-DD）

- ファイル: <パスと件数>（`it.todo` のみ）
- 確認状況: 確認済み / 確認待ち

### テストのアウトライン（`tdd-server-test-outline`、YYYY-MM-DD）

- ファイル: <パスと件数>
- 確認状況: 確認済み / 確認待ち

## 進捗

- [ ] 1. 画面のテスト（Red を目視）— `tdd-front-test-code`
- [ ] 2. 画面の実装（デザイン確認済み）— `tdd-front-impl`
- [ ] 3. サーバーのテスト（Red を目視）— `tdd-server-test-code`
- [ ] 4. サーバーの実装（全層 Green）— `tdd-server-impl`
- [ ] 5. リファクタリング — `tdd-refactor`
```

## GitHub Issue への記録

作業の経過は、対応する Issue にコメントとして残す（`gh issue comment <番号> --body-file <ファイル>`。本文はスクラッチ領域に書く）。

- **節目のたびに都度コメントする**: 仕様の確定、判断に迷った点、想定外の挙動、Red の目視、Green になったとき、問題に遭遇したとき。フェーズの最後に溜めて書かない。
- **フェーズ完了時に、総括を 1 件書く**: 何を決め・何を作り・どこで問題が起きたか。
- 事実だけを書く（実行していないテストを「通った」と書かない）。個人情報・秘密情報は書かない。
- Issue 番号が無い作業（`chore` / `docs`）は、コメントを省く。
