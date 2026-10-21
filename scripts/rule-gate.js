// Server-side Rule Context Gate for Aki MCP
// Enforces that external clients must complete the rule-context handshake before using system-modifying tools.
// Supports both session-scoped state (MCP-Session-Id) and identity-scoped handshake grants (authenticated
// client identity from gatekeeper/OAuth), bound to current rule receipt with configurable TTL.
import { createHash } from 'node:crypto';
import { assembleRuleContext } from './rule-context.js';
import { log } from './log.js';
import { logSecurity } from './security-log.js';

export const TOOL_CATEGORIES = Object.freeze({
  EXEMPT: 'EXEMPT',
  BLOCKED: 'BLOCKED',
});

export const RULE_CONTEXT_TOOL = 'akidevrule_context';
export const RULE_CONTEXT_REQUIRED_CODE = 'RULE_CONTEXT_REQUIRED';
export const BLOCKED_MESSAGE =
  'RULE_CONTEXT_REQUIRED: Rule context handshake required before using system-modifying tools. Call aki__akidevrule_context with an absolute workingPath to load effective rules.';

export const DEFAULT_GRANT_TTL_MIN = 720; // 12 hours

// Explicit classification of all 66 server tools.
// Exempt: handshake tool and read-only / discovery / inspection tools.
// Blocked: tools that mutate filesystem, execute commands, drive GUI/browser, manage processes, or have side effects.
// Any unclassified tool defaults to BLOCKED (fail-closed).
export const CLASSIFIED_TOOLS = Object.freeze({
  // --- EXEMPT TOOLS (always accessible) ---
  // Handshake tool
  akidevrule_context: TOOL_CATEGORIES.EXEMPT,

  // Filesystem read & discovery
  read_text_file: TOOL_CATEGORIES.EXEMPT,
  get_file_info: TOOL_CATEGORIES.EXEMPT,
  find_path: TOOL_CATEGORIES.EXEMPT,
  search_content: TOOL_CATEGORIES.EXEMPT,
  list_allowed_directories: TOOL_CATEGORIES.EXEMPT,

  // Port inspection
  port_status: TOOL_CATEGORIES.EXEMPT,

  // SQLite read-only & schema
  sqlite_schema: TOOL_CATEGORIES.EXEMPT,
  sqlite_query: TOOL_CATEGORIES.EXEMPT,

  // Clipboard read
  clipboard_read: TOOL_CATEGORIES.EXEMPT,

  // Kiro read-only
  kiro_read: TOOL_CATEGORIES.EXEMPT,

  // GUI screen observation & window/element inspection
  gui_screenshot: TOOL_CATEGORIES.EXEMPT,
  gui_inspect: TOOL_CATEGORIES.EXEMPT,
  gui_list_windows: TOOL_CATEGORIES.EXEMPT,
  gui_get_focused: TOOL_CATEGORIES.EXEMPT,
  gui_get_value: TOOL_CATEGORIES.EXEMPT,
  gui_search: TOOL_CATEGORIES.EXEMPT,
  gui2_locate_template: TOOL_CATEGORIES.EXEMPT,
  gui2_workflow_status: TOOL_CATEGORIES.EXEMPT,

  // Terminal & ConPTY output observation
  terminal_read: TOOL_CATEGORIES.EXEMPT,
  conpty_read: TOOL_CATEGORIES.EXEMPT,
  conpty_screen: TOOL_CATEGORIES.EXEMPT,

  // DevTools / Chrome discovery & screenshots
  devtools_targets: TOOL_CATEGORIES.EXEMPT,
  devtools_screenshot: TOOL_CATEGORIES.EXEMPT,
  chrome_tabs: TOOL_CATEGORIES.EXEMPT,
  chrome_profiles: TOOL_CATEGORIES.EXEMPT,

  // Postman read-only status
  postman_status: TOOL_CATEGORIES.EXEMPT,

  // --- BLOCKED TOOLS (pre-handshake) ---
  // Filesystem mutation
  write_file: TOOL_CATEGORIES.BLOCKED,
  edit_file: TOOL_CATEGORIES.BLOCKED,
  create_directory: TOOL_CATEGORIES.BLOCKED,
  move_file: TOOL_CATEGORIES.BLOCKED,

  // Shell / command execution
  run_cmd: TOOL_CATEGORIES.BLOCKED,

  // Git operations
  git: TOOL_CATEGORIES.BLOCKED,

  // Agent execution
  agy_run: TOOL_CATEGORIES.BLOCKED,

  // Tasks & background execution
  task_start: TOOL_CATEGORIES.BLOCKED,
  task_manage: TOOL_CATEGORIES.BLOCKED,

  // Terminal & ConPTY execution / input / lifecycle
  terminal_start: TOOL_CATEGORIES.BLOCKED,
  terminal_write: TOOL_CATEGORIES.BLOCKED,
  terminal_manage: TOOL_CATEGORIES.BLOCKED,
  conpty_start: TOOL_CATEGORIES.BLOCKED,
  conpty_write: TOOL_CATEGORIES.BLOCKED,
  conpty_manage: TOOL_CATEGORIES.BLOCKED,
  conpty_resize: TOOL_CATEGORIES.BLOCKED,

  // Port termination
  kill_port: TOOL_CATEGORIES.BLOCKED,

  // System actions & clipboard write
  notify_user: TOOL_CATEGORIES.BLOCKED,
  clipboard_write: TOOL_CATEGORIES.BLOCKED,

  // Network / intranet fetch
  local_fetch: TOOL_CATEGORIES.BLOCKED,

  // DevTools & Chrome manipulation / execution
  devtools_eval: TOOL_CATEGORIES.BLOCKED,
  chrome_launch: TOOL_CATEGORIES.BLOCKED,
  chrome_stop: TOOL_CATEGORIES.BLOCKED,
  chrome_interact: TOOL_CATEGORIES.BLOCKED,

  // GUI interaction / synthetic input
  gui_click: TOOL_CATEGORIES.BLOCKED,
  gui_send_keys: TOOL_CATEGORIES.BLOCKED,
  gui_set_value: TOOL_CATEGORIES.BLOCKED,
  gui_focus: TOOL_CATEGORIES.BLOCKED,
  gui_drag: TOOL_CATEGORIES.BLOCKED,
  gui_hover: TOOL_CATEGORIES.BLOCKED,
  gui_invoke: TOOL_CATEGORIES.BLOCKED,
  gui_scroll: TOOL_CATEGORIES.BLOCKED,
  gui_wait_for: TOOL_CATEGORIES.BLOCKED,

  // GUI2 workflow execution & action
  gui2_action: TOOL_CATEGORIES.BLOCKED,
  gui2_workflow_execute: TOOL_CATEGORIES.BLOCKED,
  gui2_workflow_cancel: TOOL_CATEGORIES.BLOCKED,

  // Postman manipulation & eval
  postman_eval: TOOL_CATEGORIES.BLOCKED,
  postman_rename_conversation: TOOL_CATEGORIES.BLOCKED,
  postman_panel_fullwidth: TOOL_CATEGORIES.BLOCKED,
});

export function normalizeToolName(toolName) {
  if (typeof toolName !== 'string') return '';
  return toolName.startsWith('aki__') ? toolName.slice(5) : toolName;
}

export function classifyTool(toolName) {
  const bareName = normalizeToolName(toolName);
  if (Object.prototype.hasOwnProperty.call(CLASSIFIED_TOOLS, bareName)) {
    return CLASSIFIED_TOOLS[bareName];
  }
  // Fail-closed default: unclassified or unknown tools are BLOCKED
  return TOOL_CATEGORIES.BLOCKED;
}

export function isToolExempt(toolName) {
  return classifyTool(toolName) === TOOL_CATEGORIES.EXEMPT;
}

export function isHandshakeTool(toolName) {
  return normalizeToolName(toolName) === RULE_CONTEXT_TOOL;
}

export function normalizeGateMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'off' || m === 'warn' || m === 'enforce') return m;
  return 'warn'; // Shipped default: warn
}

export function getGrantTtlMin(overrideTtl) {
  if (typeof overrideTtl === 'number' && !Number.isNaN(overrideTtl) && overrideTtl > 0) {
    return overrideTtl;
  }
  const envVal = Number(process.env.AKI_RULE_GATE_GRANT_TTL_MIN);
  if (!Number.isNaN(envVal) && envVal > 0) {
    return envVal;
  }
  return DEFAULT_GRANT_TTL_MIN;
}

export function hashClientIdentity(rawIdentity) {
  if (!rawIdentity || typeof rawIdentity !== 'string') return null;
  const trimmed = rawIdentity.trim();
  if (!trimmed) return null;
  return createHash('sha256').update(trimmed).digest('hex');
}

export function formatDecisionLog(entry) {
  const time = entry.timestamp || new Date().toISOString();
  const sid = (entry.sessionId || 'none').slice(0, 16);
  const idHash = (entry.identityHash || 'none').slice(0, 16);
  const source = entry.source || 'none';
  const tool = entry.tool || 'unknown';
  const decision = entry.decision;
  const mode = entry.mode;
  const reason = entry.reason || 'none';
  const cRec = (entry.clientReceipt || 'none').replace(/^sha256:/, '').slice(0, 16);
  const curRec = (entry.currentReceipt || 'none').replace(/^sha256:/, '').slice(0, 16);
  return `[rule-gate] time=${time} session=${sid} id=${idHash} source=${source} tool=${tool} decision=${decision} mode=${mode} reason=${reason} clientReceipt=${cRec} currentReceipt=${curRec}`;
}

export function buildBlockedResponse(id, toolName, reason = RULE_CONTEXT_REQUIRED_CODE) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      isError: true,
      code: RULE_CONTEXT_REQUIRED_CODE,
      reason,
      content: [
        {
          type: 'text',
          text: BLOCKED_MESSAGE,
        },
      ],
      error: {
        code: RULE_CONTEXT_REQUIRED_CODE,
        message: BLOCKED_MESSAGE,
      },
    },
  };
}

export class RuleGate {
  constructor(options = {}) {
    this.sessions = new Map();
    this.grants = new Map(); // identityHash -> { identityHash, receipt, workingPath, createdAt, expiresAt }
    this.grantTtlMin = options.grantTtlMin ?? null;
    this.mode = options.mode ? normalizeGateMode(options.mode) : null;
    this.assemble = options.assemble || assembleRuleContext;
    this.deps = options.deps || null;
    this.logger = options.logger || null;
  }

  getMode(overrideMode) {
    if (overrideMode) return normalizeGateMode(overrideMode);
    if (this.mode) return this.mode;
    return normalizeGateMode(process.env.AKI_RULE_GATE_MODE);
  }

  getGrantTtlMin(overrideTtl) {
    return getGrantTtlMin(overrideTtl ?? this.grantTtlMin);
  }

  resolveClientIdentityHash(options = {}) {
    if (options.clientIdentityHash) return options.clientIdentityHash;
    if (options.clientIdentity) return hashClientIdentity(options.clientIdentity);
    return null;
  }

  initSession(sessionId) {
    if (!sessionId) return;
    this.sessions.set(sessionId, {
      handshakeCompleted: false,
      loadedReceipt: null,
      workingPath: null,
      handshakeTime: null,
    });
  }

  terminateSession(sessionId) {
    if (!sessionId) return;
    this.sessions.delete(sessionId);
  }

  clear() {
    this.sessions.clear();
    this.grants.clear();
  }

  pruneExpiredGrants() {
    const now = Date.now();
    for (const [id, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(id);
    }
  }

  getSession(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        handshakeCompleted: false,
        loadedReceipt: null,
        workingPath: null,
        handshakeTime: null,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  logDecision(entry) {
    const msg = formatDecisionLog(entry);
    if (this.logger) {
      this.logger(msg, entry);
    } else {
      log(msg);
      if (entry.decision === 'block' || entry.decision === 'would-block') {
        logSecurity(msg);
      }
    }
  }

  async getCurrentReceipt(workingPath, suppliedDeps) {
    const deps = suppliedDeps || this.deps || undefined;
    const res = await this.assemble({ workingPath: workingPath || undefined, mode: 'effective' }, deps);
    return res?.receipt || null;
  }

  recordHandshakeResult(sessionId, response, inputArgs, recordOptions = {}) {
    if (!sessionId || !response) return false;
    if (response.error || response.result?.isError) return false;

    const structured = response.result?.structuredContent;
    let receipt = structured?.receipt;

    // Fallback receipt extraction from text header if structuredContent is missing
    if (!receipt && Array.isArray(response.result?.content)) {
      const text = response.result.content[0]?.text || '';
      const match = text.match(/sha256:[0-9a-f]{64}/);
      if (match) receipt = match[0];
    }

    const status = structured?.status;
    if (!receipt || status === 'error') return false;

    // 1. Session-scoped update (retained for session-stable clients)
    const session = this.getSession(sessionId);
    session.handshakeCompleted = true;
    session.loadedReceipt = receipt;
    session.workingPath = inputArgs?.workingPath || structured?.workingRoot || null;
    session.handshakeTime = Date.now();

    // 2. Identity-scoped grant (for session-churning clients like ChatGPT)
    const clientIdentityHash = this.resolveClientIdentityHash(recordOptions);
    if (clientIdentityHash) {
      const ttlMin = this.getGrantTtlMin(recordOptions.grantTtlMin);
      const expiresAt = Date.now() + ttlMin * 60 * 1000;
      this.grants.set(clientIdentityHash, {
        identityHash: clientIdentityHash,
        receipt,
        workingPath: session.workingPath,
        createdAt: Date.now(),
        expiresAt,
      });
    }

    this.logDecision({
      timestamp: new Date().toISOString(),
      sessionId,
      identityHash: clientIdentityHash,
      source: clientIdentityHash ? 'identity-grant' : 'session',
      tool: RULE_CONTEXT_TOOL,
      decision: 'handshake-success',
      mode: this.getMode(),
      reason: status || 'ok',
      clientReceipt: receipt,
      currentReceipt: receipt,
    });

    return true;
  }

  async checkGate(sessionId, toolName, checkOptions = {}) {
    // 1. Exempt tools are always allowed
    if (isToolExempt(toolName)) {
      return { allow: true, exempt: true };
    }

    const mode = this.getMode(checkOptions.mode);

    // 2. Off mode: bypass gate completely, no log, no blocking
    if (mode === 'off') {
      return { allow: true, mode: 'off' };
    }

    this.pruneExpiredGrants();

    const session = this.getSession(sessionId);
    const clientIdentityHash = this.resolveClientIdentityHash(checkOptions);

    let allowed = false;
    let passSource = null;
    let effectiveReceipt = null;
    let workingPath = null;
    let wouldBlock = false;
    let reason = 'HANDSHAKE_MISSING';
    let currentReceipt = null;

    // Path (a): Session-scoped handshake check
    if (session.handshakeCompleted && session.loadedReceipt) {
      workingPath = session.workingPath;
      effectiveReceipt = session.loadedReceipt;
      passSource = 'session';
    } else if (clientIdentityHash && this.grants.has(clientIdentityHash)) {
      // Path (b): Identity-scoped handshake grant
      const grant = this.grants.get(clientIdentityHash);
      if (Date.now() > grant.expiresAt) {
        this.grants.delete(clientIdentityHash);
        reason = 'GRANT_EXPIRED';
      } else {
        workingPath = grant.workingPath;
        effectiveReceipt = grant.receipt;
        passSource = 'identity-grant';
      }
    }

    if (passSource && effectiveReceipt) {
      // 3. Receipt-bound verification: check if rule corpus changed since handshake
      try {
        currentReceipt = await this.getCurrentReceipt(workingPath, checkOptions.ruleContextDeps);
      } catch {
        currentReceipt = null;
      }

      if (!currentReceipt || currentReceipt !== effectiveReceipt) {
        // Rule corpus changed -> invalidate session state and identity grant
        if (passSource === 'session') {
          session.handshakeCompleted = false;
          session.loadedReceipt = null;
        }
        if (clientIdentityHash) {
          this.grants.delete(clientIdentityHash);
        }
        wouldBlock = true;
        reason = 'RECEIPT_MISMATCH';
      } else {
        allowed = true;
      }
    } else {
      wouldBlock = true;
      if (reason !== 'GRANT_EXPIRED') {
        reason = 'HANDSHAKE_MISSING';
      }
    }

    if (allowed) {
      return { allow: true, mode, source: passSource };
    }

    // 4. Decision handling based on mode
    const timestamp = new Date().toISOString();
    if (mode === 'warn') {
      this.logDecision({
        timestamp,
        sessionId,
        identityHash: clientIdentityHash,
        source: passSource || 'none',
        tool: toolName,
        decision: 'would-block',
        mode: 'warn',
        reason,
        clientReceipt: effectiveReceipt,
        currentReceipt,
      });
      return { allow: true, wouldBlock: true, reason, mode: 'warn', source: passSource || 'none' };
    }

    // mode === 'enforce'
    this.logDecision({
      timestamp,
      sessionId,
      identityHash: clientIdentityHash,
      source: passSource || 'none',
      tool: toolName,
      decision: 'block',
      mode: 'enforce',
      reason,
      clientReceipt: effectiveReceipt,
      currentReceipt,
    });
    return { allow: false, wouldBlock: true, reason, mode: 'enforce', source: passSource || 'none' };
  }
}

// Singleton for server runtime
export const ruleGate = new RuleGate();
