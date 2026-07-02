// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Local secrets vault — AES-256-GCM encrypted, key stored in the system keychain.
 *
 * Vault file: ~/.thesmos/vault.json
 * Master key storage:
 *   macOS   — Keychain (security CLI, always available)
 *   Linux   — secret-tool (libsecret) if available, otherwise ~/.thesmos/vault.key (chmod 600)
 *   Windows — DPAPI via PowerShell (user-account-bound encryption)
 *
 * Design guarantees:
 *   - Secret values are never written to disk unencrypted
 *   - Key names are stored as plaintext (they are not sensitive)
 *   - Vault file is never transmitted anywhere
 *   - All operations are synchronous (CLI context — no async event loop needed)
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// ── Constants ─────────────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE = 'thesmos-vault';
const KEYCHAIN_ACCOUNT = 'thesmos-governance';
const VAULT_VERSION = 1;

function thesmosDir(): string {
  return join(homedir(), '.thesmos');
}

function vaultPath(): string {
  return join(thesmosDir(), 'vault.json');
}

function fallbackKeyPath(): string {
  return join(thesmosDir(), 'vault.key');
}

// ── Vault schema ──────────────────────────────────────────────────────────────

interface VaultEntry {
  /** base64(iv[12] + ciphertext + authTag[16]) */
  data: string;
  created: string;
  updated: string;
}

interface VaultFile {
  version: typeof VAULT_VERSION;
  entries: Record<string, VaultEntry>;
}

// ── Encryption ────────────────────────────────────────────────────────────────

function encryptValue(masterKey: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

function decryptValue(masterKey: Buffer, data: string): string {
  const buf = Buffer.from(data, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ── Key management ────────────────────────────────────────────────────────────

function getMasterKey(): Buffer {
  const stored = loadKeyFromKeychain();
  if (stored) return stored;
  throw new VaultNotInitializedError();
}

function getOrCreateMasterKey(): { key: Buffer; created: boolean; warning?: string } {
  const stored = loadKeyFromKeychain();
  if (stored) return { key: stored, created: false };

  const key = randomBytes(32);
  const warning = storeKeyInKeychain(key);
  return { key, created: true, warning };
}

function loadKeyFromKeychain(): Buffer | null {
  try {
    if (process.platform === 'darwin') {
      const hex = execSync(
        `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w 2>/dev/null`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      if (hex.length === 64) return Buffer.from(hex, 'hex');
    } else if (process.platform === 'linux') {
      if (isSecretToolAvailable()) {
        const hex = execSync(
          `secret-tool lookup service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}" 2>/dev/null`,
          { stdio: ['pipe', 'pipe', 'pipe'] },
        ).toString().trim();
        if (hex.length === 64) return Buffer.from(hex, 'hex');
      } else {
        return loadKeyFromFile();
      }
    } else if (process.platform === 'win32') {
      return loadKeyDpapi();
    }
  } catch {
    // Fall through — key not found yet
  }
  return null;
}

function storeKeyInKeychain(key: Buffer): string | undefined {
  const hex = key.toString('hex');
  try {
    if (process.platform === 'darwin') {
      execSync(
        `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${hex}" -U`,
        { stdio: 'pipe' },
      );
    } else if (process.platform === 'linux') {
      if (isSecretToolAvailable()) {
        execSync(
          `echo -n "${hex}" | secret-tool store --label="Thesmos Vault Key" service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}"`,
          { stdio: 'pipe' },
        );
      } else {
        storeKeyToFile(key);
        return 'libsecret not available — vault key stored in ~/.thesmos/vault.key (chmod 600). Enable full disk encryption for best protection.';
      }
    } else if (process.platform === 'win32') {
      storeKeyDpapi(key);
    }
  } catch {
    // Keychain write failed — fall back to file
    storeKeyToFile(key);
    return 'Keychain write failed — vault key stored in ~/.thesmos/vault.key (chmod 600).';
  }
  return undefined;
}

function isSecretToolAvailable(): boolean {
  try {
    execSync('which secret-tool', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function loadKeyFromFile(): Buffer | null {
  const path = fallbackKeyPath();
  if (!existsSync(path)) return null;
  try {
    const hex = readFileSync(path, 'utf8').trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex');
  } catch { /* ignore */ }
  return null;
}

function storeKeyToFile(key: Buffer): void {
  mkdirSync(thesmosDir(), { recursive: true });
  const path = fallbackKeyPath();
  writeFileSync(path, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best-effort */ }
}

function loadKeyDpapi(): Buffer | null {
  const path = fallbackKeyPath();
  if (!existsSync(path)) return null;
  try {
    const encrypted = readFileSync(path, 'utf8').trim();
    const hex = execSync(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.Security; $enc=[Convert]::FromBase64String('${encrypted}'); $ent=[Text.Encoding]::UTF8.GetBytes('thesmos-vault'); $dec=[Security.Cryptography.ProtectedData]::Unprotect($enc,$ent,'CurrentUser'); [Convert]::ToHexString($dec).ToLower()"`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ).toString().trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex');
  } catch { /* ignore */ }
  return null;
}

function storeKeyDpapi(key: Buffer): void {
  mkdirSync(thesmosDir(), { recursive: true });
  const hex = key.toString('hex');
  const encrypted = execSync(
    `powershell -NoProfile -Command "Add-Type -AssemblyName System.Security; $raw=[Convert]::FromHexString('${hex}'); $ent=[Text.Encoding]::UTF8.GetBytes('thesmos-vault'); $enc=[Security.Cryptography.ProtectedData]::Protect($raw,$ent,'CurrentUser'); [Convert]::ToBase64String($enc)"`,
    { stdio: ['pipe', 'pipe', 'pipe'] },
  ).toString().trim();
  writeFileSync(fallbackKeyPath(), encrypted, { encoding: 'utf8', mode: 0o600 });
}

// ── Vault I/O ─────────────────────────────────────────────────────────────────

function readVault(): VaultFile {
  const path = vaultPath();
  if (!existsSync(path)) {
    return { version: VAULT_VERSION, entries: {} };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as VaultFile;
  } catch {
    throw new Error(`Vault file at ${path} is corrupt. Run 'thesmos secrets:vault destroy' to reset.`);
  }
}

function writeVault(vault: VaultFile): void {
  mkdirSync(thesmosDir(), { recursive: true });
  const path = vaultPath();
  writeFileSync(path, JSON.stringify(vault, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best-effort */ }
}

// ── Error types ───────────────────────────────────────────────────────────────

export class VaultNotInitializedError extends Error {
  constructor() {
    super('Vault not initialized. Run `thesmos secrets:vault init` first.');
    this.name = 'VaultNotInitializedError';
  }
}

export class VaultKeyNotFoundError extends Error {
  constructor(key: string) {
    super(`Secret '${key}' not found in vault.`);
    this.name = 'VaultKeyNotFoundError';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SecretMeta {
  key: string;
  created: string;
  updated: string;
}

/**
 * Initialize the vault: generate a master key and store it in the system keychain.
 * Safe to call on an already-initialized vault (no-op if key exists).
 * Returns a warning string if the key had to fall back to file storage.
 */
export function initVault(): { alreadyExists: boolean; warning?: string } {
  const { created, warning } = getOrCreateMasterKey();
  if (!created) return { alreadyExists: true };
  // Ensure vault file exists
  if (!existsSync(vaultPath())) {
    writeVault({ version: VAULT_VERSION, entries: {} });
  }
  return { alreadyExists: false, warning };
}

/** Returns true if the vault has been initialized (key exists in keychain). */
export function vaultExists(): boolean {
  return loadKeyFromKeychain() !== null;
}

/**
 * Store or update a secret in the vault.
 * The value is encrypted with AES-256-GCM before writing to disk.
 */
export function setSecret(key: string, value: string): void {
  const masterKey = getMasterKey();
  const vault = readVault();
  const now = new Date().toISOString();
  vault.entries[key] = {
    data: encryptValue(masterKey, value),
    created: vault.entries[key]?.created ?? now,
    updated: now,
  };
  writeVault(vault);
}

/**
 * Retrieve and decrypt a secret by name.
 * Throws VaultKeyNotFoundError if the key doesn't exist.
 */
export function getSecret(key: string): string {
  const masterKey = getMasterKey();
  const vault = readVault();
  const entry = vault.entries[key];
  if (!entry) throw new VaultKeyNotFoundError(key);
  return decryptValue(masterKey, entry.data);
}

/**
 * Returns all stored key names with metadata. Values are never returned.
 */
export function listSecrets(): SecretMeta[] {
  const vault = readVault();
  return Object.entries(vault.entries).map(([key, entry]) => ({
    key,
    created: entry.created,
    updated: entry.updated,
  }));
}

/**
 * Delete a secret from the vault.
 * Throws VaultKeyNotFoundError if the key doesn't exist.
 */
export function deleteSecret(key: string): void {
  const masterKey = getMasterKey(); // validates vault is initialized
  void masterKey;
  const vault = readVault();
  if (!vault.entries[key]) throw new VaultKeyNotFoundError(key);
  delete vault.entries[key];
  writeVault(vault);
}

/**
 * Decrypt and return all secrets as a key/value Record suitable for env injection.
 * Caller is responsible for not logging the returned object.
 */
export function getAllSecrets(): Record<string, string> {
  const masterKey = getMasterKey();
  const vault = readVault();
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(vault.entries)) {
    try {
      result[key] = decryptValue(masterKey, entry.data);
    } catch {
      // Skip corrupt entries rather than crashing inject
    }
  }
  return result;
}

/**
 * Destroy the vault: remove vault.json and the keychain entry.
 * This is irreversible.
 */
export function destroyVault(): void {
  // Remove keychain entry
  try {
    if (process.platform === 'darwin') {
      execSync(
        `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" 2>/dev/null || true`,
        { stdio: 'pipe' },
      );
    } else if (process.platform === 'linux' && isSecretToolAvailable()) {
      execSync(
        `secret-tool clear service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}" 2>/dev/null || true`,
        { stdio: 'pipe' },
      );
    }
  } catch { /* best-effort */ }

  // Remove vault files
  const vaultFile = vaultPath();
  const keyFile = fallbackKeyPath();
  if (existsSync(vaultFile)) {
    try { unlinkSync(vaultFile); } catch { /* ignore */ }
  }
  if (existsSync(keyFile)) {
    try { unlinkSync(keyFile); } catch { /* ignore */ }
  }
}
