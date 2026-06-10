/**
 * prometheus skill:create <name> — scaffold a new skill file in .prometheus/skills/
 *
 * Usage:
 *   prometheus skill:create "My Custom Skill"
 *   prometheus skill:create my-skill-id "My Custom Skill"
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
      'skill:create: missing <name>\nUsage: prometheus skill:create "<Skill Name>"\n'
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

  const skillsDir = join(root, '.prometheus', 'skills');
  mkdirSync(skillsDir, { recursive: true });

  const filePath = join(skillsDir, `${id}.md`);
  if (existsSync(filePath)) {
    process.stderr.write(
      `skill:create: file already exists: .prometheus/skills/${id}.md\n`
    );
    process.exit(1);
  }

  const content = buildSkillStub(id, name);
  writeFileSync(filePath, content, 'utf8');

  console.log(`skill:create — created .prometheus/skills/${id}.md`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Edit .prometheus/skills/${id}.md with your skill's workflow`);
  console.log(`  2. Add "${id}" to .prometheus/registry.json skills array`);
  console.log(`     (or run: prometheus catalog:enable ${id} skill)`);
  console.log('  3. Run: npm run prometheus:adapters  to regenerate adapter files');
}
