# Release gates for a stable / production-ready release

The repository is published as a **public source beta** for code review and testing. The following checks are prerequisites to claiming a stable, security-reviewed production release.

## Completed in Stage 1

- [x] Separate local copy and independent Git history
- [x] Preserve upstream MIT copyright and attribution
- [x] Separate data directory and non-conflicting default ports
- [x] No automatic Tailscale Funnel in default mode
- [x] Restrict default file roots to a dedicated workspace
- [x] Disable implicit trusted executable zones
- [x] Static JavaScript syntax and local import checks
- [x] Limited secret-pattern checks; remove known machine-specific paths and personal donation widgets
- [x] Confirm GitHub repository is private before metadata updates
- [x] Run 10/10 isolated, non-destructive Community smoke tests on Windows
- [x] Validate Windows UI Automation read-only inspection against a real window

## Blocking checks

- [ ] Review all committed binaries/images and third-party redistribution rights
- [ ] Run independent secret-scanning tool on worktree and Git history
- [ ] Generate SPDX/CycloneDX SBOM, audit transitive licenses and dependencies
- [ ] Test full clean-host dependency install with native lifecycle scripts; `npm ci --ignore-scripts` already passed without touching production
- [ ] Validate MCP launch/stop, OAuth, port binding, and first-run filesystem restrictions
- [ ] Validate native Windows GUI and GUI2 workflow with an isolated test app
- [ ] Verify entire CI/test suite and fix environment-specific failures
- [ ] Security review for ingress, OAuth, SSRF, clipboard, shell, and browser profile access
- [ ] Confirm optional tools have safe opt-in and do not inherit Aki production profiles
- [ ] Verify docs and examples on an isolated Windows account/VM or equivalent local sandbox

A public source repository does **not** imply approval for privileged or unattended production deployment.
