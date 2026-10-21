// Interactive terminal sessions: explicit stdin, incremental stdout/stderr, bounded output,
// prompt-aware reads and process-tree stop. Separate from detached task_start.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Shell } from './shell-mcp.js';
import { resolveUnderRoot } from './roots.js';
import { USER_DIR } from './userdata.js';
import { ok, fail } from './mcp-tool.js';

const MAX_ACTIVE = 12;
const MAX_EVENTS = 512;
const MAX_CHARS = 40000;
const MAX_LOG_BYTES = 16 * 1024 * 1024;
const sessions = new Map();
const LOG_DIR = path.join(USER_DIR, 'terminal-logs');
const shell = new Shell();

function stopTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, timeout: 5000,
    });
    if (result.error && result.error.code !== 'ESRCH') throw result.error;
  } else {
    try { process.kill(-pid, 'SIGTERM'); }
    catch (e) {
      if (e.code !== 'ESRCH') {
        try { process.kill(pid, 'SIGTERM'); } catch (inner) {
          if (inner.code !== 'ESRCH') throw inner;
        }
      }
    }
  }
}

function wake(s) {
  for (const fn of s.waiters) fn();
  s.waiters.clear();
}

function promptInfo(s) {
  const tail = s.recent.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
  const line = tail.split('\n').at(-1) || '';
  const prompt = /^(?:>>> |\.\.\. |PS [^\n>]{0,180}> ?|[A-Za-z]:\\[^\n>]{0,180}> ?|> )$/.test(line);
  return { promptDetected: prompt, promptLine: prompt ? line : null };
}

function addOutput(s, stream, value) {
  if (!value) return;
  s.recent = (s.recent + value).slice(-512);
  // Chunk on code-point boundaries so an oversized raw chunk cannot defeat read caps.
  for (const piece of value.match(/[\s\S]{1,2048}/gu) || []) {
    const event = { seq: ++s.seq, stream, text: piece };
    s.events.push(event);
    if (s.events.length > MAX_EVENTS) s.events.shift();
    if (!s.logTruncated) {
      const record = Buffer.from(JSON.stringify(event) + '\n', 'utf8');
      if (s.logBytes + record.length > MAX_LOG_BYTES) {
        s.logTruncated = true;
      } else {
        try {
          fs.appendFileSync(s.logFile, record);
          s.logBytes += record.length;
        } catch (e) {
          s.logError = e.message;
          s.logTruncated = true;
        }
      }
    }
  }
  wake(s);
}

function getSession(sessionId) {
  if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
    throw new Error('Unknown terminal sessionId');
  }
  return sessions.get(sessionId);
}

function sessionState(s) {
  return {
    sessionId: s.sessionId, pid: s.pid, command: s.command, cwd: s.cwd,
    status: s.status, alive: s.status === 'running',
    startedAt: s.startedAt, endedAt: s.endedAt || null,
    exitCode: s.exitCode, exitSignal: s.exitSignal, error: s.error || null,
    lastSeq: s.seq, firstAvailableSeq: s.events[0]?.seq ?? (s.seq + 1),
    logFile: s.logFile, logTruncated: s.logTruncated,
    ...promptInfo(s),
  };
}

function trimOldSessions() {
  if (sessions.size < 100) return;
  for (const [id, s] of sessions) {
    if (s.status !== 'running') sessions.delete(id);
    if (sessions.size < 80) break;
  }
}

export async function terminalStart({ command, cwd } = {}) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('command is required');
  if ([...sessions.values()].filter((s) => s.status === 'running').length >= MAX_ACTIVE) {
    throw new Error('Interactive terminal limit reached (12 running sessions)');
  }
  const { bin, args } = shell.parse(command);
  shell.checkPermission(bin, args);
  const dir = resolveUnderRoot(cwd);
  const realDir = fs.realpathSync(dir);
  resolveUnderRoot(realDir);
  // cmd.exe uses /Q /K-style switches; they are not root-relative paths.
  const checkedArgs = process.platform === 'win32' && /^cmd(?:\.exe)?$/i.test(path.basename(bin))
    ? args.filter((a) => !/^\/(?:Q|K|D|C|S|A|U)$/i.test(a)) : args;
  shell.checkOperandBoundaries(checkedArgs, realDir);
  trimOldSessions();

  const sessionId = 'term_' + randomUUID();
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  const logFile = path.join(LOG_DIR, sessionId + '.jsonl');
  fs.writeFileSync(logFile, '', { mode: 0o600, flag: 'wx' });
  const s = {
    sessionId, command, cwd: realDir, logFile, logBytes: 0, logTruncated: false,
    events: [], seq: 0, cursor: 0, recent: '', waiters: new Set(),
    startedAt: new Date().toISOString(), status: 'running',
    exitCode: null, exitSignal: null, endedAt: null, error: null,
  };
  let child;
  try {
    child = spawn(bin, args, {
      cwd: realDir, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
    });
  } catch (e) {
    fs.unlinkSync(logFile);
    throw e;
  }
  s.child = child;
  s.pid = child.pid || null;
  sessions.set(sessionId, s);
  for (const stream of ['stdout', 'stderr']) {
    const decoder = new StringDecoder('utf8');
    child[stream].on('data', (buf) => addOutput(s, stream, decoder.write(buf)));
    child[stream].on('end', () => addOutput(s, stream, decoder.end()));
  }
  child.on('error', (e) => {
    s.error = e.message;
    addOutput(s, 'error', e.message + '\n');
    s.status = 'failed';
    s.endedAt = new Date().toISOString();
    wake(s);
  });
  child.on('close', (code, signal) => {
    s.exitCode = code;
    s.exitSignal = signal;
    if (s.status === 'running') s.status = code === 0 ? 'completed' : 'exited';
    s.endedAt = new Date().toISOString();
    wake(s);
  });
  return sessionState(s);
}

export async function terminalWrite({ sessionId, input, appendNewline = true } = {}) {
  const s = getSession(sessionId);
  if (s.status !== 'running' || !s.child.stdin.writable) throw new Error('Terminal session is not writable');
  if (typeof input !== 'string') throw new Error('input must be a string');
  if (Buffer.byteLength(input, 'utf8') > 8192) throw new Error('input exceeds 8192 bytes');
  if (input.includes('\0')) throw new Error('NUL bytes are not supported');
  const payload = input + (appendNewline ? '\n' : '');
  // Prevent carrying an obsolete prompt into the next waitForPrompt call.
  s.recent = '';
  await new Promise((resolve, reject) => s.child.stdin.write(payload, 'utf8', (e) => e ? reject(e) : resolve()));
  return { sessionId, bytesWritten: Buffer.byteLength(payload), status: s.status };
}

function waitForUpdate(s, ms) {
  return new Promise((resolve) => {
    let timer;
    const finish = (timedOut) => {
      clearTimeout(timer);
      s.waiters.delete(onChange);
      resolve(timedOut);
    };
    const onChange = () => finish(false);
    s.waiters.add(onChange);
    timer = setTimeout(() => finish(true), ms);
  });
}

function snapshot(s, cursor, maxChars) {
  const earliest = s.events[0]?.seq ?? (s.seq + 1);
  const dropped = cursor < earliest - 1;
  let nextCursor = Math.max(cursor, earliest - 1);
  let count = 0;
  const events = [];
  for (const event of s.events) {
    if (event.seq <= nextCursor) continue;
    if (count + event.text.length > maxChars && events.length) break;
    events.push(event);
    count += event.text.length;
    nextCursor = event.seq;
  }
  return { events, nextCursor, dropped, text: events.map((event) => event.text).join('') };
}

export async function terminalRead({
  sessionId, cursor, timeoutMs = 0, waitForPrompt = false, maxChars = 20000,
} = {}) {
  const s = getSession(sessionId);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 15000) {
    throw new Error('timeoutMs must be between 0 and 15000');
  }
  if (!Number.isInteger(maxChars) || maxChars < 2048 || maxChars > MAX_CHARS) {
    throw new Error('maxChars must be between 2048 and 40000');
  }
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > s.seq)) {
    throw new Error('Invalid output cursor');
  }
  const from = cursor ?? s.cursor;
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  while (timeoutMs > 0 && s.status === 'running') {
    const result = snapshot(s, from, maxChars);
    if (waitForPrompt ? promptInfo(s).promptDetected : result.events.length > 0) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) { timedOut = true; break; }
    timedOut = await waitForUpdate(s, remaining);
    if (timedOut) break;
  }
  const result = snapshot(s, from, maxChars);
  if (cursor === undefined) s.cursor = result.nextCursor;
  return {
    ...sessionState(s), fromCursor: from, ...result,
    hasMore: result.nextCursor < s.seq, timedOut,
  };
}

export async function terminalManage({ action, sessionId } = {}) {
  if (action === 'list') return [...sessions.values()].map(sessionState);
  const s = getSession(sessionId);
  if (action === 'status') return sessionState(s);
  if (action === 'stop') {
    if (s.status === 'running') {
      stopTree(s.pid);
      s.status = 'stopped';
      s.endedAt = new Date().toISOString();
      wake(s);
    }
    return sessionState(s);
  }
  if (action === 'delete') {
    if (s.status === 'running') throw new Error('Stop running session before deleting');
    sessions.delete(sessionId);
    try { fs.unlinkSync(s.logFile); } catch {}
    return { sessionId, deleted: true };
  }
  throw new Error('Unknown action: ' + action);
}

// Child processes are owned by this server. Do not leave untracked REPLs on shutdown.
process.once('exit', () => {
  for (const s of sessions.values()) {
    if (s.status === 'running') {
      try { stopTree(s.pid); } catch {}
    }
  }
});

export function register(server) {
  server.registerTool('terminal_start', {
    title: 'Start Interactive Terminal',
    description: 'Start an allowlisted persistent stdin/stdout/stderr terminal session. Returns sessionId and PID. Pipe-based REPL; not a Windows ConPTY/full-screen console. Sessions belong to the current MCP server lifetime.',
    inputSchema: {
      command: z.string().describe('Executable and arguments, e.g. node -i, python -u -i, pwsh -NoLogo -NoProfile -NoExit'),
      cwd: z.string().optional().describe('Working directory within configured allowed roots'),
    },
  }, async (args) => { try { return ok(JSON.stringify(await terminalStart(args))); } catch (e) { return fail(e); } });

  server.registerTool('terminal_write', {
    title: 'Write Interactive Terminal Input',
    description: 'Send up to 8192 bytes to an existing session stdin. Append newline by default.',
    inputSchema: {
      sessionId: z.string(), input: z.string(),
      appendNewline: z.boolean().optional(),
    },
  }, async (args) => { try { return ok(JSON.stringify(await terminalWrite(args))); } catch (e) { return fail(e); } });

  server.registerTool('terminal_read', {
    title: 'Read Interactive Terminal Output',
    description: 'Read incremental stdout/stderr and prompt status. Optional cursor enables pagination; without cursor each read advances its session cursor. Optionally wait for output or a REPL prompt.',
    inputSchema: {
      sessionId: z.string(), cursor: z.number().int().nonnegative().optional(),
      timeoutMs: z.number().int().min(0).max(15000).optional(),
      maxChars: z.number().int().min(2048).max(40000).optional(),
      waitForPrompt: z.boolean().optional(),
    },
  }, async (args) => { try { return ok(JSON.stringify(await terminalRead(args))); } catch (e) { return fail(e); } });

  server.registerTool('terminal_manage', {
    title: 'Manage Interactive Terminals',
    description: 'List, inspect, stop process tree, or delete finished terminal sessions; only sessions created by terminal_start.',
    inputSchema: {
      action: z.enum(['list', 'status', 'stop', 'delete']),
      sessionId: z.string().optional(),
    },
  }, async (args) => { try { return ok(JSON.stringify(await terminalManage(args))); } catch (e) { return fail(e); } });
}
