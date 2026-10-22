# Contributing

Contributions are welcome after the private beta gate. Keep changes portable and avoid dependencies on a contributor's machine, private paths, tokens or CLI accounts.

## Local development

- Node.js 22+; run `npm ci` in a fresh directory.
- Use an isolated `AKI_MCP_DATA_DIR`, distinct ports and local-only mode.
- Test file operations against disposable fixtures, and GUI operations against Calculator/Notepad rather than production applications.
- Run syntax checks and targeted tests before submitting changes.
- Include regression coverage and a short explanation for any security-sensitive behavior change.

## Review rules

- Do not add secrets, account identifiers, personal domains, browser profile archives, screenshots with private data or third-party licensed assets without permission.
- No implicit internet listeners, tunnel startup, desktop focus steals or hidden privilege escalation.
- Keep existing Aki MCP license and copyright notices when modifying inherited files.
- Keep `private: true` and beta status until release gates are complete.
