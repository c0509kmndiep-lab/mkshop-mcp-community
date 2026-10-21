#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data, never alter production settings/logs.
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-terminal-p0-'));
process.env.AKI_MCP_DATA_DIR = testHome;
fs.writeFileSync(path.join(testHome, 'setting.json'), JSON.stringify({
  folders: [process.cwd()],
  shell: { allowlist: { added: ['node'], revoked: [] } },
}));
const {
  register, terminalStart, terminalWrite, terminalRead, terminalManage,
} = await import('../scripts/terminal-mcp.js');
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

const server = new McpServer({ name: 'terminal-test', version: '1.0.0' });
register(server);
for (const name of ['terminal_start', 'terminal_write', 'terminal_read', 'terminal_manage']) {
  assert.ok(server._registeredTools[name], 'Tool must register: ' + name);
}
const { createToolsServer } = await import('../scripts/tools-server.js');
const productionShape = createToolsServer();
for (const name of ['terminal_start', 'terminal_write', 'terminal_read', 'terminal_manage']) {
  assert.ok(productionShape._registeredTools['aki__' + name], 'Production MCP must expose aki__' + name);
}
await assert.rejects(() => terminalStart({ command: 'unknown-binary -x' }), /not in the allowlist/);
await assert.rejects(() => terminalStart({ command: 'node -i | cat' }), /chaining/);
await assert.rejects(() => terminalStart({ command: 'node -i', cwd: 'Z:\\outside-root' }), /outside the allowed roots/);

const session = await terminalStart({ command: 'node -i', cwd: process.cwd() });
assert.match(session.sessionId, /^term_[\da-f-]+$/);
assert.ok(session.pid > 0);
assert.equal(session.status, 'running');
assert.ok(fs.existsSync(session.logFile));
if (process.platform !== 'win32') assert.equal(fs.statSync(session.logFile).mode & 0o777, 0o600);

try {
  const welcome = await terminalRead({ sessionId: session.sessionId, timeoutMs: 4000, waitForPrompt: true });
  assert.ok(welcome.promptDetected, 'Node REPL must show a prompt');
  assert.ok(welcome.text.includes('> '), 'First output should include prompt');
  assert.equal(welcome.nextCursor >= 1, true);
  assert.equal((await terminalRead({ sessionId: session.sessionId })).text, '', 'Default cursor advances');
  const replay = await terminalRead({ sessionId: session.sessionId, cursor: 0 });
  assert.equal(replay.text, welcome.text, 'Explicit cursor supports replay');

  await terminalWrite({ sessionId: session.sessionId, input: '21 * 2' });
  const calculated = await terminalRead({ sessionId: session.sessionId, timeoutMs: 4000, waitForPrompt: true });
  assert.match(calculated.text, /\b42\b/, 'REPL must accept a second input and print output');
  assert.equal(calculated.promptDetected, true);

  await terminalWrite({ sessionId: session.sessionId, input: 'console.error("AKI_ERR_TEST")' });
  const stderrResult = await terminalRead({ sessionId: session.sessionId, timeoutMs: 4000, waitForPrompt: true });
  assert.ok(stderrResult.events.some((e) => e.stream === 'stderr' && e.text.includes('AKI_ERR_TEST')),
    'stderr must remain individually identifiable');

  await terminalWrite({ sessionId: session.sessionId, input: '("x".repeat(120000))' });
  const huge = await terminalRead({ sessionId: session.sessionId, timeoutMs: 4000, waitForPrompt: true, maxChars: 4096 });
  assert.ok(huge.hasMore || huge.dropped, 'Large output must be paginated or report retention loss');
  assert.ok(huge.text.length <= 4096 + 2048, 'Response must be bounded');
  assert.ok(fs.statSync(session.logFile).size <= 16 * 1024 * 1024);

  const listing = await terminalManage({ action: 'list' });
  assert.ok(listing.some((s) => s.sessionId === session.sessionId));
  await assert.rejects(() => terminalManage({ action: 'delete', sessionId: session.sessionId }), /Stop running/);
  await assert.rejects(() => terminalWrite({ sessionId: session.sessionId, input: '\0' }), /NUL bytes/);
  await assert.rejects(() => terminalWrite({ sessionId: session.sessionId, input: 'a'.repeat(9000) }), /8192 bytes/);
} finally {
  await terminalManage({ action: 'stop', sessionId: session.sessionId });
}
const stopInfo = await terminalManage({ action: 'status', sessionId: session.sessionId });
assert.equal(stopInfo.alive, false, 'Stopped session must not report alive');
await assert.rejects(() => terminalWrite({ sessionId: session.sessionId, input: '1+2' }), /not writable/);
const deleted = await terminalManage({ action: 'delete', sessionId: session.sessionId });
assert.equal(deleted.deleted, true);
assert.equal(fs.existsSync(session.logFile), false);
await assert.rejects(() => terminalRead({ sessionId: session.sessionId }), /Unknown terminal/);

// Natural exit, exit-code tracking and UTF-8 continuation over independent stdout/stderr.
const exitSession = await terminalStart({ command: 'node -i', cwd: process.cwd() });
try {
  await terminalRead({ sessionId: exitSession.sessionId, timeoutMs: 4000, waitForPrompt: true });
  await terminalWrite({ sessionId: exitSession.sessionId, input: '.exit' });
  for (let i = 0; i < 30; i++) {
    const state = await terminalManage({ action: 'status', sessionId: exitSession.sessionId });
    if (!state.alive) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const end = await terminalManage({ action: 'status', sessionId: exitSession.sessionId });
  assert.equal(end.alive, false);
  assert.equal(end.exitCode, 0);
} finally {
  if ((await terminalManage({ action: 'status', sessionId: exitSession.sessionId })).alive) {
    await terminalManage({ action: 'stop', sessionId: exitSession.sessionId });
  }
  await terminalManage({ action: 'delete', sessionId: exitSession.sessionId });
}
fs.rmSync(testHome, { recursive: true, force: true });
console.log('terminal-mcp.test.js: ok');
