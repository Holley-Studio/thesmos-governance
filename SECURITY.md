# Security Policy

## Supported Versions

| Version | Supported              |
|---------|------------------------|
| 4.x     | ✅ Yes                 |
| 3.x     | ❌ No — upgrade to 4.x |
| < 3.0   | ❌ No                  |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via [GitHub's private vulnerability reporting](https://github.com/Holley-Studio/thesmos-governance/security/advisories/new) or by emailing **holley42 at yahoo.com** with the subject `[THESMOS SECURITY] <brief description>`.

Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (or a minimal proof-of-concept)
- Affected versions and configuration
- Any suggested mitigations

You will receive an acknowledgement within **48 hours** and a resolution timeline within **7 days** for critical issues, **30 days** for non-critical issues. Reporters of valid vulnerabilities will be credited in release notes (unless you prefer anonymity).

## Scope

**In scope:**

- **Thesmos CLI** (`thesmos` npm package) — rule execution, scanner, fix engine, secrets scanning
- **VS Code extension** — inline diagnostics, tree view, commands
- **GitHub Action** (`actions/pr-review`) — PR comment generation, file scanning, GitHub API interactions
- **MCP server** (`thesmos mcp:serve`) — tool definitions, input handling

Specific issue classes:
- Secret patterns that can be bypassed by an attacker controlling file content
- Path traversal in the file walker
- Command injection via CLI arguments or config values
- Unsafe deserialization of `.thesmos/config.json` or `report.json`
- Prompt injection via agent configuration files processed by the MCP server

**Out of scope:**

- Vulnerabilities in development-only dependencies (vitest, tsup, typescript)
- Issues that require physical access to the developer's machine
- Social engineering
- Vulnerabilities in third-party dependencies (report those to the respective project)

## Security Design

- All file reads use Node's built-in `fs` module with explicit path joins — no path traversal
- No `eval`, no `Function()`, no dynamic `import()` of user-controlled paths
- Config values are type-validated before use; regex patterns are try/caught
- Secret patterns run in a sandboxed regex engine with explicit timeouts to prevent ReDoS
- GitHub Action uses the principle of least privilege — `contents: read`, no write access by default
- SARIF output is compatible with GitHub Advanced Security and EU AI Act Article 12 audit trail requirements
