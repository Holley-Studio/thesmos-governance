#!/usr/bin/env node
/**
 * Sync the Pantheon into this machine's Claude Code user agents (ownership-aware).
 *
 * Preferred location: ~/.claude/agents/thesmos/
 * Ownership is recorded in ~/.thesmos/managed-agents.json
 *
 * Never deletes or overwrites untracked files. Matching filenames alone are
 * never treated as proof of ownership.
 *
 * Usage:
 *   npm run agents:install:local
 *   npm run agents:install:local -- --dry-run
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatSyncSummary, syncLocalUserAgents } from '../agent-sync.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const EXPORTS_DIR = resolve(__dirname, '../../pantheon/exports/claude-code')

function main(): void {
  const dryRun = process.argv.includes('--dry-run')

  if (!existsSync(EXPORTS_DIR)) {
    console.error(`❌ No exports found at ${EXPORTS_DIR} — run: npm run agents:export`)
    process.exit(1)
  }

  try {
    const result = syncLocalUserAgents({
      exportsDir: EXPORTS_DIR,
      dryRun,
      retired: ['iris-photography-agent.md'],
    })

    console.log(`\n⚡ Pantheon → Claude Code (federated)`)
    console.log(formatSyncSummary(result, '  User-level sync'))
    console.log(`  Managed namespace: ~/.claude/agents/thesmos/`)
    if (result.collisions > 0) {
      console.log(
        `  ⚠ ${result.collisions} collision(s) — untracked files were left untouched.`
      )
    }
    if (result.preserved > 0) {
      console.log(
        `  ⚠ ${result.preserved} modified managed file(s) preserved.`
      )
    }
    console.log(`\nRun /agents in Claude Code to see the full roster.`)
    console.log(`Run \`thesmos agents:doctor\` in a project for conflict details.\n`)
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

main()
