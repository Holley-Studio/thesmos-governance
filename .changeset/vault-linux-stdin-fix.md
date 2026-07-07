---
'thesmos-governance': patch
---

Fixed the Linux secrets vault path (`secret-tool`) to pipe the master key via real stdin (`execFileSync`'s `input` option) instead of an intermediate `echo`/`printf` shell process, which briefly exposed the raw key in that process's own argv. Also documented — but could not eliminate — a matching, narrower exposure on macOS: Apple's own `security` CLI has no stdin/env alternative to its `-w` flag (its own `-h` text admits this: "Use of the -p or -w options is insecure"), so the key briefly appears in `security`'s argv there. Local-only, single-user exposure window in both cases; not remotely exploitable.
