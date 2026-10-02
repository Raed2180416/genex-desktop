import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchServerIcon, pickServerIcon, serverIconDataUrl } from "../../src/substrate/mcp/server-icon.ts";

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
const pngData = `data:image/png;base64,${PNG.toString("base64")}`;

test("a server's icons: a dark-theme picture first, then one for any theme; only data: and https: sources", () => {
  assert.equal(pickServerIcon(undefined), undefined);
  assert.equal(
    pickServerIcon([{ src: "javascript:alert(1)" }, { src: "file:///etc/passwd" }, { src: "http://x/i.png" }]),
    undefined,
  );
  assert.equal(
    pickServerIcon([{ src: "https://a/light.png", theme: "light" }, { src: "https://a/any.png" }])?.src,
    "https://a/any.png",
  );
  assert.equal(
    pickServerIcon([{ src: "https://a/any.png" }, { src: "https://a/dark.png", theme: "dark" }])?.src,
    "https://a/dark.png",
  );
  assert.equal(pickServerIcon([{ src: "https://a/light.png", theme: "light" }])?.src, "https://a/light.png");
  assert.equal(pickServerIcon([{ src: 3 }, null, "x"] as never), undefined, "junk is skipped, not thrown on");
});

test("a data: icon is kept only when its bytes are the picture it says, within the cap", () => {
  assert.equal(serverIconDataUrl(pngData), pngData);
  const svg = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
  assert.equal(serverIconDataUrl(svg), svg);
  assert.equal(
    serverIconDataUrl(`data:image/svg+xml,${encodeURIComponent(SVG)}`),
    svg,
    "a percent-encoded SVG comes back as base64",
  );
  for (const bad of [
    "data:text/html;base64,PHNjcmlwdD4=",
    `data:image/png;base64,${Buffer.from("<script>").toString("base64")}`,
    `data:image/svg+xml;base64,${PNG.toString("base64")}`,
    `data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(300 * 1024)]).toString("base64")}`,
    "data:image/png;base64,%%%",
    "https://example.com/icon.png",
  ])
    assert.equal(serverIconDataUrl(bad), undefined, bad.slice(0, 40));
});

test("an https icon is fetched once, capped and sniffed; anything else is left out", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/good.png"))
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (url.endsWith("/good.svg")) return new Response(SVG, { headers: { "content-type": "image/svg+xml" } });
    if (url.endsWith("/html.png")) return new Response("<html>", { headers: { "content-type": "image/png" } });
    if (url.endsWith("/huge.png")) return new Response(new Uint8Array(Buffer.concat([PNG, Buffer.alloc(400 * 1024)])));
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  assert.equal(await fetchServerIcon("https://cdn.example/good.png", fetchImpl), pngData);
  assert.match(
    (await fetchServerIcon("https://cdn.example/good.svg", fetchImpl)) ?? "",
    /^data:image\/svg\+xml;base64,/,
  );
  assert.equal(await fetchServerIcon("https://cdn.example/html.png", fetchImpl), undefined);
  assert.equal(await fetchServerIcon("https://cdn.example/huge.png", fetchImpl), undefined);
  assert.equal(await fetchServerIcon("https://cdn.example/missing.png", fetchImpl), undefined);
  const before = calls.length;
  assert.equal(await fetchServerIcon("http://cdn.example/good.png", fetchImpl), undefined);
  assert.equal(await fetchServerIcon("file:///etc/hosts", fetchImpl), undefined);
  assert.equal(calls.length, before, "nothing but https is fetched");
  const throwing = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  assert.equal(await fetchServerIcon("https://cdn.example/good.png", throwing), undefined);
});
