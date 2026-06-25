// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * OSV.dev client — batch query for known vulnerabilities in npm packages.
 *
 * API: https://api.osv.dev/v1/querybatch
 * Zero new dependencies — uses node:https (built-in).
 *
 * Result is written to .thesmos/dep-cache.json by deps:audit.
 * DEP_001–010 rules read that cache synchronously inside detect().
 */

import { request } from 'node:https';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
}

export interface PackageResult {
  name: string;
  version: string;
  vulns: OsvVuln[];
}

interface OsvBatchRequest {
  queries: Array<{ package: { name: string; ecosystem: string }; version: string }>;
}

interface OsvBatchResponse {
  results: Array<{ vulns?: OsvVuln[] }>;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpsPost(hostname: string, path: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Batch query OSV.dev for vulnerabilities in the given packages.
 * Splits into chunks of 1000 (OSV batch limit) automatically.
 */
export async function queryOsv(
  packages: Array<{ name: string; version: string }>,
): Promise<PackageResult[]> {
  const CHUNK = 1000;
  const results: PackageResult[] = [];

  for (let i = 0; i < packages.length; i += CHUNK) {
    const chunk = packages.slice(i, i + CHUNK);
    const body: OsvBatchRequest = {
      queries: chunk.map((p) => ({
        package: { name: p.name, ecosystem: 'npm' },
        version: p.version,
      })),
    };

    const raw = await httpsPost(
      'api.osv.dev',
      '/v1/querybatch',
      JSON.stringify(body),
    );

    let parsed: OsvBatchResponse;
    try {
      parsed = JSON.parse(raw) as OsvBatchResponse;
    } catch {
      throw new Error(`OSV API returned invalid JSON: ${raw.slice(0, 200)}`);
    }

    for (let j = 0; j < chunk.length; j++) {
      results.push({
        name: chunk[j]!.name,
        version: chunk[j]!.version,
        vulns: parsed.results[j]?.vulns ?? [],
      });
    }
  }

  return results;
}
