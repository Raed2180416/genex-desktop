# Procedural sphere library — AG-966 art exploration

**Superseded after owner correction:** the intended variety is on the sphere's surface, not
objects inside a glass container. Use [the corrected surface library](../planet-surfaces/README.md).
This directory records the rejected interior-scene experiment and is not the current direction.

Local, dependency-free-at-runtime JavaScript for varied game identities. The shared shell
contains actual ray-intersected planets, ribbons, faceted crystals, an eclipse or fragments.
No orbital-ring family or mix is supported. Cloud pearl is the selected placeholder direction.

Open `../ag-966-sphere-library.html` manually in a browser. It includes eleven baked examples,
actual 28px previews, a mixer, PNG export, recipe copy and a same-color comparison. Images,
fonts and rendering code are embedded; it works offline without installing anything. Browser
automation could not access local HTML in this session, so UI acceptance remains manual.

## Agent interface

An agent chooses **data**, not shader code. A complete recipe is small:

```json
{"version":1,"seed":928,"base":"planets","mix":"crystal","palette":"jade"}
```

| Field | Values |
| --- | --- |
| `version` | `1` |
| `seed` | Unsigned 32-bit integer; store once with the game identity |
| `base` | `planets`, `ribbons`, `crystal`, `eclipse`, `fragments`, `cloud-pearl` |
| `mix` | See compatible combinations below; defaults to `none` |
| `palette` | `ice`, `violet`, `jade`, `amber`, `rose`, `silver` |

Choose one main subject and at most one supporting element. Keep empty space around the
subject. Geometry, lights, glass, composition limits and object count are owned by the renderer.
The agent should not write drawing code, request generated images or repeatedly refine seeds.
Use one recipe decision within the existing game-planning response if the host integrates this;
it does not require another inference request. A number of tokens is **not** guaranteed until
measured with the actual tokenizer, but the interface is only these five fields.

| Base | Allowed additions |
| --- | --- |
| Planets | none, clouds, fragments, crystal |
| Liquid ribbons | none, moon, crystal, fragments |
| Crystal core | none, clouds, moon, fragments |
| Eclipse | none, clouds, fragments, ribbons |
| Fragments | none, clouds, moon, ribbons |
| Cloud pearl | none |

21 supported combinations including the standalone families and placeholder, each with seeded
arrangement, palette and geometric variation. No combination adds an orbital ring. Colors
and composition need not encode a genre. An agent may pick a fitting metaphor from the game
brief; the optional automatic fallback uses a deterministic text hash and has no semantic model.

## Render from an agent or terminal

```sh
node design/experiments/sphere-library/cli.mjs \
  --recipe recipe.json --out /tmp/game-sphere.png --size 256
```

Or derive the seed from a brief and explicitly choose the contents:

```sh
node design/experiments/sphere-library/cli.mjs \
  --brief 'A quiet exploration game on an icy moon' \
  --base planets --mix crystal --palette ice --out /tmp/icy-moon.png
```

The CLI writes a transparent PNG and prints its normalized recipe and elapsed local render /
encode time. It refuses to overwrite an existing output. Rendering size is bounded to 28–768px;
256px is the normal stored cover size. PNG encoding uses Node's built-in zlib. No dependencies
are installed, no network is used and no model or image-generation service is called.

Direct JavaScript:

```js
import { renderLibrarySphere, recipeFromBrief } from './index.mjs';
const recipe = recipeFromBrief('A quiet exploration game on an icy moon', {
  base: 'planets', mix: 'crystal', palette: 'ice',
});
const { width, height, data } = renderLibrarySphere(recipe, 256);
// RGBA Uint8ClampedArray; use ImageData / Canvas in a browser or PNG encoding in Node.
```

Blank text returns the fixed Cloud pearl placeholder. Identical normalized text produces the
same recipe. Hash collisions and similar-looking images remain possible: this is a visual
identity generator, not a uniqueness guarantee. Store the initial recipe; follow-up messages
should not regenerate it. A renderer-version change requires deliberate migration of stored
recipes or keeping their baked PNGs. Custom user images should take precedence.

## Scope and eventual application integration

This is a working standalone library and exploration page, outside shipping Studio. It is not
yet registered as an in-app agent tool, included in the packaged harness, or wired into the
sidebar. Do not claim that the current chat agent can already call it through Studio.

After art approval, the host can expose a bounded recipe-setting operation and keep rendering
and presentation metadata host-owned. The harness would supply the recipe through that
operation; it would never rewrite the renderer, edit the project index or place icons in game
source/assets. Persist the version and baked PNG once; user uploads must not be overwritten.

## Development and evidence

```sh
node design/experiments/sphere-library/build.mjs
node design/experiments/sphere-library/proof.mjs
```

Building the standalone page uses the repository's already-installed esbuild. Runtime rendering
does not. The proof renders all eleven examples, verifies all 21 compatible combinations,
rejects unknown fields / rings / invalid dimensions, checks seeded repeatability and empty-text
placeholder behavior, and writes `.studio-dev/sphere-library/report.json` plus a contact sheet.
The sheet includes area-averaged 28px and 44px samples. Renderings were visually reviewed;
browser layout, focus, clipboard and PNG-download interactions remain unverified due to the
earlier local-file browser policy rejection. No alternative browser access was attempted.
