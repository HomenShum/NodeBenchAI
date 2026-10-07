# Entity Intelligence

Use this capability for source-grounded questions about companies, markets,
competitive position, diligence, and changes over time. The expected result is
an evidence-backed answer or reusable run artifact, not an unsupported chat
response.

## Brownfield status

This pack is logically registered but not physically extracted. Production
execution remains in:

- `backend/convex/domains/redesign/chatRuns.ts` for orchestration and response
  policy;
- `backend/convex/domains/agents/` for worker orchestration;
- `packages/mcp-local/src/tools/` for the tool surface;
- `workers/node/routes/search.ts` and `workers/node/pipeline/` for grounding and
  judges;
- `apps/web/src/features/redesign/components/ChatAssistantMessage.tsx` for
  rendering.

Do not duplicate or move those implementations during contract alignment. Use
the evaluation bindings in `../../evals/` to verify the current paths, and treat
`repo-local-nodebench` as authoritative until shadow parity supports promotion
to `nodeagent-native`.

## Output contract

- Preserve source URLs and citation bindings for material claims.
- Label unavailable evidence and failed fetches honestly.
- Apply the deterministic response-shape policy from the live runtime.
- Keep durable writes behind the existing policy and approval gates.
- Preserve run, tool, verification, and deployment evidence needed for a future
  canonical receipt.
