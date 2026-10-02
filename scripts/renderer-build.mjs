import path from "node:path";
const DEVELOPMENT_ENTRY_MAX_BYTES = 6_000_000;
const RELEASE_ENTRY_MAX_BYTES = 3_000_000;
const DEVELOPMENT_REACT = /react.*\/cjs\/.*\.development\.js$/;

/**
 * React build definitions shared by the application and its bundle conformance tests.
 * `npm run build`, `npm start` and packages ship React's production build; `release` (package,
 * make, publish) also minifies. `--watch` and owned `--dev-build` builds keep the development
 * build, whose StrictMode replays and warnings the UI acceptance drivers rely on; those sessions
 * are short, and the UI clears React's timing measures every minute there (`renderer/main.tsx`).
 *
 * The development build records a User Timing measure, carrying a diff of the props, for every
 * component render, and nothing clears them. An hour into an Autopilot run (2026-09-23) that
 * filled the UI renderer's memory and the window went blank.
 *
 * @param {{ release?: boolean; development?: boolean }} [mode]
 */
export function rendererBuildOptions({ release = false, development = false } = {}) {
  if (release && development) throw new Error("A release renderer cannot bundle development React");
  return {
    define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") },
    minify: release,
    keepNames: true,
  };
}

/**
 * Refuse development React outside a development build; retain provenance for packaged smoke checks.
 *
 * @param {import("esbuild").Metafile} metafile
 * @param {{ release?: boolean; development?: boolean }} [mode]
 */
export function rendererBundleReport(metafile, { release = false, development = false } = {}) {
  const inputs = Object.keys(metafile.inputs);
  const developmentReact = inputs.filter((file) => DEVELOPMENT_REACT.test(file));
  if (!development && developmentReact.length)
    throw new Error(`Development React in a production renderer: ${developmentReact.join(", ")}`);
  const entry = Object.entries(metafile.outputs).find(([, output]) => output.entryPoint === "src/renderer/main.tsx");
  const reachable = new Set();
  const visit = (file) => {
    if (reachable.has(file)) return;
    const output = metafile.outputs[file];
    if (!output) return;
    reachable.add(file);
    for (const imported of output.imports ?? []) {
      if (imported.external || imported.kind === "dynamic-import") continue;
      visit(metafile.outputs[imported.path] ? imported.path : path.join(path.dirname(file), imported.path));
    }
  };
  if (entry) visit(entry[0]);
  const eager = [...reachable].flatMap((file) => Object.keys(metafile.outputs[file].inputs));
  if (eager.some((file) => file.includes("node_modules/three/")))
    throw new Error("three.js must remain outside the eager renderer graph");
  const entryBytes = [...reachable].reduce((sum, file) => sum + metafile.outputs[file].bytes, 0);
  const ceiling = release ? RELEASE_ENTRY_MAX_BYTES : DEVELOPMENT_ENTRY_MAX_BYTES;
  if (entryBytes > ceiling) throw new Error(`Renderer bundle ${entryBytes} exceeds ${ceiling} byte budget`);
  return {
    release,
    react: developmentReact.length ? "development" : "production",
    entryBytes,
    inputs,
    outputs: metafile.outputs,
  };
}
