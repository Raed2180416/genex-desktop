/**
 * The harness's copy of the host RPC contract (`src/harness-seed/types/host-api.d.ts`) is generated
 * from `src/shared/harness-api.ts` by `scripts/gen-harness-types.ts`: the seed runs in the agent's
 * own workspace and cannot import `src/shared`. The committed copy is the one the harness project
 * type-checks against, so it must be exactly what the generator writes today. The same holds for
 * the seed's runtime copy of the `HostMethod` names (`loop/host-methods.ts`).
 */
import assert from "node:assert/strict";
import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONTRACT, harnessTypes, harnessTypesDrift, SEED_GENERATED } from "../../scripts/gen-harness-types.ts";
import { HostMethod as SeedHostMethod } from "../../src/harness-seed/loop/host-methods.ts";
import { HostMethod } from "../../src/shared/harness-api.ts";
import { tmpDir } from "../helpers/tmp.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("the harness's host API types", () => {
  it("are the ones generated from src/shared/harness-api.ts (run node scripts/gen-harness-types.ts)", () => {
    assert.equal(harnessTypesDrift(root), null);
  });

  it("give the seed the host's method names, member for member", () => {
    assert.deepEqual(SeedHostMethod, HostMethod);
  });

  it("go stale when the contract changes, and the generator carries the change", async () => {
    const copy = path.join(await tmpDir("harness-types-"), "repo");
    await mkdir(path.join(copy, "src"), { recursive: true });
    await cp(path.join(root, "src/shared"), path.join(copy, "src/shared"), { recursive: true });
    for (const { output } of SEED_GENERATED) {
      await mkdir(path.dirname(path.join(copy, output)), { recursive: true });
      await cp(path.join(root, output), path.join(copy, output));
    }
    await cp(path.join(root, "tsconfig.json"), path.join(copy, "tsconfig.json"));
    await symlink(path.join(root, "node_modules"), path.join(copy, "node_modules"));
    assert.equal(harnessTypesDrift(copy), null, "an untouched copy is in sync");

    // A different contract: one method whose result reaches a type in another shared module.
    await writeFile(
      path.join(copy, CONTRACT),
      [
        'import type { MessageImage } from "./event-log.ts";',
        "/** What the probe answers. */",
        "export interface ProbeEcho { echoed: string; image?: MessageImage }",
        'export interface HarnessHostApi { "probe.echo": { params: { text: string }; result: ProbeEcho } }',
        "",
      ].join("\n"),
    );

    assert.match(harnessTypesDrift(copy) ?? "", /out of date/);
    const generated = harnessTypes(copy);
    assert.match(
      generated,
      /export interface HarnessHostApi \{ "probe\.echo": \{ params: \{ text: string \}; result: ProbeEcho \} \}/,
    );
    assert.match(
      generated,
      /\/\*\* What the probe answers\. \*\/\nexport interface ProbeEcho \{/,
      "a type the contract names comes along, doc comment and all",
    );
    assert.match(generated, /export interface MessageImage \{/, "and so does one it reaches in another shared module");
    assert.doesNotMatch(generated, /import /, "the file stands alone");
  });
});
