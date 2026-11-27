---
name: pr
description: PR の作成・更新・Ready 化を行う。push → (画面の変更があれば)スクショ・動画を撮って添付 → PR 本文を全セクション作り直す、までを担う。`/pr --draft` は draft 作成(メディアなし)、`/pr` は通常の PR の作成または更新、`/pr --ready` は更新して draft を Ready for review にする。レビュー指摘への対応は `/pr-review-respond` の担当で、このスキルは触らない。ユーザーが `/pr` と明示的に指示したときだけ使う。「進めて」等の依頼だけで自動的に PR を作ってはいけない(`/tdd-front-test-outline` が `/pr --draft` の手順を呼ぶ場合を除く)。
---

# pr — PR の作成・更新・Ready 化

`/commit` が「変更をコミットする」のに対し、こちらは「**コミット済みの変更を PR として見せる**」。
外向き(GitHub に公開される)の操作なので、**ユーザーが `/pr` と明示した起動を承認とみなす**。それ以外では動かさない。

細部は参照ファイルに分けてある。必要な工程で読むこと:

- `.claude/skills/pr/body.md` — 本文の組み立て(材料・マーカー・タイトル・更新の仕方)
- `.claude/skills/pr/media.md` — スクショ・動画の撮影、GIF、`pr-assets` へのアップロード

## 引数

| 呼び方 | 挙動 |
|---|---|
| `/pr --draft` | push → draft PR を作成。メディアは添付しない(工程 3 を飛ばす) |
| `/pr` | PR が無ければ作成(通常の PR)、あれば更新 |
| `/pr --ready` | 更新に加えて、draft → Ready for review に切り替える |

`/tdd-front-test-outline` は、アウトラインの最初のコミットの後に、**`/pr --draft` の手順**(Skill ツールで `pr` を `--draft` で起動)で draft PR を作る。

## 工程

1. **前提の確認**
   - `git branch --show-current` が `main` でないこと(`main` なら止める。ブランチは `/commit` の手順で切る)
   - `git status --short` が空であること。**未コミットの変更があれば止めて、先に `/commit` を案内する**(何を公開するかの選別は `/commit` の責務)。
     ただし、`/pr` 自身が工程 3 で生成した `docs/work/<機能名>.capture.mjs` だけは例外で、未コミットのまま続けてよい(最後に `/commit` を案内する)
   - `main` との差分(コミット)が無ければ止める(GitHub は差分の無いブランチで PR を作れない)
   - `gh auth status` が通ること。通らなければエラーを報告して止める
   - `git remote get-url origin` が通ること(GitHub のリモートがあること)。無ければ、リポジトリの作成と `git remote add origin ...` が先、と伝えて止める
2. **push**: `git push -u origin <ブランチ>`(**force はしない**)。失敗したら、エラーを報告して止める
3. **メディア**(`--draft` では飛ばす): 画面の変更があるときだけ。手順は `media.md`
4. **本文の更新**: `body.md` に従い、PR を作る(無ければ)/ 本文のマーカーの内側を全セクション作り直す(あれば)
5. **Ready 化**(`--ready` のときだけ): 下の条件を満たすときだけ `gh pr ready`

## `--ready` の条件

次を**すべて**満たすときだけ切り替える。満たさなければ、切り替えずに、理由を報告して終える。

- CI がすべて緑(`gh pr checks <番号>`。実行中のものがあれば、待たずに「実行中」と報告して止める)
- 本文の全セクションが埋まっている(`(未定)` や空のプレースホルダが残っていない)。「リリース時の注意」「レビューしてほしい点・やらなかったこと」は、
  無ければ**「なし」と書いてあること**(空は不可)。**画面の変更があるのにメディアが無い場合も止める**
- 未解決のレビュースレッドが残っていても**止めない**。警告だけ出す(対応は `/pr-review-respond` の担当):
  ```bash
  gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}' -f o=<owner> -f r=<repo> -F n=<番号>
  ```

## 報告

最後に次を簡潔に伝える(端末から開けるよう、URL は必ず書く):

- PR の URL、種別(draft / 通常 / Ready)、何をしたか(作成・更新・Ready 化)
- 添付したメディア(枚数・GIF・WebM)。飛ばした場合はその理由
- `--ready` を断った場合は、その理由
- 未コミットの `docs/work/<機能名>.capture.mjs` があれば、`/commit` を案内する

`gh` や push が失敗したら、**エラーを報告して止める**(後続の工程を無理に進めない)。
ただし `/tdd-front-test-outline` から呼ばれたときは、その手順どおり、**エラーを報告して作業を続ける**。
