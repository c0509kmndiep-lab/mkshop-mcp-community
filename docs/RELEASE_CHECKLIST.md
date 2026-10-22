# Release gates for public distribution

Private beta is for code review. **Do not make this repository public** until every blocking item is satisfied.

## Completed in Stage 1

- [x] Separate local copy and independent Git history
- [x] Preserve upstream MIT copyright and attribution
- [x] Separate data directory and non-conflicting default ports
- [x] No automatic Tailscale Funnel in default mode
- [x] Restrict default file roots to a dedicated workspace
- [x] Disable implicit trusted executable zones
- [x] Static JavaScript syntax and local import checks
- [x] Limited secret-pattern checks; remove known machine-specific paths and personal donation widgets

## Blocking checks

- [ ] Confirm GitHub private visibility and repository permissions
- [ ] Review all committed binaries/images and third-party redistribution rights
- [ ] Run independent secret-scanning tool on worktree and Git history
- [ ] Generate SPDX/CycloneDX SBOM, audit transitive licenses and dependencies
- [ ] Test clean dependency install `npm ci` with production services untouched
- [ ] Validate MCP launch/stop, OAuth, port binding, and first-run filesystem restrictions
- [ ] Validate native Windows GUI and GUI2 workflow with an isolated test app
- [ ] Verify entire CI/test suite and fix environment-specific failures
- [ ] Security review for ingress, OAuth, SSRF, clipboard, shell, and browser profile access
- [ ] Confirm optional tools have safe opt-in and do not inherit Aki production profiles
- [ ] Verify docs and examples on an isolated Windows account/VM or equivalent local sandbox

Publishing a private GitHub source snapshot is **not** a public beta approval.
