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
