| id | selector/component | user promise | capability guard | backing field/action/network effect | observed artifact | disposition | preserve/reverify assertion |
|---|---|---|---|---|---|---|---|
| C1 | `PrototypeV2LeftRail(chat)` fixture rows | Resume real conversations | PRESERVE_CAPABILITY | Hard-coded arrays; no runtime query | production desktop + source | REMOVE | No fabricated Active/Recent/Archived rows; honest empty state only |
| C2 | `.rd-v2-new-thread` | Start a new thread | ORDINARY_CAPABILITY | Bare button with no handler | production DOM + source | REMOVE | No visible New thread promise until a real action exists |
| C3 | center run contract + `RightInspector` scope block | Understand read/write/check boundaries | PRESERVE_CAPABILITY | `AgentRailSnapshot` | production desktop/mobile | MERGE | One compact Reads/Writes/Checks disclosure remains before submit |
| C4 | idle `RightInspector` execution plan | Inspect a live run | PRESERVE_CAPABILITY | Runtime snapshot only becomes meaningful after intent | production desktop | DEFER | Inspector absent before intent; visible Run/Evidence access after runtime activity |
| C5 | `ChatV2NextActions` at idle | Continue from a completed answer | ORDINARY_CAPABILITY | Prompt callbacks, but no answer exists | production DOM | DEFER | Suggested next actions render only after a real answer packet |
| C6 | `.rd-chat-scroll-btn` at idle | Jump to unseen messages | ORDINARY_CAPABILITY | Local scroll-distance counter | production DOM showed badge `2` with no live thread | DEFER | No scroll affordance without overflow/unseen content; retained for real long threads |
| C7 | local batch timer | Monitor real batch execution | PRESERVE_CAPABILITY | `setInterval` increments count, spend, ETA locally | source audit | REMOVE | Only `useBatchLive` runtime values may render progress/cost/ETA |
| C8 | `OPEN_QUESTIONS` | Surface unresolved runtime claims | PRESERVE_CAPABILITY | Static constant | source audit | REMOVE | Questions derive only from live artifact/run data |
| C9 | `WORKING_NOTES_MARKDOWN` | Show agent working notes | PRESERVE_CAPABILITY | Static markdown fallback | source audit | REMOVE | Notes render only from live artifact/run scratchpad |
| C10 | `sourceFreshness()` | Describe source recency | PRESERVE_CAPABILITY | Hash-derived pseudo-age | source audit | REMOVE | No freshness label without a stored timestamp |
| C11 | composer context/model/add/voice/send | Configure and submit a run | PRESERVE_CAPABILITY | `UniversalComposer` callbacks and runtime state | production DOM/source | PRESERVE | Named, keyboard-reachable composer controls remain |
| C12 | tool/source/proposal/evidence message parts | Review agent work and provenance | PRESERVE_CAPABILITY | `useRedesignChatRun`, packet runtime, ProposalProvider | source/tests | PRESERVE | Tool, source, proposal, approval, error, stop and evidence states remain reachable |

Protected contract: canonical `Home / Reports / Chat / Inbox / Me`; one primary composer; explicit Reads/Writes/Checks; runtime-derived streaming and stop; exact sources/evidence; review-before-write; Workspace handoff; honest empty/degraded/failed states.
