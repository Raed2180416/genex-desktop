# Planet surfaces — corrected AG-966 direction

**The planet is the sphere.** Every pattern, relief feature and material lives directly on its
continuous spherical surface. There is no container, surrounding glass bubble or interior scene.
The earlier `sphere-library` experiment misunderstood this requirement and is superseded.

Open `../ag-966-planet-surfaces.html` manually. Four retained surfaces and their layer combinations are
embedded along with fonts and local rendering code. Cloud pearl remains the placeholder.
The preview uses Russian labels, 28px sidebar samples, a same-color comparison, seed controls,
PNG export and a small recipe that a chat agent can choose. No network or inference is used.

## Parked scope

Owner retained ocean/continents/clouds, crater surfaces (including frost), gas stripes and liquid
marble. Lava rifts and ice crust were removed from renderer, recipes, schema, fallback selection
and gallery. Cloud pearl remains the placeholder. Further procedural refinement and production recipe
integration are deferred in the code TODO in `index.mjs`; resume only when requested.

## Surface recipe

```json
{"version":2,"seed":127,"surface":"ocean","layer":"clouds","palette":"ice"}
```

| Surface | Available layers |
| --- | --- |
| `ocean` — coastlines, water, land | `none`, `clouds`, `frost` |
| `craters` — dusty rock with crater relief | `none`, `frost`, `metallic` |
| `bands` — gas bands wrapping the sphere | `none`, `storms`, `clouds` |
| `marble` — broad liquid mineral flows | `none`, `veins`, `metallic` |
| `cloud-pearl` — placeholder | `none` |

Palettes: `ice`, `violet`, `jade`, `amber`, `rose`, `silver`. Seed: uint32. Version: `2`;
v1 interior recipes are intentionally rejected. Unknown fields and incompatible layers fail.
There are 13 surface/layer combinations, each with repeatable seeded variation. Geometry,
lighting and all procedural fields are owned by the library; the agent only supplies data.

One choice can be included in existing game planning, with no additional image-generation
call. Store the first recipe or baked image; subsequent chat messages should preserve it.
The optional text-hash fallback is deterministic and does not infer genre or meaning.

## Use

```sh
node design/experiments/planet-surfaces/cli.mjs \
  --brief 'Explore an ocean planet' --surface ocean --layer clouds --palette ice \
  --out /tmp/ocean-cover.png
```

Or supply `--recipe recipe.json --out cover.png`. Default 256px; allowed range 28–768px.
The CLI refuses to overwrite existing files. Output is a transparent PNG.

```js
import { renderPlanet, recipeFromBrief } from './index.mjs';
const recipe = recipeFromBrief('Explore an ocean planet', {
  surface: 'ocean', layer: 'clouds', palette: 'ice',
});
const { width, height, data } = renderPlanet(recipe, 256);
```

Render API is pure and returns RGBA bytes. Normal perturbation provides actual shaded crater
and terrain relief. Seeded 3D fields wrap over sphere normals, compressing naturally at the limb.
All pixels inside the silhouette belong to the same sphere. There are no orbiting objects.

## Review scope

The surface library and HTML remain standalone; they are not wired into in-app chat tools.
The approved Cloud pearl is baked into the shared production fallback by
`node design/experiments/planet-surfaces/bake-placeholder.mjs`, without shipping the renderer.
It appears as a circle in the sidebar, search and image preview. Normal games, custom images
and existing cover metadata are untouched. Production procedural recipes remain deferred. No new dependencies: the HTML builder uses already-installed esbuild;
runtime rendering and the Node CLI use only JavaScript and built-in PNG compression.

```sh
node design/experiments/planet-surfaces/build.mjs
node design/experiments/planet-surfaces/proof.mjs
```

Proof output is in `.studio-dev/planet-surfaces/`: large and area-averaged 28/44px images,
all 13 combinations, seeded repeatability, distinct surfaces with one palette, layer effects,
empty-brief placeholder and validation failures. The rendered art is visually reviewed.
Browser layout, controls, clipboard and downloads remain manually unverified after the earlier
local HTML URL security rejection. No alternate browser access was attempted.
