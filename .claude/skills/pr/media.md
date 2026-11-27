# メディア(スクショ・動画)の撮影と添付(`/pr` の工程 3)

画面の変更があるときだけ行う。`--draft` では行わない。撮影・変換・アップロードの道具は `.claude/scripts/capture/`:

- `capture.mjs` — ログインして撮る。ページ1枚(`<パス> <出力.png>`)か、シナリオ(`--scenario`)+ `--video`(WebM)
- `to-gif.sh` — WebM から GIF のプレビューを作る(3MB 以下)
- `upload-assets.sh` — `pr-assets` ブランチの `pr-<ブランチ名>/` に上げて、URL を出す

## 0. 画面の変更があるかを判定する

`git diff main...HEAD --name-only` に、`apps/*/pages/**` か `apps/*/components/**` が含まれれば「あり」(`*.test.tsx` だけの変更は「なし」)。
無ければ、本文の「確認方法」「メディア」は「画面の変更なし」にして、この工程を終える。

## 1. 前提の確認

- ローカル Postgres が起動している(`make db-up`)
- 対象アプリの開発サーバーが起動している(管理画面: `vp run -F @club/admin dev` → `http://localhost:5301`、LIFF: `vp run -F @club/liff dev` → `http://localhost:5302`。
  同時には起動できないので、撮るアプリだけ起動する)。トップが 200 を返す
- サンプルデータが投入済み(認証の導入後。`SHOT_EMAIL` / `SHOT_PASSWORD` / `SHOT_ORG_SLUG` を設定する。無ければ、認証の無い画面だけ撮れる)
- `vp exec playwright install chromium` 済み(`vp install` の後に 1 回)

満たせない前提があれば、直せるものは直し、直せなければ**メディア無しで続けて**、本文のメディアの節に理由を書く
(`--ready` はこの場合止まる)。

## 2. 保存先と、撮り直すかどうか

保存先: `.claude/tmp/pr-media/<ブランチ名の `/` を `-` にしたもの>/`(`.gitignore` 済み)。以下 `$DIR`。

`/tdd-front-impl` がデザイン確認のために撮ったスクショが、`$DIR` に入っていることがある。**暫定サーバーの画面なので、そのままは載せない。**
次のときだけ、既にある画像をそのまま使う:

```bash
# 画像の撮影より後に、画面・サーバー・ルートのコミットが無い
newest=$(git log -1 --format=%ct -- apps packages)
oldest_png=$(find "$DIR" -name '*.png' -printf '%T@\n' | sort -n | head -1 | cut -d. -f1)
[ -n "$oldest_png" ] && [ "$oldest_png" -ge "$newest" ]   # 真なら再利用してよい
```

偽なら(または画像が無ければ)、**本実装のサーバーで撮り直す**。

## 3. 撮る

**スクショは PC幅(1280px)とスマホ幅(390px)の両方**、どちらも `--full`。動画は PC幅だけ。

### シナリオがある場合(`docs/work/<機能名>.capture.mjs`)

```bash
node .claude/scripts/capture/capture.mjs --scenario docs/work/<機能名>.capture.mjs --out "$DIR/pc" --full --video --name <機能名>
node .claude/scripts/capture/capture.mjs --scenario docs/work/<機能名>.capture.mjs --out "$DIR/mobile" --mobile --full
```

### シナリオが無い場合 — 初回に生成する

作業ノートの「画面仕様」と、該当する E2E テスト(あれば。Playwright)を読み、**主要な操作の流れ**(一覧 → 作成 → 詳細 → 編集など。
削除の確認など、見せたくない破壊的な操作は含めない)を `docs/work/<機能名>.capture.mjs` に書く。形は:

```js
export default async (page, { shot, origin }) => {
    await page.goto(`${origin}/...`, { waitUntil: 'networkidle' });
    await shot('01-list');
    // 操作 …(`page.getByRole(...)` など。操作の間に `await page.waitForTimeout(500)` を入れて、動画で読めるようにする)
    await shot('02-created');
};
```

- **操作で作ったデータが、開発用 DB のサンプルテナントに残る**。撮り直しで重複しても壊れない名前にする(例: 日時を含めない固定名なら、一意制約に当たる場合は末尾に連番を付ける)。`make db-down` → `make db-up` で作り直せる
- **生成したら、内容をユーザーに見せて確認を取る**(不要な操作を削る機会)。確認が取れてから撮る
- 生成したファイルは、このスキルの最後に `/commit` を案内する(未コミットでも撮影・添付は続けてよい)
- 画面が1枚だけで操作が要らないときは、シナリオを作らず、ページ指定のスクショだけにする(動画は撮らない):
  ```bash
  node .claude/scripts/capture/capture.mjs <パス> "$DIR/pc/<ページ>.png" --full
  node .claude/scripts/capture/capture.mjs <パス> "$DIR/mobile/<ページ>.png" --mobile --full
  ```

## 4. 確認する(添付する前に、必ず)

- **画像を自分で開いて見る**(`Read` で画像を読める)。出力の `終了時の URL` / `<ステータス> <URL>` がログインやエラーページでないこと、
  意図した画面が写っていること、スマホ幅で `横スクロール: なし` であること
- **実データが映っていないこと**。撮影してよいのは、サンプルデータ(シードで作ったもの)だけ。実在の子ども・保護者の氏名・連絡先・
  LINE ID らしきものが映っていたら、**アップロードせずに止めて**ユーザーに伝える
- 動画は、シナリオが最後まで通っていること(出力に `保存: ….webm` がある)

## 5. GIF にして、アップロードする

```bash
mkdir -p "$DIR/upload"
for f in "$DIR"/pc/*.png; do cp "$f" "$DIR/upload/$(basename "${f%.png}")-pc.png"; done
for f in "$DIR"/mobile/*.png; do cp "$f" "$DIR/upload/$(basename "${f%.png}")-mobile.png"; done
if [ -f "$DIR/pc/<機能名>.webm" ]; then
    cp "$DIR/pc/<機能名>.webm" "$DIR/upload/"
    .claude/scripts/capture/to-gif.sh "$DIR/pc/<機能名>.webm" "$DIR/upload/<機能名>.gif"
fi
.claude/scripts/capture/upload-assets.sh <ブランチ名> "$DIR"/upload/*
```

- `to-gif.sh` が 3MB に収まらず失敗したら、シナリオを短くして撮り直す(30秒・10MB の WebM 上限も同じ)
- `upload-assets.sh` は `pr-assets` ブランチへ **force push する**(このブランチだけの例外。他の PR の分は残る)。
  サイズ上限を超えたら、何も push せずに止まる。出力の URL をそのまま使う(組み立て直さない)

## 6. 本文の「メディア」の節に書く

`upload-assets.sh` が出した URL で書く。

```markdown
### スクリーンショット

| PC | スマホ |
|---|---|
| ![一覧(PC)](<01-list-pc.png の URL>) | ![一覧(スマホ)](<01-list-mobile.png の URL>) |

### 動画

![操作の流れ(プレビュー)](<GIF の URL>)

[WebM(原本)](<WebM の URL>)
```

- GIF はインラインで動く。WebM は原本なのでリンクで添える。**WebM をその場で再生させたいときは、PR のコメント欄に WebM を
  drag&drop して `user-attachments` に上げるしかない**(GitHub に API が無い)。必要ならユーザーに頼む
- 非公開リポジトリでは、リンク・画像はログイン済みの閲覧者にだけ表示される
