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
