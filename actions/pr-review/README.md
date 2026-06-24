# Thesmos Governance PR Review Action

Runs `thesmos review` on every pull request and posts inline findings as review comments. BLOCKER and HIGH violations block the merge check.

## Usage

```yaml
name: Thesmos PR Review

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  thesmos-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Holley-Studio/thesmos-governance/actions/pr-review@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | Yes | — | GitHub token for posting review comments. Use `secrets.GITHUB_TOKEN`. Requires `pull-requests: write` and `contents: read`. |
| `fail-on-severity` | No | `BLOCKER` | Fail CI when findings at this severity or above are present. Values: `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`, `TECH_DEBT`, `none` |
| `post-inline-comments` | No | `true` | Post inline diff comments for findings with line numbers |
| `update-summary` | No | `true` | Post (or update) a summary comment on the PR. On re-runs, the existing comment is edited, not duplicated. |

## Outputs

| Output | Description |
|--------|-------------|
| `finding-count` | Total findings found (e.g., `"7"`) |
| `blocker-count` | BLOCKER-severity findings (e.g., `"2"`) |
| `health-grade` | Governance grade if report.json exists (`A+`, `A`, `B`, `C`, `D`, `F`) |

## Examples

### Report-only mode (never blocks merge)

```yaml
- uses: Holley-Studio/thesmos-governance/actions/pr-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-severity: none
```

### Block on HIGH and above

```yaml
- uses: Holley-Studio/thesmos-governance/actions/pr-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-severity: HIGH
```

### Use finding count in a downstream step

```yaml
- id: review
  uses: Holley-Studio/thesmos-governance/actions/pr-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Print results
  run: |
    echo "Findings: ${{ steps.review.outputs.finding-count }}"
    echo "Blockers: ${{ steps.review.outputs.blocker-count }}"
    echo "Grade: ${{ steps.review.outputs.health-grade }}"
```

## Versioning

Reference `@v1` for the latest stable v1.x release. Pin to a specific tag (e.g., `@v1.0.0`) for reproducible builds.

## Links

- [Full Documentation](https://holley.studio/thesmos)
- [Issues](https://github.com/Holley-Studio/thesmos-governance/issues)
- [npm package](https://www.npmjs.com/package/thesmos-governance)
