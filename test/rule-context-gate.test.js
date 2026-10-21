#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  handleStreamableMcp,
  resetSharedSessionForTesting,
} from '../scripts/streamable-bridge.js';
import {
  RuleGate,
  TOOL_CATEGORIES,
  CLASSIFIED_TOOLS,
  classifyTool,
  isToolExempt,
  isHandshakeTool,
  hashClientIdentity,
  getGrantTtlMin,
  RULE_CONTEXT_REQUIRED_CODE,
} from '../scripts/rule-gate.js';

function createTestServer(bridgeOptions = {}) {
  const server = http.createServer((req, res) => {
    handleStreamableMcp(req, res, bridgeOptions).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
  });
  return server;
}

async function initializeClient(baseUrl, id = 1, extraHeaders = {}) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'gate-test-client', version: '1.0.0' },
      },
    }),
  });
  assert.equal(res.status, 200);
  const sessionId = res.headers.get('MCP-Session-Id');
  assert.ok(sessionId, 'MCP-Session-Id header must be present');
  const body = await res.json();
  return { sessionId, body };
}

async function callTool(baseUrl, sessionId, id, toolName, args = {}, extraHeaders = {}) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'mcp-session-id': sessionId,
      ...extraHeaders,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

async function runTests() {
  console.log('Running rule-context-gate & ChatGPT compatibility test scenarios on scratch port...');

  // Setup isolated temporary workspace under user home (authorized root)
  const tempProjectDir = fs.mkdtempSync(path.join(os.homedir(), '.aki-gate-compat-test-'));
  const claudeMdPath = path.join(tempProjectDir, 'CLAUDE.md');
  fs.writeFileSync(claudeMdPath, '# Gate Test Rules v1\nInitial rules content for testing.\n', 'utf8');

  try {
    // -------------------------------------------------------------
    // Unit verification of Tool Classification Table & Identity Hashing
    // -------------------------------------------------------------
    console.log('Testing tool classification table & identity hashing...');
    const allClassified = Object.keys(CLASSIFIED_TOOLS);
    assert.equal(allClassified.length, 66, 'Must explicitly classify all 66 server tools');

    const exemptCount = allClassified.filter((k) => CLASSIFIED_TOOLS[k] === TOOL_CATEGORIES.EXEMPT).length;
    const blockedCount = allClassified.filter((k) => CLASSIFIED_TOOLS[k] === TOOL_CATEGORIES.BLOCKED).length;
    assert.equal(exemptCount, 27, '27 tools must be exempt (read-only/discovery/handshake)');
    assert.equal(blockedCount, 39, '39 tools must be blocked (side-effects/execution)');

    assert.equal(classifyTool('aki__akidevrule_context'), TOOL_CATEGORIES.EXEMPT);
    assert.equal(classifyTool('akidevrule_context'), TOOL_CATEGORIES.EXEMPT);
    assert.equal(classifyTool('aki__read_text_file'), TOOL_CATEGORIES.EXEMPT);
    assert.equal(classifyTool('aki__port_status'), TOOL_CATEGORIES.EXEMPT);
    assert.equal(classifyTool('aki__sqlite_query'), TOOL_CATEGORIES.EXEMPT);
    assert.equal(classifyTool('aki__gui_screenshot'), TOOL_CATEGORIES.EXEMPT);

    assert.equal(classifyTool('aki__run_cmd'), TOOL_CATEGORIES.BLOCKED);
    assert.equal(classifyTool('aki__write_file'), TOOL_CATEGORIES.BLOCKED);
    assert.equal(classifyTool('aki__git'), TOOL_CATEGORIES.BLOCKED);
    assert.equal(classifyTool('aki__kill_port'), TOOL_CATEGORIES.BLOCKED);
    assert.equal(classifyTool('aki__agy_run'), TOOL_CATEGORIES.BLOCKED);
    assert.equal(classifyTool('aki__local_fetch'), TOOL_CATEGORIES.BLOCKED);

    // Fail-closed default: unclassified tool
    assert.equal(classifyTool('aki__unknown_future_tool'), TOOL_CATEGORIES.BLOCKED);
    assert.equal(isToolExempt('aki__unknown_future_tool'), false);
    assert.equal(isHandshakeTool('aki__akidevrule_context'), true);
    assert.equal(isHandshakeTool('aki__run_cmd'), false);

    // Identity hashing & TTL tests
    assert.equal(hashClientIdentity(null), null);
    assert.equal(hashClientIdentity(''), null);
    const h1 = hashClientIdentity('Bearer secret_token_abc');
    const h2 = hashClientIdentity('Bearer secret_token_abc');
    assert.match(h1, /^[0-9a-f]{64}$/, 'Identity hash must be sha256 hex');
    assert.equal(h1, h2, 'Hash must be deterministic');
    assert.notEqual(h1, 'Bearer secret_token_abc', 'Must never equal raw token');
    assert.equal(getGrantTtlMin(), 720, 'Default TTL must be 720 min');
    assert.equal(getGrantTtlMin(60), 60, 'Custom TTL must be respected');
    console.log('Tool classification & identity hashing: ok');

    // -------------------------------------------------------------
    // Scenario 1: Fresh session in enforce mode
    // Blocked before handshake -> exempt allowed -> handshake -> blocked allowed
    // -------------------------------------------------------------
    console.log('Running Scenario 1: Fresh session lifecycle (enforce mode)...');
    resetSharedSessionForTesting();
    const gate1 = new RuleGate({ mode: 'enforce' });
    const server1 = createTestServer({ gate: gate1 });
    await new Promise((resolve) => server1.listen(0, '127.0.0.1', resolve));
    const baseUrl1 = `http://127.0.0.1:${server1.address().port}/mcp`;

    try {
      const { sessionId } = await initializeClient(baseUrl1, 10);

      // 1. Blocked tool before handshake must be blocked
      const blockedRes1 = await callTool(baseUrl1, sessionId, 11, 'aki__run_cmd', { command: 'node -v' });
      assert.equal(blockedRes1.result?.isError, true, 'Blocked tool must fail before handshake');
      assert.equal(blockedRes1.result?.code, RULE_CONTEXT_REQUIRED_CODE);
      assert.ok(blockedRes1.result?.content[0]?.text.includes(RULE_CONTEXT_REQUIRED_CODE));

      // 2. Exempt tool before handshake must pass
      const exemptRes = await callTool(baseUrl1, sessionId, 12, 'aki__port_status', {});
      assert.equal(exemptRes.result?.isError, undefined, 'Exempt tool must execute without error');
      assert.ok(exemptRes.result?.content[0]?.text, 'Exempt tool returns port status');

      // 3. Handshake tool executes and completes
      const handshakeRes = await callTool(baseUrl1, sessionId, 13, 'aki__akidevrule_context', {
        workingPath: tempProjectDir,
      });
      assert.equal(handshakeRes.result?.isError, undefined, 'Handshake tool must succeed');
      const receipt1 = handshakeRes.result?.structuredContent?.receipt;
      assert.match(receipt1, /^sha256:[0-9a-f]{64}$/, 'Handshake must return sha256 receipt');

      // 4. Blocked tool after handshake must now be allowed
      const allowedRes = await callTool(baseUrl1, sessionId, 14, 'aki__run_cmd', { command: 'node -v' });
      assert.equal(allowedRes.result?.isError, undefined, 'Blocked tool must now be allowed after handshake');
      assert.ok(allowedRes.result?.content[0]?.text.includes('v'), 'Command executed and returned version');
      console.log('Scenario 1 passed.');
    } finally {
      resetSharedSessionForTesting();
      server1.close();
      await once(server1, 'close');
    }

    // -------------------------------------------------------------
    // Scenario 2: Two concurrent clients with distinct identities
    // Client A loaded, Client B unhandled remains blocked (identity isolation)
    // -------------------------------------------------------------
    console.log('Running Scenario 2: Two distinct client identities isolation...');
    resetSharedSessionForTesting();
    const gate2 = new RuleGate({ mode: 'enforce' });
    const server2 = createTestServer({ gate: gate2 });
    await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));
    const baseUrl2 = `http://127.0.0.1:${server2.address().port}/mcp`;

    try {
      const authA = { Authorization: 'Bearer token_client_alpha_123' };
      const authB = { Authorization: 'Bearer token_client_beta_456' };

      const clientA = await initializeClient(baseUrl2, 20, authA);
      const clientB = await initializeClient(baseUrl2, 21, authB);
      assert.notEqual(clientA.sessionId, clientB.sessionId, 'Clients must have distinct session IDs');

      // Client A performs handshake
      const hsA = await callTool(
        baseUrl2,
        clientA.sessionId,
        22,
        'aki__akidevrule_context',
        { workingPath: tempProjectDir },
        authA,
      );
      assert.equal(hsA.result?.isError, undefined);

      // Client A calls blocked tool -> ALLOWED
      const resA = await callTool(
        baseUrl2,
        clientA.sessionId,
        23,
        'aki__run_cmd',
        { command: 'node -v' },
        authA,
      );
      assert.equal(resA.result?.isError, undefined, 'Client A must be allowed to run tool');

      // Client B calls blocked tool -> STILL BLOCKED (proves identity isolation: distinct identity stays blocked)
      const resB = await callTool(
        baseUrl2,
        clientB.sessionId,
        24,
        'aki__run_cmd',
        { command: 'node -v' },
        authB,
      );
      assert.equal(resB.result?.isError, true, 'Client B must remain blocked even if Client A completed handshake');
      assert.equal(resB.result?.code, RULE_CONTEXT_REQUIRED_CODE);

      // Client B now performs handshake
      const hsB = await callTool(
        baseUrl2,
        clientB.sessionId,
        25,
        'aki__akidevrule_context',
        { workingPath: tempProjectDir },
        authB,
      );
      assert.equal(hsB.result?.isError, undefined);

      // Client B calls blocked tool -> now ALLOWED
      const resBAfter = await callTool(
        baseUrl2,
        clientB.sessionId,
        26,
        'aki__run_cmd',
        { command: 'node -v' },
        authB,
      );
      assert.equal(resBAfter.result?.isError, undefined, 'Client B must be allowed after completing its own handshake');
      console.log('Scenario 2 passed.');
    } finally {
      resetSharedSessionForTesting();
      server2.close();
      await once(server2, 'close');
    }

    // -------------------------------------------------------------
    // Scenario 3: ChatGPT Pattern (Session-churn with same authenticated identity)
    // Handshake on session 1 -> call blocked tool on session 2 (different session ID, same identity) -> SUCCEEDS
    // -------------------------------------------------------------
    console.log('Running Scenario 3: ChatGPT session-churn compatibility (identity-scoped grant)...');
    resetSharedSessionForTesting();
    const chatgptLogs = [];
    const gateChatGPT = new RuleGate({
      mode: 'enforce',
      logger: (msg, entry) => chatgptLogs.push(entry),
    });
    const serverChatGPT = createTestServer({ gate: gateChatGPT });
    await new Promise((resolve) => serverChatGPT.listen(0, '127.0.0.1', resolve));
    const baseUrlChatGPT = `http://127.0.0.1:${serverChatGPT.address().port}/mcp`;

    try {
      const authChatGPT = { Authorization: 'Bearer chatgpt_persistent_token_xyz789' };

      // Call 1: ChatGPT initiates Session 1 and performs handshake
      const session1 = await initializeClient(baseUrlChatGPT, 30, authChatGPT);
      const hs1 = await callTool(
        baseUrlChatGPT,
        session1.sessionId,
        31,
        'aki__akidevrule_context',
        { workingPath: tempProjectDir },
        authChatGPT,
      );
      assert.equal(hs1.result?.isError, undefined, 'ChatGPT handshake must succeed');
      const receipt1 = hs1.result?.structuredContent?.receipt;
      assert.ok(receipt1);

      // Call 2: ChatGPT initiates a BRAND NEW Session 2 (different session ID, but same bearer token)
      const session2 = await initializeClient(baseUrlChatGPT, 32, authChatGPT);
      assert.notEqual(session1.sessionId, session2.sessionId, 'ChatGPT must use different session IDs');

      // Call 3: ChatGPT immediately calls blocked tool (aki__run_cmd) on Session 2 WITHOUT calling handshake on Session 2
      const resSession2 = await callTool(
        baseUrlChatGPT,
        session2.sessionId,
        33,
        'aki__run_cmd',
        { command: 'node -v' },
        authChatGPT,
      );
      assert.equal(
        resSession2.result?.isError,
        undefined,
        'ChatGPT tool call on new session must SUCCEED via identity grant',
      );
      assert.ok(
        resSession2.result?.content[0]?.text.includes('v'),
        'Command executed and returned version on session 2',
      );

      // Verify that no raw token leaked into decision logs
      const rawToken = 'chatgpt_persistent_token_xyz789';
      for (const logEntry of chatgptLogs) {
        assert.equal(
          JSON.stringify(logEntry).includes(rawToken),
          false,
          'Raw token must NEVER leak into decision logs',
        );
      }
      console.log('Scenario 3 (ChatGPT compatibility) passed.');
    } finally {
      resetSharedSessionForTesting();
      serverChatGPT.close();
      await once(serverChatGPT, 'close');
    }

    // -------------------------------------------------------------
    // Scenario 4: Receipt-bound reopening on identity grants
    // Rule corpus changes -> identity grant is invalidated -> call blocked -> re-handshake opens
    // -------------------------------------------------------------
    console.log('Running Scenario 4: Receipt-bound reopening invalidates identity grants...');
    resetSharedSessionForTesting();
    const gate4 = new RuleGate({ mode: 'enforce' });
    const server4 = createTestServer({ gate: gate4 });
    await new Promise((resolve) => server4.listen(0, '127.0.0.1', resolve));
    const baseUrl4 = `http://127.0.0.1:${server4.address().port}/mcp`;

    try {
      const auth = { Authorization: 'Bearer token_reopening_test' };
      const s1 = await initializeClient(baseUrl4, 40, auth);

      // Handshake with initial rule file
      const hs1 = await callTool(
        baseUrl4,
        s1.sessionId,
        41,
        'aki__akidevrule_context',
        { workingPath: tempProjectDir },
        auth,
      );
      const receipt1 = hs1.result?.structuredContent?.receipt;
      assert.ok(receipt1);

      // Call blocked tool on new session -> ALLOWED via identity grant
      const s2 = await initializeClient(baseUrl4, 42, auth);
      const resAllowed = await callTool(baseUrl4, s2.sessionId, 43, 'aki__run_cmd', { command: 'node -v' }, auth);
      assert.equal(resAllowed.result?.isError, undefined);

      // Mutate rule file in test environment
      await new Promise((r) => setTimeout(r, 50));
      fs.appendFileSync(claudeMdPath, '\n- Extra rule to invalidate identity grant receipt.\n', 'utf8');

      // Call blocked tool on session 3 -> MUST DETECT RECEIPT MISMATCH & BLOCK
      const s3 = await initializeClient(baseUrl4, 44, auth);
      const resBlocked = await callTool(baseUrl4, s3.sessionId, 45, 'aki__run_cmd', { command: 'node -v' }, auth);
      assert.equal(resBlocked.result?.isError, true, 'Identity grant must be invalidated when rule receipt changes');
      assert.equal(resBlocked.result?.code, RULE_CONTEXT_REQUIRED_CODE);

      // Re-handshake on session 3
      const hs2 = await callTool(
        baseUrl4,
        s3.sessionId,
        46,
        'aki__akidevrule_context',
        { workingPath: tempProjectDir },
        auth,
      );
      const receipt2 = hs2.result?.structuredContent?.receipt;
      assert.notEqual(receipt1, receipt2, 'Receipt must have changed');

      // Now blocked tool on session 4 (new session) succeeds with new grant
      const s4 = await initializeClient(baseUrl4, 47, auth);
      const resReopened = await callTool(baseUrl4, s4.sessionId, 48, 'aki__run_cmd', { command: 'node -v' }, auth);
      assert.equal(resReopened.result?.isError, undefined, 'Tool must be allowed after re-handshake with new grant');
      console.log('Scenario 4 passed.');
    } finally {
      resetSharedSessionForTesting();
      server4.close();
      await once(server4, 'close');
    }

    // -------------------------------------------------------------
    // Scenario 5: TTL Expiration on Identity Grants
    // Short TTL expires -> grant becomes invalid -> blocked again
    // -------------------------------------------------------------
    console.log('Running Scenario 5: Grant TTL expiration...');
    resetSharedSessionForTesting();
    // Configure gate with very short TTL: 0.002 min = 120ms
    const gateTTL = new RuleGate({ mode: 'enforce', grantTtlMin: 0.002 });
    const serverTTL = createTestServer({ gate: gateTTL });
    await new Promise((resolve) => serverTTL.listen(0, '127.0.0.1', resolve));
    const baseUrlTTL = `http://127.0.0.1:${serverTTL.address().port}/mcp`;

    try {
      const authTTL = { Authorization: 'Bearer token_short_lived_ttl' };
      const s1 = await initializeClient(baseUrlTTL, 50, authTTL);

      // Handshake establishes grant with 120ms TTL
      await callTool(baseUrlTTL, s1.sessionId, 51, 'aki__akidevrule_context', { workingPath: tempProjectDir }, authTTL);

      // Immediate call on session 2 (before TTL) -> ALLOWED
      const s2 = await initializeClient(baseUrlTTL, 52, authTTL);
      const resImmediate = await callTool(baseUrlTTL, s2.sessionId, 53, 'aki__run_cmd', { command: 'node -v' }, authTTL);
      assert.equal(resImmediate.result?.isError, undefined, 'Must pass before TTL expiration');

      // Wait 180ms for TTL to expire
      await new Promise((r) => setTimeout(r, 180));

      // Call on session 3 (after TTL) -> MUST BE BLOCKED
      const s3 = await initializeClient(baseUrlTTL, 54, authTTL);
      const resExpired = await callTool(baseUrlTTL, s3.sessionId, 55, 'aki__run_cmd', { command: 'node -v' }, authTTL);
      assert.equal(resExpired.result?.isError, true, 'Must be blocked after grant TTL expiration');
      assert.equal(resExpired.result?.code, RULE_CONTEXT_REQUIRED_CODE);
      console.log('Scenario 5 passed.');
    } finally {
      resetSharedSessionForTesting();
      serverTTL.close();
      await once(serverTTL, 'close');
    }

    // -------------------------------------------------------------
    // Scenario 6: warn and off modes
    // warn: does not block, logs would-block; off: does not block, no log
    // -------------------------------------------------------------
    console.log('Running Scenario 6: warn and off modes...');

    // 6a: Warn mode
    resetSharedSessionForTesting();
    const warnLogs = [];
    const gateWarn = new RuleGate({
      mode: 'warn',
      logger: (msg, entry) => warnLogs.push(entry),
    });
    const serverWarn = createTestServer({ gate: gateWarn });
    await new Promise((resolve) => serverWarn.listen(0, '127.0.0.1', resolve));
    const baseUrlWarn = `http://127.0.0.1:${serverWarn.address().port}/mcp`;

    try {
      const { sessionId } = await initializeClient(baseUrlWarn, 60);
      const resWarn = await callTool(baseUrlWarn, sessionId, 61, 'aki__run_cmd', { command: 'node -v' });
      assert.equal(resWarn.result?.isError, undefined, 'Warn mode must not block execution');
      assert.ok(
        warnLogs.some((l) => l.decision === 'would-block' && l.tool === 'aki__run_cmd'),
        'Warn mode must log would-block decision',
      );
    } finally {
      resetSharedSessionForTesting();
      serverWarn.close();
      await once(serverWarn, 'close');
    }

    // 6b: Off mode
    resetSharedSessionForTesting();
    const offLogs = [];
    const gateOff = new RuleGate({
      mode: 'off',
      logger: (msg, entry) => offLogs.push(entry),
    });
    const serverOff = createTestServer({ gate: gateOff });
    await new Promise((resolve) => serverOff.listen(0, '127.0.0.1', resolve));
    const baseUrlOff = `http://127.0.0.1:${serverOff.address().port}/mcp`;

    try {
      const { sessionId } = await initializeClient(baseUrlOff, 65);
      const resOff = await callTool(baseUrlOff, sessionId, 66, 'aki__run_cmd', { command: 'node -v' });
      assert.equal(resOff.result?.isError, undefined, 'Off mode must not block execution');
      assert.equal(offLogs.length, 0, 'Off mode must not log gate decisions');
      console.log('Scenario 6 passed.');
    } finally {
      resetSharedSessionForTesting();
      serverOff.close();
      await once(serverOff, 'close');
    }

    // -------------------------------------------------------------
    // Scenario 7: Unclassified tool -> fail-closed default
    // -------------------------------------------------------------
    console.log('Running Scenario 7: Unclassified tool fail-closed default...');
    resetSharedSessionForTesting();
    const gate7 = new RuleGate({ mode: 'enforce' });
    const server7 = createTestServer({ gate: gate7 });
    await new Promise((resolve) => server7.listen(0, '127.0.0.1', resolve));
    const baseUrl7 = `http://127.0.0.1:${server7.address().port}/mcp`;

    try {
      const { sessionId } = await initializeClient(baseUrl7, 70);

      const unclassifiedRes = await callTool(baseUrl7, sessionId, 71, 'aki__unclassified_test_action', {});
      assert.equal(unclassifiedRes.result?.isError, true, 'Unclassified tool must be blocked fail-closed');
      assert.equal(unclassifiedRes.result?.code, RULE_CONTEXT_REQUIRED_CODE);
      console.log('Scenario 7 passed.');
    } finally {
      resetSharedSessionForTesting();
      server7.close();
      await once(server7, 'close');
    }

    console.log('All rule-context-gate & ChatGPT compatibility scenarios passed successfully!');
  } finally {
    // Cleanup temporary workspace without touching owner rules
    try {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().then(
  () => {
    console.log('PASS: rule-context-gate test suite complete');
    process.exit(0);
  },
  (err) => {
    console.error('FAIL: rule-context-gate test failed:', err);
    process.exit(1);
  },
);
