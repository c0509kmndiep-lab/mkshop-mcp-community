#!/usr/bin/env node
/**
 * Sends candidate instruction texts into Postman's AI chat, one fresh chat each, and reports whether the safety check flagged it.
 * Procedure and caveats: docs/ref/postman-permission-popup-test.md § Probe an instruction text for the safety flag
 *
 * Usage (repo root):
 *   node scripts/postman/debug/postman-probe-instruction-flag.js                     # list windows
 *   node scripts/postman/debug/postman-probe-instruction-flag.js <idPrefix> "<text>" ["<text>" ...]
 *
 * <idPrefix> must name the window you can spare: the probe clicks New chat there. It never types into a non-empty chat.
 */
const CDP = require('chrome-remote-interface');
const { PostmanSession } = require('../postman-session.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CHAT = '[data-testid="ai-chat-conversation-container"]';
const NEW_CHAT = '[data-testid="ai-chat-new-conversation-button"]';
const POLL_MS = 3000;
const POLL_TRIES = 14;

// Runs in the renderer. FLAGGED needs the safety banner; the gateway's own "Something went wrong" banner is an outage, not a verdict.
function readVerdict() {
  const banner = document.querySelector('[data-testid="aether-banner"]');
  const text = document.querySelector('[data-testid="ai-chat-conversation-container"]').innerText;
  if (banner) return /flagged by our safety checks/i.test(banner.innerText) ? 'FLAGGED' : `OUTAGE (${banner.innerText.slice(0, 40)})`;
  return /Finished executing/.test(text) ? 'PASSED' : null;
}

async function probeOne(client, text) {
  const evaluate = async (expression) => (await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true })).result.value;
  await evaluate(`document.querySelector('${NEW_CHAT}').click()`);
  await sleep(2500);
  if ((await evaluate(`document.querySelector('${CHAT}').innerText.length`)) !== 0) return 'SKIPPED (chat not empty)';
  await evaluate(`window.__pmDeliverSummarizePrompt(${JSON.stringify(text)})`);
  for (let i = 0; i < POLL_TRIES; i++) {
    await sleep(POLL_MS);
    const verdict = await evaluate(`(${readVerdict.toString()})()`);
    if (verdict) return verdict;
  }
  return 'NO TOOL CALL (replied without calling a tool, or still generating)';
}

(async () => {
  const [idPrefix, ...texts] = process.argv.slice(2);
  const port = PostmanSession.getDevToolsPort(null);
  if (!port) throw new Error('Postman CDP port not found — launch Postman from the Aki panel first');
  const pages = (await CDP.List({ port })).filter((t) => t.type === 'page');
  if (!idPrefix || !texts.length) {
    pages.forEach((t) => console.log(t.id.slice(0, 8), t.title));
    return;
  }
  const client = await CDP({ port, target: (all) => all.findIndex((t) => t.id.startsWith(idPrefix)) });
  for (const text of texts) console.log(`${await probeOne(client, text)} | ${text}`);
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
