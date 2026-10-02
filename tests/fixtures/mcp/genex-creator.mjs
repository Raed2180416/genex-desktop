// Offline substitute for the bundled creator bridge in headless Studio rigs.
// Transport behavior itself is tested against the real bridge with a fake HTTP peer.
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
let credential = '';
for await (const chunk of createReadStream('', {fd: 3})) credential += chunk;
// The same acceptance as the real bridge's readCreatorCredential: the bare token Studio sends a
// `node` plugin server, or the older `GENEX_TOKEN=` line.
const token = /^(?:GENEX_TOKEN=)?(\S+)$/.exec(credential.trim())?.[1];
const unlocked = !!token && token !== 'GENEX_TOKEN=';
const names = ['search_games', 'search_animations', 'my_games', 'generation_status'];
for await (const line of createInterface({input: process.stdin})) {
  const {id, method, params} = JSON.parse(line);
  if (id === undefined) continue;
  let result;
  if (method === 'initialize') result = {protocolVersion: params.protocolVersion, capabilities: {tools: {}}, serverInfo: {name: 'genex-offline', version: '1'}};
  else if (method === 'tools/list') result = {tools: names.map(name => ({name, description: `Genex ${name}`, inputSchema: {type: 'object', properties: {}}}))};
  else if (method === 'tools/call') result = {content: [{type: 'text', text: unlocked ? `Genex fixture: ${params.name}` : 'Missing credential'}], isError: !unlocked};
  else result = {};
  process.stdout.write(JSON.stringify({jsonrpc: '2.0', id, result}) + '\n');
}
