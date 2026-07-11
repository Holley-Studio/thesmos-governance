# Thesmos Governance

**Your AI writes fast. This extension makes sure it writes right.**

Thesmos is an AI governance and multi-agent orchestration platform built for teams shipping code with Claude, Cursor, Copilot, or Gemini. The VS Code extension brings the full Thesmos engine into your sidebar — inline findings, a live health score, and a council of specialized AI agents, all governed by 1,137 rules that run on every turn.

---

## Key Features

- **Inline findings on save** — BLOCKER and HIGH violations surface as CodeLens annotations and Error Lens-style diagnostics, right on the offending line. No terminal required.
- **Pantheon Chat** (`Cmd+Shift+G`) — A sidebar chat connected to 67 specialist AI agents. Ask Zeus to orchestrate, Argus to audit for security, Athena for strategy, or Apollo for copy — the right expert answers, not a general-purpose model.
- **Governance on every turn** — Every agent response is checked against the Thesmos rule engine: security rules (SEC, AUTH, VIBE), GDPR rules, AI agent safety rules (AGNT), CVE flags, and supply-chain checks. 1,137 rules total.
- **Credit Guardian** — Per-turn token cost tracked in the status bar. Monthly savings report built in. Hard budget stops before runaway costs compound.
- **Autopilot with a kill switch** — Generate a plan, run it on a branch, review the diff, open a draft PR, or revert the whole session in one click.
- **AI Debt Scanner** — Detects phantom imports, hallucinated packages, typosquat candidates, and slop patterns AI tools introduce silently.
- **Commit Wizard** — Guided Conventional Commits flow. Lints your last message before it reaches the remote.

---

## The interface is free — only the work costs credits

Every visual flourish in Pantheon Chat — the animated thinking oracle, the god cards, the star-field, the spinners — renders entirely in the VS Code webview. **None of it makes a model call.** Token spend comes only from the Claude calls that do your work, and Thesmos routes those to the cheapest model that gets it right:

- **Model-tier routing** — 60+ agents run on the mid tier, mechanical passes drop to the fast tier, and only architecture, strategy, and security escalate to a flagship (flagship ≈ 5× mid ≈ 5× fast).
- **Credit Guardian ledger** — every turn that ran on a cheaper tier is banked as a measured saving, totalled month-to-date.
- **Hard budget stops** — sessions carry a token ceiling; the loop stops when it's reached.
- **1M context stays opt-in** — the premium context window never turns on by accident.

The result: Pantheon Chat is built to cost fewer tokens the longer you use it, not more.

---

## The God Council

The Thesmos Pantheon is a team of 67 specialist AI agents, each scoped to a defined domain. Zeus orchestrates. Argus runs security audits. Athena sets strategy. Hephaestus handles UI and design systems. Cassandra writes tests. Chiron reviews architecture. Kratos manages DevOps.

You invoke them by describing your task. The routing system matches the domain and dispatches the right agent — no prompt engineering, no context switching. Each agent follows its own methodology, runs on the model tier that fits its work, and closes every response with a Thesmos governance check.

The Pantheon runs on Claude under the hood. Bring your own Anthropic API key.

---

## Governance Built In

Every file save, every agent turn, every autopilot run is checked against the Thesmos rule engine — the same 1,137-rule set that runs in CI, in your MCP server, and on the CLI. Rules span security (OWASP Top 10, CVE-2025-29927), GDPR compliance, EU AI Act conformity, prompt injection detection, AI agent scope enforcement, and supply chain integrity. BLOCKER findings halt. HIGH findings flag. Nothing ships that hasn't been checked.

**The permission bridge is security-audited.** The human-in-the-loop consent gate has passed a full STRIDE threat model with zero BLOCKERs — the enforcement layer fails closed, forged approvals are rejected, the consent dialog shows the full command, and privilege escalations require explicit native confirmation.

---

## Getting Started

1. **Install the extension** — Search "Thesmos Governance" in the VS Code Extensions panel, or install from the Marketplace page.
2. **Add your Anthropic API key** — Open Pantheon Chat (`Cmd+Shift+G` / `Ctrl+Shift+G`) and enter your key when prompted. The key is stored in VS Code's secret storage — never in plaintext.
3. **Run your first scan** — Open the Command Palette and run `Thesmos: Scan Repository`. Findings appear in the sidebar tree. Right-click any finding to fix it inline or copy an AI fix prompt.

---

## Requirements

- VS Code 1.100.0 or later
- An Anthropic API key (Claude) for Pantheon Chat and AI fix features
- Node.js in PATH for CLI scan commands (optional — UI scan works without it)
- `.thesmos/config.json` in your project root (generated on first scan)

---

[holley.studio/thesmos](https://holley.studio/thesmos) · [GitHub](https://github.com/Holley-Studio/thesmos-governance) · [Discussions](https://github.com/Holley-Studio/thesmos-governance/discussions)
