// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Publish the built desktop app to a release folder.
 *
 *   node scripts/publish-release.mjs --channel "<folder>" [--notes "What changed"]
 *
 * Run after `npm run desktop:build`. Packages `target/release` into
 * `Pantheon-<version>.zip`, writes `latest.json` beside it, and copies the
 * first-install files. The folder is normally inside Google Drive for desktop,
 * so every studio PC that follows it is offered the update on its next launch.
 *
 * Order matters: the package is written and verified before the manifest names
 * it, so a PC that reads the folder mid-publish sees the previous release, never
 * a manifest pointing at a half-written file.
 *
 * Whoever can write to the release folder can ship code to every PC following
 * it. Keep it owner-writable only.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function fail(message) { console.error(`[publish] ${message}`); process.exit(1); }

const channel = option('--channel');
if (!channel || !isAbsolute(channel)) fail('Pass --channel with the absolute path of the release folder.');
const notes = (option('--notes') ?? '').slice(0, 4000);

const version = JSON.parse(readFileSync(join(appDir, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version)) fail(`tauri.conf.json version "${version}" must be major.minor.patch.`);

const release = join(appDir, 'src-tauri', 'target', 'release');
const shell = join(release, 'thesmos-desktop.exe');
// Staged by scripts/build-sidecar.mjs. Tauri's "resources/*" glob copies only
// top-level files into target/release, so the agent catalog must come from here.
const resources = join(appDir, 'src-tauri', 'resources');
for (const required of [shell, join(resources, 'thesmos-runtime.exe'), join(resources, 'Install-Pantheon.ps1'), join(resources, 'catalog', 'holdbacks.json')]) {
  if (!existsSync(required)) fail(`Missing ${required}. Run "npm run desktop:build" first.`);
}

mkdirSync(channel, { recursive: true });
const manifestPath = join(channel, 'latest.json');
if (existsSync(manifestPath)) {
  const published = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
  const order = (v) => String(v).split('.').map(Number);
  const [a, b] = [order(version), order(published)];
  const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
  // Installed apps only move forward, so republishing an old number would be ignored by them.
  if (!newer) fail(`Version ${version} is not newer than the published ${published}. Raise the version in src-tauri/tauri.conf.json.`);
}

const stage = join(tmpdir(), `pantheon-release-${process.pid}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyFileSync(shell, join(stage, 'Pantheon.exe'));
// runtime.cjs is only written when sealing fails; a leftover copy is stale code.
cpSync(resources, join(stage, 'resources'), { recursive: true, filter: (source) => !source.endsWith('runtime.cjs') });

const packageName = `Pantheon-${version}.zip`;
const localZip = join(tmpdir(), `${packageName}.${process.pid}`);
rmSync(localZip, { force: true });
// bsdtar ships with Windows and writes a standard zip that Expand-Archive reads.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-c', '-f', localZip, '--format', 'zip', '-C', stage, 'Pantheon.exe', 'resources'], { stdio: 'inherit' });

function sha256(file) {
  return new Promise((done, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', () => done(hash.digest('hex'))).on('error', reject);
  });
}
const digest = await sha256(localZip);
const size = statSync(localZip).size;

const target = join(channel, packageName);
copyFileSync(localZip, `${target}.partial`);
if ((await sha256(`${target}.partial`)) !== digest) fail('The package did not copy to the release folder intact.');
rmSync(target, { force: true });
renameSync(`${target}.partial`, target);

copyFileSync(join(here, 'Install-Pantheon.ps1'), join(channel, 'Install-Pantheon.ps1'));
copyFileSync(join(here, 'Install Pantheon.cmd'), join(channel, 'Install Pantheon.cmd'));

const manifest = { schema: 1, product: 'Pantheon', version, package: packageName, sha256: digest, size, notes, publishedAt: new Date().toISOString() };
writeFileSync(`${manifestPath}.partial`, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
rmSync(manifestPath, { force: true });
renameSync(`${manifestPath}.partial`, manifestPath);

rmSync(stage, { recursive: true, force: true });
rmSync(localZip, { force: true });
console.log(`[publish] Pantheon ${version} published to ${channel}`);
console.log(`[publish] ${packageName}  ${(size / 1048576).toFixed(1)} MB  sha256 ${digest}`);
