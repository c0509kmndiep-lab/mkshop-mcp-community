#!/usr/bin/env node
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register } from '../scripts/cdp-mcp.js';
import cdp from '../scripts/cdp-engine.js';
import { NO_CDP_PORT_MESSAGE } from '../scripts/chrome-profile.js';

async function testCdpExtensions() {
  assert.equal(typeof cdp.screenshot, 'function');
  assert.equal(typeof cdp.click, 'function');

  // Verify server registers devtools_screenshot and devtools_click
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  register(server);
  assert.ok(server);

  // The attach-to-existing-window path must be spelled out in the error and in every devtools_* description.
  assert.match(NO_CDP_PORT_MESSAGE, /aki__port_status/);
  assert.match(NO_CDP_PORT_MESSAGE, /aki__devtools_targets/);
  for (const name of ['devtools_targets', 'devtools_eval', 'devtools_screenshot']) {
    assert.match(server._registeredTools[name].description, /aki__port_status/, `${name} description must point at aki__port_status`);
  }

  console.log('cdp-extensions.test.js: ok');
}

await testCdpExtensions();
