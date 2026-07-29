---
"thesmos-governance": patch
---

**Guard config repair hatch (hardened):** a malformed `.thesmos/config.json` no longer deadlocks the agent under `autoMode.failClosed`. A `Write`/`Edit` of that exact file is allowed so it can self-heal, while every other tool stays blocked. The exception is threat-modeled and narrow — it requires a canonical directory match with an exact `config.json` basename, refuses look-alike names and `..` traversal, refuses a symlinked config file (no link-follow write), and still runs the content scan on the repair payload so a secret-bearing "repair" is rejected. Invalid project `package.json` is never misclassified as a broken Thesmos config.
