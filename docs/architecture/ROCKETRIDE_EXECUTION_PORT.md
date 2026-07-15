# NodeBenchAI Execution Port

NodeBenchAI can accept candidate work from its native executor, a RocketRide
sidecar, or a LangChain sidecar through the versioned
`node.workflow-execution/v1` envelope. The app does not import either framework.

The executor returns an evidence-bound `AgentOutputEnvelope` report packet. `inspectNodeBenchWorkflowCandidate()` verifies:

- request, fixture, trace, input digest, and idempotency-key binding;
- the frozen application commit and runtime provenance;
- canonical candidate SHA-256, bounded size, event order, deadline, counters, and reported runtime health;
- NodeBenchAI's existing candidate invariants.

A successful receipt says `candidate_validated`, not committed. Final authority
remains with Convex artifact persistence and benchmark score mutations. The
inspector accepts no backend mutation port, so a sidecar cannot bypass those
controls.

## Adapter Shape

```ts
const executionPort =
  createNodeWorkflowSidecarExecutionPort<NodeBenchWorkflowCandidate>({
    framework: "rocketride", // Use "langchain" for that sidecar.
    endpoint: process.env.NODEBENCH_WORKFLOW_SIDECAR_URL!,
    headers: sidecarToken ? { authorization: `Bearer ${sidecarToken}` } : {},
  });
const result = await executionPort.execute(request, { signal });
const admission = await inspectNodeBenchWorkflowCandidate({
  request,
  result,
  expectedAppCommit,
  digestCandidate,
});

if (!admission.accepted) return admission.receipt;
// Submit admission.candidate to the existing proposal path; do not write directly.
```

The endpoint is fixed at port creation, requires HTTPS except on localhost,
inherits the request deadline, and rejects non-JSON or oversized responses.
`createNativeNodeWorkflowExecutionPort()` wraps the current native control
behind the same request/result contract.

The deterministic study requires no model or cloud credential. A cloud transport
may implement the same port, but must report `location: "cloud"` and is an
operational appendix rather than a replacement for the pinned local benchmark.

## Evidence Ingestion

`validateRocketRideEvidenceBundle()` verifies source SHA, safe manifest paths,
hashes, costs, failure counts, negative findings, and evidence gaps before
`buildRocketRideEvidenceReportCandidate()` creates an unpersisted source-bundle
report. `externally_accepted` is rejected unless the bundle includes a hashed
`submission_receipt` artifact issued outside the application. NodeBenchAI can
therefore organize and report the study without promoting its own local result.

## Verify

```powershell
npx vitest run src/shared/nodeBenchWorkflowCandidate.test.ts src/shared/rocketRideEvidenceBundle.test.ts
```
