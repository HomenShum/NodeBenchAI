# NodeKit RFS Showcase: Build, Benchmark, and Publication Plan

**Status:** proposed execution plan  
**Campaign:** YC Summer 2026 Requests for Startups  
**Scope:** 16 bounded applications, 16 sealed benchmark runs, 16 evidence-backed posts  
**Primary rule:** a post is unlocked by a verified run, never by a speculative concept alone

## 1. Outcome

The campaign should prove a narrower and more defensible claim than “NodeKit invented 16 startups”:

> Given a raw YC request, NodeKit can research and narrow a product wedge, build a useful vertical slice, deploy it, independently verify it, and publish the exact time, token, cost, intervention, product-quality, and taste evidence for that run.

The public series remains:

> **16 YC Requests. 16 NodeKit Product Concepts. One Figured-Out Product Grammar.**

The recurring close remains:

> **YC named the frontier. NodeKit figured out the product path.**

The campaign is complete only when every request has:

1. A source-hashed raw brief.
2. One target user, one primary job, and one canonical artifact.
3. A deployed, bounded vertical slice.
4. A sealed benchmark receipt.
5. Production browser proof.
6. A blind comparative taste result or an explicit provisional status.
7. A human-approved public post and a verified distribution receipt.

## 2. Current-state verdict

NodeKit is ready to begin a calibrated campaign, but not ready to start 16 autonomous builds at once.

### Already available

- NodeKit can generate a domain-blank application with a stable product grammar and deterministic local proof.
- NodeAgent exposes model route, provider, requested and resolved model, token usage, cached tokens, reasoning tokens, and cost when the underlying provider supplies them.
- NodeProof provides durable, resumable, budgeted execution and fail-closed verification gates.
- NodeBench already has durable execution traces, steps, decisions, evidence, approvals, verifications, and goal/drift fields.
- NodeBench TasteBench already supports owner-scoped blind A/B judgments, artifact eligibility, append-only decisions, and delayed role reveal.
- NodeBench dogfood runs already retain rendered evidence, input hashes, media, and independent QA output.
- The LinkedIn plane already has archive deduplication, a deterministic engagement gate, a judged content queue, scheduling, posting, and archive verification.
- Founder Quest Graph is a real production-certified calibration artifact with exact source and production-browser evidence.

### Gaps that must be closed before scaling

- There is no single receipt joining raw brief, research, build, repairs, deploy, production proof, taste, and publication.
- Coding-agent usage is not universally measurable. Native subscription-agent tokens must not be guessed.
- Current TasteBench is a two-artifact, single-owner workflow, not a multi-rater campaign arena with judge segments and confidence intervals.
- The NodeKit claim ledger and the newest factory evidence need reconciliation before public claims are generated.
- Founder Quest Graph is intentionally bounded and read-only. It does not prove authentication, durable mutation, live model execution, or approval-backed external action.
- The current `@homenshum/nodekit` package is not a stable public npm dependency; benchmark runs must pin an immutable commit or artifact digest.
- Kimi K3 is not yet a proven NodeAgent route in this environment. It requires a pinned route, live smoke test, usage capture, and application-level fallback.
- The standing app-scoring document referenced by `AGENTS.md` is missing from its current path and should be restored or replaced before campaign certification.

## 3. Campaign architecture

Do not build a second agent platform. Compose the existing systems with explicit ownership.

```text
YC brief
  -> NodeKit product architect
  -> NodeKit application factory
  -> NodeAgent model workers
       -> Kimi K3 frontend specialist
       -> independent visual critic
  -> generated application repository
  -> NodeProof supervisor
  -> NodeBench execution trace + evidence control tower
  -> dogfood and production browser proof
  -> NodeTaste campaign arena
  -> sealed benchmark receipt
  -> LinkedIn content queue
  -> human publication approval
  -> verified public distribution receipt
```

### System responsibilities

| System | Owns | Must not own |
|---|---|---|
| NodeKit | Product narrowing, product contract, app factory, canonical artifact grammar | Self-certification or unsupported domain claims |
| NodeAgent | Instrumented model execution, tool use, model/provider usage | Final product or taste verdict |
| Kimi K3 route | Interface hypothesis, frontend implementation, screenshot-guided repair | Target user selection, safety policy, or its own certification |
| NodeProof | Durable plan, budgets, resume, hard gates, sealed run result | Domain semantics or visual preference |
| NodeBench trace | Goal, vision, steps, decisions, evidence, approvals, drift | Hidden reasoning or invented cost data |
| Dogfood/browser QA | Rendered and interactive proof across required states | Holistic human taste verdict |
| NodeTaste arena | Blind product preference and diagnostic reasons | Functional eligibility |
| LinkedIn queue | Draft, judge, dedupe, schedule, post, archive | Creating claims absent from a sealed receipt |

### Repository boundaries

- Keep NodeBench as the campaign control plane.
- Build each RFS application in its own clean repository or isolated clean worktree.
- Pin the exact NodeKit, NodeAgent, NodeProof, model, prompt, and design-contract versions in every receipt.
- Do not merge generated applications into the NodeBench web shell.
- Do not use the dirty NodeKit development worktree as a campaign build environment.
- Never deploy the shared Convex production deployment out of band.

## 4. Campaign phases

### Phase 0: Run 00 infrastructure calibration

Reconstruct Founder Quest Graph as **Run 00**, without presenting it as an RFS completion.

Deliverables:

- A unified receipt joining its existing launch, local proof, deployment, and production browser evidence.
- Explicit unavailable fields for coding-agent token use and human attention where no evidence exists.
- A reconciled claim ledger using `planned`, `measured`, `verified`, or `published` status.
- A replayable NodeProof runner plan for future runs.
- A campaign dashboard record in NodeBench.

Exit criteria:

- One command or control-plane action can start or resume a campaign run.
- A run cannot reach `sealed` with missing required proof.
- The receipt distinguishes measured values from estimates and unavailable values.
- Receipt hashes bind source, product contract, code revision, deployment, proof, and publication artifacts.

### Phase 1: two full pilots

#### Pilot 1: 13/16 Software for Agents

Use the request closest to NodeKit's core substrate to validate the complete campaign machinery.

Required proof:

- Machine-readable case/run/stage/artifact/proposal/approval/receipt contract.
- At least one consequential but sandboxed proposal and approval workflow.
- Instrumented live model calls.
- Resume after an injected interruption.
- Production browser proof and blind taste comparison.

#### Pilot 2: 03/16 AI-Native Service Companies

Build the autonomous compliance desk to close the largest Founder Quest limitations.

Required proof:

- Authentication or owner-scoped access.
- Durable mutations.
- Evidence retrieval and provenance.
- Missing-evidence exception handling.
- Human approval before final delivery.
- A canonical audit-ready evidence binder.
- A realistic service completion receipt.

Exit criteria for Phase 1:

- Both pilots produce a valid `nodekit.rfs-benchmark-run/v1` receipt.
- At least one pilot exercises live provider usage and exact cost capture.
- At least one pilot exercises durable writes and approvals.
- The campaign can generate a post draft solely from sealed receipt fields.
- No pilot is published until its claim packet passes human review.

### Phase 2: frontend-taste pilot

Build 07/16 Dynamic Software Interfaces next. This is the best stress test for product specificity, UI hypotheses, behavioral diffs, responsive behavior, and the Kimi K3 frontend route.

This run must include the full ablation set described below and must not be labeled taste-certified until the minimum qualified vote counts are met.

### Phase 3: scaled waves

Run no more than two applications concurrently until the first six receipts show stable cost and failure distributions.

| Wave | Requests | Rationale |
|---|---|---|
| Calibration | Run 00 Founder Quest | Unify existing evidence; not part of 16 |
| Pilots | 13, 03, 07 | Core substrate, durable service, frontend taste |
| Software-native | 05, 12, 14, 16 | Reuse cases, approvals, evidence, and organizational artifacts |
| Operational | 09, 15, 01, 08 | Add supply-chain, geospatial, qualification, and constraint workflows |
| Scientific and high-consequence | 02, 04, 10, 11, 06 | Require stricter domain boundaries and simulation-only claims where appropriate |

## 5. The 16 build contracts

Every application is one deep vertical slice, not a broad industry platform.

| ID | Request / NodeKit concept | Target user | Primary job | Canonical artifact | Dominant surface and claim boundary |
|---|---|---|---|---|---|
| 01 | Low-Pesticide Agriculture / Per-Plant Intervention OS | Crop-protection lead | Approve the lowest-chemical effective intervention | Versioned field-intervention map and work order | Map-first review; synthetic or licensed data; NodeKit does not validate agronomy or robotics |
| 02 | AI-Native Discovery / Battery-Electrolyte Discovery Loop | Materials scientist | Select the next highest-information experiment | Versioned experiment batch | Hypothesis-to-result loop; no claim of laboratory discovery without real experimental evidence |
| 03 | AI-Native Services / Autonomous Compliance Desk | Compliance lead | Deliver an audit-ready evidence package | Evidence binder and exception log | Case workspace; sources and approvals visible; no autonomous legal certification |
| 04 | Personalized Medicine / N-of-1 Care Conference Packet | Specialist or care team | Prepare a patient-specific decision-support dossier | Clinician-approved care-conference packet | Timeline, conflicts, uncertainty, and sources; no diagnosis or autonomous care decision |
| 05 | Company Brain / Executable Playbook Compiler | Process owner | Convert tacit know-how into an approved executable playbook | Versioned skills pack | Provenance map and historical-case tests; publication requires experienced owner approval |
| 06 | Counter-Swarm Defense / Defensive Sensor-Fusion Caseflow | Defensive operator | Correlate alerts and authorize an appropriate response | Common operating picture and signed decision record | Simulation and defensive coordination only; no weapon-control implementation |
| 07 | Dynamic Interfaces / Personal Interface Compiler | Application user | Reshape an application around the current outcome | Versioned interface specification | Preview and behavioral diff; stable backend primitives and recovery path |
| 08 | Electronics in Space / Orbital Inference Qualification | Qualification engineer | Produce a flight-readiness dossier | Qualification dossier | Requirement matrix and test evidence; NodeKit does not qualify real flight hardware |
| 09 | Hardware Supply Chain / 24-Hour Prototype Loop | Hardware engineer | Move CAD to an inspected, approved part | Manufacturing package | Revision-bound quotes and inspection loop; sandbox ordering unless authorized |
| 10 | Industrial Capabilities in Space / Lunar Process Recipe OS | Process engineer | Turn a target output into a validated process recipe | Process recipe, resource budget, and mission procedure | Simulation and test-evidence orchestration; no claim of physical lunar manufacturing |
| 11 | Inference Chips for Agents / Agent Workload Trace Lab | Chip architect or compiler engineer | Compare architecture or scheduling changes on real agent workloads | Benchmark suite and architecture decision report | Reproducible traces and counters; no fabricated hardware measurements |
| 12 | SaaS Challengers / AI-Native QMS | Quality leader | Close a nonconformance through verified corrective action | Closed CAPA record | Dense case workspace with evidence, approval, verification, and audit history |
| 13 | Software for Agents / Agent-Native Application Substrate | Agent-app builder and operator | Let agents perform consequential work through typed contracts | Approved artifact and content-bound receipt | Machine and human interfaces share governed state; no ungoverned back door |
| 14 | Enterprise Sales / Enterprise Pilot Factory | Startup team and enterprise sponsor | Turn a messy process into a bounded deployable vertical slice | Working slice and pilot dossier | Access model, risks, ownership, and before/after measures; no guarantee of a sale |
| 15 | Semiconductor Supply Chain / Allocation and Risk Control Tower | Supply-chain director | Respond to a capacity or supplier constraint | Approved allocation plan and risk register | Scenario-first control tower; assumptions and freshness visible |
| 16 | AI Company OS / Closed-Loop Company OS | Operational leader | Detect divergence and approve an executable correction | Versioned operating plan | Evidence-to-action loop with approval and measured impact; no unsupervised organization-wide writes |

## 6. Standard run lifecycle

Every run follows the same state machine.

```text
registered
  -> researched
  -> contracted
  -> scaffolded
  -> implemented
  -> locally_verified
  -> dogfood_verified
  -> taste_evaluated
  -> deployed
  -> production_verified
  -> sealed
  -> publication_approved
  -> published
  -> distribution_verified
  -> engagement_observed
```

A failure does not disappear. It creates an attempt, evidence, a decision, and either a bounded repair or a stopped run.

### Required stages

1. **Register brief**: capture the YC source URL, request title, retrieval time, source snapshot, and brief hash.
2. **Research**: retain source references and unresolved disagreements; distinguish source facts from product inference.
3. **Narrow**: select one user, one job, one terminal artifact, and explicit non-goals.
4. **Create product contract**: workflow, permissions, data boundaries, exceptions, success criteria, design intent, and required states.
5. **Propose UI hypotheses**: require a structured hypothesis before implementation and, for benchmarked ablations, a materially different alternative.
6. **Scaffold**: run NodeKit from a clean directory with immutable dependency references.
7. **Implement**: backend/domain work and the Kimi-routed frontend stage operate under separate stage budgets.
8. **Local hard gates**: typecheck, targeted tests, build, accessibility, interaction tests, and receipt integrity.
9. **Dogfood**: render all required states, retain screenshots/video, capture browser console/network evidence, and run an independent critique.
10. **Repair**: at most two benchmarked visual repair rounds; record every finding and change.
11. **Taste arena**: blind eligible candidates only after hard gates pass.
12. **Deploy**: isolated preview first, then campaign production target after approval.
13. **Production proof**: repeat task-path, responsive, console, network, and content-hash verification against the deployed revision.
14. **Seal**: calculate the receipt digest and freeze claim inputs.
15. **Generate post packet**: derive claims, carousel frames, captions, limits, and unresolved exceptions from the sealed receipt.
16. **Approve and publish**: require explicit human approval for externally visible publication.
17. **Verify distribution**: retain public URL, platform ID, rendered screenshot, content hash, and verification timestamp.
18. **Observe**: collect 48-hour and 7-day engagement without rewriting the sealed benchmark result.

## 7. Unified benchmark receipt

Create one canonical receipt per application: `nodekit.rfs-benchmark-run/v1`.

```json
{
  "schemaVersion": "nodekit.rfs-benchmark-run/v1",
  "runId": "rfs-2026-13-001",
  "status": "sealed",
  "request": {
    "season": "Summer 2026",
    "requestId": "13",
    "title": "Software for Agents",
    "sourceUrl": "https://www.ycombinator.com/rfs",
    "retrievedAt": "2026-07-22T00:00:00.000Z",
    "sourceSnapshotSha256": "...",
    "briefSha256": "..."
  },
  "oracle": {
    "goalId": "...",
    "visionSnapshot": "...",
    "successCriteria": ["..."],
    "sourceRefs": ["..."],
    "crossCheckStatus": "passed",
    "deltaFromVision": "...",
    "dogfoodRunId": "..."
  },
  "productContract": {
    "targetUser": "...",
    "primaryJob": "...",
    "canonicalArtifact": "...",
    "nonGoals": ["..."],
    "designIntentSha256": "...",
    "contractSha256": "..."
  },
  "environment": {
    "nodekitRevision": "...",
    "nodeagentRevision": "...",
    "nodeproofRevision": "...",
    "runnerImageDigest": "...",
    "repository": "...",
    "candidateCommit": "..."
  },
  "stages": [
    {
      "name": "frontend_implementation",
      "attempt": 1,
      "startedAt": "...",
      "completedAt": "...",
      "wallClockMs": 0,
      "agentActiveMs": 0,
      "waitMs": 0,
      "result": "passed"
    }
  ],
  "modelUsage": [
    {
      "stage": "frontend_implementation",
      "provider": "openrouter",
      "requestedModel": "moonshotai/kimi-k3-20260715",
      "resolvedModel": "...",
      "generationId": "...",
      "inputTokens": 0,
      "outputTokens": 0,
      "reasoningTokens": 0,
      "cacheReadTokens": 0,
      "cacheWriteTokens": 0,
      "costUsd": 0,
      "costKind": "provider_reported"
    }
  ],
  "nonModelCosts": [
    {
      "kind": "browser_or_ci_or_deployment_or_human_panel",
      "amountUsd": 0,
      "source": "invoice_or_meter",
      "evidenceSha256": "..."
    }
  ],
  "humanInterventions": [
    {
      "kind": "approval_or_credential_or_repair",
      "startedAt": "...",
      "completedAt": "...",
      "activeMs": 0,
      "reason": "...",
      "decisionId": "..."
    }
  ],
  "result": {
    "applicationSha256": "...",
    "deploymentUrl": "...",
    "deploymentRevision": "...",
    "browserProofSha256": "...",
    "tasteReceiptSha256": "...",
    "releaseReady": true,
    "limitations": ["..."]
  },
  "publication": {
    "claimPacketSha256": "...",
    "approvalId": null,
    "distributionReceiptSha256": null
  },
  "receiptSha256": "..."
}
```

### Accounting rules

- **Wall-clock time** starts at brief registration and ends at production certification.
- **Agent-active time** counts instrumented worker execution, not queue or provider wait.
- **Human-attention time** records actual approval, credential, review, and manual-repair intervals.
- **Provider-reported cost** and **estimated cost** are different `costKind` values and are never silently combined.
- If a coding surface does not expose token use, store `null` plus `unavailableReason`; never store zero.
- Full-token-accounting claims are allowed only when every build worker ran through an instrumented provider or harness.
- Every retry retains its own usage, result, and duration.
- Total cost includes model, search, browser, CI, deployment, and compensated evaluation. Human internal labor is reported as time unless a defensible rate policy is declared before the run.
- Publish both machine time and human attention. A fast machine result with hours of hidden human repair is not autonomous.

## 8. Kimi K3 frontend route

Kimi K3 should be the preferred, replaceable frontend specialist, not NodeKit's product brain or judge.

### Route contract

```yaml
frontend_architect:
  requested_model: moonshotai/kimi-k3-20260715
  provider: openrouter
  required_capabilities:
    - tool_use
    - image_input
    - repository_context
  proposal_before_write: true
  max_visual_repair_rounds: 2
  record_requested_and_resolved_model: true
  record_generation_id: true
  record_usage_and_cost: true
  independent_judge_required: true
```

Because Kimi K3 currently has a single OpenRouter provider, application-level alternate-model fallback is required. Provider routing alone is not redundancy. A fallback changes the candidate identity and must be visible in the receipt; a run may not silently claim Kimi output if another model completed it.

### Frontend worker inputs

- Product contract and design intent.
- Typed backend/tool contracts.
- Domain vocabulary and source references.
- Required workflow and exception states.
- Existing tokens and accessibility rules.
- Reference board with principle-level annotations, not layouts to clone.
- Explicit template-smell avoid list.
- Fixed time, token, cost, and repair budgets.

### Required hypothesis output

```json
{
  "interfaceHypothesis": "...",
  "primarySurface": "...",
  "supportingSurfaces": ["..."],
  "visualRationale": ["..."],
  "hardestInteraction": "...",
  "responsiveRisk": "...",
  "domainTrustRisk": "..."
}
```

NodeKit accepts, rejects, or requests an alternate hypothesis before the implementation budget opens.

## 9. NodeTaste campaign benchmark

Extend TasteBench rather than replacing it. Preserve the current append-only blind-comparison semantics and add a campaign version for repeated qualified judgments.

### Candidate design

Every request produces:

- **A: raw-RFS baseline** — raw request to the pinned Kimi route with only common environment constraints.
- **B: NodeKit production candidate** — NodeKit product/design contract to the same pinned Kimi route.
- **C: model-substitution candidate** — NodeKit contract to a pinned alternate frontend model on selected ablation runs.

Run C for at least 01, 03, 07, and 13. These cover operational mapping, service caseflow, interface generation, and NodeKit's core agent substrate.

The production candidate may receive a bounded critique and repair pass. The one-shot baseline remains frozen.

### Required review packet

Every eligible candidate must expose the same states:

1. First-load orientation.
2. Realistic populated workspace.
3. Primary task in progress.
4. AI proposal.
5. Human review or approval.
6. Error, disputed, stale, or permission-blocked state.
7. Completed canonical artifact.
8. Mobile or narrow viewport.
9. A short interaction recording for the primary job.

### Hard eligibility gate

Taste voting begins only after:

- Required workflow passes.
- No uncaught browser, console, or network errors.
- No material responsive overflow.
- Keyboard path and focus behavior pass.
- Accessibility baseline passes.
- Required states exist and use realistic data.
- The deployment and screenshots bind to the candidate commit.

### Blind vote

Primary question:

> Which product would you be more confident shipping to the named target user for the named primary job?

Candidate identity and left/right order remain hidden until the vote is durably stored.

Non-scoring diagnostic tags:

- Product specificity.
- Workflow clarity.
- Domain authenticity.
- Visual hierarchy.
- Typography.
- Layout and spacing.
- Information density.
- Interaction quality.
- Trust.
- Brief fidelity.
- Fewer functional problems.

Also require:

> Does either candidate contain a decision that would prevent you from shipping it?

The objection must include severity, affected state, rationale, and judge role.

### Judge segments

- Product designer.
- Domain practitioner.
- Target or adjacent user.
- Frontend engineer.

Publish segment results and disagreement. Do not hide a practitioner loss inside a general-user win.

### Rating and certification

Use a Bradley-Terry or TrueSkill-style relative rating with a confidence interval after sufficient votes. Before then, label the result exploratory.

Recommended minimum for a per-app certificate:

- 30 qualified votes.
- At least 5 product designers.
- At least 5 practitioners.
- At least 5 target or adjacent users.
- Remaining qualified votes may include frontend engineers and additional members of the three primary groups.

Proposed `taste-certified` threshold:

- All hard gates pass.
- At least 70% preference against the raw generic baseline.
- At least 55% preference against a pinned frontier-model baseline when that candidate exists.
- Designer preference at least 60%.
- Practitioner preference at least 60%.
- Critical practitioner objection rate below 5%.
- No major responsive or exception-state failure.

If the vote minimum is not met, publish `taste-evaluated: provisional`, the sample composition, and the interval. Never convert a small panel into a definitive score.

## 10. Budgets and stop conditions

Run 00 and the first two pilots establish empirical budgets. Until then, use provisional safety caps, not cost forecasts.

Provisional per-production-candidate caps:

- Two visual repair rounds.
- One automatic implementation retry per failed stage; additional retries require a recorded decision.
- USD 25 for the Kimi frontend stage.
- USD 100 total measured model spend for one production candidate.
- Six hours of agent-active time.
- Twenty-four hours of wall-clock time before an explicit continuation decision.
- No production credentials until local and dogfood gates pass.

Baseline and ablation candidates get separately declared budgets so the production candidate cannot consume their allocation.

After six completed RFS runs:

- Publish p50 and p95 by stage.
- Set future caps from the observed distribution, not intuition.
- Report cost per passed run, cost per taste-qualified run, repair yield, and human-attention minutes.

Automatic stop conditions:

- Budget exceeded.
- Unresolved critical security, privacy, medical, defense, or domain objection.
- Missing source provenance for a consequential claim.
- Model fallback without candidate reclassification.
- More than two visual repair rounds.
- Deployment revision differs from certified revision.
- Receipt integrity failure.
- Publication copy introduces a claim absent from the sealed claim packet.

## 11. Publication pipeline

Do not write all 16 final posts in advance. Concepts may be drafted, but past-tense performance claims are generated only from sealed receipts.

### Claim ledger

Every public claim has one status:

- `planned`: intended capability or experiment.
- `measured`: observed once with retained evidence.
- `verified`: independently checked against an exact revision.
- `published`: verified claim with a distribution receipt.

The copy generator may use past tense only for `verified` or `published` claims.

### Five-frame post packet

1. **YC brief** — request, retrieval date, and the problem received.
2. **Narrowing decision** — one user, one job, one wedge, and alternatives rejected.
3. **Service blueprint** — frontstage experience, backstage agents, approvals, and exceptions.
4. **Product artifact** — deployed interface and canonical output.
5. **Proof** — exact commit, URL, time, token coverage, cost, repairs, human attention, browser result, taste sample, unresolved limitations, and receipt digest.

### Queue contract

Add a campaign post type such as `nodekit_rfs_showcase` with metadata:

```json
{
  "rfsId": "13",
  "runId": "rfs-2026-13-001",
  "receiptDigest": "...",
  "deploymentUrl": "...",
  "candidateCommit": "...",
  "claimPacketDigest": "...",
  "carouselAssetDigests": ["..."]
}
```

The queue must:

- Dedupe by RFS ID, run ID, receipt digest, channel, and content hash.
- Run the existing engagement-quality checks even if the founder's personal profile is exempt from the hard org gate.
- Require a JSON LLM judge and explicit human publication approval.
- Hold posts when receipt claims and copy diverge.
- Store the final rendered content hash and public URL.

### Cadence

- Publish after evidence, not according to an immovable calendar.
- Target two posts per week once the first three applications are certified.
- Start with 13, then 03, then 07 so the audience sees substrate, a real service workflow, and frontend taste.
- Use the remaining wave order unless evidence or domain review requires a pause.
- Collect 48-hour and 7-day engagement outcomes. Classify genuine questions, practitioner objections, and generic engagement separately.

## 12. Implementation backlog

### P0 implementation status (2026-07-22)

The first executable slice is implemented in the NodeBench control plane.

| Contract surface | Canonical integration point | Status |
|---|---|---|
| Receipt JSON Schema | `proof/contracts/nodekit-rfs-benchmark-run-v1.schema.json` | Implemented |
| Receipt types and semantic validator | `packages/mcp-local/src/contracts/nodekitRfsBenchmark.ts` | Implemented |
| ProofLoop runner-contract JSON Schema | `proof/contracts/nodekit-rfs-proofloop-runner-v1.schema.json` | Implemented |
| ProofLoop `proofloop-runner-plan-v1` compiler | `buildNodekitRfsProofloopPlan` in `packages/mcp-local/src/contracts/nodekitRfsBenchmark.ts` | Implemented |
| Existing execution-trace binding | `NODEKIT_RFS_TRACE_PROTOCOL` plus `buildNodekitRfsTrace*Args` in the same module | Implemented without new Convex tables or tools |
| Receipt/contract CLI | `scripts/nodekit-rfs/benchmark-contract.mts` | Implemented |
| Focused invariant tests | `packages/mcp-local/src/__tests__/nodekitRfsBenchmark.test.ts` | 12 passing |

The compiled ProofLoop plan emits two durable tasks for every standard stage: the stage command and a receipt checkpoint. The final `seal` checkpoint runs the strict seal validator. ProofLoop owns append-only state, budget enforcement, locking, and resume; NodeKit owns the benchmark semantics; the existing NodeBench execution-trace primitives remain the durable observability plane.

Seal validation fails closed when:

- A metric is `null` without a non-empty `unavailableReason`.
- A provider-started call lacks the resolved model.
- A required stage or proof is absent or not passed.
- An immutable candidate revision is dirty or not a 40-character commit SHA.
- `fullTokenAccounting` is claimed while any token category is unavailable.
- Release readiness, deployment revision, trace binding, or receipt integrity evidence is missing.

Discovered revisions at implementation time:

| Component | Revision | Eligibility note |
|---|---|---|
| NodeBench base | `abbb23287225d31dbfebf716b4f278d7d4f1800f` | Clean base before this slice; final campaign candidate will be the commit containing this implementation |
| NodeProof | `53e084ee4a9941fb205ebc66380e2fc009c4d465` | Clean discoverable candidate; native `proofloop-runner-plan-v1` source of truth |
| NodeAgent | `c0ad5236d5424fca60008ed500cb565683bcd1d5` | Clean discoverable candidate; Kimi route work remains separate |
| NodeKit / node-platform | `c701819f06c04c8be894f5f89cf5b2ae5d969675` | Commit is discoverable, but the inspected worktree had 398 dirty entries; do not use that worktree for a benchmark run. Create a clean checkout at an approved immutable revision first |

The first Run 00 contract instance is intentionally not checked in yet. The NodeKit revision must first be selected from a clean checkout; the runner-contract validator refuses a dirty candidate rather than normalizing it away.

### P0: campaign runner and evidence

- [x] Define and validate `nodekit.rfs-benchmark-run/v1`.
- [x] Add a NodeProof runner contract and plan compiler for the standard lifecycle.
- [ ] Add NodeBench campaign run, stage, attempt, usage, intervention, and artifact views using existing execution-trace primitives.
- [x] Add exact-versus-estimated-versus-unavailable model and non-model accounting.
- Reconcile NodeKit factory and claim ledgers.
- Recreate Founder Quest as Run 00.
- Restore or replace the missing current app-scoring and dogfood instructions document.

### P0: Kimi route

- Register the pinned Kimi K3 model in NodeAgent.
- Add a `frontend_architect` route instead of changing the global default.
- Add provider-reported usage and generation-ID persistence.
- Add single-provider failure handling and visible alternate-model fallback.
- Run a live smoke test for text, tool use, screenshot input, usage, and cost.
- Fail closed if the resolved model is not recorded.

### P0: proof and deployment

- Standardize clean repository creation and immutable NodeKit installation.
- Standardize preview and production deployment receipts.
- Add required-state browser capture and deployed-revision binding.
- Add campaign-specific security, privacy, and domain-boundary checks.

### P1: NodeTaste campaign arena

- Add campaign/scenario records beyond the current fixed six scenarios.
- Support more than two artifacts and generate randomized pairings.
- Add judge role, qualification evidence, reason tags, and critical objections.
- Add vote-count thresholds, segment summaries, rating, and confidence interval.
- Keep role reveal after durable vote creation.
- Add exportable taste receipts bound to dogfood run and commit hashes.

### P1: publication

- Add `nodekit_rfs_showcase` to the content queue and archive metadata.
- Add claim-packet validation against the sealed benchmark receipt.
- Generate the five-frame asset manifest.
- Require publication approval and store platform distribution proof.
- Add 48-hour and 7-day campaign engagement snapshots.

### P2: scale and analysis

- Add cross-run p50/p95 time and cost dashboards.
- Add autonomy metrics: intervention count, attention minutes, retry count, and uninstrumented-token share.
- Add product-vs-model ablation reports.
- Add category breakdowns across software, operations, science, hardware, and high-consequence domains.
- Publish aggregate campaign methodology and limitations after the first six runs.

## 13. Verification matrix

| Plane | Required proof |
|---|---|
| Source | YC snapshot, retrieval time, source hash, brief hash |
| Product | User, job, artifact, non-goals, success criteria, rejected alternatives |
| Build | Clean start, immutable revisions, file diff, build/test logs |
| Model | Requested/resolved model, provider, generation ID, tokens, cost kind |
| Runtime | Main workflow, durable state where required, approvals, exception recovery |
| UI | All required states, mobile, keyboard, accessibility, console/network cleanliness |
| Taste | Eligible blind pairs, judge segments, reason tags, objections, uncertainty |
| Deploy | Exact revision, URL, timestamp, response and asset integrity |
| Production | Browser proof against deployed revision and canonical artifact creation |
| Economics | Stage time, wall time, active time, waits, model/non-model cost, attention |
| Claims | Claim ledger, limitations, sealed claim-packet hash |
| Publication | Human approval, content/assets hash, public URL, rendered screenshot |

## 14. Campaign success measures

Report the distribution, not just the average.

- RFS runs registered, locally passed, deployed, production-certified, taste-evaluated, taste-certified, and published.
- Completion rate by domain-risk class.
- p50/p95 wall-clock, agent-active, wait, and human-attention time.
- p50/p95 provider-reported model cost and total measured cost.
- Percentage of build calls with exact token coverage.
- Repair loops and pass yield by stage.
- NodeKit-contract uplift over raw-RFS Kimi baseline.
- Model-substitution delta on the four ablation requests.
- Designer, practitioner, user, and engineer preference separately.
- Critical objection rate and unresolved limitation count.
- 48-hour and 7-day genuine-engagement rate after publication.

The final campaign claim should be no stronger than the weakest material evidence category. If 16 apps deploy but only 6 have qualified taste panels, report `16 deployed, 6 taste-certified`; do not call all 16 taste-certified.

## 15. Immediate next actions

Execute in this order:

1. Approve this campaign contract and select the immutable NodeKit/NodeAgent/NodeProof candidate revisions.
2. Instantiate the implemented unified receipt and ProofLoop runner contract for Run 00 from clean immutable candidate checkouts.
3. Reconstruct Founder Quest as Run 00 and audit every unavailable metric using the new validator.
4. Implement and live-smoke the pinned Kimi K3 frontend route.
5. Extend TasteBench just enough for multi-rater pilot comparisons and provisional results.
6. Run 13/16 end to end from a clean repository.
7. Run 03/16 with owner scope, durable writes, approval, and evidence binder.
8. Run 07/16 with full A/B/C frontend ablation.
9. Publish the methodology and first three evidence-backed posts.
10. Scale through the remaining waves, at most two applications at a time until six stable receipts exist.

## 16. Decision record

The campaign makes the following deliberate choices:

- **Build before post.** The concept copy is a brief, not evidence of execution.
- **One deep workflow per request.** Breadth would hide whether the product path works.
- **Kimi is a specialist.** NodeKit owns product intent; independent systems own certification.
- **Compare product contracts, not only models.** Raw-RFS-to-Kimi versus NodeKit-to-Kimi measures NodeKit's actual contribution.
- **Keep quality and taste separate.** A functional candidate must pass hard gates before preference voting.
- **Publish uncertainty.** Small panels, missing tokens, and estimated costs remain visibly qualified.
- **Treat high-consequence domains as orchestration demonstrations.** The campaign does not claim to build or validate the underlying medicine, weapons, space hardware, agriculture science, or semiconductor process.
- **Require human authority for public claims.** Autonomous preparation does not imply autonomous publication.

The benchmark's strongest eventual statement is:

> **Sixteen different frontiers. Sixteen deployed vertical slices. One measured path from raw brief to provable product, including the time, cost, repairs, human attention, and taste evidence for every run.**
