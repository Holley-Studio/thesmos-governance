// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos secrets:vault — local secrets manager.
 *
 * Subcommands:
 *   secrets:vault init              Create vault + store master key in system keychain
 *   secrets:vault set <KEY> [VAL]   Encrypt and store a secret (prompts if VAL omitted)
 *   secrets:vault get <KEY>         Decrypt and print a secret value
 *   secrets:vault list              Print key names and timestamps (never values)
 *   secrets:vault delete <KEY>      Remove a secret from the vault
 *   secrets:vault inject            Print all secrets as export statements (for shell sourcing)
 *   secrets:vault destroy           Permanently delete vault + keychain entry
 */

import { createInterface } from 'node:readline';
import { parseArgs, flag } from '../lib/args.ts';
import {
  initVault,
  vaultExists,
  setSecret,
  getSecret,
  listSecrets,
  deleteSecret,
  getAllSecrets,
  destroyVault,
  VaultNotInitializedError,
  VaultKeyNotFoundError,
} from '../../vault.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(prompt);
    rl.question('', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

function requireVault(): void {
  if (!vaultExists()) {
    process.stderr.write('Vault not initialized. Run `thesmos secrets:vault init` first.\n');
    process.exit(1);
  }
}

// ── secrets:vault init ────────────────────────────────────────────────────────

function cmdVaultInit(json: boolean): void {
  const result = initVault();

  if (result.alreadyExists) {
    if (json) {
      process.stdout.write(JSON.stringify({ status: 'exists' }) + '\n');
    } else {
      console.log('  Vault already initialized. Run `thesmos secrets:vault list` to inspect.\n');
    }
    return;
  }

  if (json) {
    process.stdout.write(
      JSON.stringify({ status: 'created', warning: result.warning ?? null }) + '\n',
    );
  } else {
    console.log('\n  ✓ Vault initialized.\n');
    if (result.warning) {
      console.log(`  ⚠  ${result.warning}\n`);
    } else {
      const storage =
        process.platform === 'darwin'
          ? 'macOS Keychain'
          : process.platform === 'win32'
            ? 'Windows DPAPI'
            : 'Linux Secret Service';
      console.log(`  Master key stored in ${storage}.\n`);
    }
    console.log('  Get started:');
    console.log('    thesmos secrets:vault set OPENAI_API_KEY sk-...');
    console.log('    thesmos secrets:vault list\n');
  }
}

// ── secrets:vault set ─────────────────────────────────────────────────────────

async function cmdVaultSet(argv: string[], json: boolean): Promise<void> {
  requireVault();

  const { positionals } = parseArgs(argv);
  const key = positionals[0];
  let value = positionals[1];

  if (!key) {
    process.stderr.write('Usage: thesmos secrets:vault set <KEY> [VALUE]\n');
    process.exit(1);
  }

  if (!value) {
    value = await promptSecret(`Enter value for ${key}: `);
    if (!value) {
      process.stderr.write('Value cannot be empty.\n');
      process.exit(1);
    }
  }

  setSecret(key, value);

  if (json) {
    process.stdout.write(JSON.stringify({ status: 'ok', key }) + '\n');
  } else {
    console.log(`  ✓ ${key} stored.\n`);
  }
}

// ── secrets:vault get ─────────────────────────────────────────────────────────

function cmdVaultGet(argv: string[], json: boolean): void {
  requireVault();

  const { positionals } = parseArgs(argv);
  const key = positionals[0];
  if (!key) {
    process.stderr.write('Usage: thesmos secrets:vault get <KEY>\n');
    process.exit(1);
  }

  try {
    const value = getSecret(key);
    if (json) {
      process.stdout.write(JSON.stringify({ key, value }) + '\n');
    } else {
      // Print value directly with no trailing newline decoration — shell-script friendly
      process.stdout.write(value + '\n');
    }
  } catch (err) {
    if (err instanceof VaultKeyNotFoundError) {
      process.stderr.write(`  Not found: ${key}\n`);
      process.exit(1);
    }
    throw err;
  }
}

// ── secrets:vault list ────────────────────────────────────────────────────────

function cmdVaultList(json: boolean): void {
  requireVault();

  const secrets = listSecrets();

  if (json) {
    process.stdout.write(JSON.stringify(secrets) + '\n');
    return;
  }

  if (secrets.length === 0) {
    console.log('\n  Vault is empty. Add secrets with `thesmos secrets:vault set <KEY> <VALUE>`.\n');
    return;
  }

  console.log(`\n  ${secrets.length} secret${secrets.length === 1 ? '' : 's'} in vault:\n`);
  const longest = Math.max(...secrets.map((s) => s.key.length));
  for (const { key, updated } of secrets) {
    const pad = ' '.repeat(longest - key.length);
    const date = new Date(updated).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    console.log(`    ${key}${pad}   updated ${date}`);
  }
  console.log();
}

// ── secrets:vault delete ──────────────────────────────────────────────────────

function cmdVaultDelete(argv: string[], json: boolean): void {
  requireVault();

  const { positionals } = parseArgs(argv);
  const key = positionals[0];
  if (!key) {
    process.stderr.write('Usage: thesmos secrets:vault delete <KEY>\n');
    process.exit(1);
  }

  try {
    deleteSecret(key);
    if (json) {
      process.stdout.write(JSON.stringify({ status: 'deleted', key }) + '\n');
    } else {
      console.log(`  ✓ ${key} deleted.\n`);
    }
  } catch (err) {
    if (err instanceof VaultKeyNotFoundError) {
      process.stderr.write(`  Not found: ${key}\n`);
      process.exit(1);
    }
    throw err;
  }
}

// ── secrets:vault inject ──────────────────────────────────────────────────────

function cmdVaultInject(argv: string[], json: boolean): void {
  requireVault();

  const { flags } = parseArgs(argv);
  const printExport = flag(flags, 'export'); // --export: output `export KEY=VALUE` lines

  const secrets = getAllSecrets();
  const count = Object.keys(secrets).length;

  if (json) {
    // Returns keys only in JSON mode — never values in JSON output
    process.stdout.write(JSON.stringify({ injected: Object.keys(secrets), count }) + '\n');
    return;
  }

  if (count === 0) {
    console.log('\n  Vault is empty — nothing to inject.\n');
    return;
  }

  if (printExport) {
    // Shell-sourceable output: eval $(thesmos secrets:vault inject --export)
    for (const [key, value] of Object.entries(secrets)) {
      // Escape single quotes in value
      const escaped = value.replace(/'/g, "'\\''");
      process.stdout.write(`export ${key}='${escaped}'\n`);
    }
  } else {
    // Default: show keys only, instruct how to use
    console.log(`\n  ${count} secret${count === 1 ? '' : 's'} available.\n`);
    console.log('  To export to current shell:');
    console.log('    eval $(thesmos secrets:vault inject --export)\n');
    console.log('  Or use in a subprocess:');
    console.log('    thesmos secrets:vault inject --export > /tmp/secrets && source /tmp/secrets\n');
    console.log('  Keys:');
    for (const key of Object.keys(secrets)) {
      console.log(`    ${key}`);
    }
    console.log();
  }
}

// ── secrets:vault destroy ─────────────────────────────────────────────────────

async function cmdVaultDestroy(json: boolean): Promise<void> {
  if (!json) {
    const confirmed = await promptConfirm(
      '  ⚠  This will permanently delete the vault and all stored secrets.\n  Type "yes" to confirm: ',
    );
    if (!confirmed) {
      console.log('  Aborted.\n');
      return;
    }
  }

  destroyVault();

  if (json) {
    process.stdout.write(JSON.stringify({ status: 'destroyed' }) + '\n');
  } else {
    console.log('\n  ✓ Vault destroyed.\n');
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function cmdVault(subcommand: string, argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');

  try {
    switch (subcommand) {
      case 'init':    cmdVaultInit(json); break;
      case 'set':     await cmdVaultSet(argv, json); break;
      case 'get':     cmdVaultGet(argv, json); break;
      case 'list':    cmdVaultList(json); break;
      case 'delete':  cmdVaultDelete(argv, json); break;
      case 'inject':  cmdVaultInject(argv, json); break;
      case 'destroy': await cmdVaultDestroy(json); break;
      default:
        process.stderr.write(
          `Unknown subcommand: ${subcommand}\n` +
          `Usage: thesmos secrets:vault <init|set|get|list|delete|inject|destroy>\n`,
        );
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof VaultNotInitializedError) {
      process.stderr.write(`  ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
