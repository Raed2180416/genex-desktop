/**
 * An MCP server a *plugin* ships, for tests only — and deliberately dependency-free.
 *
 * A plugin package is copied into Studio's own storage before anything runs it, far away from
 * this repository's `node_modules`, so a fixture that imported the MCP SDK could not resolve it
 * from there. This one speaks the protocol by hand instead, exactly as the Genex CLI's own
 * blender server does: newline-delimited JSON-RPC over stdin and stdout, and every log line on
 * stderr so the stream the client reads stays clean.
 *
 * Tools:
 *   echo  {text}  → the text back.
 *   probe {}      → JSON describing the process Studio started: its working directory, its HOME,
 *                   what arrived on file descriptor 3, and the environment it can see. That last
 *                   pair is the point of the fixture — a test can prove a credential came down
 *                   the pipe and never through the environment. `fd3Digest` is its SHA-256
 *                   fingerprint: the host redacts a credential a server repeats, so a test
 *                   compares by fingerprint.
 */
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

/** Read fd 3 to EOF, as `src/genex-host/preload.mjs` does. Absent or never closed answers ''. */
const fd3 = new Promise(resolve => {
  const timer = setTimeout(() => resolve(''), 3_000);
  timer.unref?.();
  let text = '';
  let stream;
  try { stream = createReadStream(null, { fd: 3 }); } catch { clearTimeout(timer); resolve(''); return; }
  stream.setEncoding('utf8');
  stream.on('data', chunk => { text += chunk; });
  stream.on('end', () => { clearTimeout(timer); resolve(text.trim()); });
  stream.on('error', () => { clearTimeout(timer); resolve(''); });
});

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'What to say back.' } }, required: ['text'], additionalProperties: false },
  },
  {
    name: 'probe',
    description: 'Report the working directory, HOME, fd 3 and the environment this process was given.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function call(name, args) {
  if (name === 'echo') return `${args?.text ?? ''}`;
  if (name === 'probe') {
    return JSON.stringify({
      cwd: process.cwd(),
      home: process.env.HOME ?? '',
      fd3: await fd3,
      fd3Digest: createHash('sha256').update(await fd3).digest('hex'),
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('FIXTURE_'))),
      envNames: Object.keys(process.env).sort(),
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(message) {
  const { id, method, params } = message ?? {};
  // A notification has no id and is never answered.
  if (id === undefined || id === null) return;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'studio-plugin-fixture', version: '1.0.0' },
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try { return reply(id, { content: [{ type: 'text', text: await call(params?.name, params?.arguments ?? {}) }] }); }
    catch (error) { return reply(id, { content: [{ type: 'text', text: String(error?.message ?? error) }], isError: true }); }
  }
  return fail(id, -32601, 'Method not found');
}

process.stdin.setEncoding('utf8');
let buffer = '';
for await (const chunk of process.stdin) {
  buffer += chunk;
  for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    await handle(message);
  }
}
