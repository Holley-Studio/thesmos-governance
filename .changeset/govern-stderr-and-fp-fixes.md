---
'thesmos-governance': patch
---

claude:govern check now writes block messages to stderr so Claude Code displays them (blocking hooks only surface stderr on exit 2; stdout was silently dropped, making every block appear as "No stderr output"). Ships alongside the already-committed VIBE_007 placeholder and VIBE_009 JSX `<select>` template-literal false-positive fixes, which were fixed in source but never published.
