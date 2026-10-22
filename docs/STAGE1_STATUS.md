# Stage 1 — private Community preparation

Date: 2026-10-22

## Source and license
- Forked locally from Aki MCP Server v2.2.0 (MIT), including selected local MKShop GUI/Workflow enhancements.
- Original MIT LICENSE preserved; original author credited in README and THIRD_PARTY_NOTICES.
- Independent Community commit history, with GitHub's original Initial commit preserved as a merge ancestor; no production .git history.

## Changes to standalone Community copy
- NPM package mkshop-mcp-community, version 0.1.0-beta.1, private=true.
- Excluded personal production data, logs, browser profiles, sessions, backups and scratch folders.
- Removed upstream donation QR images and payment widget; replaced footer with attribution.
- Removed machine-specific Paseo CLI path; optional PASEO_CLI_JS environment variable.
- Default user data at ~/.mkshop-mcp-community/, not ~/.aki/mcpsv.
- Default ports 18999/18998 (dev 18997/18996), separate from production.
- Default local-only: opt-in MKSHOP_ENABLE_FUNNEL=1 to run Tailscale Funnel.

## Verified
- Node syntax checking: 108 JavaScript files, zero errors.
- Static relative-import resolution: zero missing files.
- High-confidence secret / absolute-path / private-domain pattern scan: zero findings.
- Static copy remains independent; production not restarted.
- Community default-roots smoke test PASS: only isolated workspace, no default trusted-script folders.
- GitHub private-beta source pushed to c0509kmndiep-lab/mkshop-mcp-community; branch SHA verified locally against git ls-remote.

## Pending before public release
- Confirm repository visibility via GitHub settings before any public release; public unauthenticated API currently returns 404 (consistent with private visibility).
- Review GitHub Actions CI run results after upload.
- Independent npm dependency installation, npm pack, GUI runtime smoke test.
- Full third-party license and SBOM audit, external secret scanner.
- Audit inherited auto-updater and branding/personal assets.
- End-to-end privacy/security review before setting GitHub visibility to public.

No full standalone MCP server startup, GUI mutation, or public network exposure was attempted in Stage 1. The source was uploaded through authenticated local Git without force-push.
