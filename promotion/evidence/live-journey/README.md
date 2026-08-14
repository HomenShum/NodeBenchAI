# live-journey — the primary journey, running

Produced by `node scripts/capture-live-journey.mjs --port 4902`, against a
Convex deployment you provision yourself (`docs/START_HERE.md` → "Before
Step 1"). It exits nonzero if any assertion below stops holding, and it costs
real Gemini calls.

`report.json` is the measurement; the PNGs are what it looked like.

| File | What it shows |
|---|---|
| `01-empty-desktop.png` | The designed empty state on a live backend — `data-empty="true"`, starters, composer. This is the frame that used to be the "Convex backend not configured" card. |
| `02-agent-running-desktop.png` | Mid-run: the live-research checklist with named stages, the assistant turn already carrying a `data-chat-run-id`. |
| `03-answer-desktop.png` | The sealed answer with its cost/source header. In this capture the count is **0 sources**, so the packet carries the "Source needed: no supported URL is available…" notice instead of evidence rows — the honest degraded branch (defect D7). |
| `04-answer-trace-desktop.png` | The same turn scrolled to its trace: four tool rows and the evidence footer. |
| `05-receipt-desktop.png` | `/redesign/chat/r/<hash>` opened in a **cold** browser context — the continuation aside at `data-state="ready"`. |
| `06-cancelled-desktop.png` | Stop pressed mid-run: an honest terminal state, no fabricated answer. |
| `07-empty-mobile.png`, `08-answer-mobile.png` | The same journey at 375×812, separate session. |
| `09-validation-error-desktop.png` | A 2-character prompt rejected by the server. The designed failure card is there; the *reason* is not, which is defect D5. |

Two things the screenshots cannot show, so the report asserts them instead:

- **It persisted.** The run row and its `redesignChatStreamEvents` are read back
  out of Convex — status `complete`, 30 rows, `idx` strictly increasing,
  including `tool_call` and `packet_complete`. "It streamed" and "it persisted"
  are separate claims and are checked separately.
- **The receipt replayed rather than re-ran.** `getLatestOwnedRun().runId` is
  identical before and after opening the permanent link, so no second paid run
  was created. Matching text alone would not prove that.
