import assert from "node:assert/strict";
import { test } from "node:test";
import { build, type Metafile } from "esbuild";
import { rendererBuildOptions, rendererBundleReport } from "../../scripts/renderer-build.mjs";

const DEVELOPMENT_REACT = /react.*\/cjs\/.*\.development\.js$/;

// React's development build keeps a User Timing measure per component render; shipped in
// `npm start` builds it filled the UI renderer's memory during a long Autopilot run. Only watch
// and owned `--dev-build` builds (`development`) keep it.
const MODES = [
  { name: "watch or owned development", mode: { development: true }, development: true },
  { name: "plain (npm run build, npm start)", mode: {}, development: false },
  { name: "release", mode: { release: true }, development: false },
] as const;

async function bundleReactDom(mode: Parameters<typeof rendererBuildOptions>[0]): Promise<Metafile> {
  const result = await build({
    stdin: {
      contents: 'import {createRoot} from "react-dom/client"; console.log(createRoot)',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    metafile: true,
    logLevel: "silent",
    platform: "browser",
    ...rendererBuildOptions(mode),
  });
  return result.metafile;
}

for (const { name, mode, development } of MODES) {
  test(`${name} renderer selects the intended React runtime`, async () => {
    const inputs = Object.keys((await bundleReactDom(mode)).inputs);
    assert.equal(
      inputs.some((file) => DEVELOPMENT_REACT.test(file)),
      development,
    );
    if (!development) assert.ok(inputs.some((file) => file.endsWith("react-dom/cjs/react-dom-client.production.js")));
  });
}

test("a release cannot ask for development React", () => {
  assert.throws(() => rendererBuildOptions({ release: true, development: true }));
});

test("the bundle report refuses development React outside a development build", async () => {
  const metafile = await bundleReactDom({ development: true });
  assert.throws(() => rendererBundleReport(metafile, {}), /Development React/);
  assert.throws(() => rendererBundleReport(metafile, { release: true }), /Development React/);
  assert.equal(rendererBundleReport(metafile, { development: true }).react, "development");
  assert.equal(rendererBundleReport(await bundleReactDom({}), {}).react, "production");
});
