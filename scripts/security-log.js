// Security events outlive the terminal: each is printed and appended to security.log, which rotates once at MAX_BYTES so disk use stays under two files of that size.
import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { SECURITY_LOG_PATH } from './userdata.js';
import { log, logErr } from './log.js';

const MAX_BYTES = 1024 * 1024;
const PANEL_LINES = 200;

export function logSecurity(message) {
  log(`[security] ${message}`);
  try {
    if ((statSync(SECURITY_LOG_PATH, { throwIfNoEntry: false })?.size ?? 0) >= MAX_BYTES) renameSync(SECURITY_LOG_PATH, `${SECURITY_LOG_PATH}.1`);
    appendFileSync(SECURITY_LOG_PATH, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  } catch (e) {
    logErr(`[security] could not write ${SECURITY_LOG_PATH}: ${e.message}`);
  }
}

/** Newest first, current file only; the rotated copy stays on disk for reading by hand. */
export function readSecurityLog() {
  const lines = existsSync(SECURITY_LOG_PATH) ? readFileSync(SECURITY_LOG_PATH, 'utf8').split('\n').filter(Boolean) : [];
  return { path: SECURITY_LOG_PATH, lines: lines.slice(-PANEL_LINES).reverse() };
}
