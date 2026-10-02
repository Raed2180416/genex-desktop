import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { releaseIntent } from "./release-policy.mjs";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
let mainAncestor = false;
try {
  execFileSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], { stdio: "pipe" });
  mainAncestor = true;
} catch {
  // Build-only candidates may run before main exists; uploading must still fail closed.
}
const intent = releaseIntent({
  version,
  refType: process.env.GITHUB_REF_TYPE ?? "branch",
  refName: process.env.GITHUB_REF_NAME ?? "dev",
  publish: process.env.RELEASE_PUBLISH === "true",
  mainAncestor,
});
if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `tag=${intent.tag}\npublish=${intent.publish}\nprerelease=${intent.prerelease}\n`,
  );
}
console.log(JSON.stringify(intent));
