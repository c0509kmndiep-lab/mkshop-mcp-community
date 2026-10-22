# MKShop MCP Community

**Status: Public source beta — provided for evaluation and development. Not yet security-audited for unattended production use.**

**MKShop MCP Community is a standalone MCP server that gives authorized AI clients tools to access and control a local computer**: files, terminal, browsers, Windows desktop UI, and local services. It is an independent community distribution based on [Aki MCP Server](https://github.com/lacvietanh/aki-mcp-sv), enhanced with native Windows GUI automation and guarded multi-step workflows.

**Tiếng Việt:** Máy chủ MCP giúp AI truy cập và điều khiển máy tính theo quyền được cấp: đọc/ghi tệp, chạy lệnh, điều khiển trình duyệt và thao tác giao diện Windows. Các chức năng GUI dành cho Windows; một số công cụ khác có thể hoạt động trên những nền tảng khác khi đáp ứng phụ thuộc.

## Capabilities

| Module | What it does |
|---|---|
| File system and search | Read, edit, search and inspect files under configured roots |
| Shell and local jobs | Allowlist-governed commands, background processes, logs and terminals |
| Native Windows GUI | Window inventory, Microsoft UI Automation inspection, input and screenshots |
| GUI2 Workflow | Up to 20 steps, dry-run, verification, desktop lease, persistent receipts and guarded resume |
| Browser/CDP | Chromium profile and tab automation, DevTools and screenshots |
| Developer tools | Git, read-only SQLite queries, localhost HTTP and terminal interfaces; optional Postman/CLI integrations |
| Remote MCP | OAuth-backed gateway; internet ingress **must be explicitly configured** |

Existing command names retain the `aki__*` namespace for compatibility. Community branding does **not** imply endorsement by the original Aki MCP author.

### Design

The MCP server exposes individual tools through an OAuth-protected endpoint and includes a local control panel for configuration. Background jobs are OS processes with logs; optional Postman and external CLI integrations are supported when their prerequisites are installed.

## Prerequisites

- **Node.js 22 or later**, including npm.
- Windows 10/11 for native GUI automation (requires **Microsoft Windows App Development CLI / WinApp CLI**).
- Git for Windows for selected Unix-style read-only shell commands on Windows.
- An unlocked, interactive Windows user session for physical mouse and keyboard input.
- Optional: PowerShell 7, Python/OpenCV for the screenshot-template fallback, and external CLI providers where relevant.

**Platform scope:** Windows 10/11 is the primary target and the only platform for the bundled native GUI tools. The underlying Node.js MCP/file/search/shell/browser modules are designed to be cross-platform, but the Community beta has not been fully validated on macOS/Linux.

## Quick start — isolated, local-only

```powershell
git clone https://github.com/c0509kmndiep-lab/mkshop-mcp-community.git
cd mkshop-mcp-community
npm ci
node ./scripts/start.js --no-browser
```

Default loopback endpoints (Community only):

- MCP gateway: `http://127.0.0.1:18999/mcp`
- Local control panel: `http://127.0.0.1:18998/` (requires the generated panel token)

The app creates its own data directory at `~/.mkshop-mcp-community/data/`, separate from the Aki MCP installation. The initial allowed workspace is its `workspace/` subfolder, **not** your home directory. To grant access to another folder, review the local panel's allowed roots first.

To avoid interfering with an existing Aki MCP installation, do **not** run both with identical ports or data directory overrides. See [Installation and isolation](docs/INSTALL.md).

## Remote AI clients (ChatGPT, Claude and others)

A web/cloud AI client cannot reach `127.0.0.1` on your computer. To connect from outside, provide your own authenticated HTTPS ingress, review the server's OAuth registration and explicitly enable the intended remote connection. Never forward the panel port or disable authentication.

**There is no automatic public tunnel in the default configuration.** Tailscale Funnel is opt-in via `MKSHOP_ENABLE_FUNNEL=1`. Cloudflare credentials or `PUBLIC_ORIGIN` are explicit settings and require independent security review. See [Security](SECURITY.md).

## Windows GUI2 workflow

The native GUI layer uses Microsoft UI Automation and can fall back to bounded, explicit coordinates or OpenCV matching when the UI tree is sparse. The `aki__gui2_workflow_execute` tool supports up to 20 steps, explicit `HWND`, `dryRun=true` by default and `confirmMutations=true` for live actions. Interrupted mutating steps are **not** replayed blindly; a pending receipt must be reviewed.

The GUI feature cannot bypass Windows UAC, secure desktops or a locked session. GUI operations sharing one physical desktop must be serialized across agents.

## Documentation

- [Install / first-run isolation](docs/INSTALL.md)
- [Architecture and module inventory](docs/ARCHITECTURE.md)
- [Stable release readiness checklist](docs/RELEASE_CHECKLIST.md)
- [Security and vulnerability reporting](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Stage 1 local audit](docs/STAGE1_STATUS.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License and attribution

Licensed under the **MIT License**. Based on **Aki MCP Server** by **Lạc Việt Anh (AkiTao)** — original MIT copyright and permission terms are retained in [LICENSE](LICENSE). Community modifications are credited separately where applicable. Upstream: https://github.com/lacvietanh/aki-mcp-sv

The MIT license does not grant a trademark endorsement or supersede licenses of third-party dependencies, fonts and images. A full dependency/asset audit is still pending.

## Tests and verification

Run the isolated, non-destructive regression suite with:

```powershell
npm ci --ignore-scripts
npm test
```

The Community smoke runner launches every test with a separate temporary configuration directory and hides child console windows on Windows.

**Windows local beta verification (2026-10-22):** 10/10 scoped regression tests passed, including OAuth/panel, MCP transport, file-root security, GUI tool registration and GUI2 workflow validation. An additional read-only GUI inspection succeeded on the actual Windows desktop. Static JavaScript syntax and internal import checks passed; basic secret-pattern scanning produced no findings.

**Limitations:** This is not a full end-to-end certification. Native dependency build/install scripts were intentionally skipped, no GUI mutations were performed, and a clean-host installation, full legacy integration suite, security audit and third-party license review remain pending.
