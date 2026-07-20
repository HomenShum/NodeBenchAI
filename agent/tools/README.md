# tools/ — index (phase 0)

The tool surface is `packages/mcp-local/src/tools/**` — 304 tools across 50
domains, registered in `toolRegistry.ts` (`{name, description, inputSchema,
handler}`), discovered progressively via `discover_tools` /
`get_tool_quick_ref` / `get_workflow_chain`.

Mapping onto the standard verb taxonomy (for the future authored split):

| Standard verb | Today's domains (examples) |
|---|---|
| read/ | web fetch/search, entity read, memory/JIT retrieval tools |
| analyze/ | deep-sim, benchmarks, trajectory scoring, judge tools |
| propose/ | drafting, memo/report generation, LinkedIn drafts |
| mutate/ | Convex writes, spreadsheet/document edits, sync tools |
| verify/ | verification cycles, eval harness, watchdog, live checks |

Conformance note: `toolRegistry.ts` is a hand-maintained global registry —
standard rule 4 ("no manually maintained global tool registry") is a known
violation, resolved by the generated-registry compiler phase, not by hand.
