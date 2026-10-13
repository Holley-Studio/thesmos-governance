import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,statSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {StudioStore} from '../sidecar/studio/store.ts';

// Regression: the runtime exits without closing the store, so without an
// explicit checkpoint studio.sqlite stayed at its empty size and every write
// lived only in studio.sqlite-wal.
test('a checkpoint folds the write-ahead log into the database file while the store stays open', () => {
 const dir = mkdtempSync(join(tmpdir(), 'pantheon-store-close-'));
 try {
  const store = new StudioStore(dir);
  for (let i = 0; i < 200; i++) store.event('fixture', `event ${i} ${'x'.repeat(200)}`);
  const wal = join(dir, 'studio.sqlite-wal');
  assert.ok(statSync(wal).size > 0, 'fixture should have produced write-ahead data');
  store.checkpoint();
  assert.ok(!existsSync(wal) || statSync(wal).size === 0, 'write-ahead log still holds data after the checkpoint');
  // The database file alone must carry the work, as a file-copy backup would see it.
  const copyDir = join(dir, 'copy'); mkdirSync(copyDir);
  copyFileSync(join(dir, 'studio.sqlite'), join(copyDir, 'studio.sqlite'));
  const copy = new DatabaseSync(join(copyDir, 'studio.sqlite'));
  try { assert.equal(Number(copy.prepare("SELECT COUNT(*) AS n FROM events WHERE body LIKE '%fixture%'").get()?.n), 200); }
  finally { copy.close(); }
  store.close();
 } finally { rmSync(dir, {recursive: true, force: true}); }
});
