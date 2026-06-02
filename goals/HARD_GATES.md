# Hard Gates — no-autonomy zones

These zones are **propose-only**. An agent may draft a patch and open a PR, but a **human must
approve** before it merges. Runtime goals are stricter than design goals — **never** put a
"never stop until done" clause on backend/security work.

## Never auto-ship (human approval required)

```
production deploy
database migrations with destructive writes
auth / session changes
billing / rate-limit changes
public/private permission rules
data deletion
legal / privacy copy
public wiki publish
host / mod privilege changes
secret / API-key handling
```

## ScratchNode product invariants (release blockers — must never regress)

- Private notes **never** create public `eventMessages` rows.
- Public `/ask` **never** includes private notes.
- Public traces state **"No private notes used."**
- Normal chat **never** invokes the agent (only `/ask` does).
- Agent answers show their parent `/ask`.
- Attendees **suggest** FAQ; only hosts **promote**.
- Host-only controls are never exposed to guests.

These are enforced by `tests/e2e/scratchnode-live-route-honesty.spec.ts` +
`tests/e2e/home-v5-output-contract.spec.ts`. A red oracle is **P0** — fix or flag before anything else.

## The operating rule (why this is safe)

> Human sets the *why* and the *boundary*. Agent explores the *how*. Tests decide whether it
> worked. Docs preserve the learning.

A self-directed agent amplifies the prompt:

```
clear goal      → useful progress
vague goal      → expensive confusion
bad architecture→ faster bad architecture
no evals        → polished wrong thing
```

So the autonomy is always bounded by: a closed Goal Card, a reviewable definition of done,
focused subagents, these hard gates, a budget/ship cap, and a CI-gated merge.
