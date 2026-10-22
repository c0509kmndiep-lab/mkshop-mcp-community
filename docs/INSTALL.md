# Install and isolate MKShop MCP Community

**Beta guidance: use a separate directory, configuration profile and ports to avoid interfering with any other MCP services already running on your computer.**

## 1. Dependencies

Install Node.js 22+ and Git. Native Windows UI Automation requires Microsoft's WinApp CLI. Python + OpenCV are optional for GUI2 screenshot-template matching. Optional external tools (Paseo, Kiro, Antigravity, Postman) must be installed separately to use their integrations.

## 2. Clone and install

```powershell
git clone https://github.com/c0509kmndiep-lab/mkshop-mcp-community.git
cd mkshop-mcp-community
npm ci
```

Do not launch with Administrator/UAC elevation. Review Node.js package scripts and dependency origins before installing software on a sensitive machine.

## 3. Local-only start

```powershell
node ./scripts/start.js --no-browser
```

Default ports are **18999 (MCP)** and **18998 (panel)**. The local panel uses a generated token shown in startup output. Do not publish that token in logs or screenshots.

Default configuration and OAuth credentials live in `~/.mkshop-mcp-community/data/`. The only initial accessible filesystem root is `~/.mkshop-mcp-community/data/workspace/`. Use the allowed-folders section of the local panel to grant **only folders you intend AI tools to access**.

### Advanced overrides

Set environment variables **before** starting Node (especially `AKI_MCP_DATA_DIR`; do not assume late-loaded `.env` overrides values read at module import time).

- `GATEKEEPER_PORT`, `PANEL_PORT` — listening ports
- `AKI_MCP_DATA_DIR` — credential and settings data directory
- `MCP_DATA_DIR` — initial filesystem root(s)
- `MCP_SKIP_BROWSER_OPEN=1` — no automatic browser panel window
- `MKSHOP_ENABLE_FUNNEL=1` — **explicitly** allow Tailscale Funnel startup
- `MKSHOP_ENABLE_UPDATE_CHECK=1` — explicitly enable upstream update check
- `PASEO_CLI_JS` — path to installed Paseo CLI JavaScript entrypoint (if needed)

Use `--port` and `--panel-port` CLI switches if already running another MCP server. Never point Community at production OAuth storage.

## 4. Connect an MCP client

Local-compatible clients may use the loopback Streamable HTTP endpoint. Follow the client's OAuth/connection method; keep the panel on loopback. Remote ChatGPT/Claude web requires an explicitly configured HTTPS ingress and a successful OAuth authorization flow. Never publish the local panel directly.

## 5. GUI requirements

Run in the signed-in, unlocked interactive Windows session. An administrative desktop and Windows UAC secure desktop cannot be controlled by normal user-level UI automation. Start with `gui_list_windows`, inspect the exact HWND, then use dry-run GUI2 workflows before approving any mutation. Avoid concurrent physical desktop operations.

## 6. Troubleshooting

- **Connection denied:** check OAuth / target port, do not disable authorization.
- **Native GUI unavailable:** verify WinApp CLI, active interactive session and correct HWND.
- **Unexpected window focus:** use semantic UIA actions; physical mouse/keyboard require exclusive desktop ownership.
- **Port already used:** change Community ports; do not stop other services.
- **Dependency install failure:** inspect native `node-pty` compilation/toolchain; don't copy production `node_modules` as a shortcut.

This beta has not completed clean-host installation or full runtime smoke tests.
