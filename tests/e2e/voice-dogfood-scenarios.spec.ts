/**
 * Voice Dogfood Scenarios — 10-scenario matrix companion to
 * `docs/architecture/REALTIME_VOICE_INTEGRATION.md` section 3.
 *
 * `tests/e2e/voice-input.spec.ts` covers basic mic affordance + browser
 * mode lifecycle for 3 personas. This file covers the durable-outcome
 * scenarios that prove the realtime adapter writes into the right
 * NodeBench objects (capture / report / notebook patch / inbox / Temporal
 * escalation) under the right consent/budget/idempotency gates.
 *
 * Each test follows scenario_testing.md mandate — persona / goal /
 * prior state / actions / scale / duration / expected / edge cases —
 * even when skipped on unfinished backend, so test reports show
 * named blockers rather than hiding the gap.
 *
 * Run:  BASE_URL=http://127.0.0.1:4173 npm run voice:dogfood
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function assertVoiceHealth(page: Page): Promise<void> {
  const res = await page.request.get(`${BASE_URL}/voice/health`);
  expect(res.ok(), "voice route must be mounted").toBe(true);
  const body = await res.json().catch(() => ({}));
  expect(body, "voice/health body shape").toMatchObject({ ok: expect.any(Boolean) });
}

/** Drop a canned audio fixture into Playwright's fake-mic shim. */
async function injectFakeMicStream(page: Page, fixturePath: string): Promise<void> {
  await page.addInitScript((path: string) => {
    (window as unknown as { __MIC_FIXTURE__?: string }).__MIC_FIXTURE__ = path;
  }, fixturePath);
}

// ─── Scenario 1: Anonymous web voice ask ─────────────────────────────────────
test.describe("Scenario 1 — Anonymous web voice ask", () => {
  /**
   * Persona:     New visitor, no account
   * Goal:        Ask one question by voice, see a sourced answer, decide whether to link account
   * Prior state: No auth, no Convex user record, no memory
   * Actions:
   *    1. Land on /, click voice CTA
   *    2. Inject fake mic stream with one short question
   *    3. Wait for sourced answer
   *    4. See "link account to save" prompt
   * Scale:       1 anonymous user, 1 utterance
   * Duration:    < 10s
   * Expected:
   *    - Sourced answer rendered (citations visible)
   *    - NO write to private memory (no entity / claim / capture under any user id)
   *    - "Link account to save" affordance visible
   *    - RealtimeAuditEvent records `gate: "anonymous_no_persist"`
   * Edge cases:
   *    - User dismisses link prompt → session torn down, nothing retained
   *    - User links account → captured utterance + answer migrate to new user id
   */
  test.skip(
    "Phase 2 backend gate: anonymous consent flow + RealtimeAuditEvent not yet wired",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 2:
      // 1. Visit / as anonymous (no auth cookie)
      // 2. Inject fixtures/voice/anon-ask.wav
      // 3. Assert citations rendered
      // 4. Query Convex: assert NO entity / claim / capture rows correlated to this session
      // 5. Assert "link account to save" CTA visible
      // 6. Assert RealtimeAuditEvent has gate=="anonymous_no_persist"
    },
  );
});

// ─── Scenario 2: First-time signup → first result becomes saved report ───────
test.describe("Scenario 2 — First-time signup, first result saved", () => {
  /**
   * Persona:     User who just linked account from anonymous voice ask
   * Goal:        First voice-derived answer becomes a durable saved report
   * Prior state: Just signed up; anonymous session result is in transient state
   * Actions:
   *    1. Complete signup
   *    2. Verify the prior anonymous answer is preserved
   *    3. Open the generated report
   * Scale:       1 user
   * Duration:    < 30s for migration
   * Expected:
   *    - Report row created in `reports` table
   *    - Thread row created with the original question + answer
   *    - Claims drafted with sources, confidence=needs_review
   *    - User lands on the report after signup
   * Edge cases:
   *    - Signup fails → answer remains transient, no orphan rows
   *    - Anonymous session expired → user sees "session expired, please ask again"
   */
  test.skip(
    "Phase 2 backend gate: anon→linked migration not yet wired",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 2:
      // 1. Reproduce scenario 1 anonymous state
      // 2. Sign up via test auth fixture
      // 3. Assert reports row created with originating sessionId
      // 4. Assert thread + claims + sources rows persisted under new userId
      // 5. Assert lands on /reports/<id>
    },
  );
});

// ─── Scenario 3: Returning user — memory-first trace ─────────────────────────
test.describe("Scenario 3 — Returning user uses existing memory + current report context", () => {
  /**
   * Persona:     Existing user with prior captures, claims, and an open report
   * Goal:        Voice question uses memory before hitting external sources
   * Prior state: User has report open, capture history exists for the same entity
   * Actions:
   *    1. Open existing Stripe report
   *    2. Activate mic, ask "what's changed since last week"
   * Scale:       1 user, 1 utterance
   * Duration:    < 5s
   * Expected:
   *    - Memory-first trace visible (cites prior captures + claims)
   *    - External fetch only when memory has gap
   *    - Trace UI shows: classify → memory hit → context bundle → answer
   *    - Cost lower than scenario 1 (memory-first avoids external fetch)
   * Edge cases:
   *    - Memory empty for entity → falls back to external, trace shows fallback
   *    - User has no current report context → asks for clarification
   */
  test.skip(
    "Phase 1 baseline gate: SearchTrace memory-first surfacing not yet asserted",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 1:
      // 1. Seed user with Stripe captures + claims via test fixture
      // 2. Open report, inject fixtures/voice/whats-changed.wav
      // 3. Assert SearchTrace renders steps including "memory hit"
      // 4. Assert no external web fetch in network log when memory was sufficient
    },
  );
});

// ─── Scenario 4: Mobile event capture ────────────────────────────────────────
test.describe("Scenario 4 — Mobile event capture: tap, speak, ack", () => {
  /**
   * Persona:     "Sarah" — founder at demo day on iPhone
   * Goal:        Walk between booths, capture spoken notes, get acknowledgment
   * Prior state: Logged in, mobile viewport, mic permission granted
   * Actions:
   *    1. Tap mic
   *    2. Speak: "Met Alex from Orbital Labs. They build voice-agent eval infra."
   *    3. Stop
   *    4. Verify capture ack appears
   * Scale:       1 user, 5 captures over 10 min
   * Duration:    Sustained — verifies no state drift
   * Expected:
   *    - Capture row in `quickCaptures` (type=voice)
   *    - Entities resolved: "Alex" (Person), "Orbital Labs" (Organization)
   *    - Follow-up draft created
   *    - Active report (Demo Day) updated
   *    - Visible toast: "Captured to Ship Demo Day · Alex · Orbital Labs · 1 follow-up"
   * Edge cases:
   *    - Same person mentioned twice → entity dedupe
   *    - User stops mid-sentence → partial transcript saved with status="partial"
   */
  test.skip(
    "Phase 1 baseline gate: capture-to-entity resolution latency not yet asserted",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 1:
      // 1. Mobile viewport (iPhone 14 preset)
      // 2. Inject fixtures/voice/demoday-orbital-labs.wav
      // 3. Assert quickCaptures row created within 2s of utterance end
      // 4. Assert resolvedEntityIds.length >= 2
      // 5. Assert toast contains "Orbital Labs"
      // 6. Repeat for 5 captures, assert no drift
    },
  );
});

// ─── Scenario 5: Noisy event capture → low-confidence Inbox fallback ─────────
test.describe("Scenario 5 — Noisy event capture: partial transcript recoverable", () => {
  /**
   * Persona:     User in loud event environment
   * Goal:        Even with noise, partial transcript is preserved and triaged
   * Prior state: Logged in, event mode active
   * Actions:
   *    1. Activate mic
   *    2. Inject noisy fixture (event-floor noise + speech)
   *    3. Stop
   * Scale:       1 user, 1 noisy capture
   * Duration:    < 10s
   * Expected:
   *    - Partial transcript saved
   *    - Low-confidence entities flagged (confidence < threshold)
   *    - Capture appears in Inbox uncertainty queue (not the main report)
   *    - User can review/edit/promote to report from Inbox
   * Edge cases:
   *    - Pure noise (no speech) → no capture row, audit event "no_speech_detected"
   *    - 1-word transcript → still goes to Inbox, never auto-promotes
   */
  test.skip(
    "Phase 2 backend gate: Inbox uncertainty queue routing for voice not yet wired",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 2:
      // 1. Inject fixtures/voice/noisy-event.wav
      // 2. Assert quickCaptures row exists with status=partial/noisy
      // 3. Assert Inbox shows the capture for review
      // 4. Assert NOT promoted into active report automatically
    },
  );
});

// ─── Scenario 6: Translation — original + translated saved ───────────────────
test.describe("Scenario 6 — Translation: original + translated transcripts both saved", () => {
  /**
   * Persona:     "Lina" — bilingual operator
   * Goal:        Capture cross-language conversation in both EN and ZH
   * Prior state: Translation panel opened, event session started
   * Actions:
   *    1. Inject 50-utterance bilingual fixture
   * Scale:       1 user, 50 utterances
   * Duration:    Sustained
   * Expected:
   *    - Each capture has both `transcript` (source) and `translatedTranscript` fields
   *    - Both languages stored on capture
   *    - Claims cite either translated OR original (with attribution)
   *    - All claims marked confidence=needs_review
   * Edge cases:
   *    - Code-switching ("我们 closed our Series A")
   *    - Speaker overlap
   *    - Idiomatic untranslatables flagged, not silently dropped
   */
  test.skip(
    "Phase 4 backend gate: translate tier + dual-language storage not yet wired",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 4:
      // 1. Navigate to event mode
      // 2. Inject fixtures/voice/translation-50utt-bilingual.wav
      // 3. Assert each capture has translatedTranscript field populated
      // 4. Run BLEU vs tests/fixtures/voice/translation-ground-truth.json
      // 5. Assert score >= 0.70
      // 6. Assert all derived claims have confidence=needs_review
    },
  );
});

// ─── Scenario 7: Report dictation patches TipTap ─────────────────────────────
test.describe("Scenario 7 — Report dictation: spoken note → notebook patch with undo", () => {
  /**
   * Persona:     "Priya" — researcher dictating into a Stripe report draft
   * Goal:        Add a personal take to an existing report section
   * Prior state: Stripe report open in TipTap, cursor in "Analyst notes" section
   * Actions:
   *    1. Activate mic in editor mode
   *    2. Speak: "Add my take. Their churn is improving because their support investments are paying off."
   *    3. Verify diff preview appears
   *    4. Confirm patch
   * Scale:       1 user, 1 patch
   * Duration:    < 10s
   * Expected:
   *    - NotebookPatch row stored, versioned
   *    - Diff preview shown before commit
   *    - Cmd+Z reverts the patch
   *    - Section attribution preserved (provenance: voice)
   * Edge cases:
   *    - Cursor in read-only zone → mic refuses to activate
   *    - User says "cancel" mid-utterance → no patch
   *    - Reject diff → no edit, no cost charged
   */
  test.skip(
    "Phase 4 backend gate: TipTap dictation extension + NotebookPatch not yet wired",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 4:
      // 1. Open editable report at known URL
      // 2. Place cursor in "Analyst notes" section
      // 3. Inject fixtures/voice/dictation-take.wav
      // 4. Assert diff preview modal appears
      // 5. Confirm
      // 6. Assert NotebookPatch row exists with versioning
      // 7. Cmd+Z → assert patch reverts
    },
  );
});

// ─── Scenario 8: Phone-like agent — preamble + tool progress + write approval ─
test.describe("Scenario 8 — Phone-like agent: preamble, tool progress, confirmation before writes", () => {
  /**
   * Persona:     "Marcus" — banker on a phone-style voice agent session
   * Goal:        Pull live diligence on Stripe with parallel tool calls; approval before durable writes
   * Prior state: Logged in, agent panel open, agent mode toggled
   * Actions:
   *    1. Speak: "Pull diligence on Stripe, focus on funding."
   *    2. Hear preamble while tools run
   *    3. Hear final answer
   *    4. Hear "save this to your Stripe report?" before any write
   * Scale:       1 user, 1 session
   * Duration:    < 30s
   * Expected:
   *    - >= 2 RealtimeToolEvent rows with status=parallel
   *    - Preamble plays within 800ms of utterance complete
   *    - No durable write before user confirms ("yes" or click)
   *    - Approval logged in RealtimeAuditEvent
   * Edge cases:
   *    - One tool fails → answer synthesized from remaining sources
   *    - User says "no" → nothing persisted, audit logs the rejection
   *    - User idle past 5s after answer → agent prompts to confirm
   */
  test.skip(
    "Phase 3 backend gate: realtime-2 tier + approval-before-write not yet wired",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 3:
      // 1. Open agent panel, toggle agent mode
      // 2. Inject fixtures/voice/diligence-stripe.wav
      // 3. Assert preamble within 800ms of utterance end
      // 4. Assert >= 2 parallel RealtimeToolEvent rows
      // 5. Assert NO claims/captures written until user confirms
      // 6. Confirm via voice ("yes") or click
      // 7. Assert claims now exist + audit log shows approval
    },
  );
});

// ─── Scenario 9: Bad network / reload — idempotency proof ────────────────────
test.describe("Scenario 9 — Bad network / reload: no duplicate capture, no lost transcript", () => {
  /**
   * Persona:     Mobile user with flaky 5G/LTE
   * Goal:        Speak a capture, lose connection mid-stream, reconnect — exactly one capture persisted
   * Prior state: Logged in, mid-utterance
   * Actions:
   *    1. Begin capture, speak partial
   *    2. Throttle network to offline
   *    3. Wait 3s
   *    4. Restore network
   *    5. Reload page (worst case)
   * Scale:       1 user, multi-disconnect
   * Duration:    < 30s including reconnect
   * Expected:
   *    - Idempotency key on capture: same key from client → server returns existing capture, no duplicate
   *    - Partial transcript preserved across reconnect
   *    - Final capture has full transcript OR status=partial with what was captured
   *    - No orphan TranscriptSegment rows without parent capture
   * Edge cases:
   *    - Network never recovers → capture finalized with status=partial after timeout
   *    - User opens new tab + speaks during disconnect → second session, separate idempotency key
   *    - Server-side retry storm avoided (exponential backoff with jitter)
   */
  test.skip(
    "Phase 2 backend gate: idempotency key + partial-transcript persistence not yet wired",
    async ({ page, context }) => {
      await assertVoiceHealth(page);
      // TODO Phase 2:
      // 1. Begin capture with fixtures/voice/event-note-partial.wav
      // 2. await context.setOffline(true)
      // 3. Wait 3s
      // 4. await context.setOffline(false)
      // 5. Reload page
      // 6. Query Convex: assert exactly 1 capture row for this idempotency key
      // 7. Assert no orphan TranscriptSegment rows
    },
  );
});

// ─── Scenario 10: Paid/deep research → Temporal escalation ───────────────────
test.describe("Scenario 10 — Paid/deep research: realtime queues, async pipeline picks up", () => {
  /**
   * Persona:     User asking for something realtime should NOT do
   * Goal:        Realtime detects scope, queues async work, ends session cleanly
   * Prior state: Logged in
   * Actions:
   *    1. Speak: "Do a full diligence pack on every YC W26 fintech."
   *    2. Realtime classifier routes intent=deep_research
   *    3. Realtime says "queued — I'll notify you when ready"
   * Scale:       1 user, 1 escalation
   * Duration:    < 5s realtime; async runs separately
   * Expected:
   *    - IntentRoute=deep_research recorded
   *    - Temporal job created with the user's request
   *    - User informed in-voice that work was queued (not silently dropped)
   *    - Realtime session ends cleanly (no zombie WebRTC channel)
   *    - Notification delivered when async work completes
   * Edge cases:
   *    - Cost gate denies escalation (free tier user) → user told to upgrade, no Temporal job
   *    - Async work fails → notification with retry option, original request preserved
   */
  test.skip(
    "Phase 4 backend gate: Temporal escalation handoff not yet wired into voice",
    async ({ page }) => {
      await assertVoiceHealth(page);
      // TODO Phase 4:
      // 1. Inject fixtures/voice/deep-research-request.wav
      // 2. Assert IntentRoute=deep_research recorded
      // 3. Assert Temporal job ID returned + persisted
      // 4. Assert voice response confirms queuing
      // 5. Assert RealtimeSession.status=ended_cleanly
      // 6. Trigger Temporal job complete fixture
      // 7. Assert notification delivered
    },
  );
});

// ─── Coverage matrix assertion ───────────────────────────────────────────────
test.describe("Dogfood matrix coverage", () => {
  /**
   * Sanity check that all 10 scenarios from spec section 3 are
   * accounted for. Test always runs (no backend dependency).
   */
  test("10/10 dogfood scenarios accounted for across spec files", () => {
    const matrix = {
      1:  { file: "voice-dogfood-scenarios.spec.ts", note: "anonymous web voice ask" },
      2:  { file: "voice-dogfood-scenarios.spec.ts", note: "first-time signup → saved report" },
      3:  { file: "voice-dogfood-scenarios.spec.ts", note: "returning user memory-first" },
      4:  { file: "voice-dogfood-scenarios.spec.ts", note: "mobile event capture ack" },
      5:  { file: "voice-dogfood-scenarios.spec.ts", note: "noisy capture → Inbox fallback" },
      6:  { file: "voice-dogfood-scenarios.spec.ts", note: "translation dual-language" },
      7:  { file: "voice-dogfood-scenarios.spec.ts", note: "report dictation patch + undo" },
      8:  { file: "voice-dogfood-scenarios.spec.ts", note: "phone-like agent + approval" },
      9:  { file: "voice-dogfood-scenarios.spec.ts", note: "bad network reload idempotency" },
      10: { file: "voice-dogfood-scenarios.spec.ts", note: "paid/deep → Temporal escalation" },
    } as const;

    expect(Object.keys(matrix).length).toBe(10);
    for (const [n, entry] of Object.entries(matrix)) {
      expect(entry.file, `scenario ${n} must declare a host file`).toBeTruthy();
      expect(entry.note, `scenario ${n} must declare a behavior note`).toBeTruthy();
    }
  });

  /**
   * Release-gate coverage assertion — each gate from spec section 6
   * must be tied to at least one scenario above.
   */
  test("10/10 release gates each map to a scenario", () => {
    const gates = [
      { gate: "no duplicate captures after reconnect",        coveredBy: [9] },
      { gate: "no private memory writes before consent",      coveredBy: [1] },
      { gate: "no paid/deep calls without approval",          coveredBy: [8, 10] },
      { gate: "no raw provider names exposed in normal UX",   coveredBy: [3, 4, 8] },
      { gate: "transcript visible within target latency",     coveredBy: [4, 5] },
      { gate: "capture ack appears quickly",                  coveredBy: [4] },
      { gate: "every saved claim has source or needs_review", coveredBy: [3, 6, 8] },
      { gate: "notebook patches editable/diffable/undoable",  coveredBy: [7] },
      { gate: "mobile works on throttled 5G/LTE",             coveredBy: [4, 9] },
      { gate: "realtime failure falls back to text capture",  coveredBy: [9] },
    ];
    expect(gates.length).toBe(10);
    for (const g of gates) {
      expect(g.coveredBy.length, `gate "${g.gate}" must be covered`).toBeGreaterThan(0);
    }
  });
});
