# Security Policy

## Supported Versions

| Version | Maintenance status |
|---------|--------------------|
| 5.x     | Current maintenance target |
| 4.x     | Reports accepted; backport availability is evaluated per issue |
| < 4.0   | Upgrade to a supported release |

An unreleased fix in a branch or local checkout is not protection for an installed release. Check the release notes for the version containing a fix.

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
- **Runtime and desktop sidecar** — provider execution, tool permissions, workspace boundaries
- **Mnemosyne memory and execution evidence** — identity filtering, persistence, receipts, and evaluation

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

## Security Design and Limits

- Thesmos runs with the operating-system permissions of its host process. A path join alone is not a containment check. Validate identifiers and resolved paths at each filesystem boundary; review symlinks and workspace permissions separately.
- CLI, MCP, provider, and plugin inputs require validation appropriate to the operation. Custom packs and executable integrations are trusted code; do not load them from an untrusted source.
- Rules are deterministic static checks with varying precision. Many use JavaScript regular expressions; there is no blanket guarantee of a sandbox, execution timeout, complete language analysis, or freedom from false positives and missed detections.
- Local JSONL evidence is structurally validated. A malformed or unreadable evidence stream must not produce a passing evaluation. Logs are not signed, tamper-proof, or a substitute for independent monitoring.
- Mnemosyne is a local knowledge store. Client and repository filtering does not provide server tenant authentication. Records can contain sensitive material; protect the directory, backups, and any embedding provider accordingly.
- Memory writes use a process lock and atomic replacement of individual files. An interrupted process can leave a lock requiring operator inspection. Records, vectors, and metadata are not one crash-atomic database transaction.
- Receipt prompt and result payloads use hashes. Operators and integrations must still avoid secrets in free-text metadata, error messages, activity summaries, and artifact paths.
- Grant GitHub workflows only the permissions their enabled features require. Posting reviews or comments can require write permission; inspect the action configuration and token scope.
- SARIF and evaluation reports support review and record keeping. Their availability does not establish legal compliance, regulatory certification, or complete coverage of all rules.
