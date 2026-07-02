#!/usr/bin/env node
/**
 * Sync the Pantheon into this machine's Claude Code user agents.
 *
 * Copies all pantheon/exports/claude-code/*.md into ~/.claude/agents/ so the
 * local Claude Code always matches the repo. Removes stale Thesmos agents
 * (files we previously installed that no longer exist in exports — e.g. the
 * renamed iris agent). Never touches files that don't correspond to a current
 * or former Thesmos export.
 *
 * Usage: npm run agents:install:local
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const EXPORTS_DIR = resolve(__dirname, '../../pantheon/exports/claude-code')
const AGENTS_DIR = join(homedir(), '.claude', 'agents')

// Former export filenames that should be cleaned up on sync
const RETIRED = new Set(['iris-photography-agent.md'])

function main(): void {
  if (!existsSync(EXPORTS_DIR)) {
    console.error(`❌ No exports found at ${EXPORTS_DIR} — run: npm run agents:export`)
    process.exit(1)
  }
  mkdirSync(AGENTS_DIR, { recursive: true })

  const exports_ = readdirSync(EXPORTS_DIR).filter(f => f.endsWith('.md'))
  const exportSet = new Set(exports_)

  let removed = 0
  for (const existing of readdirSync(AGENTS_DIR)) {
    if (!existing.endsWith('.md')) continue
    // Remove retired Thesmos agents; current ones get overwritten below.
    if (RETIRED.has(existing) && !exportSet.has(existing)) {
      rmSync(join(AGENTS_DIR, existing))
      removed++
    }
  }

  let installed = 0
  for (const file of exports_) {
    copyFileSync(join(EXPORTS_DIR, file), join(AGENTS_DIR, file))
    installed++
  }

  console.log(`\n⚡ Pantheon → Claude Code`)
  console.log(`  ✅ ${installed} agents synced to ~/.claude/agents/`)
  if (removed > 0) console.log(`  🧹 ${removed} retired agent(s) removed`)
  console.log(`\nRun /agents in Claude Code to see the full roster.\n`)
}

main()
