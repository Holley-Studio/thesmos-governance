# Thesmos Skills

Add reusable workflow skill files here. Skills guide AI tools through repeatable tasks.

## How to add a skill

1. Create a Markdown file: `.thesmos/skills/<id>.md`
2. Add the `id` to the `skills` array in `.thesmos/registry.json`

## File format

```md
# <Skill Name>

## Use when

Describe the situation where this skill applies.

## Inputs

- .thesmos/report.json
- .thesmos/GUARDRAILS.md

## Process

1. Step one.
2. Step two.
```

## Built-in skills (Phase 4)

Future releases will ship built-in skills for common review workflows.