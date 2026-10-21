#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-terminal-protocol-'));
process.env.AKI_MCP_DATA_DIR = dir;
fs.writeFileSync(path.join(dir, 'setting.json'), JSON.stringify({
  folders: [process.cwd()], shell: { allowlist: { added: ['node'], revoked: [] } },
}));
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { createToolsServer } = await import('../scripts/tools-server.js');
const [ct, st] = InMemoryTransport.createLinkedPair();
const server = createToolsServer();
const client = new Client({ name: 'p0-protocol-test', version: '1.0.0' });
await Promise.all([server.connect(st), client.connect(ct)]);
let id;
const call = async (name, params) => {
  const r = await client.callTool({ name: 'aki__terminal_' + name, arguments: params });
  assert.equal(r.isError, undefined, JSON.stringify(r));
  return JSON.parse(r.content.find((c) => c.type === 'text').text);
};
try {
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const name of ['start', 'write', 'read', 'manage']) {
    assert.ok(names.includes('aki__terminal_' + name), 'Not listed: aki__terminal_' + name);
  }
  const started = await call('start', { command: 'node -i', cwd: process.cwd() });
  id = started.sessionId;
  const welcome = await call('read', { sessionId: id, timeoutMs: 4000, waitForPrompt: true });
  assert.ok(welcome.promptDetected);
  await call('write', { sessionId: id, input: '20 + 22' });
  const value = await call('read', { sessionId: id, timeoutMs: 4000, waitForPrompt: true });
  assert.match(value.text, /\b42\b/);
  const stopped = await call('manage', { action: 'stop', sessionId: id });
  assert.equal(stopped.alive, false);
  await call('manage', { action: 'delete', sessionId: id });
  id = null;
} finally {
  if (id) {
    try { await call('manage', { action: 'stop', sessionId: id }); } catch {}
    try { await call('manage', { action: 'delete', sessionId: id }); } catch {}
  }
  await client.close();
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('terminal-mcp-protocol.test.js: ok');
