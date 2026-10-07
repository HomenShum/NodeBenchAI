# ActiveGraph offline canaries

Status: **evaluation only; never a production runtime or source of truth**

This directory contains two pinned ActiveGraph 1.10.0 lanes:

1. **Synthetic graph-hop golden.** Characterizes deterministic fork, traversal,
   diff, persistence, reload, and issue #67 payload containment.
2. **Canonical NodeKit replay.** Accepts only a complete
   `nodekit.run-export/v1` document, persists the exact ordered event payloads
   into disposable SQLite, reloads them, and requires exact parity.

Neither lane calls an LLM, MCP tool, Convex function, or network service during
execution. NodeBench's owner-scoped Convex runtime remains authoritative.

See
[`NODEKIT_ACTIVEGRAPH_CANARY.md`](../../docs/architecture/NODEKIT_ACTIVEGRAPH_CANARY.md)
for the authority boundary and adoption gates.

## Safety boundary

The supported real-export entrypoint is the Node wrapper:

[`scripts/nodekit/runActiveGraphCanary.mjs`](../../scripts/nodekit/runActiveGraphCanary.mjs)

It validates the original export before creating canary output, writes a
canonical disposable copy into a new exclusive evidence directory, and invokes
an immutable Docker image with no network, a read-only root filesystem, all
Linux capabilities dropped, resource limits, and only that evidence directory
mounted writable. The source export and repository are not mounted. The source
export is never modified. ActiveGraph outputs cannot feed an answer, approval,
or NodeBench mutation.

The Python adapter independently verifies:

- exact contract shape;
- contiguous order beginning with `run.started`;
- exactly one terminal event in the final position;
- balanced explicit span lifecycles;
- every previous-event and content hash;
- the event-chain and span-lifecycle receipt;
- the chain head; and
- the whole-export hash.

Validation finishes before the SQLite path is created. A malformed, incomplete,
oversized, or tampered export fails closed. The CLI also refuses to execute
outside Docker; the host-only path exists solely as a private unit-test seam.

Every stored event contains only `nodekit.safe-event-payload/v1`: a bounded
allowlist of structural scalar fields plus the digest and byte count of a
sensitivity-redacted source payload. Raw `toolArgs`, span data, evidence text,
decision text, and arbitrary metadata are never copied into the
immutable-while-retained event table or the ActiveGraph database.

The contract caps each redacted source at 32 KiB, each stored projection at
2 KiB, and each run at 256 events. Every append reserves enough capacity to
close all open spans plus write a terminal event. Only that terminal event gets
an expiry timestamp. The bounded sweep follows terminal-only indexes, drains up
to 1,024 event rows per mutation, schedules one continuation while a backlog
remains, and fails stale running traces before starting their 30-day retention
clock. Owners also have an explicit terminal-history deletion mutation.

## Upstream pin

`requirements.in` pins the direct dependencies exactly:

- `activegraph==1.10.0`
- `jsonschema==4.26.0`
- `pytest==9.1.1`
- `rfc8785==0.1.4`

ActiveGraph requires Python 3.11 or newer.
The RFC 8785 pin makes Python reproduce ECMAScript number serialization and
UTF-16 property ordering used by the TypeScript exporter.

| Reference                                  | Immutable revision                         |
| ------------------------------------------ | ------------------------------------------ |
| Annotated tag object `v1.10.0`             | `3fbcd8fc56a45ae68622d4e2b18a6d5844180527` |
| Released tag `v1.10.0` commit              | `148e12c2969f18fa12a1a3c2e75f3affd9aa0616` |
| Upstream `main` inspected during the audit | `8aedb1866cf5dce056af97529152ffd6f468a1ed` |

`UPSTREAM.json` records the provenance. The executable dependency is the
released package, never a floating Git revision. Upstream features and claims
are audit data only; they do not grant ActiveGraph authority over NodeBench.

## Setup

Run from the repository root:

```powershell
$ActiveGraphVenv = Join-Path (Get-Location) ".tmp\venvs\activegraph-canary"
New-Item -ItemType Directory -Force (Split-Path $ActiveGraphVenv) | Out-Null
python -m venv $ActiveGraphVenv
& "$ActiveGraphVenv\Scripts\python.exe" -m pip install -r evals/activegraph/requirements.in
& "$ActiveGraphVenv\Scripts\python.exe" -m pip check
$env:PYTHONPATH = (Resolve-Path "evals/activegraph/src").Path
```

Dependency installation may contact the configured package index. The test and
run commands below must not make live calls.

## Run the complete evaluator test suite

```powershell
& "$ActiveGraphVenv\Scripts\python.exe" -m pytest evals/activegraph/tests -q
```

The suite covers both schemas, contract validation, deterministic topology and
winner flip, diff explanation, canonical bytes, live-to-reload parity, CLI
failure semantics, caller-payload mutation containment, real NodeKit event
replay, and no-write failure paths.

## Build the locked evaluator image

The runtime wrapper accepts only an immutable Docker image ID or repository
digest carrying labels for the exact committed build-input hash, NodeBench
candidate commit, and audited upstream record. Generate those values from a
clean commit, build the image, resolve its ID, and write the image attestation:

```powershell
$ActiveGraphBuild = node scripts/nodekit/runActiveGraphCanary.mjs `
  --print-build-metadata | ConvertFrom-Json

docker build `
  --file evals/activegraph/Dockerfile `
  --tag nodebench-activegraph-canary:local `
  --build-arg "NODEBENCH_ACTIVEGRAPH_BUILD_INPUTS_SHA256=$($ActiveGraphBuild.buildInputsHash)" `
  --build-arg "NODEBENCH_CANDIDATE_COMMIT=$($ActiveGraphBuild.nodebenchCandidateCommit)" `
  --build-arg "NODEBENCH_ACTIVEGRAPH_UPSTREAM_SHA256=$($ActiveGraphBuild.upstreamHash)" `
  evals/activegraph
$ActiveGraphSandboxImage = docker image inspect `
  --format "{{.Id}}" `
  nodebench-activegraph-canary:local
if ($ActiveGraphSandboxImage -notmatch '^sha256:[a-f0-9]{64}$') {
  throw "ActiveGraph sandbox image is not immutable"
}

$ActiveGraphImageAttestation = Join-Path `
  (Resolve-Path ".tmp").Path `
  "activegraph-canary\image-attestation.json"
node scripts/nodekit/runActiveGraphCanary.mjs `
  --attestation-output $ActiveGraphImageAttestation `
  --sandbox-image $ActiveGraphSandboxImage
if ($LASTEXITCODE -ne 0) {
  throw "ActiveGraph image attestation failed"
}
```

Dependency installation occurs at image-build time. The replay itself runs
with Docker networking disabled. Metadata/attestation generation rejects dirty
canonical image inputs. Replay independently recomputes those inputs, checks the
current candidate commit, inspects the image labels, and rejects arbitrary
immutable digests that lack the exact attestation.

This is local provenance, not a signed supply-chain attestation. A party that
controls both Docker and the attestation file can forge matching labels; that
threat remains a production-adoption gate.

## Replay a canonical NodeKit export

First obtain an owner-authorized terminal export from:

```text
domains/operations/taskManager/nodeKitRunExport:exportNodeKitRun
```

Save that returned JSON unchanged, then run:

```powershell
$NodeKitExport = (Resolve-Path ".tmp\nodekit-export.json").Path
$ActiveGraphEvidence = Join-Path (Resolve-Path ".tmp").Path "activegraph-canary\nodekit"

node scripts/nodekit/runActiveGraphCanary.mjs `
  --input $NodeKitExport `
  --evidence-root $ActiveGraphEvidence `
  --sandbox-image $ActiveGraphSandboxImage `
  --image-attestation $ActiveGraphImageAttestation
if ($LASTEXITCODE -ne 0) {
  throw "NodeKit ActiveGraph replay failed with exit code $LASTEXITCODE"
}
```

The wrapper prints the newly created evidence directory. It contains only:

```text
nodekit-run-export.json
activegraph.sqlite3
report.json
```

The report passes only when the reloaded ActiveGraph event payloads exactly
equal the exported NodeKit event array and the report binds the same export
hash, chain head, event count, canonical replayed-event digest, run ID,
immutable sandbox image, build-input hash, candidate commit, upstream hash, and
image-attestation hash. The wrapper also caps the source export at 1 MiB, the
report at 64 KiB, SQLite at 64 MiB, child output at 1 MiB, and runtime at 120
seconds. It requires exactly three non-empty regular artifacts and reads only
the 16-byte SQLite 3 header for the file check.

Do not invoke the Python replay CLI directly. It rejects host execution. The
Node wrapper is the boundary that enforces source immutability, exclusive
output placement, credential stripping, Docker isolation, and exact artifact
placement.

## Run the synthetic graph-hop golden twice

The synthetic lane uses fixed IDs and clocks. Two independent databases must
produce byte-identical reports:

```powershell
$ActiveGraphRunRoot = Join-Path ".tmp\activegraph-canary" ([guid]::NewGuid().ToString("N"))
$ActiveGraphFixture = (Resolve-Path "evals/activegraph/fixtures/golden-selection-flip.input.v1.json").Path
New-Item -ItemType Directory -Force $ActiveGraphRunRoot | Out-Null

& "$ActiveGraphVenv\Scripts\python.exe" -m nodebench_activegraph_canary `
  --input $ActiveGraphFixture `
  --output "$ActiveGraphRunRoot\run-1.json" `
  --db "$ActiveGraphRunRoot\run-1.sqlite"
if ($LASTEXITCODE -ne 0) {
  throw "First ActiveGraph golden run failed with exit code $LASTEXITCODE"
}

& "$ActiveGraphVenv\Scripts\python.exe" -m nodebench_activegraph_canary `
  --input $ActiveGraphFixture `
  --output "$ActiveGraphRunRoot\run-2.json" `
  --db "$ActiveGraphRunRoot\run-2.sqlite"
if ($LASTEXITCODE -ne 0) {
  throw "Second ActiveGraph golden run failed with exit code $LASTEXITCODE"
}

$ActiveGraphHash1 = (Get-FileHash -Algorithm SHA256 -LiteralPath "$ActiveGraphRunRoot\run-1.json").Hash
$ActiveGraphHash2 = (Get-FileHash -Algorithm SHA256 -LiteralPath "$ActiveGraphRunRoot\run-2.json").Hash
$ActiveGraphExpectedHash = "C07439CB9B90B7A8511739C8BC8F2184523ED74C557169A53129E09A00FCE9EE"
if ($ActiveGraphHash1 -ne $ActiveGraphHash2 -or $ActiveGraphHash1 -ne $ActiveGraphExpectedHash) {
  throw "ActiveGraph hash gate failed: run1=$ActiveGraphHash1 run2=$ActiveGraphHash2 expected=$ActiveGraphExpectedHash"
}

$ActiveGraphReport = Get-Content -Raw -LiteralPath "$ActiveGraphRunRoot\run-1.json" | ConvertFrom-Json
$ActiveGraphFailedAssertions = @($ActiveGraphReport.assertions | Where-Object { -not $_.passed })
if (
  $ActiveGraphReport.verdict -ne "pass" `
  -or $ActiveGraphFailedAssertions.Count -ne 0 `
  -or @($ActiveGraphReport.assertions).Count -ne 7 `
  -or $ActiveGraphReport.runs.baseline.event_count -ne 17 `
  -or $ActiveGraphReport.runs.variant.event_count -ne 17
) {
  throw "ActiveGraph golden report did not pass every assertion"
}
$ActiveGraphHash1
```

The synthetic lane models explicit query-to-candidate hop paths, materializes
them as `graph_hop` relations, traverses those relations to derive graph scores,
and compares a semantic-heavy parent with a graph-heavy fork. Its normalized
report exposes the changed policy, weights, ranking, selected relation, and
evidence paths.

## Issue #67 containment

[ActiveGraph issue #67](https://github.com/yoheinakajima/activegraph/issues/67)
shows that a caller can mutate a nested payload after `Graph.emit()`, causing
live memory and serialized SQLite history to diverge. Both adapters deep-copy
payloads at their boundary. The regression compares live, persisted, and
freshly reloaded values.

This proves the local containment, not an upstream fix or production readiness.

## Files

| Path                                                 | Purpose                                                |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `requirements.in`                                    | Exact direct dependency pins                           |
| `UPSTREAM.json`                                      | Audited release and source revision                    |
| `schemas/graph-hop-*.schema.json`                    | Synthetic fixture and report contracts                 |
| `schemas/nodekit-*.schema.json`                      | Canonical export and replay-report contracts           |
| `fixtures/golden-selection-flip.input.v1.json`       | Fixed synthetic graph-hop case                         |
| `src/nodebench_activegraph_canary/runtime.py`        | Synthetic fork/diff runtime                            |
| `src/nodebench_activegraph_canary/nodekit_replay.py` | Canonical export validator and replay                  |
| `tests/`                                             | Contract, determinism, persistence, and boundary tests |

## Gates

- **Gate 1, synthetic mechanics:** implemented and required to stay green.
- **Gate 2, immutable export and exact replay:** implemented for newly created
  owner-scoped execution traces; legacy and ownerless traces fail closed.
- **Gate 3, representative corpus and latency:** deferred. Replay about 20
  owner-authorized exports and stop on any parity failure, more than 2× median
  latency, or no material explanatory gain.
- **Gate 4, production bridge:** not authorized. It requires a separate ADR,
  threat model, issue #67 disposition, ownership proof, migration, and rollback.

## Explicit non-goals

This evaluator does not add a live `EventSink`, TypeScript ActiveGraph runtime,
MCP ingestion, Temporal backend, production worker, dual-write, or any role for
ActiveGraph in user-visible answers or approval decisions.
