import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readCodexModels, codexModelPage } from "../../src/substrate/engines/codex-models.ts";
import { CatalogError } from "../../src/substrate/engines/model-catalog.ts";
import { ModelCatalogProblemCode } from "../../src/shared/model-catalog.ts";
const row = (model: string, hidden = false) => ({
  id: model,
  model,
  displayName: model,
  hidden,
  supportedReasoningEfforts: [{ reasoningEffort: "low" }],
  defaultReasoningEffort: "low",
});
test("catalog keeps all generations and respects hidden models", () => {
  const page = codexModelPage({ data: [row("gpt-6-sol"), row("gpt-5.6-sol"), row("secret", true)], nextCursor: null });
  assert.deepEqual(
    page.models.map((v) => v.id),
    ["gpt-6-sol", "gpt-5.6-sol"],
  );
  assert.equal(page.models[0]?.defaultEffort, "low");
});
test("malformed catalogs fail rather than becoming empty", () => {
  for (const value of [null, {}, { data: [null] }, { data: [{ model: 12 }] }, { data: [], nextCursor: 3 }])
    assert.throws(() => codexModelPage(value));
});
async function scripted(body: string, check: (file: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "model-list-"));
  const file = path.join(dir, "server.cjs");
  await writeFile(
    file,
    `const rl = require('node:readline').createInterface({input:process.stdin});\nconst row = ${row.toString()};\nrl.on('line', line => {const m=JSON.parse(line); const reply=(result)=>process.stdout.write(JSON.stringify({id:m.id,result})+'\\n'); ${body} });`,
  );
  try {
    await check(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("control-only discovery initializes and follows every page", async () => {
  await scripted(
    `if(m.method==='initialize') return reply({}); if(m.method==='initialized') return; if(m.method!=='model/list') process.exit(2); reply({data:[row(m.params.cursor?'gpt-5.6-sol':'gpt-6-sol')], nextCursor:m.params.cursor?null:'next'});`,
    async (file) => {
      const models = await readCodexModels(process.execPath, [file], process.env);
      assert.deepEqual(
        models.map((v) => v.id),
        ["gpt-6-sol", "gpt-5.6-sol"],
      );
    },
  );
});
test("repeated cursors discard incomplete catalogs", async () => {
  await scripted(
    `if(m.method==='initialize') return reply({}); if(m.method==='model/list') reply({data:[row('test')],nextCursor:'repeat'});`,
    async (file) => {
      await assert.rejects(
        readCodexModels(process.execPath, [file], process.env),
        (error) => error instanceof CatalogError && error.code === ModelCatalogProblemCode.Malformed,
      );
    },
  );
});
test("unsupported model/list is distinct from provider failure", async () => {
  await scripted(
    `if(m.method==='initialize') return reply({}); if(m.method==='model/list') process.stdout.write(JSON.stringify({id:m.id,error:{code:-32601}})+'\\n');`,
    async (file) => {
      await assert.rejects(
        readCodexModels(process.execPath, [file], process.env),
        (error) => error instanceof CatalogError && error.code === ModelCatalogProblemCode.Unsupported,
      );
    },
  );
});

test("a silent control process times out and is closed", async () => {
  await scripted("", async (file) => {
    await assert.rejects(
      readCodexModels(process.execPath, [file], process.env, 30),
      (error) => error instanceof CatalogError && error.code === ModelCatalogProblemCode.Timeout,
    );
  });
});

test("protocol row identity stays separate from the execution model", () => {
  const page = codexModelPage({
    data: [{ ...row("gpt-6-sol"), id: "provider-row-42", isDefault: true }],
    nextCursor: null,
  });
  assert.equal(page.models[0]?.id, "gpt-6-sol");
  assert.equal(page.models[0]?.providerId, "provider-row-42");
  assert.equal(page.models[0]?.providerDefault, true);
});
