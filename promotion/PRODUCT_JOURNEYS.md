# Canonical journeys — NodeBenchAI

Three to five real workflows. Not feature tours: a journey is one person, one
goal, and the artifact they hold when it worked. These are the promotion loop's
work queue, exercised in order of importance.

**A journey with no browser evidence is unfinished**, regardless of test status.

## What this product actually is, in one paragraph

Someone has been asked a question about a company or a market that they cannot
answer from memory, and they will have to defend the answer to a partner, a
committee, or a customer. NodeBench is where they type that question and get
back a written answer with the sources attached, plus a permanent link that
replays the exact same answer later. Everything else in the app — saved
reports, the attention queue, the account page — is a state of that one
conversation, not a separate destination. Every primary URL in the web app
resolves to `/redesign/chat` (`apps/web/src/App.tsx` ends in
`<Navigate to="/redesign/chat" replace />`), so a stranger who lands anywhere
lands in the same room.

## Journey shape

Each journey states, in this order:

- **Persona and situation** — who arrived, and why today.
- **Goal** — what they want to be true when they leave.
- **Steps** — what they actually do, in the UI, in order.
- **Done when** — the observable artifact or state that proves completion.
- **Evidence** — path to the capture that shows it working. Empty until proven.

---

## J1 — "Answer this question and show me where it came from"

- **Persona and situation:** An investor's associate is asked, an hour before a
  call, what has changed at a company they have never diligenced. They cannot
  hand their partner a chatbot paragraph with no provenance.
- **Goal:** A written answer on screen with a visible source count, produced by
  the live runtime and not by a fixture.
- **Drives:** `apps/web/src/features/redesign/surfaces/ChatSurface.tsx`, mounted
  by `RedesignShell.tsx` at route `/redesign/chat`. Composer is
  `UniversalComposer` with placeholder `Ask anything · type / for commands`.
- **Steps:**
  1. Open `http://localhost:5173/redesign/chat`.
  2. Land on `ChatEmptyState` — the empty transcript with suggested starters.
  3. Type a company question into the composer and submit.
  4. Watch the turn move through thinking → streaming → answer packet.
- **Done when:** the transcript holds one assistant turn whose rendered body is
  an answer (not `liveChatUnavailableMarkdown`), and the turn reports a source
  count. `[data-agent-runtime-surface="redesign-chat"]` has lost its
  `data-empty="true"` attribute.
- **Evidence (2026-08-14, live Convex deployment):** `node scripts/capture-live-journey.mjs --port 4902` → exit 0. Run `chat_msse8tbz_5w7dj9`: the surface mounted with `data-empty="true"`, the submitted turn showed the live-research checklist while streaming, and the turn sealed into an answer packet with five tool rows (classify_query 0 ms, build_context_bundle 293 ms, gemini_synthesis 19.9 s, fallback_source_search **warning**, bind_evidence **warning**). **This capture landed the ungrounded branch:** `Auto · 0 sources`, no evidence rows, and the honest "Source needed: no supported URL is available…" notice — which is a designed state, asserted by the gate, and which the journey's own "Done when" (a reported source count) is satisfied by. Runs of the same prompt on the same deployment returned 3, 2 and 1 sources earlier the same day, so this is nondeterminism in Gemini's grounding, tracked as defect D7 — not a rendering failure. Captures: `promotion/evidence/live-journey/01-empty-desktop.png`, `02-agent-running-desktop.png`, `03-answer-desktop.png`, `04-answer-trace-desktop.png`; numbers in `report.json`. Zero console errors, zero failed requests.

## J2 — "Send my partner the exact answer I saw, not a re-run of it"

- **Persona and situation:** Same associate, next morning. The partner asks
  where a number came from. A fresh model call would produce a different
  paragraph and destroy the point.
- **Goal:** A URL that replays the stored prompt, answer, and evidence exactly.
- **Drives:** the receipt link in `ChatSurface.tsx`
  (`href={/redesign/chat/r/${continuationHash}}`, label
  `View immutable receipt`), resolved by `pathToChatHash()` in
  `apps/web/src/features/redesign/lib/oneSurfaceRouting.ts`, restored into the
  `[data-testid="continued-chat-context"]` aside.
- **Steps:**
  1. From a completed turn in J1, click **View immutable receipt**.
  2. Copy the resulting `/redesign/chat/r/<hash>` URL.
  3. Open that URL cold in a new tab (no prior state).
- **Steering/receipt role:** this is the **receipt** journey.
- **Done when:** the continuation aside reaches `data-state="ready"` and reads
  "Prompt, answer, and N sources are carried into new messages", with the
  original prompt and answer visible above the composer. `data-state="loading"`
  that never resolves, or `data-state="unavailable"`, is a failure.
- **Evidence (2026-08-14, live Convex deployment):** same run. **Share reproducible link** produced `/redesign/chat/r/1znqpv1wpmh0`; opened in a **cold browser context**, the continuation aside reached `data-state="ready"` and the restored answer text matched the original. That it *replayed* rather than re-ran is proven independently of the text: `getLatestOwnedRun().runId` was `chat_msse8tbz_5w7dj9` both before and after opening the link, so no second run row was created. Capture: `promotion/evidence/live-journey/05-receipt-desktop.png`.

## J3 — "The agent got one sentence wrong and I want to fix it in place"

- **Persona and situation:** The answer is 90% right and one claim is wrong. The
  user does not want to re-prompt from scratch; they want to correct that
  sentence and have the correction stick.
- **Goal:** The correction visibly takes effect, and the app is honest about
  whether it was actually persisted.
- **Drives:** the `InlineCorrection` component at the bottom of
  `ChatSurface.tsx` — selection-triggered, writes a 👎 reaction with a
  `[correction] original: … → corrected: …` note via `recordReaction`.
- **Steps:**
  1. Select a sentence inside an assistant answer.
  2. Click the correction affordance that appears on the selection.
  3. Type the corrected text into the panel labelled
     "Correction (writes a memory patch — review required)".
  4. Save — once signed out, once signed in.
- **Steering/receipt role:** this is the **steering** journey.
- **Done when:** signed in, the toast reads "Correction saved to your NodeBench
  memory." Signed out, it reads "Use Sign in in the header to persist
  corrections to memory." — the signed-out path must NOT claim a save.
- **Evidence:** _still none. The surface now renders (see J1), so the blocker is
  gone, but nobody has driven the selection-triggered correction panel or
  compared the signed-in and signed-out toasts. UNVERIFIED means unwatched, not
  broken._

## J4 — "Stop. That is not the question I meant."

- **Persona and situation:** The user submits, immediately sees the run heading
  the wrong way, and needs out — without reloading and losing the transcript.
- **Goal:** Cancel a live run, get an honest terminal state, and keep working in
  the same session.
- **Drives:** the composer's `onStop` handler in `ChatSurface.tsx` calling
  `chatRun.cancel(chatRunId)`, and `liveChatUnavailableMarkdown(...)` for the
  cancelled turn.
- **Steps:**
  1. Submit a question and, while the turn is `thinking`/`streaming`, press stop.
  2. Read the toast and the affected turn.
  3. Submit a second, corrected question without reloading the page.
- **Steering/receipt role:** this is the **recovery** journey.
- **Done when:** a toast reports one of "Cancellation recorded…", "Cancellation
  queued…", or "already terminal or unavailable"; the cancelled turn ends in
  `_(cancellation requested)_` or the honest unavailable message rather than a
  fabricated answer; and the next submission produces a new turn in the same
  transcript.
- **Evidence (2026-08-14, live Convex deployment):** same run. Stop was pressed ~3.5 s into a streaming run; the toast read **"Cancellation recorded. The active stream will abort at its next checkpoint."** and the turn settled on **"Live chat is not running / Run cancelled. Any in-flight provider stream was aborted at the next cooperative checkpoint."** — no sealed answer packet was rendered for the cancelled turn (asserted). The next question then produced new turns in the same transcript (4 → 6). Capture: `promotion/evidence/live-journey/06-cancelled-desktop.png`.

## J5 — "Show me how these entities are connected, and do not invent an edge"

- **Persona and situation:** The user is holding a research answer about a
  company and wants the shape of the neighbourhood — who is connected to whom —
  without the graph asserting relationships nobody measured.
- **Goal:** A populated graph rail whose every label traces to real stored
  research, with counts left unknown rather than guessed.
- **Drives:** `apps/web/src/features/research/components/EntityGraphRail.tsx`
  (`[data-testid="entity-graph-rail"]`) mounted in
  `apps/web/src/features/research/views/EntityProfilePage.tsx` at
  `/#entity/<name>`, fed by `entityContexts.getEntityContext`,
  `relationshipGraph.getEntityGraph`, `adaptiveEntityQueries.getAdaptiveProfile`.
  The Convex-free equivalent is `demo/graph-rail/index.html`, gated by
  `node scripts/capture-graph-rail.mjs`, which replays the committed fixture
  `benchmarks/history/archived-2026-q1/persona-episode-eval-pack-20260105-153100.json`.
- **Steps:**
  1. Open `http://localhost:5173/#entity/Anthropic`.
  2. Wait for the rail to populate from the page's own reactive queries.
  3. Hover a node to isolate its neighbourhood; drag to reposition.
- **Done when:** `[data-testid="entity-graph-rail"]` holds ≥1 node, every
  rendered label is a literal substring of stored research (the capture gate
  asserts exactly this and exits nonzero otherwise), and no edge is presented as
  evidence or assertion.
- **Evidence (2026-08-13, Convex-free half only):**
  `node scripts/capture-graph-rail.mjs` → exit 0, printing
  `rail: 34 entities, 28 edges (all traversal)`,
  `labels verified against fixture: 34`,
  `PASS: zero console errors, non-empty rail, every label traced to the fixture`.
  Capture written to `demo/graph-rail/graph-rail.png`. Independently re-driven by
  hand in a browser at 1280×900 and again at 375×812: `#stats` reached
  `34 entities · 28 edges · replay complete` with no horizontal overflow at
  either width. The **product** route `/#entity/<name>` remains unverified — it
  is behind the Convex gate (defect D1). Zero-width mount is broken (defect D3).

---

## Journeys every agent surface owes

- **Recovery** — J4.
- **Steering** — J3.
- **Receipt** — J2.

None of the three is omitted. J1 and J5 are the two surfaces a stranger meets
first, so they lead the queue.
