# NodeKit RFS Showcase launch packet

This packet contains the campaign launch post and the first three blueprint posts for the YC Summer 2026 NodeKit benchmark.

All four posts are intentionally marked `planned`. They may describe a proposed user, job, artifact, workflow, and benchmark, but they may not claim a completed build, deployment, cost result, taste certificate, or autonomous run.

Primary source: [YC Requests for Startups](https://www.ycombinator.com/rfs).

Validation:

```powershell
npx tsx scripts/nodekit-rfs/validate-blueprint-posts.mts
```

The validator prints queue-ready JSON payloads only after every post passes the existing LinkedIn engagement gate and the campaign claim-discipline checks.

Queue preview:

```powershell
npx tsx scripts/nodekit-rfs/queue-blueprint-posts.mts
```

Queue through an already configured NodeBench checkout without deploying code:

```powershell
npx tsx scripts/nodekit-rfs/queue-blueprint-posts.mts --execute --deployment-workspace <configured-nodebench-checkout>
```

Publication path:

1. Run validation.
2. Enqueue each payload as `target: personal`, `persona: FOUNDER`, `source: manual`.
3. Retain `claimStatus: planned`, `campaignId`, `rfsId`, and the YC source in metadata.
4. Run the existing LLM judge.
5. Require human approval before scheduling or posting.

The corresponding proof post is unlocked only after a sealed `nodekit.rfs-benchmark-run/v1` receipt exists.

## Live queue handoff, 2026-07-22

The four founder-personal drafts were enqueued through the existing Convex deployment without `--push`, codegen, scheduling, or publication.

| Campaign post | Queue ID | Status after production judge |
|---|---|---|
| `00-launch` | `y9828rxf2187ncb2jz54sagmgs8b0nn7` | `approved` |
| `13-software-for-agents-blueprint` | `y987wxsmb4tqva05y6r01fw8ms8b1ccq` | `approved` |
| `03-ai-native-services-blueprint` | `y987a4e5w9nvdz9b6a5392nszd8b1sm3` | `approved` |
| `07-dynamic-interfaces-blueprint` | `y980acy8znhhg4nczvz1acw6fn8b1frm` | `approved` |

The deployed `batchJudgePending` action was invoked with `limit: 4`, but its configured `qwen3-coder-free` route resolves to the retired OpenRouter slug `qwen/qwen3-coder:free`. OpenRouter returned HTTP 404 and identified `qwen/qwen3-coder` as the available paid replacement. Because failures revert to `pending` and selection is oldest-first, the deployed action selected `00-launch` on each iteration and did not advance any item.

The reviewed replacement shipped through PR #594 and CI in merge commit `2d3217eed619c36851c793ca79f5904b41c96c2c`. `laguna-s-2.1-free` resolves to `poolside/laguna-s-2.1:free`, with `laguna-xs-2.1-free` (`poolside/laguna-xs-2.1:free`) as the explicit zero-cost fallback. Both were verified against OpenRouter's models API on July 22, 2026. The production batch processed four distinct queue IDs in one run and returned four approvals; the subsequent state read confirmed every row stores `poolside/laguna-s-2.1:free` as the exact judge model. Main CI, Convex deploy, Vercel deploy, post-deploy verification, Attrition QA, and Dogfood Visual QA all passed. The personal-post scheduling path remains deliberately manual; the existing hourly scheduler targets organization posts only.
