---
name: python-async-audit
description: Audits Python async/await usage for correctness — blocking calls inside async functions, unawaited coroutines, async functions with no await, and threading anti-patterns. Particularly useful after AI-generated async Python code which frequently mixes sync and async incorrectly.
---

# Python Async Audit

## Purpose

Audits Python async/await usage for correctness: blocking calls inside async functions, unawaited coroutines, async functions with no await, and threading anti-patterns. Particularly useful after AI-generated async Python code which frequently mixes sync and async incorrectly.

## When to use

- Before merging async Python services (FastAPI, aiohttp, asyncio workers)
- After an AI coding session added async routes or background tasks
- When investigating unexplained latency spikes in async Python services
- After refactoring sync code to async to verify the conversion is complete

## Required inputs

- Changed `.py` files with full content
- Active Thesmos config
- File list indicating which files contain `async def` functions

## Workflow steps

1. Run `npm run thesmos:review` on all changed `.py` files
2. Filter findings for async-related rule categories: `py_blocking_sleep_in_async`, `py_unawaited_coroutine`, `py_async_without_await`
3. For each `time.sleep()` inside `async def`, confirm the replacement is `await asyncio.sleep()`
4. For each unawaited coroutine, identify the call site and add `await`
5. For each `async def` with no `await`, determine if the function should be sync or needs async operations added
6. Check `threading.Thread` usage near async code for thread safety issues

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A focused async-correctness report:
- `py_blocking_sleep_in_async` — file:line of each `time.sleep` inside async, with `await asyncio.sleep()` replacement
- `py_unawaited_coroutine` — file:line of each unawaited coroutine call, with `await` insertion location
- `py_async_without_await` — async functions that should be sync, with refactor suggestion

## Related agents

- python-reviewer
- performance-reviewer

## Related rule packs

- @thesmos/core
