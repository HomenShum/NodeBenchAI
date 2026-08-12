# NodeGraph Live inside NodeBench

An analyst opens an entity profile to decide whether to trust what the
research pipeline found. If the graph next to the prose draws a thick edge
between Anthropic and Google, the analyst will read thickness as "strongly
connected" — and if that thickness came from an LLM's prose rather than a
counted fact, the UI has manufactured confidence out of nothing. The vendored
renderer (`vendor/nodegraph-live/`) prevents exactly that by forcing every
edge into one of three epistemic classes, and this document is the mapping
from NodeBench's own events to those classes.

Paper note: an edge may only look "measured" when its weight came from a
system of record; everything else renders at constant width.

## Where the rail lives

- Component: `apps/web/src/features/research/components/EntityGraphRail.tsx`
- Mounted in: `apps/web/src/features/research/views/EntityProfilePage.tsx`
  (the entity research surface), reached via `/#entity/<name>` — the URL
  grammar `backend/convex/domains/agents/digestAgent.ts` emits in digest
  notifications and `scripts/seed-entity-contexts.ts` prints. The hash branch
  that resolves it is in `apps/web/src/App.tsx`.
- Fed by the page's OWN reactive queries — the rail adds zero subscriptions:
  - `backend/convex/domains/knowledge/entityContexts.ts:getEntityContext`
  - `backend/convex/domains/knowledge/relationshipGraph.ts:getEntityGraph`
  - `backend/convex/domains/knowledge/adaptiveEntityQueries.ts:getAdaptiveProfile`
- Recording + gate: `demo/graph-rail-live/record-product-rail.mjs` (exits
  nonzero on a missing rail, an under-populated rail, or a rail that fails to
  grow after a real `storeEntityContext` write).

## Event taxonomy: NodeBench event → entities → measured? → class

The deciding question for every event is always the same: **did a number come
from a system of record, or did text come from a model?**

| NodeBench event | Entities extracted | Measured? | NodeGraph class |
|---|---|---|---|
| `entityContexts` write (`storeEntityContext` — seed script, research jobs, due-diligence branches) | the researched entity + each cited source (`sources[].name/url`) | No — a research summary and a list of citations carry no counted magnitude | `traversal` (entity↔source), counts `undefined` |
| `relationshipGraph` observation (`ingestObservation` / `materializeEdge`, read back by `getEntityGraph`) | subject entity + `relatedEntityName` per edge | No — `confidence` on these edges is model confidence, not an external count; rendering it as width would launder a guess into a measurement | `traversal` (entity↔related entity) |
| Graphify / adaptive-profile results (`adaptiveEntityQueries.getAdaptiveProfile` — LLM-extracted `relationships`, `circleOfInfluence`) | profiled entity + each `relationships[].entityName` | No — LLM extraction from prose | `traversal` |
| Research events with an API count (none wired today — e.g. a registry probe returning `totalCount`) | probed entity pair | Yes — the count is the payload | `evidence`, weight = the count, and ONLY this class may vary edge width |
| Curated claims with a complete replay receipt (none exist today — see the receipt gap below) | claim subject + object | Curated, not measured | `assertion` via `assertEdge`, badge not width |

Everything the rail shows today is in the first three rows, which is why the
panel caption says so: counts stay `undefined`, `assertEdge` is never called,
and the rail cannot imply magnitude the backend never measured.

Idempotency: every `session.observe` call carries an `eventId` derived from
document identity (`ctx:<docId>`, `src:<docId>:<i>`, `rel:<edgeKey>`,
`adaptive:<entity>:<related>`), so Convex re-delivering a subscription update
does not make a relationship look stronger. The session is bounded
(`maxNodes/maxEdges/maxSeen`), so a profile left open all day cannot grow
without limit.

## The named receipt gap (public-footprint CSV join)

`assertEdge` demands a complete receipt: curating source, versioned release,
stable ids for both endpoints, and a literal URL that re-opens the assertion
(`vendor/nodegraph-live/graph-model.d.ts`, `AssertionReceipt`). The tempting
shortcut is the public-footprint eval corpus
(`scripts/publicFootprintEval/prepare-public-footprint-eval.ts` and its CSV):
join an entity's rows to its profile and draw "asserted" edges to every
domain in its public footprint.

The join fails the receipt on two named fields:

- **release** — the CSV rows are scraped observations with a fetch date, not
  a versioned release of a curated system; re-running the pipeline can change
  a row with no version to cite.
- **subjectId / objectId** — NodeBench entities are keyed by
  `entityType:slug(name)` (`buildCanonicalKey` in
  `backend/convex/domains/knowledge/entityContexts.ts`), which is a local
  naming convention, not a stable identifier in the curating source.

Until a curated upstream provides both, footprint joins enter the graph as
`traversal` like everything else. Closing the gap honestly means storing a
source-of-record id and release alongside each footprint row at ingestion
time — not synthesizing them at render time.
