# Agent Scoping Playbook

## When to use
When configuring Claude Code or any autonomous agent for use on this repository.

## scope.json setup

Create `.thesmos/scope.json`:
```json
{
  "allowedPaths": [
    "src/**",
    "thesmos/**",
    ".thesmos/**",
    "package.json"
  ],
  "blockedPaths": [
    ".env*",
    "**/*.key",
    "**/secrets/**"
  ],
  "allowedNetworkDomains": [],
  "piiCategories": [],
  "maxCostUSD": 5.00,
  "maxIterationsPerTask": 50
}
```

## Claude Code settings (.claude/settings.json)

Restrict Bash to repo paths — never grant unrestricted shell access:
```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Edit(src/**)",
      "Edit(thesmos/**)",
      "Edit(.thesmos/**)",
      "Read(**)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(curl *)",
      "Bash(wget *)",
      "Bash(ssh *)",
      "Write(.env*)"
    ]
  }
}
```

## Token budget configuration

Add to `.thesmos/config.json`:
```json
{
  "tokenBudget": {
    "sessionLimit": 200000,
    "dailyLimit": 1000000,
    "alertThresholdPercent": 80,
    "hardStop": true
  }
}
```

## Checklist before enabling autopilot

- [ ] `.claude/settings.json` has Bash path restrictions (prevents AGNT_023)
- [ ] `scope.json` has `maxIterationsPerTask` set (prevents AI_018)
- [ ] `scope.json` has `maxCostUSD` set (prevents AGNT_015)
- [ ] Audit log enabled in `.thesmos/config.json`
- [ ] No PII categories without consent lifecycle hooks (prevents AGNT_024)
- [ ] Sub-agents forward parent session token (prevents AGNT_028)
- [ ] DPIA documented if agent processes health/financial data (AGNT_025)

## Verifying scope

```bash
npx thesmos compliance --standard eu-ai-act
# Check for AGNT_* findings in scan report
npm run thesmos:scan && grep -c 'AGNT_' .thesmos/report.json
```
