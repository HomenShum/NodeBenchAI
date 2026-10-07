# subagents/ — index (phase 0)

The orchestrator-workers implementation lives in `backend/convex/domains/agents/**`
(sub-agent configs, trace types, parallel task trees) per
`.claude/rules/orchestrator_workers.md`: one orchestrator + N sub-agents with
fresh context, each with a scoped task, a tool allowlist, a budget envelope,
and a dedicated scratchpad section. Failure is bounded output + a failure
marker — never silent.

Standard-shape authoring (`<role>/agent.yaml` + `instructions.md` +
`tools.allow.yaml` + `output.schema`) lands when the runtime consumes authored
definitions. Until then this index prevents a second, drifting copy of the
sub-agent contracts.
