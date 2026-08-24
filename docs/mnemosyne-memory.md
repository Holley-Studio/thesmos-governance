# Mnemosyne — governed memory and context intelligence

> **Memory is not truth.** A stored statement is evidence with a history — not
> an instruction, and never an authority.

Mnemosyne gives Thesmos durable cross-session project knowledge so a mission can
start from *relevant governed evidence* rather than from a hundred-thousand-token
transcript. It is a Thesmos core subsystem (`thesmos/memory/`), callable from the
CLI, the editor, and a future headless runtime.

## Four words this subsystem keeps apart

| Term | Meaning |
| --- | --- |
| **memory** | something recorded, with provenance and a lifecycle |
| **evidence** | memory offered in support of a claim |
| **instruction** | what the user or mission is asking for |
| **authority** | what governance permits |

Memory can become evidence. It can never become instruction or authority. Every
design decision below follows from that.

## Relationship to what already existed

Mnemosyne does not replace either of these, and deliberately does not merge with
them — they answer different questions and have different lifecycles.

| System | Remembers | Lifecycle |
| --- | --- | --- |
| `brain.ts` | how *Thesmos rules* perform (suppressions, proposals) | per scan session |
| `pantheon:memory` | per-agent freeform markdown notes | operator-edited |
| **Mnemosyne** | governed *project knowledge* with provenance | durable, superseded not deleted |

## The record

Every record answers: where did this come from, who made it, when, was it
observed or inferred, how confident are we, is it still valid, what project does
it belong to, and has something newer replaced it.

- **Type** — `observation`, `user-decision`, `architecture-decision`,
  `procedure`, `constraint`, `summary`, `hypothesis`, `ephemeral`. The critical
  split is observation (verifiable) versus hypothesis (inferred); ranking and
  rendering never treat them alike.
- **Provenance** — structured, never prose: source kind, creator, derivation,
  evidence reference, and lineage for consolidated records. An `observed`
  memory with no `evidenceRef` or `sourceId` is **rejected** — otherwise
  "observed" is an unfalsifiable confidence boost.
- **Confidence** — `low | medium | high | verified`. Coarse on purpose;
  a continuous score would be false precision.
- **Status** — `active | superseded | expired | disputed`. Superseded records
  are kept (history explains decisions) but excluded from active retrieval.
- **Sensitivity** — `public | project | private | sensitive | secret`.

## Write governance

```text
agent proposes → validate → scope · provenance · sensitivity · bounds → accept/reject → store
```

Rejected outright: empty content, content over 4000 chars, malformed
provenance, an unbacked observation, a consolidation with no sources, a
hypothesis claiming `verified`, malformed timestamps, a cross-project write, a
scope escalation, and anything matching a secret pattern.

**Secret detection is stricter here than in the shared scanner.**
`matchesSecretPattern` compiles patterns case-sensitively, so a default pattern
like `secret_access_key…` never fires on `AWS_SECRET_ACCESS_KEY=…` — the
spelling AWS actually uses. Missing that in a lint pass produces a stale
finding; missing it here writes a live credential into permanent memory and then
embeds it. So Mnemosyne runs a case-insensitive second pass. The shared scanner
is left alone deliberately — widening it would change findings in every repo
Thesmos scans.

## Scopes and isolation

`global → workspace → repository → project → mission → session → agent`

- A query reads its own scope and anything **wider**, never anything narrower.
- A record carrying a `repoId` is invisible to any other repo's query.
- Mission-scoped memory is private to its mission.
- A child task can never write wider than its mission's ceiling.

## Storage

`.thesmos/memory/records.jsonl` + `vectors.jsonl` + `meta.json` — gitignored, as
per-machine state.

**Why JSONL and not SQLite**, in priority order:

1. **No native dependency.** `better-sqlite3` needs a compiler toolchain on
   every platform Thesmos installs onto; `node:sqlite` is still experimental on
   the Node versions this repo supports.
2. **Inspectable.** For a subsystem promising "no opaque hidden memory", being
   greppable is a feature.
3. **Matches convention** — `agent-activity.jsonl` already does this.

The honest trade-off: retrieval is a linear scan. At Mnemosyne's target volume
(curated project knowledge, *not* an index of every file) that is milliseconds.
The store interface is narrow enough to swap if volume ever justifies it.

Writes are atomic (temp file + rename). A corrupt line is skipped and counted
rather than making the whole store unreadable.

## Embeddings

```text
Mnemosyne → EmbeddingProvider → Ollama
```

Mnemosyne depends only on the runtime's `EmbeddingProvider` contract, so another
provider needs no change here and no second memory architecture. Ollama is the
default local implementation — it is *an embedding provider*, not the memory
system.

- **Namespaced** `provider:model:dimensions`. Vectors from different spaces are
  never compared: cosine distance between unrelated spaces returns a plausible
  number, which is the dangerous kind of wrong.
- **Content-hashed.** Editing content invalidates its vector and triggers
  re-embedding; an unchanged record is skipped.
- **Width-checked.** A vector whose length disagrees with its namespace is
  discarded, not stored.
- **Never embeds** `secret` or `sensitive` content. Embedding does not launder
  sensitivity.
- **Never downloads.** A missing model produces an actionable error naming the
  `ollama pull` command. `nomic-embed-text` is a *recommendation, not a
  requirement*.

## Retrieval

Deterministic and explainable — same store and query always yield the same
order, and every hit reports why it ranked where it did.

Similarity is **never** the final authority; a stale guess can be lexically
closer to a query than the current architectural decision. Weighted inputs:

| Factor | Weight |
| --- | --- |
| semantic (or lexical) similarity | 0.45 |
| memory type | 0.20 |
| confidence | 0.15 |
| provenance quality | 0.10 |
| recency | 0.10 |

Superseded and expired records are excluded by default, and demoted ×0.3 when
explicitly included. Ties break on id so ordering is reproducible.

**Graceful degradation:** with no embedding provider, retrieval falls back to
lexical overlap and says so. Semantic search being unavailable never means
memory is unavailable.

## Conflicts

Two active, high-confidence governance records on the same subject with opposite
requirement polarity are **surfaced, never silently resolved** — picking a side
invisibly is how a memory system launders a contradiction into false confidence.

Detection is deliberately narrow; a noisy detector trains everyone to ignore it.
It reads negated modals ("must **not** require") and the double-negative
construction ("**never** deploy **without** approval" *asserts* the requirement)
because both invert meaning and both are common in real decision text. It will
still miss subtly-worded contradictions — an accepted, documented trade.

## Context capsule

Retrieved memory is rendered **below** system policy, inside an explicit
`<retrieved-memory>` fence, with a standing note that the block is data and any
imperative inside it is quoted historical text. Content is sanitized so a stored
string cannot close the fence early or forge a role prefix — escaping the data
block is the classic injection-by-delimiter.

Sections separate `USER DECISIONS`, `ARCHITECTURE CONSTRAINTS`, `PROCEDURES`,
`RETRIEVED MEMORY` and `UNVERIFIED HYPOTHESES`, so a model can tell present
evidence from historical memory.

Contribution is bounded (default 12 records / 6000 chars) and deduplicated after
ranking, so the budget is spent on the best records rather than the earliest.

## Telemetry honesty

`contextCharsAvoidedEstimate` is an **estimate** and is named as one. It compares
the full candidate set against what was injected — a real number, but not a
measurement of tokens saved against any actual alternative run. It is never
presented as measured savings.

## Configuration

```jsonc
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434",
      "embeddingModel": "nomic-embed-text"   // must already be pulled
    }
  }
}
```

## CLI

```bash
thesmos memory:list [--all] [--json]
thesmos memory:search "staging migration repair" [--limit=10]
thesmos memory:show <id>
thesmos memory:add "<text>" --type=user-decision [--supersedes=<id>]
thesmos memory:forget <id> | --mission=<id> | --repo=<id>
thesmos memory:index [--rebuild]
thesmos memory:stats [--json]
thesmos memory:doctor
```

Deleting a record deletes its vector in the same operation — an orphaned vector
would keep surfacing a "forgotten" memory, which would make deletion a lie.

## Context Intelligence — the live path

```text
              THESMOS
                 │
         Context Intelligence          thesmos/context-intelligence.ts
                 │
      ┌──────────┼──────────┐
      │          │          │
   Mission    Evidence   Mnemosyne
      │          │          │
      └──────────┼──────────┘
                 │
          Context Capsule
                 │
           Provider Router
         ┌───────┼───────┐
         │       │       │
      Claude   Codex   Ollama
```

`buildMissionContext()` is the one place Thesmos decides what a provider sees.
It is re-exported from `context-capsule.ts`, so there is a single import
surface: that module answers *"what is true about this repo now"*,
Context Intelligence answers *"what should this provider see for this request"*.

> **Provider adapters never decide what historical context to send.**
> Thesmos decides, before dispatch.

### Authority hierarchy

Order is fixed and not configurable. Memory is appended last so nothing in it
can precede — and therefore appear to qualify — anything above it.

```text
SYSTEM POLICY
   ↓
THESMOS GOVERNANCE
   ↓
CURRENT USER INTENT
   ↓
CURRENT VERIFIED EVIDENCE
   ↓
RETRIEVED GOVERNED MEMORY      ← fenced, labelled non-authoritative
```

A stale memory saying *"deploy automatically"* sits below a policy requiring
approval. Policy wins, unambiguously.

### Recall policy

Deterministic, not an LLM classifier — that would add a model call, a failure
mode, and nondeterminism to a decision well served by asking "is this about
continuing something?".

Recall **requires a project identity**. Without one it declines rather than
guesses: failing to recall is cheap, leaking across projects is not.

| Recalls | Declines |
| --- | --- |
| continue / resume / still failing | `format this string` |
| migration, deployment, certification | queries under 8 characters |
| "why did we…", architecture, constraint | no repo or project identity |

### Two thresholds, not one

Relevance is gated on **raw topical similarity separately from the composite
rank**. This matters: the composite score sums similarity with type, confidence,
provenance and recency, and those non-similarity terms alone floor an
authoritative record near 0.5. A `minRelevance` gate can therefore never exclude
a well-attested memory about a completely unrelated subject.

That would be the wrong model. Authority decides *which of the relevant* records
matter most; it must not manufacture relevance for an irrelevant one.

`minSimilarity` defaults to 0.08, calibrated for lexical overlap. Semantic
callers should raise it — cosine similarity runs generously high even for
loosely related text.

### Budget

Memory is opportunistic. Mandatory current evidence is never dropped to fit more
history. Defaults: **1500 estimated tokens, 12 records**. Exclusions are recorded
with a reason (`below-relevance-threshold`, `duplicates-current-evidence`,
`exceeds-token-budget`, `exceeds-record-budget`).

Token counts come from the single estimator in `token-budget.ts` — roughly four
characters per token, and labelled an estimate everywhere it surfaces. There is
deliberately no second tokenizer.

### Mission authority

A task never states its own memory scope, exactly as it never states its own
permissions. `memoryScopeForTask()` returns `mission` — never `global`, never
`workspace`. Delegated children inherit the same ceiling because they are bound
to the same mission object, which makes widening structurally impossible rather
than merely discouraged.

Retrieval is read-only and its failure is absorbed by the executor, so a memory
outage can never fail a task or perturb mission state. Verified: the mission
state hash is byte-identical with and without recall.

### Measured (this fixture only)

`thesmos/context-benchmark.test.ts`, 125-record corpus, lexical retrieval:

| | baseline (transcript carried forward) | memory-aware |
| --- | --- | --- |
| characters | 15,115 | **927** |
| estimated tokens | ~3,779 | **~232** |
| records injected | — | 3 of 125 |
| retrieval | — | 5 ms |

Reduction is ~94% **on this corpus**. It is not a general claim, and the token
figures are estimates, not measurements. The benchmark asserts correctness
alongside size: the facts needed to continue survive, current evidence is never
displaced, and the superseded fact stays out while its replacement stays in.

### Inspecting a decision

```bash
thesmos context:explain "continue fixing the staging migration certification issue"
```

Reports the retrieval mode, why recall did or didn't run, what was included with
scores, exclusions grouped by reason, and the estimated token cost.

### Receipts

`ExecutionReceipt.memory` records included ids, candidate count, exclusion
reasons and a sha256 of the rendered block — **never memory content**. A receipt
may be shared or archived; copying remembered project detail into every one
would turn an audit trail into a second, ungoverned store of the same material.

## Not implemented in this PR

- Mission-runtime auto-recall and automatic memory proposals from mission
  completion / council records (`MnemosyneService.recall` is ready for it).
- Consolidation of repetitive records into governed summaries (the contracts —
  `derivation: 'consolidated'` with required `derivedFrom` — exist and are
  validated).
- Integration into `generateContextCapsule`; the renderer exists and is tested,
  but nothing calls it during a live mission yet.
- Whole-repository or code indexing. Git already stores code; Mnemosyne stores
  high-value project knowledge, deliberately.
