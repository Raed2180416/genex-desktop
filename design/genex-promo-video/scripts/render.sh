#!/bin/sh
# Render the Genex promo film and its poster, then copy both beside the renderer.
set -e
cd "$(dirname "$0")/.."
OUT=../../src/renderer/media
mkdir -p out "$OUT"
npx remotion render GenexPromo out/genex-promo-raw.mp4 --codec=h264 --crf=18 --pixel-format=yuv420p --muted
# Re-encode small for the card: no audio, fast start, one keyframe a second.
ffmpeg -y -loglevel error -i out/genex-promo-raw.mp4 -an -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -g 30 -movflags +faststart "$OUT/genex-promo.mp4"
npx remotion still GenexPromo "$OUT/genex-promo-poster.jpg" --frame=313 --image-format=jpeg --jpeg-quality=85
ls -l "$OUT"
