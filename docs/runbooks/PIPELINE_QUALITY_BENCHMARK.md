# Run the pipeline quality benchmark

A developer checking search readiness needs answers from the service being evaluated. A frontend returning a page, or a different agent service returning 404, cannot produce an answer-quality grade. The benchmark checks the Pipeline v2 runtime before sending its ten golden queries.

## Choose the actual worker

The implementation is `workers/node/routes/pipelineRoute.ts`, mounted under `/api/pipeline` by `workers/node/index.ts`. Its existing local entrypoint is `npm run dev:voice`, on port 3100. That starts the full worker and requires its own configured environment; this benchmark does not start it or transfer secrets. Use an already prepared local worker or an explicitly verified deployed worker URL.

The Vercel application and worker are separate deployment surfaces. `workers/node/vercel/searchApp.ts` and `api/search.js` do not mount the pipeline router. Do not replace this benchmark's route with the legacy `/api/search`, whose behavior is a different contract.

As observed on September 8, 2026:

- `scratchnode.live` returned HTTP405 for an empty POST to `/api/pipeline/search`.
- The source-referenced Cloud Run LangGraph service identified itself as `langgraph-agent`, and returned 404 for pipeline health and search.
- The configured cloud project's service inventory had no `nodebench-server`, and the worker deployment workflow had no recorded runs in the queried history.
- `workers/node/Dockerfile` requires a root `package-lock.json`, but the current Git tree does not contain one. The clean-source container build needs a separately reviewed dependency/reproducibility repair before that deployment recipe can be considered ready.

These observations do not establish a substitute production URL or authorize a new deployment. A Vercel deployment event and a green frontend crawl do not establish that the worker exists.

## Verify the clean container prerequisite

The packaging candidate keeps the existing worker, routes and `build:voice`
compiler command. Both image stages share a pinned Node 22 base, npm 11.5.2,
the checked root lock and the public root `legacy-peer-deps=true` policy.
The existing `dotenv` range moves to production dependencies because
`workers/node/index.ts` imports it at startup. No application version range
changes. The obsolete patch-script copy is removed. The cloud ignore rules
exclude environment files and nested registry-token files; the checked root
npm policy contains no credentials.

With an already functioning Linux Docker engine, from a clean checkout:

```powershell
docker build --platform linux/amd64 -f workers/node/Dockerfile -t nodebench-worker-proof:local .
docker run -d --name nodebench-worker-proof --network none --memory 2g --cpus 2 nodebench-worker-proof:local
docker inspect nodebench-worker-proof --format '{"networkMode":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}},"hostPorts":{{json .HostConfig.PortBindings}}}'
docker inspect nodebench-worker-proof --format '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}'
Get-Content -Raw scripts/worker-container-smoke.mjs | docker exec -i nodebench-worker-proof node --input-type=module
docker logs nodebench-worker-proof
docker stop nodebench-worker-proof
```

Use an unused container name, retain the logs, and stop only the container you
started. This proof supplies no provider environment, published host port or
mounted personal data. Verify the actual network mode is `none`, mounts and
host-port bindings are empty, and environment-variable names contain only
expected public settings. Inspect names without printing values. The helper
cannot inspect Docker configuration itself. Use an explicitly verified Linux
engine; the recorded Windows proof used the Linux daemon, not the Windows default.
The helper captures the actual localhost root/MCP/Pipeline
health responses, requires a nonempty tool inventory and absent Linkup/Gemini
configuration, then checks 12 concurrent and 20 repeated empty-query rejections,
malformed JSON and stable tool/session state. It does not send a valid query.

In the October 7, 2026 local-date proof, the current-manifest lock was generated with
npm 11.5.2 and its `npm ci --dry-run` passed. The first native Docker attempt
could not reach the Linux engine. After the engine recovered, the unchanged
clean-source build failed at `COPY` because both `package-lock.json` and
`scripts/patch-crons-exports.mjs` are absent. The repaired Linux/amd64 image
built successfully and started the actual compiled worker with Node v22.22.2
and npm 11.5.2. Docker inspection confirmed network mode `none`, no mounts or
published ports and seven expected public environment-variable names.

The helper observed HTTP200 root/MCP/Pipeline health, 573 registered tools,
false Linkup/Gemini configuration booleans, 12 concurrent and 20 repeated
empty-query HTTP400 rejections, malformed-JSON HTTP400 and unchanged zero
sessions. These 33 rejection cases completed in 94 ms; they are a burst and
repeated-request observation, not a sustained-duration result.

A separate, bounded 60-second stability observation used the same image in
another inspected network-`none` container. In 60,005 ms, 61 paced empty or
whitespace queries returned HTTP400 and 13 recovery snapshots retained
HTTP200 root/MCP/Pipeline health, 573 tools and zero sessions. Worker PID1 RSS
was 126,036 KiB at the start and 112,820 KiB at the end; container cgroup memory
was 100,499,456 and 94,007,296 bytes respectively. These two snapshots do not
establish a production SLA or long-term memory behavior. Both owned worker
containers were stopped normally after proof. No valid
provider query, cloud upload, image push, deployment or manual CI was performed.

The install audits remain unresolved: production reported 29 vulnerabilities
(7 low, 11 moderate, 11 high), and the full build install reported 57
(7 low, 21 moderate, 27 high, 2 critical). These are observations from the
new frozen graph, not a baseline/new vulnerability comparison or a security pass.
An audit-only container using that image and the exact same lock separately
ran `npm audit --omit=dev --json` against the public npm registry. Its process
exited 1 and confirmed 29 production findings, including 11 high and no
critical findings. That diagnostic used Docker network `bridge`, ran no worker,
and applied no dependency updates. Its external network access is separate
from the two isolated worker observations.

The existing compile command uses `--noCheck`; an emitted worker is not a full
application typecheck. Optional tool dependencies and browser binaries require
their own invocation proofs. Local startup with false provider booleans cannot
pass the provider-ready benchmark below or establish a deployed worker URL.

## Verify provider HTTP compatibility without credentials

A developer replacing the HTTP transport needs to preserve private-address
blocking and response handling before trying a configured provider. The frozen
`scripts/provider-http-compat.mjs` exercises actual installed provider-utils
and its consumer-relative Undici, with DNS-only mocks for blocked-address cases
and real local TCP for separately labelled transport cases. It makes no valid
provider query. Its expected SHA256 is
`5D30EE0091F1A1799971C038BE693EF1352372F65D18F70A2309CF5964820292`.

From a clean checkout and an explicitly verified Linux Docker engine, build
the worker using the existing recipe. Choose an unused owned container name;
the commands supply no provider environment, mounts or published ports:

```powershell
$providerHttpProofImage = 'nodebench-worker-proof:provider-http-compat-local'
$providerHttpProofContainer = 'nodebench-provider-http-compat-proof'
docker build --platform linux/amd64 -f workers/node/Dockerfile -t $providerHttpProofImage .
if ($LASTEXITCODE -ne 0) { throw 'Worker image build failed' }
docker run -d --name $providerHttpProofContainer --network none --memory 2g --cpus 2 $providerHttpProofImage
if ($LASTEXITCODE -ne 0) { throw 'Owned proof container did not start' }
docker inspect $providerHttpProofContainer --format '{"networkMode":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}},"hostPorts":{{json .HostConfig.PortBindings}}}'
docker inspect $providerHttpProofContainer --format '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}'
docker logs $providerHttpProofContainer
```

Require actual network `none`, empty mounts/host-port bindings and only expected
public environment-variable names. Inspect names without printing values.
After the logs show the worker has started, copy the harness to its fixed
in-container path and run it inside that same worker container:

```powershell
try {
  if ((Get-FileHash scripts/provider-http-compat.mjs -Algorithm SHA256).Hash -ne '5D30EE0091F1A1799971C038BE693EF1352372F65D18F70A2309CF5964820292') { throw 'Frozen harness bytes differ' }
  docker cp scripts/provider-http-compat.mjs "${providerHttpProofContainer}:/app/actual-consumer-scenarios.mjs"
  if ($LASTEXITCODE -ne 0) { throw 'Harness copy failed' }
  docker exec $providerHttpProofContainer node /app/actual-consumer-scenarios.mjs
  $providerHttpProofExit = $LASTEXITCODE
  if ($providerHttpProofExit -ne 0) { throw "HTTP compatibility proof failed: exit $providerHttpProofExit" }
} finally {
  docker logs $providerHttpProofContainer
  docker stop --timeout 10 $providerHttpProofContainer
}
```

Retain actual JSON output and exit status. Inspect `sources` for the loaded
provider-utils/Undici paths, versions, entry hashes, lock hash and harness hash,
then inspect every result and its scope. The recorded comparison used locked
provider-utils 3.0.41, Undici 5.29.0 before and 6.29.0 after, and pinned Linux
Node 22.22.2/npm 11.5.2. Both phases returned 49 PASS / 0 FAIL / 1 NOT_VERIFIED.
Thirty default guard DNS failures and literal private URLs were blocked without
socket connections; direct local response/stream/multipart/recovery, a 12-client
burst and one fixed 60-second paced worker/transport observation passed.

The external study images used source `0f5b3cc9e2403a1bbcb1df841ec5b39a7ddecd3f`;
the adoption is prepared on combined local source
`25b6a1698ef717fd3c8f680de1d92a93ec4c49d8`. The historical study does not certify
that newer combined source. Its automatic CI and final main QA are pending.
The exact parent-scoped override crosses upstream's Undici major range, so
future graph or runtime changes require a new matched comparison.

The measured production audit changed from 29 to 21 findings, HIGH 11 to 9;
full findings changed from 57 to 51, with HIGH 27 and CRITICAL 2 unchanged.
Busboy remains on a development path; all four npm audits exited 1. These
counts are dependency findings, not proof of exploit reachability or a clean
security grade. Default guarded public success remains NOT_VERIFIED under
network isolation. Custom/trusted-origin or direct localhost success cannot
replace it. No provider-backed Golden evaluation, deployment, strict typecheck,
performance/SLA or lifetime memory result follows from this check.

## Run

After installing the repository's declared development dependencies, verify the runner without provider calls:

```powershell
node --test scripts/attrition/golden-runtime-scenarios.mjs
```

To evaluate an already configured local worker:

```powershell
$env:NODEBENCH_API_URL = 'http://127.0.0.1:3100'
npx tsx scripts/attrition/run-golden-queries.ts
```

For an existing remote worker, set that same variable to its verified HTTP(S) base URL. The target must not contain embedded credentials, query parameters or fragments; redirects are rejected. Do not use provider keys in the URL. Linkup and Gemini credentials belong to the worker environment. An OpenAI key in another backend environment does not satisfy this pipeline's provider configuration.

The Attrition QA workflow's `api_url` input still feeds both its existing surface crawl and this runner. Its default frontend URL remains a known blocked target. The workflow has not been repurposed as a deployment mechanism or changed to guess a worker URL. Use the CLI for a separate worker until the two deployment targets are explicitly configured in a subsequent reviewed change.

## Interpret the report

The generated `scripts/attrition/golden-results.json` is ignored by Git and uploaded even when the benchmark fails.

| Result | Meaning | Exit code |
| --- | --- | --- |
| `status: blocked` | Runtime preflight failed; `total: 0`, `notRun` equals the planned count, results are empty and quality aggregates are null. | 1 |
| `status: completed`, some failed queries | The runtime contract passed; the report retains each attempted query's success or failure against the unchanged golden criteria. | 1 |
| `status: completed`, all queries passed | Every golden query met its criteria in this run. | 0 |

Preflight requires JSON health with `status: ok`, `pipeline: v2`, and true Linkup/Gemini presence booleans. It then sends an empty query and requires HTTP400 with `{ "error": true, "message": "Query is required" }`. The current route rejects that input before hooks, providers or retention writes. Each preflight request has a ten-second timeout and a 64KiB response cap. Query requests retain their sixty-second timeout and have a 1MiB response cap.

Health booleans prove configuration presence, not valid credentials or provider availability. Only subsequent real queries exercise those capabilities. A successful run against the controlled scenario server proves runner behavior, not real answer quality, visual UI quality, responsiveness, accessibility or developer handoff for the full application.

The regression scenarios cover a static page, missing POST route, absent provider configuration, redirects, oversized bodies, a real preflight timeout, degradation after preflight, concurrent evaluators, repeated invocations and stale local report replacement. Each invocation has a separate temporary report directory, printed for inspection, and its process and HTTP server are closed. Test reports use the operating system's temporary directory; normal temporary-file retention applies.

## Separate frontend and Pipeline configuration (2026-10-08 source patch)

An evaluator needs the research worker's JSON API, while a surface crawl needs
the public frontend. This patch separates those destinations; it does not
create or deploy a worker. The earlier shared-`api_url` paragraph in this
runbook describes the e901 baseline and is superseded by this configuration
after the patch is adopted. All earlier observations retain their capture dates.

| Setting | Destination and behavior |
| --- | --- |
| Attrition QA `api_url` | Frontend surface crawl only; its existing ScratchNode default and crawl checks remain. |
| Attrition QA `pipeline_api_url` | Optional manual input for an independently verified Pipeline v2 worker base URL. |
| Repository variable `NODEBENCH_PIPELINE_API_URL` | Nonsecret worker base URL used when the manual Pipeline input is absent. No frontend, deployment-event or LangGraph fallback. |
| Runner `NODEBENCH_API_URL` | The workflow always supplies the separate Pipeline setting. An empty or whitespace value blocks before any fetch. An unset variable retains the local CLI default `http://localhost:3100`. |

If no Pipeline URL is configured, the runner exits 1 and writes a fresh
`status: blocked` report: zero evaluated queries, all planned queries not run,
empty results and null quality aggregates. It does not skip or invent a grade.
The Golden job has a twenty-minute overall timeout. Existing preflight requests
retain their ten-second timeout and 64-KiB response cap; query requests retain
their sixty-second timeout and 1-MiB cap. Existing URL validation and redirect
rejection remain unchanged. Provider presence booleans still do not prove that
credentials work or that answers are correct.

The scenario source retains all eleven original cases and adds one operator
case for empty and whitespace targets. It requires the configuration error,
zero requests to a reachable controlled server and replacement of the stale
successful report. At this source-only capture, paired scenario execution and
new automatic CI are **NOT_RUN**. Controlled answers cannot certify providers.

### Private worker prerequisites remain unresolved

Populate the endpoint only from an observed service/project/region and revision;
do not infer the deployment workflow's project from the local cloud setting.
The current Golden runner has no audience-bound authorization, so a private
service's unauthenticated 401/403 remains a blocked result. A private-first
worker needs a separately reviewed least-privilege invoker, credential-reference,
resource/cost and first-deployment/rollback contract. The existing anonymous
Cloud Build recipe is not that contract.

The e901 provider path also retains an honest-failure blocker: provider errors
can continue into packaging, trajectory/retention effects and HTTP200 success;
source conversion includes artificial score floors. Adopt and verify the
separately reviewed outcome, score and cancellation repair before provider-backed
use. Endpoint separation does not fix those defects, authorize provider spend,
or establish a live worker, successful Golden answers or application security.

### Local verification captured on 2026-10-08 (UTC)

After the source-only capture above, the root-controlled comparison used the
same Windows Node 22.22.2 runtime and pre-existing explicit TSX 4.23.15 loader.
This was not a normal installed e901 dependency graph. The unchanged suite
passed 11/11 with no failures or skips (native exit 0, 18.1129387 seconds);
the candidate passed 12/12 with no failures or skips (native exit 0,
18.2130269 seconds). The original eleven scenario contracts were retained.

The new blank-target criterion was also run separately against the authentic
old CLI: it failed with native exit 1 because the old report said `Invalid URL`
instead of the explicit unconfigured-target diagnostic. The old runner already
blocked that malformed URL; this counterexample proves the diagnostic change,
not a newly prevented provider request. The candidate's added case passed for
both empty and whitespace targets, requiring zero controlled-server requests
and fresh blocked reports with null quality aggregates.

The baseline ran at 20:13:43–20:14:01 UTC, the candidate at 20:15:06–20:15:24,
and the old-CLI counterexample at 20:17:08. No provider call was made. These
controlled localhost results do not establish provider quality, a deployed
worker, private invocation or the canonical installed CI graph. Updated
source automatic CI and the private-worker prerequisites remain pending.
