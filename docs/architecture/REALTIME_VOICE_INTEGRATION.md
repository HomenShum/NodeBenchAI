# Realtime Voice Integration — Adapter + Scenario Dogfood Matrix

> **Status**: spec drafted 2026-05-08 against current `main`
> **Pattern**: Realtime Adapter — voice = input/output surface for the existing NodeBench pipeline, never a separate product path
> **Prior art (verified)**:
>   - OpenAI announcement 2026-05-07 — GPT-Realtime-2, GPT-Realtime-Translate, GPT-Realtime-Whisper. https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/
>   - OpenAI Realtime WebRTC docs — recommends WebRTC for browser/mobile sessions, ephemeral keys, server-mediated session flow. https://platform.openai.com/docs/guides/realtime-webrtc
>   - Existing NodeBench Gemini 3.1 Flash Live integration (2026-03-28) — already in `server/routes/session.ts`

---

## 0. What ALREADY exists in NodeBench (do not rebuild)

| Layer | File | What it does |
|---|---|---|
| Server route | `server/routes/session.ts` | `POST /voice/session` — Gemini 3.1 Flash Live ephemeral token, 100-session cap, 30-min TTL, eviction |
| Server route | `server/routes/session.ts` | `POST /voice/tool` — tool dispatch from Gemini Live function calls |
| Server route | `server/routes/session.ts` | `GET /voice/health` |
| Server route | `server/routes/tts.ts` | `POST /tts` — ElevenLabs TTS proxy, MAX_CHARS 5000, MAX_BODY_SIZE 8000 |
| Server tool registry | `server/agents/voiceAgent.ts` | `getGeminiVoiceTools()`, `executeVoiceTool()` — voice context tool dispatcher |
| Convex schema | `convex/schema.ts:1670` | `quickCaptures` table — `type:"voice"`, `audioUrl`, `audioStorageId`, `transcription` |
| Convex schema | `convex/schema.ts:3048` | `voiceSessions` table — RTVI/Daily Bots session tracking |
| Convex action | `convex/domains/documents/quickCapture/voiceMemos.ts:9` | `transcribeVoiceMemo` internal action |
| Convex domain | `convex/domains/integrations/voice/voiceAgent.ts` | voice agent integration |
| Frontend hook | `src/features/workspace/lib/useEventCaptureRecorder.ts` | event capture recorder for workspace |
| E2E test | `tests/e2e/voice-input.spec.ts` | scenario-based voice input test (3 personas, 6 scenarios) |

This existing surface is sufficient for: capture, basic Q&A, tool calls. Insufficient for: multi-tier model routing, cost-cap enforcement, PII redaction, translation tier, idempotent reconnect, anonymous-consent gating, paid-work approval, the full 10-scenario dogfood matrix.

---

## 1. Integration Spine

```
Web / Mobile mic / SIP
  → Realtime Gateway
  → transcript events + tool events
  → Convex captures / thread messages
  → NodeBench intent router
  → entity resolution
  → claims / sources / follow-ups
  → report notebook / graph / inbox review
  → Temporal async deep work when needed
```

**Invariant**: realtime only creates or streams input/output. Durable system remains Convex, reports, notebooks, graph, sources, inbox, exports.

**Forbidden** for realtime: full diligence, source verification, daily brief generation, batch synthesis, LLM-judge evals, large reports, market maps. Async only.

---

## 2. Core objects to add or formalize

```
RealtimeSession        — session metadata: userId|anonId, model tier, started/ended, cost
TranscriptSegment      — append-only transcript events keyed by sessionId
VoiceCapture           — finalized capture (existing quickCapture extended with realtime fields)
IntentRoute            — classifier output: capture | qna | dictation | tool_call | escalate_to_async
EntityCandidate        — pre-resolution entity guess from transcript span
ClaimDraft             — voice-derived claim, always confidence=needs_review
FollowUpDraft          — actionable item extracted from voice
NotebookPatch          — TipTap edit op proposal (diffable, versioned, undoable)
RealtimeToolEvent      — tool call / preamble / progress / completion / failure events
RealtimeAuditEvent     — privacy/budget/consent gate decisions, append-only
```

Every realtime flow MUST end in one of these outcomes:

```
saved capture
updated chat thread
updated report
notebook patch
claim/source draft
follow-up
review inbox item
deep workflow queued
```

If a session ends without producing one of these, that is a failure mode and must be logged as a `RealtimeAuditEvent` with reason.

---

## 3. Scenario matrix (10 scenarios)

| # | Scenario | Expected UX | Backend Proof |
|---|----------|-------------|----------------|
| 1 | Anonymous web voice ask | User can ask once, see sourced answer, link account to save | No private memory write before consent |
| 2 | First-time signup | First result becomes saved report after linking | Report, thread, claims created |
| 3 | Returning user | Voice uses existing memory and current report context | Memory-first trace visible |
| 4 | Mobile event capture | Tap mic, speak note, get capture ack | Capture, entities, follow-up, report update |
| 5 | Noisy event capture | Partial transcript still recoverable | Low-confidence entity goes to Inbox |
| 6 | Translation | Original + translated transcript saved | Claims cite translated/original text |
| 7 | Report dictation | Spoken note becomes notebook patch with undo | TipTap patch stored and versioned |
| 8 | Phone-like agent | Preamble, tool progress, confirmation before writes | Tool events + approval log |
| 9 | Bad network / reload | No duplicate capture, no lost transcript | Idempotency key + retry state |
| 10 | Paid/deep research request | Realtime says it queued deeper work | Temporal job created, realtime session ends cleanly |

Each scenario has a corresponding test in `tests/e2e/voice-dogfood-scenarios.spec.ts` (this PR) + `tests/e2e/voice-input.spec.ts` (existing).

Release command:

```bash
BASE_URL=http://127.0.0.1:4173 npm run voice:dogfood
```

---

## 4. Model routing (policy, not scattered)

**Do not scatter model names through UI code. Put routing behind policy.**

```
transcription_only        → realtime transcription model (whisper)
cheap_voice_chat          → lightweight realtime model (mini)
tool_calling_voice_agent  → strongest realtime voice model (realtime-2)
translation               → realtime translation model (translate)
deep_research             → async text/research pipeline (Temporal worker)
```

**Implementation**:
- Config file: `convex/domains/integrations/voice/modelRouting.ts` exports `RoutingPolicy` keyed by `IntentRoute`
- Model IDs + pricing in `convex/domains/integrations/voice/modelCatalog.ts` — single source of truth, rechecked against OpenAI docs at implementation time
- Routing decision is **deterministic** (hashed inputs) and persisted to `RealtimeAuditEvent` for replay
- Existing Gemini 3.1 Flash Live remains the default for `cheap_voice_chat` and `tool_calling_voice_agent` until OpenAI tier is benchmarked head-to-head
- UI code consumes the policy decision — never references provider names

---

## 5. QA dogfood harness (4 layers)

### Layer 1 — Deterministic unit tests
- intent routing (input → expected route)
- entity extraction (transcript → entity candidates with confidence)
- capture idempotency (same idempotency key → same capture, no duplicate)
- notebook patch generation (transcript → TipTap op)
- privacy/budget/consent gates (boolean: allowed | denied | needs_consent | needs_approval)

### Layer 2 — Synthetic audio fixtures
- clean event note
- noisy event note (event-floor noise mixed in)
- ambiguous company/person ("Mercury")
- interrupted speech (cut mid-word)
- bilingual conversation (EN ↔ ZH)
- report dictation
- correction utterance ("no, not Mercury Systems, Mercury the fintech")

Stored at `tests/fixtures/voice/*.wav` with a manifest `tests/fixtures/voice/manifest.json` containing ground-truth transcript + expected entities + expected route.

### Layer 3 — Browser/mobile E2E
- fake mic input with prerecorded audio (Playwright `--use-fake-device-for-media-stream`)
- WebRTC session startup
- live transcript rendering
- capture ack
- report update
- inbox fallback (low-confidence path)
- reload/retry behavior (idempotency proof)

### Layer 4 — LLM judge AFTER deterministic gates pass
**Order matters.** LLM judge runs only when Layer 1-3 are green. Layer 4 grades:
- did it route correctly?
- did it save the right durable object?
- did it avoid hallucinated facts?
- are claims marked `needs_review` when source is weak?
- is the user shown what happened?
- is the next action obvious?

LLM judge variance is masked by deterministic gates — never overload Layer 4 with checks that should be Layer 1.

---

## 6. Release gates (do not ship realtime until ALL pass)

```
☐ No duplicate captures after reconnect
☐ No private memory writes before consent
☐ No paid/deep calls without approval
☐ No raw provider names exposed in normal UX
☐ Transcript visible within target latency (≤ 800ms first partial)
☐ Capture ack appears quickly after speech ends (≤ 1.5s)
☐ Every saved claim has source or needs_review
☐ Notebook patches are editable, diffable, undoable
☐ Mobile works on throttled 5G/LTE
☐ Realtime failure falls back to text capture
```

Each gate maps to specific scenarios in section 3 and tests in the harness.

---

## 7. Daily dogfood cadence

Run the same script daily, against the deployed app:

```
1. Open mobile event mode
2. Capture 5 spoken notes
3. Ask who to follow up with
4. Open the generated report
5. Verify claims and sources
6. Dictate a notebook edit
7. Export follow-ups
8. Check Inbox uncertainty queue
9. Re-run after reload and weak network
```

Failures get filed as P0/P1/P2 issues. The 10-scenario matrix from section 3 is the QA bar; the daily cadence is the smoke test that catches regressions between full QA runs.

---

## 8. Reliability invariants (apply 8-point checklist)

Already satisfied by existing infra:
- `BOUND` — `MAX_SESSIONS=100`, `SESSION_TTL_MS=30min` in `session.ts`
- `BOUND_READ` — `MAX_CHARS=5000`, `MAX_BODY_SIZE=8000` in `tts.ts`
- `TIMEOUT` — session TTL + eviction in `session.ts`

To add:
- `HONEST_STATUS` — close codes 4004 (cost cap), 4005 (PII detected), 4006 (consent required)
- `HONEST_SCORES` — cost ledger from actual API response, never estimate
- `SSRF` — audit assertion (no user-supplied URLs in voice flow)
- `ERROR_BOUNDARY` — Gemini Live disconnect → fallback to Web Speech API (already wired for the 12 voice command aliases per CLAUDE.md)
- `DETERMINISTIC` — model routing decision hashed + stored in `RealtimeAuditEvent` for replay

---

## 9. Phased rollout

### Phase 1 — Baseline + matrix coverage (week 1)
- Wire `tests/e2e/voice-dogfood-scenarios.spec.ts` (this PR)
- Add the release command `npm run voice:dogfood`
- Run all 10 scenarios against current Gemini Live tier
- Record baseline cost, latency, WER
- Gate: scenarios 4, 5, 6, 7 pass; scenarios 1, 9, 10 surface as named TODO blockers

### Phase 2 — Privacy + consent + budget gates (week 2)
- Add `RealtimeAuditEvent` table
- Anonymous-ask consent flow (scenario 1)
- Cost ledger + cap (release gate 3)
- PII redaction in `transcribeVoiceMemo`
- Idempotency key on captures (scenario 9)
- Gate: scenarios 1, 9 pass; release gates 1-3, 7 met

### Phase 3 — Multi-tier model adapter (week 3)
- `modelRouting.ts` policy file
- `modelCatalog.ts` single source of truth
- OpenAI Realtime adapter behind env flag
- Routing decision deterministic + audited
- Gate: scenarios 3, 8 pass on both Gemini and OpenAI tiers

### Phase 4 — Translation + paid escalation (week 4)
- Translation tier opt-in for events
- Temporal escalation flow for deep research (scenario 10)
- Notebook dictation extension (scenario 7)
- Gate: scenarios 6, 7, 10 pass; release gates 8-10 met

### Kill criteria
- Cost > $10/user/day for 2 days → fall back to whisper or Gemini Live
- WER > 12% on dogfood corpus → revert to Web Speech API
- Privacy incident → kill non-Gemini tiers, audit, ship redaction before resume
- Adoption < 3 captures/user/week after week 4 → re-evaluate UX, don't keep paying

---

## 10. The standard

> Voice captures the moment.
> NodeBench turns it into durable intelligence.
> Inbox catches uncertainty.
> Reports preserve memory.
> Notebook lets the user edit truth.
> Sources prove it.

That is the QA bar.

---

## Related rules

- `agentic_reliability` — 8-point checklist applied
- `scenario_testing` — 10 scenarios codified
- `live_dom_verification` — Tier A check extended for `/voice/health`
- `pre_release_review` — voice surface added to layer 8
- `qa_dogfood` — daily cadence script

## Canonical reference

This doc.
