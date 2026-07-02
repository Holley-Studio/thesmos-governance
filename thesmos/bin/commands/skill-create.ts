// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos skill:create <name> — scaffold a new skill file in .thesmos/skills/
 *
 * Usage:
 *   thesmos skill:create "My Custom Skill"
 *   thesmos skill:create my-skill-id "My Custom Skill"
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs } from '../lib/args.ts';
import { buildSkillStub } from '../../catalog.ts';

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export async function cmdSkillCreate(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { positionals } = parseArgs(argv);

  let id: string;
  let name: string;

  if (positionals.length === 0) {
    process.stderr.write(
      'skill:create: missing <name>\nUsage: thesmos skill:create "<Skill Name>"\n'
    );
    process.exit(1);
  }

  if (positionals.length === 1) {
    name = positionals[0];
    id = toKebabCase(name);
  } else {
    id = toKebabCase(positionals[0]);
    name = positionals[1];
  }

  if (!/^[a-z0-9-]+$/.test(id)) {
    process.stderr.write(
      `skill:create: invalid id "${id}" — must be lowercase kebab-case\n`
    );
    process.exit(1);
  }

  const skillsDir = join(root, '.thesmos', 'skills');
  mkdirSync(skillsDir, { recursive: true });

  const filePath = join(skillsDir, `${id}.md`);
  if (existsSync(filePath)) {
    process.stderr.write(
      `skill:create: file already exists: .thesmos/skills/${id}.md\n`
    );
    process.exit(1);
  }

  const content = buildSkillStub(id, name);
  writeFileSync(filePath, content, 'utf8');

  console.log(`skill:create — created .thesmos/skills/${id}.md`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Edit .thesmos/skills/${id}.md with your skill's workflow`);
  console.log(`  2. Add "${id}" to .thesmos/registry.json skills array`);
  console.log(`     (or run: thesmos catalog:enable ${id} skill)`);
  console.log('  3. Run: npm run thesmos:adapters  to regenerate adapter files');
}
