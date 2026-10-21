#!/usr/bin/env node
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cliArguments, runWinApp, register } from '../scripts/windows-gui-mcp.js';
import { createToolsServer } from '../scripts/tools-server.js';

assert.deepEqual(cliArguments('inspect', ['--depth', '2'], 123, null),
  ['ui', 'inspect', '--depth', '2', '--window', '123', '--json']);
assert.deepEqual(cliArguments('list-windows'), ['ui', 'list-windows', '--json']);

const server = new McpServer({ name: 'windows-gui-test', version: '1.0.0' });
register(server);
const names = ['gui_list_windows', 'gui_inspect', 'gui_search', 'gui_get_value',
  'gui_get_focused', 'gui_invoke', 'gui_set_value', 'gui_focus', 'gui_hover',
  'gui_click', 'gui_drag', 'gui_send_keys', 'gui_scroll', 'gui_wait_for', 'gui_screenshot'];
for (const name of names) assert.ok(server._registeredTools[name], name + ' not registered');
const productionRegistry = createToolsServer();
for (const name of names) assert.ok(productionRegistry._registeredTools['aki__' + name], 'production registry missing ' + name);
assert.ok(Object.keys(productionRegistry._registeredTools).length >= names.length, 'GUI tools must remain registered alongside other MCP tools');

if (process.platform === 'win32' && process.env.AKI_GUI_LIVE_READ_TEST === '1') {
  const windows = JSON.parse(await runWinApp(cliArguments('list-windows')));
  assert.ok(Array.isArray(windows));
  const target = windows.find(w => w.title && w.hwnd);
  assert.ok(target, 'no visible windows');
  const inspected = JSON.parse(await runWinApp(cliArguments('inspect', ['--depth', '1'], target.hwnd)));
  assert.ok(Array.isArray(inspected.windows) && inspected.windows.length > 0);
  console.log('live GUI read-only smoke:', JSON.stringify({ target: target.title, hwnd: target.hwnd, elements: inspected.windows[0].elementCount }));
}
console.log('windows-gui-mcp.test.js: ok (' + names.length + ' tools)');
