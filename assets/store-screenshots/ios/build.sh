#!/bin/zsh
set -euo pipefail

# App Store 用スクリーンショットに見出し・補足・淡色背景を合成するスクリプト
# （filto-app の docs/05_store/store_screenshots/build_store_screenshots.sh と同じ構図）。
# raw/{en,ja}/ のシミュレータ撮影画像（1284×2778）を入力に、App Store Connect の
# 「6.5インチディスプレイ」欄にそのまま使える 1284×2778 の画像を {en,ja}/ に出力する。
# 撮影画像は横幅を保ったまま縮小配置し、はみ出た下部（タブバー付近）はキャンバス外へ
# クロップされる。
asset_dir="${0:A:h}"
raw_dir="$asset_dir/raw"

font_en_bold="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
font_en_reg="/System/Library/Fonts/Supplemental/Arial.ttf"
font_ja_bold="/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
font_ja_reg="/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"

canvas_w=1284
canvas_h=2778
shot_w=1164
corner=40

# constants/theme.ts の solo（#2E7D6B）・partnered（#F4A699）を淡くした背景色
bg_brand='#E3EFEA'
bg_accent='#FBE6E1'
headline_color='#1F2933'
subhead_color='#5B6670'

mkdir -p "$asset_dir/en" "$asset_dir/ja"

make_slide() {
  local input="$1" output="$2" headline="$3" subhead="$4" bg="$5" font_bold="$6" font_reg="$7"
  local headline_size=88 subhead_size=46

  local subhead_y=470
  if [[ "$headline" != *$'\n'* ]]; then
    subhead_y=$(( 140 + (headline_size * 12 / 10) + 70 ))
  fi
  local shot_y=$(( subhead_y + (subhead_size * 12 / 10) + 85 ))

  local base="$asset_dir/.tmp-base.png" rounded="$asset_dir/.tmp-rounded.png" shadowed="$asset_dir/.tmp-shadowed.png"

  magick -size ${canvas_w}x${canvas_h} xc:"$bg" \
    -font "$font_bold" -fill "$headline_color" -pointsize "$headline_size" -gravity north \
    -interline-spacing 14 -annotate +0+140 "$headline" \
    -font "$font_reg" -fill "$subhead_color" -pointsize "$subhead_size" -gravity north \
    -annotate +0+${subhead_y} "$subhead" \
    "$base"

  magick "$input" -resize ${shot_w}x \
    \( +clone -alpha extract -draw "fill black polygon 0,0 0,$corner $corner,0 fill white circle $corner,$corner $corner,0" \
       \( +clone -flip \) -compose Multiply -composite \
       \( +clone -flop \) -compose Multiply -composite \
    \) -alpha off -compose CopyOpacity -composite \
    "$rounded"

  magick "$rounded" \( +clone -background black -shadow 30x25+0+18 \) +swap \
    -background none -layers merge +repage \
    "$shadowed"

  magick "$base" "$shadowed" -gravity north -geometry +0+${shot_y} -compose over -composite \
    -crop ${canvas_w}x${canvas_h}+0+0 +repage \
    -strip -colorspace sRGB -alpha off \
    "$output"

  rm -f "$base" "$rounded" "$shadowed"
}

make_slide "$raw_dir/en/01-today.png" "$asset_dir/en/01-today.png" \
  'Your private log.' 'Record solo or partnered in one tap.' \
  "$bg_brand" "$font_en_bold" "$font_en_reg"
make_slide "$raw_dir/en/02-calendar.png" "$asset_dir/en/02-calendar.png" \
  'See it over time.' 'Every entry, month by month.' \
  "$bg_brand" "$font_en_bold" "$font_en_reg"
make_slide "$raw_dir/en/03-insights.png" "$asset_dir/en/03-insights.png" \
  'Know your patterns.' 'Totals, split, and average interval.' \
  "$bg_accent" "$font_en_bold" "$font_en_reg"
make_slide "$raw_dir/en/04-settings.png" "$asset_dir/en/04-settings.png" \
  'Private by design.' 'App Lock, encryption, no account.' \
  "$bg_brand" "$font_en_bold" "$font_en_reg"

make_slide "$raw_dir/ja/01-today.png" "$asset_dir/ja/01-today.png" \
  '自分だけの記録を。' 'ソロもパートナーとも、1タップで記録。' \
  "$bg_brand" "$font_ja_bold" "$font_ja_reg"
make_slide "$raw_dir/ja/02-calendar.png" "$asset_dir/ja/02-calendar.png" \
  '月ごとに振り返る。' 'いつ記録したかがひと目で分かります。' \
  "$bg_brand" "$font_ja_bold" "$font_ja_reg"
make_slide "$raw_dir/ja/03-insights.png" "$asset_dir/ja/03-insights.png" \
  '傾向が見える。' '合計・内訳・平均間隔をひと目で。' \
  "$bg_accent" "$font_ja_bold" "$font_ja_reg"
make_slide "$raw_dir/ja/04-settings.png" "$asset_dir/ja/04-settings.png" \
  'プライバシーを守る設計。' 'アプリロック・暗号化・アカウント不要。' \
  "$bg_brand" "$font_ja_bold" "$font_ja_reg"
