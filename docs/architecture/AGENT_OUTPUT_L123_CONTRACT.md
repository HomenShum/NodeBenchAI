# Agent Output L1/L2/L3 Contract

Last updated: 2026-05-27

## Locked Rule

Every agent output must be classified, validated, stored, retrieved, rendered,
traced, and evaluated through the same three-level contract:

```text
L1 = broad output family
L2 = object category
L3 = exact contract, renderer, and validator
```

No output is accepted unless it has:

```text
valid l1/l2/l3
visibility boundary
target id
source/citation policy
traceRef
producer metadata
storage policy
renderer mapping
evaluator mapping
```

The implementation lives in:

```text
src/shared/agentOutputContract.ts
src/shared/agentOutputContract.test.ts
src/shared/riskAttackEvaluator.ts
src/shared/riskAttackEvaluator.test.ts
public/proto/home-v5.html
```

## Why This Exists

ScratchNode and NodeBench already have the right runtime primitives:

```text
public event wiki
private notes
traces
semantic cache
context retriever
Convex truth
Redis hot layer
Typesense search
Linkup search
pi-ai orchestration
```

The missing shared spine was a typed way to say what an agent produced and what
rules apply to it. L1/L2/L3 gives one gate for public wiki generation, private
LightRAG memory, search retrieval tools, semantic cache entries, trace nodes,
artifacts, and UI renderers.

## L1 Families

```text
public_knowledge
private_memory
retrieval_context
graph_memory
agent_trace
generated_artifact
operational_cache
ui_renderable
```

## Core Envelope

```ts
type AgentOutputEnvelope = {
  id: string;
  l1: OutputL1;
  l2: string;
  l3: string;
  target: {
    eventId?: string;
    notebookId?: string;
    artifactId?: string;
    entityId?: string;
    messageId?: string;
    traceId?: string;
  };
  visibility: "event_public" | "private" | "workspace" | "host_draft";
  sourceRefs: string[];
  citationRefs: string[];
  traceRef: string;
  producedBy: {
    runId: string;
    skill: string;
    model?: string;
    toolChain: string[];
  };
  version: {
    wikiVersion?: number;
    sourceBundleVersion?: number;
    memorySnapshotVersion?: number;
  };
  output: Record<string, unknown>;
};
```

## Validator Stack

The shared evaluator checks:

```text
taxonomy validity
policy mapping
visibility mapping
target presence
trace completeness
producer metadata
source/citation array shape
public/private leakage
FAQ answer contract
wiki version contract
semantic cache key contract
retrieval visibility contract
private note contract
```

The public/private rule is strict:

```text
event_public output cannot reference private notes, private sources, or
privateNotesUsed=true.
```

## Adversarial Layer

The output evaluator is now wrapped by the risk/attack evaluator documented in
`docs/architecture/RISK_ATTACK_EVALUATOR.md`.

```text
Output correctness:
Did the run produce a valid L1/L2/L3 object?

Risk robustness:
When attacked with a specific L1/L2/L3 attack, did it trigger a specific
L1/L2/L3 risk?
```

The ScratchNode v5 demo exposes `runRiskAttackQA()` and includes the risk summary
inside `runDemoQA().riskAttack`. The current release-blocker matrix covers
private-note leakage, normal chat agent invocation, FAQ host gating, cache
visibility collision, wrong-event retrieval, private wiki compaction, and trace
search honesty.

Private notes remain:

```text
l1 = private_memory
l2 = private_note
visibility = private
```

If a private note is shared, the system should create a separate public
suggestion or FAQ candidate. It must not mutate the original private object into
public content.

## ScratchNode Demo Wiring

`home-v5.html` now records typed envelopes while `runDemoFull()` plays:

```text
public /ask answer
semantic answer cache entry
retrieval context packet
public trace output node
semantic cache trace tool call
agent answer UI card
private anchored note
private note patch trace
private note marker UI card
event wiki section items
published event wiki artifact
LightRAG atomic claim
NodeBench presentation artifact
workspace artifact-created trace
```

`runDemoQA()` still returns the 17 user-facing release-blocker checks, and now
also returns:

```ts
summary.contract = {
  passed: boolean,
  total: number,
  invalid: string[],
  missingFamilies: string[],
  byL1: Record<string, number>,
  rendererMapped: boolean,
  evaluatorMapped: boolean
}
```

This means the demo now proves both layers:

```text
human-visible product invariants
machine-readable agent output contract invariants
```

## Golden Contract Examples

Public cached FAQ answer:

```text
l1 = public_knowledge
l2 = event_faq
l3 = faq.cached_reuse_answer
visibility = event_public
privateNotesUsed = false
sourceRefs present
traceRef present
```

Private anchored note:

```text
l1 = private_memory
l2 = private_note
l3 = note.anchored_to_chat
visibility = private
anchor = message id
never creates eventMessages row
```

Public retrieval packet:

```text
l1 = retrieval_context
l2 = index_search
l3 = retrieval.context_packet
visibility = event_public
includePrivate = false
no private results
```

Public semantic cache:

```text
l1 = operational_cache
l2 = semantic_answer_cache
l3 = cache.public_faq_answer
visibility = event_public
eventId + wikiVersion + sourceBundleVersion in key
privateContextAllowed = false
```

## Release Impact

This does not replace Convex, Redis, Typesense, Linkup, or pi-ai. It makes their
outputs auditable before storage and rendering.

Runtime rule:

```text
Classify -> Validate -> Persist -> Render -> Trace -> Evaluate
```

Any new agent skill must declare the L3 contracts it can emit before it writes to
Convex, cache, artifact storage, or UI.
