# MKShop MCP Community — private preparation beta

Based on Aki MCP Server by Lạc Việt Anh (AkiTao), MIT licensed.
Original project: https://github.com/lacvietanh/aki-mcp-sv

## Status

Stage 1 source snapshot only. NOT verified for production or public release.
No local configuration, OAuth secrets, screenshots, browser profiles, agent sessions, or Hub data are intentionally included.

## Features

- Filesystem, command execution, Git, SQLite, browser/CDP, OAuth MCP integration.
- Windows GUI UI Automation, screenshot and input via WinApp CLI.
- GUI2 bounded workflow, desktop lease, dry-run, checkpoint and guarded resume.

## Requirements

- Node.js >=22 and Windows WinApp CLI for Windows native GUI tools.
- Run npm ci before testing; start with npm start only after reviewing ingress and settings.
- Use a separate data directory for isolated testing.

## Security

- Keep endpoints loopback-only until OAuth/network/security assessment is complete.
- Upstream launcher may initiate public ingress; DO NOT start before verifying this behavior.
- The package is marked private=true intentionally to block accidental NPM publication.
- Never add local secrets, OAuth storage, screenshots, logs or machine-specific files.

## Attribution

Original © 2026 Lạc Việt Anh (AkiTao), MIT License, see LICENSE.
Added MKShop features remain subject to their contributors rights and MIT license.
See THIRD_PARTY_NOTICES.md for licensing follow-up.
