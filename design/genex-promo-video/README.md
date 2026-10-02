# Genex promo film

The looping film at the top of the Genex Tools card that greets a new person after the welcome
(`src/renderer/panels/GenexPromo.tsx`). It is a [Remotion](https://www.remotion.dev/) project of
its own: nothing here is bundled into the app, only the two rendered files are.

A Genex window floats on the Genex sky. One message asks for "a cottage, a well, a tree and village
music"; Genex Tools makes them: on the asset grid the cottage, the well and the oak tree
materialize in cyan and turn solid as their rows tick, and the theme starts playing. Live then
shows the finished game, an archer walking through that village, and the window settles back to
its first frame, so the film loops without a seam. 760×400 at 30 fps, 13.4 s (the first 1.5 s hold still), shown at 380×200
CSS pixels.

- `src/GenexPromo.tsx`: the timeline, the camera, the window, the asset grid and the game.
- `src/assets.tsx`: the theme's waveform.
- `public/clips`: the two clips the film plays and the empty grid it starts on (see below).
- `public/fonts`: the app's Zalando Sans SemiExpanded and Geist Mono (SIL OFL 1.1, texts beside them).

## The clips

`village-assets.mp4` is Genex's own asset-grid film from https://genex.games/tools, trimmed to
start on the empty grid. `village-game.mp4` was generated with fal.ai: Nano Banana Pro made a game
picture from frames of the site's cottage, well, tree and archer, and Seedance 2.5 set it moving.
`scripts/clips.sh` remakes both (needs `FAL_KEY`, and gives a different game each run); the
prompts are in `scripts/fal-inputs/`, and `scripts/fal.mjs` is the small queue client they run
through. If a new game clip is kept, check the rows' timings in `src/GenexPromo.tsx` still match.

## Preview and render

Node 24 and ffmpeg on the path.

```sh
npm install
npm run studio   # preview and scrub in Remotion Studio
npm run render   # writes src/renderer/media/genex-promo.mp4 and genex-promo-poster.jpg
```

`scripts/render.sh` renders H.264 from Remotion, re-encodes it small (CRF 27, no audio, fast
start, a keyframe a second) and takes the poster from frame 313, the game with the new assets.
Commit both files in `src/renderer/media`.

## License

Remotion is free for individuals and companies of up to three people; larger companies need a
Remotion company license (https://www.remotion.dev/license) before rendering for commercial use.
Check this before the next render ships.
