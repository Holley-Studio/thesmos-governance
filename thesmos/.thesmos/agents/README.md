# Thesmos Agents

Add role-based agent files here. Each agent is a focused lens over Thesmos rules.

## How to add an agent

1. Create a Markdown file: `.thesmos/agents/<id>.md`
2. Add the `id` to the `agents` array in `.thesmos/registry.json`
3. Run `thesmos adapters` to inject the agent context into adapter files

## File format

```md
# <Agent Name>

## Purpose

What this agent focuses on.

## Rule focus

- rule_category_one
- rule_category_two

## Output

How this agent should format its findings.
```

## Built-in agents (Phase 3)

Future releases will ship built-in agents for common review roles.
See the Thesmos documentation for the current list.