# Security policy

MKShop MCP Community can read/write files, execute approved shell commands, inspect browser state and physically control the Windows desktop. Treat it as a privileged local agent, not a sandbox.

## Beta scope

Private development snapshot. No security warranty; do not expose publicly or use unattended on sensitive systems. Public network ingress is disabled by default. If you intentionally enable ingress, require HTTPS, correct OAuth authorization, per-client access review and restricted allowed folders.

## Hardening basics

1. Use a dedicated non-administrator Windows account for high-risk testing when feasible.
2. Grant only task-relevant directories in the local panel. Never grant your home directory or private configuration folders without understanding the risk.
3. Keep `~/.mkshop-mcp-community/data/` and its OAuth credentials private.
4. Do not expose the control panel port, disable OAuth, bypass UAC, or grant anonymous shell.
5. Serialize physical GUI operations. Locked/UAC secure desktops are unsupported.
6. Never commit screenshots, device tokens, browser profiles, passwords, secret keys, shell histories, registry exports or production logs.
7. Review all third-party dependencies and installation scripts before production use.

## Report a vulnerability

Do not open a public issue containing exploit steps, keys, or private data. While private beta is in progress, contact the repository maintainers via a private GitHub channel. Enable GitHub's private vulnerability reporting before making this repository public.

## Upstream attribution

This project inherits parts of MIT-licensed [Aki MCP Server](https://github.com/lacvietanh/aki-mcp-sv). Security fixes should be reviewed for both the upstream base and the Community-specific additions.
