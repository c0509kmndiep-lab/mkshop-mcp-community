# Community architecture

```text
AI client / MCP consumer
      |
      | localhost or user-approved HTTPS + OAuth
      v
Gatekeeper / OAuth / Streamable MCP bridge
      |
      +---- Files, search, shell, tasks, terminal/ConPTY
      +---- Git, SQLite, localhost HTTP, notifications
      +---- Chromium DevTools (CDP), browser profiles, Postman
      +---- Windows native UIA (WinApp CLI)
      +---- GUI2 guarded workflow + exclusive desktop lease + receipt/checkpoint
```

## Source map

| Area | Files |
|---|---|
| Startup / OAuth | `scripts/start.js`, `scripts/gatekeeper.js`, `scripts/oauth.js` |
| MCP bridge / registry | `scripts/streamable-bridge.js`, `scripts/tools-server.js` |
| File scope and shell policy | `scripts/roots.js`, `scripts/allowlist.js`, `scripts/shell-mcp.js` |
| Native Windows UIA | `scripts/windows-gui-mcp.js` |
| GUI2 workflow | `scripts/gui2-core.js`, `scripts/gui2-workflow.js`, `scripts/gui2-mcp.js` |
| OpenCV fallback | `scripts/gui2-template-match.py` |
| Browser CDP | `scripts/chrome-mcp.js`, `scripts/cdp-mcp.js`, `scripts/cdp-engine.js` |
| Web UI | `scripts/panel.js`, `scripts/config-page.js`, `public/` |

### Guardrails

- Physical desktop interaction should be single-owner. The GUI2 workflow lease is cross-process within the same data directory, not a lock spanning unrelated MCP installations.
- Mutations require explicit confirmation; interrupted mutations are never retried blindly.
- File roots are dynamically re-evaluated after configuration changes.
- Local-only by default; remote exposure requires an explicit user configuration.
- The repository does **not** include local OAuth secrets, logs, or production Hub configuration.

### Compatibility limitations

- Some integrations inherited from Aki MCP expect optional external CLI and services and are not standalone guarantees.
- Windows UIA is distinct from Chromium CDP; use CDP for browser renderers when available.
- No full cross-platform or multi-machine validation has been completed.
