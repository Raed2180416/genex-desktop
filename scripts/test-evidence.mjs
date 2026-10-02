import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("..", import.meta.url));

/** One default home for generated acceptance artifacts; explicit output overrides still work. */
export function testEvidence(name, override) {
  return path.resolve(override ?? path.join(repo, ".studio-dev/evidence", name));
}
export function optimizationEvidence(override = process.env.AG931_OUTPUT) {
  const root = testEvidence("optimization", override);
  return { root, ui: path.join(root, "ui"), result: path.join(root, "webgl/improve/result.json") };
}
