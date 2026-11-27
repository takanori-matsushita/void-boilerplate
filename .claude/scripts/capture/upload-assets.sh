#!/usr/bin/env bash
# 画像・GIF・WebM を、孤立ブランチ `pr-assets` の `pr-<ブランチ名>/` へ上げ、本文に貼る URL を出力する
# (`pr` の「メディア」工程が使う)。
#   .claude/scripts/capture/upload-assets.sh <ブランチ名> <ファイル>...
#
# 履歴は積まない: 他の PR のディレクトリを残したまま、毎回「最新のツリー1コミット」にして `--force` で push する。
# **`pr-assets` だけは force push が例外**(このブランチは成果物置き場で、履歴に価値が無い)。他のブランチには使わない。
# 上限: PNG 10MB / GIF 3MB / WebM 10MB かつ 30秒。超えたら何も push せず止める。
set -euo pipefail

BRANCH_NAME="pr-assets"
branch="${1:?使い方: upload-assets.sh <ブランチ名> <ファイル>...}"
shift
[ "$#" -gt 0 ] || { echo "ファイルを1つ以上指定してください" >&2; exit 2; }

limit_of() {
    case "$1" in
        *.png) echo $((10 * 1024 * 1024)) ;;
        *.gif) echo $((3 * 1024 * 1024)) ;;
        *.webm) echo $((10 * 1024 * 1024)) ;;
        *) echo "対応していない拡張子です(png / gif / webm): $1" >&2; return 1 ;;
    esac
}

for f in "$@"; do
    [ -f "$f" ] || { echo "ファイルがありません: $f" >&2; exit 2; }
    limit=$(limit_of "$f")
    size=$(stat -c %s "$f")
    [ "$size" -le "$limit" ] || { echo "上限(${limit} bytes)を超えています: $f (${size} bytes)" >&2; exit 1; }
    case "$f" in
        *.webm)
            if command -v ffprobe >/dev/null; then
                # Playwright の WebM は長さのメタ情報を持たないことがあるので、取れなければ検査を飛ばす
                dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null || true)
                if [ -n "$dur" ] && [ "$dur" != "N/A" ] && awk "BEGIN{exit !($dur > 30)}"; then
                    echo "30秒を超えています(${dur}秒): $f" >&2
                    exit 1
                fi
            fi
            ;;
    esac
done

remote_url=$(git remote get-url origin)
repo_path=$(printf '%s' "$remote_url" | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')
dir="pr-$(printf '%s' "$branch" | tr '/' '-')"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git -C "$work" init -q
git -C "$work" remote add origin "$remote_url"
if git -C "$work" fetch -q --depth 1 origin "$BRANCH_NAME" 2>/dev/null; then
    git -C "$work" checkout -q FETCH_HEAD
fi
git -C "$work" checkout -q --orphan "$BRANCH_NAME-new" 2>/dev/null || git -C "$work" checkout -q -B "$BRANCH_NAME-new"

rm -rf "${work:?}/$dir"
mkdir -p "$work/$dir"
cp "$@" "$work/$dir/"

git -C "$work" add -A
git -C "$work" -c user.name="pr-assets" -c user.email="pr-assets@users.noreply.github.com" \
    commit -q -m "pr-assets: ${dir}" --allow-empty
git -C "$work" push -q --force origin "HEAD:refs/heads/$BRANCH_NAME" 2> >(grep -v "^remote:" >&2)

for f in "$@"; do
    echo "https://github.com/${repo_path}/blob/${BRANCH_NAME}/${dir}/$(basename "$f")?raw=true"
done
