#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register, executeFetch, isBlockedHost } from '../scripts/fetch-mcp.js';

async function runTests() {
  // 1. SSRF block patterns
  assert.equal(isBlockedHost('169.254.169.254'), true);
  assert.equal(isBlockedHost('169.254.1.1'), true);
  assert.equal(isBlockedHost('metadata.google.internal'), true);
  assert.equal(isBlockedHost('[fe80::1]'), true);
  assert.equal(isBlockedHost('localhost'), false);
  assert.equal(isBlockedHost('127.0.0.1'), false);
  assert.equal(isBlockedHost('192.168.1.100'), false);

  // 2. Protocol block
  await assert.rejects(
    () => executeFetch({ url: 'file:///etc/passwd' }),
    /Forbidden protocol/i,
  );

  // 3. Cloud metadata block
  await assert.rejects(
    () => executeFetch({ url: 'http://169.254.169.254/latest/meta-data/' }),
    /Access to link-local\/cloud-metadata host/i,
  );

  // 4. Test actual local fetch, redirect validation and streaming cap with a loopback server.
  const server = http.createServer((req, res) => {
    if (req.url === '/api/test' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: JSON.parse(body), ok: true }));
      });
      return;
    }
    if (req.url === '/redirect-metadata') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (req.url === '/large') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('x'.repeat(600 * 1024));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('hello from local');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // GET test
    const getRes = await executeFetch({ url: `http://127.0.0.1:${port}/` });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data, 'hello from local');
    assert.equal(getRes.isJson, false);

    // POST JSON test
    const postRes = await executeFetch({
      url: `http://127.0.0.1:${port}/api/test`,
      method: 'POST',
      body: { msg: 'ping' },
    });
    assert.equal(postRes.status, 200);
    assert.equal(postRes.isJson, true);
    assert.equal(postRes.data.received.msg, 'ping');

    // Redirects must be revalidated before following them, otherwise a benign LAN endpoint can bounce
    // the request into cloud metadata after the first URL passed validation.
    await assert.rejects(
      () => executeFetch({ url: `http://127.0.0.1:${port}/redirect-metadata` }),
      /Access to link-local\/cloud-metadata host/i,
    );

    // The 512KB limit is a read limit, not merely an output slice after buffering the whole response.
    const large = await executeFetch({ url: `http://127.0.0.1:${port}/large` });
    assert.equal(large.truncated, true);
    assert.equal(large.bytesReceived, 512 * 1024);
    assert.equal(Buffer.byteLength(large.data), 512 * 1024);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // 5. Tool registration in McpServer
  const mcp = new McpServer({ name: 'test-fetch', version: '2.0.0' });
  register(mcp);
  assert.ok(mcp._registeredTools['local_fetch']);

  console.log('fetch-mcp.test.js: ok');
}

await runTests();
