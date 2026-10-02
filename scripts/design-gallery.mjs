/** Builds the development-only component specimen using the production CSS and components. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, cp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
const root = fileURLToPath(new URL("..", import.meta.url));
export async function buildDesignGallery() {
  const out = path.join(root, ".studio-dev/design-gallery");
  await mkdir(out, { recursive: true });
  await build({
    entryPoints: [path.join(root, "design/genex/Gallery.tsx")],
    outfile: path.join(out, "gallery.js"),
    bundle: true,
    format: "esm",
    jsx: "automatic",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await writeFile(
    path.join(out, "input.css"),
    `@import "${path.join(root, "src/renderer/theme.css")}";\n@source "${path.join(root, "design/genex")}";\n`,
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/@tailwindcss/cli/dist/index.mjs"),
      "-i",
      path.join(out, "input.css"),
      "-o",
      path.join(out, "gallery.css"),
    ],
    { cwd: root, stdio: "pipe" },
  );
  await cp(path.join(root, "src/renderer/fonts"), path.join(out, "fonts"), { recursive: true });
  await writeFile(
    path.join(out, "index.html"),
    '<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="gallery.css"></head><body><div id="root"></div><script type="module" src="gallery.js"></script></body></html>',
  );
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await buildDesignGallery());
