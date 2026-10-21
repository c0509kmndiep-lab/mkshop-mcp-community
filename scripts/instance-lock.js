// Single-instance discipline: a second `akimcp` launch reuses the running instance's panel
// instead of racing it for the same ports and dying with a token 403 the user can't decode
// (docs/plan/done/2.0.0-improve.md follow-up). The lock file records enough for that second
// launch to find, verify, and — if it's an older version — replace the running instance.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { USER_DIR } from './userdata.js';

const LOCK_PATH = path.join(USER_DIR, 'instance.json');

export function readLock() {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A recycled PID is not proof that our MCP server is still alive.
// Prefer a token-protected panel identity check; accept the pre-upgrade panel
// only when both its authenticated page and OAuth gate are responding.
export async function isLockedInstanceActive(lock) {
  if (!lock || !Number.isInteger(lock.pid) || !isPidAlive(lock.pid)) return false;
  const panel = Number(lock.panelPort);
  const gate = Number(lock.gatePort);
  if (!Number.isInteger(panel) || panel < 1 || panel > 65535 ||
      !Number.isInteger(gate) || gate < 1 || gate > 65535 ||
      typeof lock.token !== 'string' || !lock.token) return false;
  try {
    const instance = await fetch(`http://127.0.0.1:${panel}/api/instance`, {
      headers: { 'x-panel-token': lock.token },
      signal: AbortSignal.timeout(1800),
    });
    if (instance.ok) {
      const identity = await instance.json();
      return identity.pid === lock.pid;
    }
    if (instance.status !== 404) return false;
    // Backward compatibility for the already-running server before upgrade.
    const [legacyPanel, oauthGate] = await Promise.all([
      fetch(`http://127.0.0.1:${panel}/?t=${encodeURIComponent(lock.token)}`, {
        signal: AbortSignal.timeout(1800),
      }),
      fetch(`http://127.0.0.1:${gate}/mcp`, {
        signal: AbortSignal.timeout(1800),
      }),
    ]);
    return legacyPanel.status === 200 && oauthGate.status === 401;
  } catch {
    return false;
  }
}

export function writeLock({ pid, panelPort, gatePort, token, version }) {
  writeFileSync(LOCK_PATH, JSON.stringify({ pid, panelPort, gatePort, token, version, startedAt: new Date().toISOString() }), { mode: 0o600 });
}

export function clearLock() {
  try { unlinkSync(LOCK_PATH); } catch {}
}

// SIGTERM first so the old instance tears down its own children (cloudflared, Postman daemon) cleanly; SIGKILL only if it doesn't exit within the grace period.
export async function killAndWait(pid, graceMs = 3000) {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const start = Date.now();
  while (isPidAlive(pid)) {
    if (Date.now() - start > graceMs) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
