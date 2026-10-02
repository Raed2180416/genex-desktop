/** Add from Ollama: exact-tag parsing, the manifest URL and download size — no live network. */
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  lookupOllamaModel,
  manifestSizeGb,
  manifestUrl,
  parseOllamaReference,
} from "../../src/substrate/ollama-registry.ts";

it("accepts the names ollama pull accepts and nothing that could redirect the request", () => {
  assert.deepEqual(parseOllamaReference(" qwen3.5:122b "), {
    namespace: "library",
    name: "qwen3.5",
    tag: "122b",
    id: "qwen3.5:122b",
  });
  assert.equal(parseOllamaReference("qwen3-coder-next")?.id, "qwen3-coder-next:latest");
  assert.equal(
    parseOllamaReference("Someone/Model:Q4_K_M")?.id,
    "someone/model:Q4_K_M",
    "names are lower case, tags keep their case",
  );
  for (const bad of [
    "",
    "https://ollama.com/library/qwen3.5",
    "a/b/c",
    "../etc:passwd",
    "qwen 3",
    "qwen:",
    "qwen:a/b",
    "-x:1b",
    "q?x=1",
  ]) {
    assert.equal(parseOllamaReference(bad), null, bad);
  }
});

it("builds the registry manifest URL for library and user namespaces", () => {
  assert.equal(
    manifestUrl(parseOllamaReference("gpt-oss:120b")!),
    "https://registry.ollama.ai/v2/library/gpt-oss/manifests/120b",
  );
  assert.equal(
    manifestUrl(parseOllamaReference("someone/model")!),
    "https://registry.ollama.ai/v2/someone/model/manifests/latest",
  );
});

it("sums every layer and the config into decimal GB", () => {
  assert.equal(
    manifestSizeGb({ config: { size: 500 }, layers: [{ size: 81_000_000_000 }, { size: 400_000_000 }] }),
    81.4,
  );
  assert.equal(manifestSizeGb({ layers: [] }), null);
  assert.equal(manifestSizeGb({ layers: [{ size: "big" }] }), null);
  assert.equal(manifestSizeGb(null), null);
});

it("reports found, not found and unreachable separately", async () => {
  const answer = (status: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  let asked = "";
  const found = await lookupOllamaModel("qwen3.5:9b", {
    fetch: (async (url: string, init: RequestInit) => {
      asked = url;
      assert.equal(
        (init.headers as Record<string, string>).Accept,
        "application/vnd.docker.distribution.manifest.v2+json",
      );
      return new Response(JSON.stringify({ layers: [{ size: 6_600_000_000 }] }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(found, { ok: true, id: "qwen3.5:9b", sizeGb: 6.6 });
  assert.equal(asked, "https://registry.ollama.ai/v2/library/qwen3.5/manifests/9b");
  assert.deepEqual(await lookupOllamaModel("nope:1b", { fetch: answer(404) }), {
    ok: false,
    reason: "not_found",
    id: "nope:1b",
  });
  assert.equal((await lookupOllamaModel("x:1b", { fetch: answer(503) })).ok, false);
  const offline = await lookupOllamaModel("x:1b", {
    fetch: (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(offline, {
    ok: false,
    reason: "unavailable",
    id: "x:1b",
    error: "Could not reach the Ollama library.",
  });
  let called = false;
  assert.deepEqual(
    await lookupOllamaModel("https://evil.example/x", {
      fetch: (async () => {
        called = true;
        return new Response("{}");
      }) as unknown as typeof fetch,
    }),
    { ok: false, reason: "invalid" },
  );
  assert.equal(called, false, "an invalid name never reaches the network");
});
