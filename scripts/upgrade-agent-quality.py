#!/usr/bin/env python3
"""
Bulk upgrade Thesmos Pantheon catalog agents to 26/26 quality.
Adds Anti-Drift Protocol + Operating Doctrine to agents missing them.
Skips reviewers/, figma/, and files already containing the sections.
"""
import os
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.resolve()
CATALOG_ROOT = (REPO_ROOT / "thesmos" / "catalog" / "agents").resolve()

def safe_open(path: Path, base: Path, mode: str = "r"):
    """Resolve path and assert it stays under base to prevent traversal."""
    resolved = path.resolve()
    assert resolved.is_relative_to(base), f"Path traversal attempt: {path}"
    return resolved.open(mode, encoding="utf-8")

def get_agent_files():
    dirs = [CATALOG_ROOT, CATALOG_ROOT / "pantheon"]
    files = []
    for d in dirs:
        for f in sorted(d.iterdir()):
            if f.suffix == ".md" and not f.name.endswith("-README.md"):
                files.append(f)
    return files

def parse_identity(content: str):
    emoji_m = re.search(r'^emoji:\s*["\']?([^\s"\']+)', content, re.M)
    emoji = emoji_m.group(1) if emoji_m else "⚡"

    name_m = re.search(r'^name:\s*["\']?(?:God Agent )?(\w+)', content, re.M)
    name = name_m.group(1).strip("\"'") if name_m else None

    domain_m = re.search(r'[^\n]*— ([A-Z][A-Z ,&/\-]+)\n```', content)
    if domain_m:
        domain = domain_m.group(1).strip()
    else:
        title_m = re.search(r'^# .* — (.+)$', content, re.M)
        domain = title_m.group(1).upper() if title_m else (f"{name.upper()} SPECIALIST" if name else "SPECIALIST")

    def title_case_domain(d):
        words = d.lower().split()
        stop = {'and', 'or', 'of', 'the', 'for', 'in', 'at'}
        caps = [w if w in stop else w.capitalize() for w in words]
        result = ' '.join(caps)
        for abbr in ['Cx', 'Ux', 'Seo', 'Sql', 'Crm', 'Ai ']:
            result = result.replace(abbr, abbr.upper())
        return result

    domain_title = title_case_domain(domain)

    rules_m = re.findall(r'\[([A-Z]+_\d+)\]', content)
    seen, rules = set(), []
    for r in rules_m:
        if r not in seen:
            seen.add(r)
            rules.append(r)
        if len(rules) >= 4:
            break
    rules_str = " ✅ | ".join(rules) + " ✅" if rules else "no applicable rules this response"

    return emoji, name, domain, domain_title, rules_str

def make_anti_drift(emoji, name, domain_title, rules_str):
    du = domain_title.upper()
    return f"""
## Anti-Drift Protocol

These rules keep your identity intact across the entire conversation:

**1. Banner cadence is deterministic.** Full banner on your first response and on any
domain shift. Compact banner otherwise: `{emoji} {name}:` → substance → `— {name} | {domain_title}`.
The banner may include a state line: `{emoji} {name.upper()} — {du} · [phase] · [status]`.
It never disappears.

**2. Never break character — with one exception.** Never say "As an AI", "I'm a language
model", or any variant. You are {name}. If asked what you are: "I am {name},
{domain_title} of the Thesmos Pantheon." EXCEPTION: if the user explicitly asks you to drop
the persona or answer plainly, comply for that one message, then resume with the
re-anchor line below. A persona the user cannot switch off is a toy; user control is trust.

**3. Concede facts instantly; hold judgments.** Concede factual errors immediately and
without ceremony. Hold your recommendations unless new evidence arrives — never reverse
merely because the user pushed back. When holding your position, state what evidence
WOULD change your recommendation.

**4. No filler.** Never open with "Great question!", "Certainly!", "I'd be happy to…",
or "That's a great point." Substance first, always.

**5. Scripted re-anchor.** If any prior response lacked your banner, open the next one with:
"The mist clears. {emoji} {name.upper()} — {du} resumes the watch." Then continue.

**6. Honest badges only.** Your closing `Thesmos check:` line lists ONLY rules you
actually assessed in that response — your named scope is {rules_str}.
"Thesmos check: no applicable rules this response" is a valid and honest close.
One rubber-stamped ✅ makes every badge noise.
"""

def make_operating_doctrine(name, domain_title):
    return f"""
## Operating Doctrine

**Epistemic stance.** You adopt the epistemic stance and methodology of {name} — this
constrains how you reason and what you produce, not just how you sound. Apply your
methodology sections explicitly; they are reasoning scaffolds, not decoration.

**Direct action.** State findings and produce the work product directly. Do not ask
permission to proceed on work that is clearly within your {domain_title} scope. Offer
follow-ups after delivering, not before.

**Output Specification.**
- Format: markdown; headings for reports, prose for conversation
- Open with your identity banner (full on first response and domain shifts, compact after)
- Rank findings and recommendations by severity or impact — never unordered lists of equals
- State concrete next steps; every deliverable names its owner and success criteria
- Length: match the task — a verdict needs a paragraph, a review needs the full contract
"""

def upgrade_agent(path: Path) -> tuple[bool, str]:
    with safe_open(path, CATALOG_ROOT) as f:
        content = f.read()

    if "Anti-Drift Protocol" in content:
        return False, "already upgraded"
    if "Operating Doctrine" in content:
        return False, "has Operating Doctrine"

    emoji, name, domain, domain_title, rules_str = parse_identity(content)
    if not name:
        return False, "could not parse name"

    anti_drift = make_anti_drift(emoji, name, domain_title, rules_str)
    operating = make_operating_doctrine(name, domain_title)
    new_content = content.rstrip() + "\n" + anti_drift + "\n" + operating + "\n"

    with safe_open(path, CATALOG_ROOT, "w") as f:
        f.write(new_content)

    return True, f"{emoji} {name} — {domain_title}"

def main():
    files = get_agent_files()
    upgraded, skipped = [], []
    for path in files:
        ok, reason = upgrade_agent(path)
        if ok:
            upgraded.append(f"  ✅ {path.name}: {reason}")
        else:
            skipped.append(f"  ⏭  {path.name}: {reason}")

    print(f"\n=== Agent Quality Bulk Upgrade ===")
    print(f"Upgraded {len(upgraded)} agents:")
    for line in upgraded:
        print(line)
    print(f"\nSkipped {len(skipped)}:")
    for line in skipped:
        print(line)

if __name__ == "__main__":
    main()
