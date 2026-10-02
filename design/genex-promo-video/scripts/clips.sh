#!/bin/sh
# Remake the clips the film plays: Genex's asset grid from genex.games/tools, and a game built
# from those assets with fal.ai (Nano Banana Pro for the picture, Seedance 2.5 to set it moving).
# Needs FAL_KEY, Node 24 and ffmpeg. Generation differs every run: look at what comes back before
# committing it. A request already sent is resumed from out/clips; delete that folder to start over.
set -e
cd "$(dirname "$0")/.."
: "${FAL_KEY:?Set FAL_KEY to a fal.ai key}"
OUT=out/clips
mkdir -p "$OUT" public/clips
SITE=https://genex.games/tools/videos
[ -f "$OUT/village-world.mp4" ] || curl -fsSL "$SITE/village-world.mp4" -o "$OUT/village-world.mp4"
[ -f "$OUT/archer-controls.mp4" ] || curl -fsSL "$SITE/archer-controls.mp4" -o "$OUT/archer-controls.mp4"
frame() { ffmpeg -y -loglevel error -ss "$2" -i "$OUT/$1.mp4" -frames:v 1 -q:v 2 "$OUT/$3.jpg"; }

# The asset grid from its last empty moment (1.2 s), through the cottage, well and tree.
ffmpeg -y -loglevel error -ss 1.2 -i "$OUT/village-world.mp4" -t 5.6 -an -vf scale=800:-2 \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p public/clips/village-assets.mp4
ffmpeg -y -loglevel error -i public/clips/village-assets.mp4 -frames:v 1 -q:v 3 public/clips/village-empty.jpg

# The game: a picture made from the finished assets, then five seconds of it playing.
frame village-world 2.6 ref-cottage
frame village-world 4.2 ref-well
frame village-world 7.9 ref-village
frame archer-controls 0.3 ref-archer
node scripts/fal.mjs fal-ai/nano-banana-pro/edit scripts/fal-inputs/game-still.json "$OUT/game-still.png"
ffmpeg -y -loglevel error -i "$OUT/game-still.png" -q:v 2 "$OUT/game-still.jpg"
node scripts/fal.mjs bytedance/seedance-2.5/image-to-video scripts/fal-inputs/game-video.json "$OUT/game.mp4"
ffmpeg -y -loglevel error -i "$OUT/game.mp4" -an -vf scale=800:-2 -c:v libx264 -preset slow -crf 23 \
  -pix_fmt yuv420p public/clips/village-game.mp4
ls -l public/clips
