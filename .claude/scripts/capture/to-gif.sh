#!/usr/bin/env bash
# WebM から、PR 本文に埋め込む GIF のプレビューを作る(`pr` の「メディア」工程が使う)。
#   .claude/scripts/capture/to-gif.sh <入力.webm> <出力.gif> [幅=800] [fps=10]
# GIF は 3MB 以下にする。超えたら、幅を 800 → 640 → 480 → 360 と下げて作り直す。
# それでも超える場合は、終了コード 1 で止める(シナリオを短くする)。
set -euo pipefail

in="${1:?使い方: to-gif.sh <入力.webm> <出力.gif> [幅=800] [fps=10]}"
out="${2:?使い方: to-gif.sh <入力.webm> <出力.gif> [幅=800] [fps=10]}"
width="${3:-800}"
fps="${4:-10}"
limit=$((3 * 1024 * 1024))

# ホストの ffmpeg を使う(外部のコンテナイメージには頼らない)。無ければ導入方法を示して止まる。
if ! command -v ffmpeg >/dev/null; then
    echo "ffmpeg が見つかりません。導入してください(例: sudo apt-get install ffmpeg)。GIF が作れないときは、WebM のリンクだけを本文に載せます" >&2
    exit 2
fi
convert() { ffmpeg -v error -y -i "$1" -vf "$2" -loop 0 "$3"; }

for w in "$width" 640 480 360; do
    [ "$w" -le "$width" ] || continue
    convert "$in" "fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" "$out"
    size=$(stat -c %s "$out")
    echo "GIF: ${out} (幅 ${w}px, ${size} bytes)"
    [ "$size" -le "$limit" ] && exit 0
done

echo "GIF が 3MB を超えました。シナリオを短くしてください: ${out}" >&2
exit 1
