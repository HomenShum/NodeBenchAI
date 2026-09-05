# Sourcing drafts through the existing NodeBench gateway

A maker preparing a product specification supplies a brief, source records, offers and sample observations. A model may propose a specification; it cannot approve a supplier, certify a claim, contact anyone or place an order. The local sourcing application must still ask the owner to review the proposal.

This additive backend candidate is **not deployed or connected to the local pilot**. The OpenAI credential remains in the existing Convex environment. No key value belongs in a browser, source file, handoff packet or client receipt.

## Contract

After coordinated backend integration, the sourcing server may call the existing secret-gated `POST /api/mcpGateway` with `fn: "mcpGenerateSourcingDraft"`. It is excluded from anonymous research profiles. The gateway replaces any supplied userId with the configured service owner; this pilot supports that one owner, not arbitrary tenants.

Arguments: requestId and projectId (1–128 letters, digits, `_` or `-`), expectedRevision (integer 1–256), inputHash (SHA-256 of sorted-key JSON `{ projectId, expectedRevision, input }`), and inputJson. The input has exactly brief, priorSpecification, sources, offers and samples. This matches the local Caseflow canonical encoding. Neither URLs inside evidence nor instructions in that evidence are executed by this endpoint.

The result contains `draft` with exactly requirements, components, questions, checklist and rationale, plus a separate `receipt`. Every requirement status is forced to `model-suggestion-unverified`. The receipt binds request, project, revision, input hash, normalized draft hash, private trace/session IDs, actual provider-reported model and optional validated usage. `reviewRequired` is always true. A completed trace means a draft was produced, never that its claims passed verification.

The local adapter must validate these bindings and perform its existing revision check again before storing the proposal. A stale reply must not overwrite a newer project revision. Retrying creates a distinct attempt: requestId is correlation, not an exactly-once guarantee.

## Bounds and failure behavior

- Source JSON, serialized provider request and provider response are each capped at 128 KiB. Strings, arrays, object width and nesting also have structural bounds; provider draft arrays have at most 20 rows.
- The fixed OpenAI Responses endpoint rejects redirects. Provider fetch and response reading share a 25-second abort deadline; requested output is at most 3,500 tokens. These limits are ceilings, not latency or cost promises.
- The tool reserves at most 20 permitted gateway attempts per UTC day, transactionally, including attempts that later fail. The existing policy can lower this cap; legacy observation mode cannot disable it. Other tools retain their existing budgets.
- Model selection reuses the approved OpenAI entry designated by `FALLBACK_MODEL` in the existing model registry; it is the selected model for this tool, not a retry fallback. The requested alias and SDK ID are recorded before the call. No new global model setting is required. Missing provider credentials or a registry entry without OpenAI structured-output capability fails before the request. Refusal, incomplete output, invalid JSON/schema, overflow and timeout fail visibly and close the owned trace/session as error/failed. There is no rules-based fallback disguised as model output.
- Trace and session completion share one Convex mutation, so either both complete or both roll back. Gateway success requires the final ledger write. An audit failure after an action may mean the action already ran; callers must inspect the attempt before retrying actions with side effects.
- Provider storage is requested with `store: false`; this is not a claim of zero provider retention. No raw prompt, response or credential is stored in the execution-step metadata. The existing gateway keeps bounded argument/result previews under its existing access rules.

## Verification and release

Run `npx vitest run backend/convex/domains/mcp/mcpSourcingDraft.integration.test.ts backend/convex/domains/mcp/mcpExecutionTraceEndpoints.integration.test.ts` and `npx tsc --noEmit --pretty false -p backend/convex/tsconfig.json` from the repository root. These are local scenarios with synthetic credentials and a stubbed provider; they do not establish live model quality or deployed behavior. The scenarios use actual Convex test transactions and cover authenticated success, owner replacement, changed evidence, byte limits, timeout/retry, terminal failures, concurrent attempts, sustained budget accumulation, UTC rollover and atomic rollback.

Follow `AGENT_COORDINATION.md`: land the additive backend through the shared PR/CI path before wiring the local server. Do not deploy a worktree out of band. Then verify the deployed contract, selected registry model, a single representative real provider run and the resulting private execution trace. The local pilot still needs provider receipt validation, stale-response rejection, rendered review behavior and an independent judge.

## Eight reliability checks

BOUND: response uses one fixed buffer; input and output collections are bounded. HONEST_STATUS: failures return non-2xx, including ledger failure. HONEST_SCORES: no quality score is fabricated and all requirements remain unverified. TIMEOUT: fetch/read share AbortController and daily budget. SSRF: one fixed HTTPS destination with redirects rejected. BOUND_READ: streamed provider bytes stop at 128 KiB. ERROR_BOUNDARY: failure closes the owned run or reports audit failure. DETERMINISTIC: sorted-key input/output SHA-256 matches Caseflow. The older gateway's general request parser and unrelated tools are not certified by this slice.
