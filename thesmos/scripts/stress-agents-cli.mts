#!/usr/bin/env tsx
/**
 * CLI stress harness for federated agents commands.
 * Run: npx tsx thesmos/scripts/stress-agents-cli.mts
 */
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(tmpdir(), `thesmos-cli-stress-${Date.now()}`);
mkdirSync(root, { recursive: true });
mkdirSync(join(root, '.thesmos'), { recursive: true });
mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cli-stress' }));
writeFileSync(
  join(root, '.thesmos', 'config.json'),
  JSON.stringify({ version: '1.0.0', project: 'cli-stress' }),
);
writeFileSync(
  join(root, '.thesmos', 'registry.json'),
  JSON.stringify({ rules: [], agents: [], skills: [] }),
);
writeFileSync(
  join(root, '.claude', 'agents', 'mine.md'),
  '---\nid: mine\nname: Mine\n---\n\n# Mine\n',
);
writeFileSync(
  join(root, '.claude', 'agents', 'zeus-executive-agent.md'),
  '---\nid: zeus-executive-agent\nname: Collision Zeus\n---\n\n# Collision\n',
);

const cli = join(process.cwd(), 'thesmos', 'bin', 'cli.ts');
let failed = 0;

function run(args: string[]): { code: number | null; out: string } {
  const r = spawnSync('npx', ['tsx', cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const adoptMissing = run(['agent:adopt', '.claude/agents/nope.md', '--no-sync']);
check('adopt missing exits nonzero', (adoptMissing.code ?? 0) !== 0, `code=${adoptMissing.code}`);

const adoptOk = run(['agent:adopt', '.claude/agents/mine.md', '--no-sync']);
check(
  'adopt ok copies to .thesmos/agents',
  adoptOk.code === 0 &&
    existsSync(join(root, '.thesmos', 'agents', 'mine.md')) &&
    existsSync(join(root, '.claude', 'agents', 'mine.md')),
  adoptOk.out.slice(0, 200),
);

const adoptDup = run(['agent:adopt', '.claude/agents/mine.md', '--no-sync']);
check('adopt duplicate without force fails', (adoptDup.code ?? 0) !== 0, `code=${adoptDup.code}`);

const adoptForce = run(['agent:adopt', '.claude/agents/mine.md', '--force', '--no-sync']);
check('adopt --force ok', adoptForce.code === 0, `code=${adoptForce.code}`);

const listAll = run(['agents:list', '--all', '--json']);
check(
  'agents:list --all json includes mine',
  listAll.code === 0 && listAll.out.includes('"agents"') && listAll.out.includes('mine'),
  listAll.out.slice(0, 200),
);

const doctor = run(['agents:doctor', '--json']);
check(
  'agents:doctor json succeeds on healthy project',
  doctor.code === 0 && doctor.out.includes('"findings"'),
  `code=${doctor.code}`,
);

const conflicts = run(['agents:conflicts', '--json']);
check(
  'agents:conflicts detects zeus collision or lists without crash',
  conflicts.code === 0 && conflicts.out.includes('"conflicts"'),
  conflicts.out.slice(0, 200),
);

// Project zeus shadows pantheon id once pantheon is installed; without pantheon install,
// we still expect the external project file to be discoverable.
check(
  'agents:list sees project zeus-executive-agent',
  listAll.out.includes('zeus-executive-agent'),
);

const releaseMissing = run(['agent:release', 'does-not-exist']);
check('release missing fails', (releaseMissing.code ?? 0) !== 0);

const releaseOk = run(['agent:release', 'mine']);
check(
  'release without --delete preserves canonical file',
  releaseOk.code === 0 && existsSync(join(root, '.thesmos', 'agents', 'mine.md')),
  `code=${releaseOk.code}`,
);

// Re-adopt then release --delete
writeFileSync(
  join(root, '.claude', 'agents', 'mine.md'),
  '---\nid: mine\nname: Mine\n---\n\n# Mine\n',
);
const readopt = run(['agent:adopt', '.claude/agents/mine.md', '--force', '--no-sync']);
check('re-adopt after release', readopt.code === 0);
const relDel = run(['agent:release', 'mine', '--delete']);
check(
  'release --delete removes canonical managed file',
  relDel.code === 0 && !existsSync(join(root, '.thesmos', 'agents', 'mine.md')),
  `code=${relDel.code} exists=${existsSync(join(root, '.thesmos', 'agents', 'mine.md'))}`,
);

const adoptCollision = run([
  'agent:adopt',
  '.claude/agents/zeus-executive-agent.md',
  '--no-sync',
]);
check('adopt collision-named agent still succeeds', adoptCollision.code === 0);

const travMissing = run(['agent:adopt', '../definitely-missing-outside.md', '--no-sync']);
check('adopt missing outside path fails', (travMissing.code ?? 0) !== 0);

writeFileSync(join(root, '.thesmos', 'managed-agents.json'), '{not-json');
const doctorCorrupt = run(['agents:doctor', '--json']);
check(
  'doctor reports corrupt manifest as error',
  (doctorCorrupt.code ?? 0) !== 0 && doctorCorrupt.out.includes('manifest_invalid'),
  `code=${doctorCorrupt.code} out=${doctorCorrupt.out.slice(0, 240)}`,
);

writeFileSync(
  join(root, '.thesmos', 'managed-agents.json'),
  JSON.stringify({
    version: 1,
    files: {
      '../../../tmp/evil.md': {
        owner: 'thesmos',
        source: 'pantheon',
        agentId: 'evil',
        hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    },
  }),
);
const doctorTrav = run(['agents:doctor', '--json']);
check(
  'doctor does not crash on traversal manifest keys',
  (doctorTrav.code ?? 0) !== 0 && doctorTrav.out.includes('manifest_invalid'),
  `code=${doctorTrav.code}`,
);
const listTrav = run(['agents:list', '--json']);
check(
  'list does not crash on traversal manifest keys',
  listTrav.code === 0 && listTrav.out.includes('"agents"'),
  `code=${listTrav.code}`,
);

const listCorrupt = run(['agents:list', '--json']);
check(
  'list soft-handles corrupt manifest (still exits 0)',
  listCorrupt.code === 0 && listCorrupt.out.includes('"agents"'),
  `code=${listCorrupt.code}`,
);

// Recover
writeFileSync(
  join(root, '.thesmos', 'managed-agents.json'),
  JSON.stringify({ version: 1, files: {}, updatedAt: new Date().toISOString() }, null, 2),
);

const doctorStrict = run(['agents:doctor', '--strict', '--json']);
// May exit 2 if warnings remain (e.g. registry inconsistency) — must not crash
check(
  'doctor --strict exits 0/1/2 without crash',
  doctorStrict.code === 0 || doctorStrict.code === 1 || doctorStrict.code === 2,
  `code=${doctorStrict.code}`,
);

console.log(`\nTemp root kept until exit: ${root}`);
console.log(failed === 0 ? '\nAll CLI stress checks passed.' : `\n${failed} CLI stress check(s) failed.`);
rmSync(root, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
