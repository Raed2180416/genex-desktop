// A minimal fal.ai queue client: submit a request, wait for it, download what it made.
// Usage: FAL_KEY=… node scripts/fal.mjs <endpoint-id> <input.json> <out-file>
// Local image paths in the input ("file:…") are sent inline as data URIs. A request already queued
// for <out-file> (its .queued.json beside it) is resumed rather than sent again.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const POLL_MS = 3000;
const DEADLINE_MS = 20 * 60 * 1000;
const NETWORK_RETRIES = 8;
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

const [endpoint, inputFile, outFile] = process.argv.slice(2);
const key = process.env.FAL_KEY;
if (!endpoint || !inputFile || !outFile || !key) {
  console.error("Usage: FAL_KEY=… node scripts/fal.mjs <endpoint-id> <input.json> <out-file>");
  process.exit(2);
}
const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

/** Replaces every "file:path" string with that file as a data URI. */
function inline(value) {
  if (typeof value === "string" && value.startsWith("file:")) {
    const path = value.slice(5);
    return `data:${TYPES[extname(path).toLowerCase()]};base64,${readFileSync(path).toString("base64")}`;
  }
  if (Array.isArray(value)) return value.map(inline);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inline(v)]));
  return value;
}

async function json(url, init, attempt = 0) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // A dropped connection while polling is not the request failing: look again.
    if (attempt >= NETWORK_RETRIES) throw e;
    await sleep(POLL_MS);
    return json(url, init, attempt + 1);
  }
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}\n${body.slice(0, 2000)}`);
  return JSON.parse(body);
}

/** The first media URL in a result: a video, then images, then any file-like object. */
function mediaUrl(result) {
  return result.video?.url ?? result.images?.[0]?.url ?? result.image?.url ?? result.audio?.url ?? result.file?.url;
}

const queuedFile = `${outFile}.queued.json`;
async function submit() {
  const input = inline(JSON.parse(readFileSync(inputFile, "utf8")));
  const sent = await json(`https://queue.fal.run/${endpoint}`, { method: "POST", headers, body: JSON.stringify(input) });
  writeFileSync(queuedFile, JSON.stringify(sent, null, 2));
  return sent;
}
const queued = existsSync(queuedFile) ? JSON.parse(readFileSync(queuedFile, "utf8")) : await submit();
console.error(`queued ${queued.request_id}`);
const started = Date.now();
for (;;) {
  const status = await json(`${queued.status_url}?logs=1`, { headers });
  if (status.status === "COMPLETED") break;
  if (Date.now() - started > DEADLINE_MS) throw new Error(`timed out waiting for ${queued.request_id}`);
  process.stderr.write(".");
  await sleep(POLL_MS);
}
const result = await json(queued.response_url, { headers });
writeFileSync(`${outFile}.json`, JSON.stringify(result, null, 2));
const url = mediaUrl(result);
if (!url) throw new Error(`no media in the result; see ${outFile}.json`);
const media = await fetch(url);
writeFileSync(outFile, Buffer.from(await media.arrayBuffer()));
console.error(`\nsaved ${outFile}`);
