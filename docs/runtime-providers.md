# Thesmos Runtime — provider architecture

> **Thesmos owns orchestration and governance. Model providers are
> interchangeable execution engines operating under Thesmos authority.**

This document describes the provider runtime introduced alongside the native
Ollama provider. It covers what exists today and what does not — see
[Status](#status) before relying on anything here.

## Why this exists

Before this change, provider execution lived entirely in
`extensions/vscode/src/chat/`. Claude and Codex sessions were classes owned by
Pantheon Chat, and the event union they emitted was declared in
`claudeSession.ts`. That made the editor the accidental owner of a contract the
CLI and any future headless runtime also need, and it meant every new provider
was another branch inside a webview controller.

The runtime moves the contract into core and leaves the editor as one consumer
of it.

```text
Mission
   ↓
Thesmos Runtime          thesmos/runtime/
   ↓
Governance               endpoint egress · tool authority
   ↓
Provider Router          thesmos/runtime/registry.ts
   ├── Claude Code       (CLI subprocess — extension-hosted today)
   ├── Codex             (CLI subprocess — extension-hosted today)
   └── Ollama            thesmos/runtime/providers/ollama/
         ↓
     local models
```

## The contracts

All in `thesmos/runtime/types.ts`:

| Contract | Role |
| --- | --- |
| `ModelProvider` | An execution engine: `health()`, `listModels()`, `createSession()` |
| `AgentSession` | One conversation: `id`, `running`, `start/send/stop/dispose` |
| `RuntimeEvent` | The normalized event union every provider emits |
| `ModelDescriptor` | Routing metadata — capabilities, billing, privacy, context |
| `EmbeddingProvider` | Embeddings as a separate capability, not a chat mode |

### Why embeddings are a separate interface

`EmbeddingProvider` is deliberately not a mode of `AgentSession`. A governed
memory layer (Mnemosyne) needs to embed a corpus without pretending to hold a
conversation, and a provider that serves embeddings but not chat has to be
representable. Folding embeddings into chat sessions is precisely what would
force a second inference architecture later.

What that layer needs is already present and tested:

- `listModels()` + `capabilities.embeddings` — select an embedding-capable model
  without hardcoding names.
- `embeddingDimensions` — size and validate a vector store *before* indexing.
  Read strictly from the `<family>.embedding_length` key; sibling keys such as
  `<family>.vision.embedding_length` are decoys that would silently size a store
  to the wrong width.
- `embed(model, inputs, signal)` — batched, cancellable, and subject to the same
  endpoint egress check as chat, because embedding a repository is egress too.
- `supportsEmbeddings(provider)` — narrowing, so consumers need no cast.

Nothing in the memory system itself is implemented here.

`RuntimeEvent` was not invented. It is the union Claude and Codex already
emitted, lifted into core unchanged, so the extraction cost those two providers
nothing. `extensions/vscode/src/chat/claudeSession.ts` now re-exports it as
`SessionEvent` and every existing import site still compiles.

## Why Ollama is native rather than a proxy

Ollama could have been added as another "custom proxy" preset — pointed at an
Anthropic-compatible shim (LiteLLM, claude-code-router) and driven by the
`claude` CLI. It is not, deliberately:

- **A shim is a third moving part.** It has to be installed, configured, kept
  running and kept version-compatible. A local model is supposed to be the
  simple option.
- **Translation loses information.** Ollama reports capabilities, context
  length, quantization and token counts natively. Re-framing the traffic as
  Anthropic messages discards most of that, which is exactly the metadata
  routing needs.
- **Governance needs the real wire.** Cancellation must abort the actual HTTP
  request, and a tool request must reach Thesmos before anything executes. With
  a proxy in the path, both are somebody else's implementation detail.
- **It proves the architecture.** If Thesmos cannot own one provider end to
  end, the "Governed Agent OS" claim is not real.

So the provider speaks to `/api/tags`, `/api/show`, `/api/chat` and `/api/embed`
directly, with no SDK — the surface is three endpoints and a newline-delimited
JSON stream.

## Governance

### Endpoint egress is the trust boundary

`http://127.0.0.1:11434` is loopback. Nothing leaves the machine, so it is
permitted without a prompt — requiring approval for the default configuration
would be noise that trains users to approve everything.

Anything else is data egress. A prompt carries source code, repository context
and tool output, so a non-loopback endpoint is resolved on the **existing `web`
permission channel** rather than through a new parallel system:

| Locality | Examples | Treatment |
| --- | --- | --- |
| `local` | `127.0.0.0/8`, `localhost`, `::1` | permitted, no approval |
| `lan` | `10/8`, `192.168/16`, `172.16–31/12`, `fe80::/10` | governed as egress |
| `remote` | everything else | governed as egress |

Three rules this enforces:

1. **LAN is not local.** A workstation on a shared network is still a different
   machine under someone else's control.
2. **Locality comes from the parsed host**, never from a provider id, a label or
   a config flag. `http://127.0.0.1.attacker.com` is remote, and so is
   `http://evil.example.com/?host=127.0.0.1`.
3. **Silence is not consent.** A policy with no matching rule resolves to `ask`,
   never `allow` — so an unconfigured remote endpoint is refused, not assumed.

Malformed URLs, non-`http(s)` protocols and embedded credentials are rejected
outright rather than repaired.

### Tool authority stays with Thesmos

```text
Ollama model → requests tool → Thesmos → permission check → allow/ask/deny
```

There is no path from a provider to a shell. `authorizeToolCall()` maps the
request onto a channel and resolves it against policy; an unrecognized tool name
routes to `shell`, the strictest channel, because guessing generously on an
unknown capability is the dangerous case. The target judged is the *argument the
channel governs* — a `shell` grant for `git status` does not authorize `rm -rf /`
through the same tool.

## Model metadata and billing honesty

Local inference has **no metered API cost**, but it is not free — it spends the
user's hardware, power, memory and GPU time. Modelling it as `$0` would let a
router treat local execution as costless and stampede every task onto the user's
laptop. So descriptors carry:

```ts
billingClass: 'local-compute'   // not 'free'
privacyClass: 'local-only'      // 'egress' for a non-loopback endpoint
```

Undetectable metadata stays **absent**, never defaulted. `capabilities.toolUse
=== undefined` means "not determined" and `false` means "verified absent" —
routing must distinguish them, because assuming absence silently downgrades a
capable model and assuming presence produces a failure the user cannot explain.

Some things local models are *not*:

- **Local does not mean safe.** A local model can still emit a destructive tool
  call; that is why tool authority is unconditional.
- **Local does not mean private if the endpoint is not loopback.** A remote
  Ollama is data egress like any other API.
- **Local does not mean good.** Quality is not inferred from locality. Routing
  must be capability-aware and evidence-backed; never route a task to a local
  model merely because it is cheap.

## Configuration

```jsonc
{
  "providers": {
    "ollama": {
      "enabled": true,                       // true = required; false = hidden
      "baseUrl": "http://127.0.0.1:11434"    // loopback default
    }
  }
}
```

Omitting the block entirely means *available if running* — Ollama appears in
`providers:list` when reachable and never fails a gate when it is not. Only an
explicit `"enabled": true` makes it required.

No API key is used for a loopback endpoint, and none is requested.

## CLI

```bash
thesmos providers:list [--json] [--verbose]
thesmos providers:doctor [--json]
```

Both report on the **service**, never on a binary being present on PATH — an
installed `ollama` executable with no running daemon is exactly the state a PATH
check would mis-report as available.

`thesmos doctor` additionally validates a configured endpoint synchronously
(parses, classifies, warns on non-loopback). It does not dial the network:
`runDoctor` is pure by design, and live reachability is `providers:doctor`'s job.

## Status

Working and verified end-to-end against a live Ollama:

- health, model discovery with real capability/context metadata
- streaming chat normalized into `RuntimeEvent`
- mid-generation cancellation that aborts the HTTP request
- normalized errors (service down, model missing, malformed, timeout)
- endpoint egress governance and locality classification
- embeddings (`/api/embed`) exposed via `EmbeddingProvider`

**Deliberately not implemented yet** — the contracts and the authority check are
real, the execute-and-return loop is not:

- **Tool execution.** A model's tool request is authorized and reported. An
  allowed call is *not* executed and no result is fed back to the model; the UI
  says so explicitly rather than implying the tool ran. Wiring execution means
  routing through the same approval path Claude uses (`permissionBridge`), which
  is the natural next PR.
- **`thesmos runtime` daemon.** The runtime is placed in core and is free of
  `vscode` imports specifically so a headless host can use it, but no daemon,
  queue or scheduler exists yet.
- **Ollama in mission execution / Zeus routing.** `ModelDescriptor` carries the
  metadata routing will need; no routing policy consumes it yet.
