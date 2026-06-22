# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately by emailing the maintainer or using [GitHub's private vulnerability reporting](https://github.com/Holley-Studio/prometheus-governance/security/advisories/new).

Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (or a minimal proof-of-concept)
- Affected versions
- Any suggested mitigations

You will receive an acknowledgement within **48 hours** and a resolution timeline within **7 days**.

## Scope

This tool runs entirely locally — it reads files, performs static analysis, and writes governance artifacts. It has no network access, no telemetry, and no server component.

Security issues in scope:
- Secret patterns that can be bypassed by an attacker controlling file content
- Path traversal in the file walker
- Command injection via CLI arguments or config values
- Unsafe deserialization of `.prometheus/config.json` or `report.json`

Out of scope:
- Vulnerabilities in development-only dependencies (vitest, tsup, typescript)
- Issues that require physical access to the developer's machine
- Social engineering

## Security design

- Zero runtime dependencies — no supply-chain attack surface at runtime
- All file reads use Node's built-in `fs` module with explicit path joins
- No `eval`, no `Function()`, no dynamic `import()` of user-controlled paths
- Config values are type-validated before use; regex patterns are try/caught
