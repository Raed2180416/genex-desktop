# AG-966 — Sphere material study

Open `../ag-966-spheres.html` in a browser. It is a self-contained artifact: embedded fonts,
initial PNGs and local software rendering. Nothing loads from a CDN or calls an AI service.
It is deliberately outside the shipping app. The earlier low-poly direction was rejected;
these three materials are candidates for owner selection, not an accepted design-system change.

- **Sky + chrome:** reflected clouds, a curved horizon and a mirrored lower region.
- **Cloud pearl:** diffuse cloud forms with spherical shading and a glossy coating.
- **Abstract iris:** radial fibers around an off-axis dark center.
- **Default:** a neutral silver-blue sphere, previewed below the candidates.

The comparison shares seed, tint, gloss and detail controls. Five sample game rows vary the seed
and tint within each material. Clicking a row inspects that identity across all three materials.
The bottom picker switches between comparison and a larger single-material view. Arrow keys
and 1–4 also switch; inputs retain their normal keys. `?variant=chrome`, `pearl`, `iris`, or `all`
select the view (local browser history restrictions may prevent updating the URL).

Save PNG exports the currently rendered transparent 480px image. Rendering runs only when the
controls change, yields between images, cancels superseded updates, and bounds the image cache.
It does not keep a WebGL context or animation loop alive. The HTML opens with baked previews
even if scripts are disabled. PNGs are generated entirely from code, not from the supplied images.

Regenerate the standalone HTML:

```sh
node design/experiments/spheres/build.mjs
```

Render the exact same material implementation to an offline contact sheet and record timings:

```sh
node design/experiments/spheres/render-proof.mjs
```

The proof writes `.studio-dev/spheres/contact-sheet.png`, individual transparent PNGs and a
report. That verifies material output and seed determinism, not browser UI behavior. Local-file
browser automation was blocked earlier in this session; no alternate access was attempted.
Page layout, browser controls and downloads still need owner review in a browser.

## Different games from different prompts

`../ag-966-game-identities.html` compares three editable prompts (shooter, RPG, racing)
using the **same** selected material. Regenerate it with:

```sh
node design/experiments/spheres/build-identities.mjs
```

The candidate `sphereIdentityFromPrompt` normalizes the text, hashes it into a numeric seed,
and derives a curated palette, cloud scale and reflection orientation. It uses no genre
classifier or model; color is an identity marker, not a semantic description of the game.
Different prompts may share a palette. Same normalized prompt gives identical parameters;
blank input uses the neutral default. Proposed application behavior would save the first
identity and retain it through follow-up messages. This mapping is not integrated into Studio.
