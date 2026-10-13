import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { MemoryStore } from './store.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('memory concurrent processes', () => {
  it('retains every successful write from six real local processes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mnemosyne parallel '));
    roots.push(root);
    const script = join(root, 'writer.mjs');
    const storeUrl = new URL('./store.ts', import.meta.url).href;
    const tsxUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    writeFileSync(
      script,
      `
import {MemoryStore,MemoryStoreBusyError} from ${JSON.stringify(storeUrl)};
const store=new MemoryStore(process.argv[2]);
for(let n=0;n<12;n++) {
  const deadline=Date.now()+10000;
  for(;;) {
    try {
      store.append({scope:'repository',type:'observation',content:process.argv[3]+':'+n,provenance:{sourceKind:'user',creator:'fixture',derivation:'stated'},confidence:'high',sensitivity:'project',metadata:{}});
      break;
    } catch(error) {
      if(!(error instanceof MemoryStoreBusyError)||Date.now()>deadline)throw error;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
  }
}
`,
      'utf8'
    );
    const writers = await Promise.allSettled(
      Array.from(
        { length: 6 },
        (_, index) =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              ['--import', tsxUrl, script, root, String(index)],
              { windowsHide: true, timeout: 20000, stdio: ['ignore', 'ignore', 'pipe'] }
            );
            let stderr = '';
            child.stderr.on('data', (chunk) => {
              stderr += String(chunk);
            });
            child.on('error', reject);
            child.on('exit', (code) =>
              code === 0
                ? resolve()
                : reject(new Error(`Memory fixture writer failed (${code}): ${stderr}`))
            );
          })
      )
    );
    for (const writer of writers) if (writer.status === 'rejected') throw writer.reason;
    const loaded = new MemoryStore(root).load();
    expect(loaded.corruptLines).toEqual([]);
    expect(loaded.records).toHaveLength(72);
    expect(new Set(loaded.records.map((record) => record.content)).size).toBe(72);
  }, 30000);
});
