#!/usr/bin/env node
/**
 * Gumroad Sync — pushes the latest description and agent count to the product.
 *
 * Usage:
 *   tsx scripts/gumroad-sync.ts
 *   npm run gumroad:sync
 *
 * Requires in root .env:
 *   GUMROAD_TOKEN=...
 *   GUMROAD_PRODUCT_ID=...
 *
 * IMPORTANT: pushes the pre-built HTML block from gumroad-description.html
 * (the content between its two `PASTE EVERYTHING ... LINE` marker comments),
 * NOT the raw .md file. Gumroad's API description field renders real HTML —
 * it does not parse Markdown — so pushing gumroad-description.md's raw text
 * ships literal "##"/"---"/"[text](url)" characters to the live product page.
 * (Discovered 2026-07-06: exactly this happened on the first sync.)
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')

function loadEnv(): void {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

const TOKEN      = process['env']['GUMROAD_TOKEN']
const PRODUCT_ID = process['env']['GUMROAD_PRODUCT_ID']

if (!TOKEN || !PRODUCT_ID) {
  console.error('❌  Missing GUMROAD_TOKEN or GUMROAD_PRODUCT_ID in .env')
  process.exit(1)
}

const DESC_PATH = resolve(ROOT, 'website/downloads/gumroad-description.html')

if (!existsSync(DESC_PATH)) {
  console.error('❌  website/downloads/gumroad-description.html not found — run npm run agents:pack first')
  process.exit(1)
}

const START_MARKER = 'PASTE EVERYTHING BELOW THIS LINE INTO GUMROAD HTML EDITOR'
const END_MARKER   = 'PASTE EVERYTHING ABOVE THIS LINE INTO GUMROAD HTML EDITOR'

function extractPasteableHtml(fullHtml: string): string {
  const startIdx = fullHtml.indexOf(START_MARKER)
  const endIdx   = fullHtml.indexOf(END_MARKER)
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `gumroad-description.html is missing its "${START_MARKER}" / "${END_MARKER}" marker comments — ` +
      'cannot safely extract the pasteable block. Fix the file structure before syncing.'
    )
  }
  // Skip past the start marker's closing "-->", then trim back to the end marker's opening "<!--".
  const afterStart = fullHtml.indexOf('-->', startIdx) + '-->'.length
  const beforeEnd   = fullHtml.lastIndexOf('<!--', endIdx)
  return fullHtml.slice(afterStart, beforeEnd).trim()
}

const description = extractPasteableHtml(readFileSync(DESC_PATH, 'utf-8'))

async function getProduct(): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.gumroad.com/v2/products/${PRODUCT_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  const json = await res.json() as Record<string, unknown>
  if (!json.success) throw new Error(`Failed to fetch product: ${JSON.stringify(json)}`)
  return json.product as Record<string, unknown>
}

async function updateProduct(fields: Record<string, string>): Promise<void> {
  const body = new URLSearchParams(fields)
  const res = await fetch(`https://api.gumroad.com/v2/products/${PRODUCT_ID}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const json = await res.json() as Record<string, unknown>
  if (!json.success) throw new Error(`Failed to update product: ${JSON.stringify(json)}`)
}

async function main(): Promise<void> {
  console.log('\n⚡ Gumroad Sync\n')

  console.log('  → Fetching current product...')
  const product = await getProduct()
  console.log(`  ✅ Found: ${product.name} (${product.permalink})`)

  console.log('  → Pushing description...')
  await updateProduct({ description })
  console.log('  ✅ Description updated')

  console.log('\n✅ Sync complete.')
  console.log(`   Product: https://holleystudio.gumroad.com/l/${PRODUCT_ID}\n`)
  console.log('   Note: ZIP file replacement must be done manually in Gumroad → Content tab → ⋮ → Replace file\n')
}

main().catch(err => {
  console.error('❌ Sync failed:', err.message)
  process.exit(1)
})
