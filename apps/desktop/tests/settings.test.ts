import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SettingsStore,DEFAULT_SETTINGS,DEFAULT_PORTAL_URL,validatePortalUrl} from '../sidecar/studio/settings.ts';
import {LOCAL_OLLAMA,validateOllamaEndpoint,setOllamaEndpoint,ollamaOrigin,ollamaUrl,ollamaPolicy,ollamaIsLocal} from '../sidecar/studio/ollama-endpoint.ts';
import {authorizeEndpointEgress} from '../../../thesmos/runtime/governance.ts';

function store(run: (s: SettingsStore, dir: string) => void): void {
 const dir = mkdtempSync(join(tmpdir(), 'pantheon-settings-'));
 try { run(new SettingsStore(dir), dir); } finally { rmSync(dir, {recursive: true, force: true}); }
}

test('a PC with no settings file reads the defaults, and nothing is written by reading', () => store((s, dir) => {
 assert.deepEqual(s.read(), DEFAULT_SETTINGS);
 assert.equal(existsSync(join(dir, 'settings.json')), false);
}));

test('saving changes only what was sent and survives a restart', () => store((s, dir) => {
 const saved = s.update({displayName: '  Marcus Lee ', preferredWorker: 'claude', ollamaEndpoint: 'http://192.168.0.160:11434/'});
 assert.equal(saved.displayName, 'Marcus Lee'); assert.equal(saved.preferredWorker, 'claude');
 assert.equal(saved.ollamaEndpoint, 'http://192.168.0.160:11434');
 assert.equal(saved.studioName, DEFAULT_SETTINGS.studioName); assert.equal(saved.portalUrl, DEFAULT_PORTAL_URL);
 assert.deepEqual(new SettingsStore(dir).read(), saved);
}));

test('an unknown key or a bad value is refused and nothing is written', () => store((s, dir) => {
 for (const patch of [{apiKey: 'x'}, {__proto__: {x: 1}, constructor: 'x'}, {preferredWorker: 'gpt-9'}, {displayName: ''}, {displayName: 'A<script>'}, {displayName: 'x'.repeat(61)},
  {ollamaEndpoint: 'http://8.8.8.8:11434'}, {portalUrl: 'http://portal.holley.studio'}, {displayName: 'Ok', portalUrl: 'javascript:alert(1)'}, {}, null, [], 'x']) {
  assert.throws(() => s.update(patch), Error, JSON.stringify(patch));
 }
 assert.equal(existsSync(join(dir, 'settings.json')), false);
}));

test('a damaged or hand-edited file never breaks startup: bad values read as defaults', () => store((s, dir) => {
 writeFileSync(join(dir, 'settings.json'), '\uFEFF' + JSON.stringify({displayName: 'Dana', ollamaEndpoint: 'https://evil.example', portalUrl: 'ftp://x', preferredWorker: 7, extra: 'ignored'}));
 const read = s.read();
 assert.equal(read.displayName, 'Dana'); assert.equal(read.ollamaEndpoint, LOCAL_OLLAMA);
 assert.equal(read.portalUrl, DEFAULT_PORTAL_URL); assert.equal(read.preferredWorker, 'playbook');
 assert.equal('extra' in read, false);
 writeFileSync(join(dir, 'settings.json'), '{ not json');
 assert.deepEqual(s.read(), DEFAULT_SETTINGS);
 // Saving over a damaged file repairs it.
 s.update({studioName: 'North Studio'});
 assert.equal(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).studioName, 'North Studio');
}));

test('the Ollama address is this PC or a private-network address, never a public or named host', () => {
 for (const ok of ['http://127.0.0.1:11434', 'http://192.168.0.160:11434', 'http://10.0.0.5:8080', 'http://172.16.4.2:11434', 'http://172.31.255.1:11434', 'http://100.85.195.107:11434']) assert.equal(validateOllamaEndpoint(ok), ok);
 assert.equal(validateOllamaEndpoint(''), LOCAL_OLLAMA);
 for (const bad of ['http://8.8.8.8:11434', 'http://172.32.0.1:11434', 'http://100.128.0.1:11434', 'http://192.169.0.1:11434', 'https://192.168.0.1:11434', 'http://192.168.0.1', 'http://192.168.0.1:0',
  'http://192.168.0.1:99999', 'http://ollama.example.com:11434', 'http://localhost:11434', 'http://192.168.0.1:11434/api', 'http://user:pw@192.168.0.1:11434', 'http://256.1.1.1:11434',
  'http://192.168.0.1:11434?x=1', 'http://[::1]:11434', 'http://0300.0250.0.1:11434', 42, null]) assert.throws(() => validateOllamaEndpoint(bad), Error, String(bad));
});

test('a network Ollama address is authorised for exactly that machine and nothing else', () => {
 try {
  setOllamaEndpoint('http://192.168.0.160:11434');
  assert.equal(ollamaOrigin(), 'http://192.168.0.160:11434'); assert.equal(ollamaUrl('/api/tags'), 'http://192.168.0.160:11434/api/tags'); assert.equal(ollamaIsLocal(), false);
  assert.equal(authorizeEndpointEgress(ollamaOrigin(), ollamaPolicy()).permitted, true);
  assert.equal(authorizeEndpointEgress('http://192.168.0.161:11434', ollamaPolicy()).permitted, false);
  assert.equal(authorizeEndpointEgress('https://api.openai.com', ollamaPolicy()).permitted, false);
  // Without the policy the core still refuses it: the setting, not a default, grants the access.
  assert.equal(authorizeEndpointEgress(ollamaOrigin(), undefined).permitted, false);
  setOllamaEndpoint('https://evil.example');
  assert.equal(ollamaOrigin(), LOCAL_OLLAMA, 'an invalid saved address must fall back to this PC');
 } finally { setOllamaEndpoint(''); }
 assert.equal(ollamaIsLocal(), true); assert.equal(ollamaPolicy(), undefined);
});

test('the portal address must be plain https', () => {
 assert.equal(validatePortalUrl('https://portal.example.studio/portal'), 'https://portal.example.studio/portal');
 assert.equal(validatePortalUrl(''), DEFAULT_PORTAL_URL);
 for (const bad of ['http://portal.example.studio', 'https://user:pw@portal.example.studio', 'file:///C:/Windows', 'https://localhost', 'javascript:alert(1)', 'https://portal.example.studio/a b', 'not a url', 5])
  assert.throws(() => validatePortalUrl(bad), Error, String(bad));
});
