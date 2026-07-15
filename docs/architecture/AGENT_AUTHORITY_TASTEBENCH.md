# Agent Authority and TasteBench

## Outcome

NodeBench should let an owner delegate a narrow class of work once, observe exactly
what authority was used, and revoke it without stopping the surrounding run. The same
product surface should make experience quality measurable through fixed scenarios,
real artifacts, blind human comparison, and operational-friction evidence.

This first slice is intentionally smaller than a generic "full access" switch. It is
an enforceable foundation for the Live intelligence decoration flow that can expand
operation by operation.

## Capability boundary

The only operation eligible for delegated commit in v1 is:

- `notebook.update_block` on one owner-accessible, versioned `productBlocks` row,
  limited to content plus preserved source-reference IDs proposed by the Live
  intelligence decoration flow. Delegated commit requires a server-matched
  `verified` or `corroborated` projection with at least one source reference;
  `single-source` and `unverified` projections stay explicit. The projection
  must come from the internal structuring producer and match the exact owner,
  entity, scratchpad, run, block type, version, content, and ordered sources.
  Canonical and generic projections may still render, but cannot authorize a
  delegated write.

The following operations are not delegated by this grant:

- block insertion, kind changes, attributes, and structural changes;
- publish, share, export, and delete;
- access-control or membership changes;
- external synchronization;
- provider or web egress;
- local or remote file access.

Within this Live intelligence control, Review every change is the default and creates
no authority grant. Autonomous this run and Autonomous workspace create durable,
owner-scoped grants. Every eligible mutation is still proposed first. Delegated
authority changes who may approve that proposal; it does not bypass validation,
optimistic concurrency, history, or receipts. Slash-agent commands and other agent
workflows remain outside this v1 grant and retain their existing approval behavior.

## Authority lifecycle

1. The owner selects a mode and sees the exact allowed and restricted operations.
2. The server creates a scoped grant with an expiry, operation cap, policy version,
   and policy digest.
3. An agent submits a proposal containing the target block, base revision, proposed
   content, fixed server agent identity, durable operation key, and idempotency key.
4. Review mode stores a pending proposal. Delegated mode re-resolves the live grant
   and atomically checks owner, scope, status, expiry, operation allowance, operation
   cap, idempotency, content limits, and current block revision.
5. A successful update creates block history and an immutable commit receipt with
   the before and after revisions and hashes.
6. Pause or revoke prevents the next eligible Live intelligence replacement,
   including one prepared by an already-running decoration flow. Expiry and
   exhaustion fail closed.
7. Undo is an owner action. It restores the receipt's previous content and ordered
   source references as a new revision only when the block still matches the
   receipt's after revision and hashes. It never overwrites a later human edit.
8. A blocked proposal is not retried on render. A changed bound revision, body, or
   ordered source set may create one new server-validated attempt, up to the policy
   attempt cap. An unchanged blocked proposal remains inert.

Run grants bind to one concrete persisted scratchpad ID. Workspace grants bind to
the authenticated owner's workspace. Neither accepts a client-selected owner or
agent identity. Legacy slug-only memory is excluded from this tenant-bound path
until its tables carry owner and entity keys.

## Data binding

| UI claim                                    | Authoritative source                              | Empty or unavailable behavior                           |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Current authority mode                      | Effective live owner grant                        | Show Review every change                                |
| Allowed operation                           | Server policy constant                            | Show only `notebook.update_block`                       |
| Run scope                                   | Exact persisted scratchpad and entity             | Disable run mode when no concrete live run exists       |
| Evidence producer                           | Internal structuring assurance plus scratchpad ID | Keep the proposal explicit or blocked                   |
| Restricted operations                       | Server policy constant                            | Never infer broader access                              |
| Active, paused, expired, revoked, exhausted | Grant status plus server time and operation count | Fail closed and return to Review affordance             |
| Agent identity                              | Proposal and receipt snapshot                     | Show unavailable, never invent a name                   |
| Validation checks                           | Commit receipt                                    | Do not render a successful receipt without them         |
| Resulting version                           | Product block revision in receipt                 | Null until a real commit exists                         |
| Undo availability                           | Receipt revision versus current block revision    | Disable with an explicit stale-version reason           |
| TasteBench candidates                       | Real dogfood QA artifact references               | Empty state until two eligible artifacts exist          |
| Blind A/B order                             | Persisted server assignment                       | Never derive or reshuffle in the client                 |
| Human preference                            | Append-only TasteBench event                      | Human choice is authoritative; model review is advisory |
| Friction metric                             | Timestamped run/event evidence                    | Use `null` and "Not measured," never synthetic zero     |

## Authority state matrix

| State             | May propose               | May delegated-commit      | Owner actions                                     | Presentation                                  |
| ----------------- | ------------------------- | ------------------------- | ------------------------------------------------- | --------------------------------------------- |
| Review            | Yes                       | No                        | Select a delegated mode; approve/reject proposals | Safe default                                  |
| Active            | Yes                       | Only the scoped operation | Pause or revoke                                   | Mode, scope, expiry, remaining operations     |
| Paused            | Yes                       | No                        | Resume or revoke                                  | Paused; next mutation waits                   |
| Expired           | Yes                       | No                        | Create a new grant                                | Expired; no implied continuation              |
| Revoked           | Yes                       | No                        | Create a new grant                                | Revoked; immutable historical receipts remain |
| Exhausted         | Yes                       | No                        | Create a new grant                                | Operation cap reached                         |
| Validation failed | Proposal remains evidence | No                        | Review or reject                                  | Failed check and zero-write result            |

## TasteBench protocol

TasteBench uses fixed scenarios and source-bound evidence packs. A run requires two
real dogfood artifacts. Their identities are hidden behind a server-persisted A/B
assignment until the owner records one of: baseline, candidate, tie, or both fail.
The active packet withholds row IDs, hashes, timestamps, and baseline/candidate
roles. Persisting the judgment reveals the roles so the result is interpretable
without weakening the blind comparison.
The judgment requires a reason and at least one dimension:

- narrative;
- visual semantics;
- composition;
- craft;
- trust;
- interaction.

Manual corrections are append-only events classified as reduced density,
strengthened hierarchy, changed visual encoding, corrected audience level, factual,
source, scope, tone, or other. Before and after artifact references are retained.

Operational-friction evidence may include time to first reviewable output, approval
interruptions, retries, manual interventions, undo count, completion, and abandonment.
A metric is displayed only when its source events make it provable. Real authority
proposal, receipt, and undo workflows append best-effort operational events to the
exact TasteBench run captured when the proposal was first persisted. Receipts inherit
that binding, so a historical retry cannot contaminate a later benchmark and a true
post-judgment undo can still append to its completed run. Each source event has a
deterministic key, so a retry returns the existing event instead of double-counting.
Telemetry cannot roll back the operation it observes; an unavailable event remains an
honest null metric.

## Deliberate v1 limits

- Delegated authority covers one safe replacement operation, not a generic full-
  access promise across NodeBench.
- The accepted multi-block decoration remainder is one atomic explicit batch. Once
  that composite remainder exists, target-only undo is disabled rather than
  pretending to reverse the whole operation. Composite multi-block undo is a
  follow-up contract.
- TasteBench v1 uses the six fixed AI-application scenarios already present in the
  dogfood catalog. Expanding to repeated founder, researcher, and analyst cohorts is
  benchmark-corpus work, not seeded demo data.

## Interaction contract

The Live intelligence Authority control lives in the real entity notebook beside the
decoration review surface. It is compact, keyboard accessible, visible on mobile, and
honest about the narrow scope. Pause and Revoke exist only for a live grant. Shared,
member, and guest sessions remain in Review mode. No new rail, decorative dashboard,
or duplicate approval queue is added.

TasteBench belongs on the existing `/dogfood` review surface. It must show a useful
empty state when there are not yet two real artifacts. It must not seed demo outputs
or project inferred quality scores.

## Verification contract

The release floor is:

1. pure policy and server mutation tests for owner isolation, expiry, revocation,
   scope, operation caps, idempotency, stale revisions, immutable receipts, and safe
   undo;
2. Authority UI tests for the default, authentication gate, mode selection, and
   pause/resume/revoke visibility;
3. TasteBench tests for fixed scenarios, real artifact validation, persisted blind
   order, required judgment evidence, append-only events, and null metrics;
4. focused Agents and dogfood regressions;
5. TypeScript, Convex TypeScript, design-system tests, design and agent-UI linters,
   production build, and responsive light/dark browser captures.

## Non-regression contract

Do not change streaming ownership, `/spawn`, human approval requests, export bytes,
structured sources, tool or domain cards, provenance, navigation, mobile safe areas,
or reduced-motion behavior. Do not use demo passports, client-only proposal events,
dead FastAgent approval state, or mutable action receipts as an authorization source.
