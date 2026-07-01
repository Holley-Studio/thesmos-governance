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

const DESC_PATH = resolve(ROOT, 'website/downloads/gumroad-description.md')

if (!existsSync(DESC_PATH)) {
  console.error('❌  website/downloads/gumroad-description.md not found — run npm run agents:pack first')
  process.exit(1)
}

const description = readFileSync(DESC_PATH, 'utf-8')

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
