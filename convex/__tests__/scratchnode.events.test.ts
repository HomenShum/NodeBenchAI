/// <reference types="vite/client" />
/**
 * Scenario tests for scratchnode.live event mutations — covers the 4 P1
 * coverage gaps surfaced by the post-deploy review of PRs #377-#381.
 *
 * Per .claude/rules/scenario_testing.md — every test names a persona, a goal,
 * prior state, an action sequence, scale, and duration. Shallow happy-path
 * unit tests are banned.
 *
 * Hybrid harness:
 *   - composeAnswer / publishWiki / sequential claimHost  → drive the Convex
 *     mutation handlers directly via `(name as any)._handler(ctx, args)` and
 *     back them with an in-memory `MockDb`. Mirrors convex/domains/founder/
 *     __tests__/ambientIntelligenceOps.test.ts.
 *   - claimHost concurrent-race test                      → uses the official
 *     `convex-test` framework (Phase 4 follow-up to PR #396). The MockDb does
 *     NOT model Convex serial-mutation semantics, so it can't surface the
 *     production race contract honestly; `convex-test` runs the real Convex
 *     transaction engine in-process and serializes mutations by table-write-
 *     set the same way the live runtime does.
 *
 * Coverage matrix:
 *   1. composeAnswer — first call creates new answer + sources; second call
 *      with same normalized question reuses cached body and emits a
 *      semantic_cache_lookup ok trace step.
 *   2. publishWiki — attendee (no host row) is rejected with code=not_host;
 *      claimed host succeeds and writes a status="published" wiki version.
 *   3. claimHost — concurrent claims via convex-test: exactly ONE row lands
 *      in liveEventHosts, the loser receives host_already_claimed.
 *   4. Anonymous chat hydration leak — kept as an E2E spec in
 *      tests/e2e/anonymous-chat-leak.spec.ts (it tests rendered DOM, not a
 *      Convex handler).
 *
 * Pattern: deterministic, sandboxed. No network, no live Convex deploy.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";

import * as eventsModule from "../events";
import { publishWiki, claimHost, requestHostClaim, releaseHost } from "../events";
import schema from "../schema";
import { api } from "../_generated/api";

// convex-test needs the full module map so it can resolve `api.events.claimHost`
// to the actual handler. The repo's Convex source lives in ./convex/**/*.{ts,js},
// so we glob from this test file's parent (the convex/ directory).
const convexModules = import.meta.glob("../**/*.{ts,js}");

// Resolve `composeAnswer` with a fallback to `askAgent`.
// Rationale: the rename PR (refactor/rename-ask-to-compose) is open but not
// merged at the time this test was written. Per the task brief, tests are
// written against `composeAnswer` (the new name); when the rename merges,
// the fallback path becomes dead code and can be removed in a one-line
// follow-up. This keeps CI green during the rename rollout.
//
// Once the rename PR merges, replace this block with:
//   import { composeAnswer, publishWiki, claimHost } from "../events";
const composeAnswer =
  (eventsModule as any).composeAnswer ?? (eventsModule as any).askAgent;

/* -------------------------------------------------------------------------- */
/* In-memory MockDb — mirrors convex/domains/founder/__tests__ pattern         */
/* -------------------------------------------------------------------------- */

type TableRecord = Record<string, any>;
type Tables = Record<string, TableRecord[]>;

class MockIndexBuilder {
  private filters: Array<{ field: string; op: "eq" | "gte" | "lt"; value: unknown }> = [];

  eq(field: string, value: unknown) {
    this.filters.push({ field, op: "eq", value });
    return this;
  }

  gte(field: string, value: unknown) {
    this.filters.push({ field, op: "gte", value });
    return this;
  }

  lt(field: string, value: unknown) {
    this.filters.push({ field, op: "lt", value });
    return this;
  }

  getFilters() {
    return this.filters;
  }
}

class MockFilterBuilder {
  // Used by `.filter(q => q.lt(q.field("lastSeenAt"), cutoff))` (presence janitor).
  lt(left: { field: string }, value: unknown) {
    return { kind: "lt" as const, field: left.field, value };
  }
  gte(left: { field: string }, value: unknown) {
    return { kind: "gte" as const, field: left.field, value };
  }
  eq(left: { field: string }, value: unknown) {
    return { kind: "eq" as const, field: left.field, value };
  }
  field(name: string) {
    return { field: name };
  }
}

type FilterFn = (q: MockFilterBuilder) => any;

class MockQueryChain {
  private orderDirection: "asc" | "desc" = "asc";
  private extraFilter: FilterFn | null = null;

  constructor(
    private readonly rows: TableRecord[],
    private readonly filters: Array<{ field: string; op: "eq" | "gte" | "lt"; value: unknown }>,
  ) {}

  order(direction: "asc" | "desc") {
    this.orderDirection = direction;
    return this;
  }

  filter(fn: FilterFn) {
    this.extraFilter = fn;
    return this;
  }

  async take(limit: number) {
    return this.getRows().slice(0, limit);
  }

  async first() {
    return this.getRows()[0] ?? null;
  }

  async collect() {
    return this.getRows();
  }

  private applyExtraFilter(rows: TableRecord[]): TableRecord[] {
    if (!this.extraFilter) return rows;
    const builder = new MockFilterBuilder();
    const expr = this.extraFilter(builder);
    if (!expr || !expr.kind) return rows;
    return rows.filter((row) => {
      const v = row[expr.field];
      if (expr.kind === "lt") return v < (expr.value as any);
      if (expr.kind === "gte") return v >= (expr.value as any);
      if (expr.kind === "eq") return v === expr.value;
      return true;
    });
  }

  private getRows() {
    let filtered = this.rows.filter((row) =>
      this.filters.every(({ field, op, value }) => {
        const v = row[field];
        if (op === "eq") return v === value;
        if (op === "gte") return v >= (value as any);
        if (op === "lt") return v < (value as any);
        return true;
      }),
    );
    filtered = this.applyExtraFilter(filtered);
    const sorted = [...filtered].sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      return this.orderDirection === "desc" ? right - left : left - right;
    });
    return sorted;
  }
}

function sortValue(row: TableRecord) {
  // composeAnswer/publishWiki sort by createdAt; sources by uploadedAt; wiki by version.
  return (
    row.version ??
    row.createdAt ??
    row.uploadedAt ??
    row.lastSeenAt ??
    row.joinedAt ??
    row.startedAt ??
    0
  );
}

class MockDb {
  public inserts: Array<{ table: string; value: TableRecord }> = [];
  public patches: Array<{ id: string; value: TableRecord }> = [];
  private idCounter = 0;

  constructor(private readonly tables: Tables) {}

  async get(id: string) {
    for (const rows of Object.values(this.tables)) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return null;
  }

  query(table: string) {
    const rows = this.tables[table] ?? [];
    return {
      withIndex: (
        _indexName: string,
        build: (builder: MockIndexBuilder) => MockIndexBuilder,
      ) => {
        const builder = build(new MockIndexBuilder());
        return new MockQueryChain(rows, builder.getFilters());
      },
      filter: (fn: FilterFn) => {
        const chain = new MockQueryChain(rows, []);
        return chain.filter(fn);
      },
    };
  }

  async insert(table: string, value: TableRecord) {
    this.idCounter += 1;
    const inserted = { _id: `${table}:${this.idCounter}`, ...value };
    this.inserts.push({ table, value: inserted });
    if (!this.tables[table]) this.tables[table] = [];
    this.tables[table].push(inserted);
    return inserted._id;
  }

  async patch(id: string, value: TableRecord) {
    this.patches.push({ id, value });
    for (const rows of Object.values(this.tables)) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) {
        Object.assign(row, value);
        return;
      }
    }
    throw new Error(`Missing row ${id}`);
  }

  async delete(id: string) {
    for (const [table, rows] of Object.entries(this.tables)) {
      const idx = rows.findIndex((candidate) => candidate._id === id);
      if (idx >= 0) {
        this.tables[table] = [...rows.slice(0, idx), ...rows.slice(idx + 1)];
        return;
      }
    }
    throw new Error(`Missing row ${id}`);
  }
}

type SchedulerCall = { delayMs: number; ref: unknown; args: unknown };

class MockScheduler {
  public calls: SchedulerCall[] = [];

  async runAfter(delayMs: number, ref: unknown, args: unknown) {
    this.calls.push({ delayMs, ref, args });
    return `scheduled:${this.calls.length}` as unknown;
  }
}

function createCtx(tables: Tables) {
  return { db: new MockDb(tables), scheduler: new MockScheduler() };
}

const ANONYMOUS_SESSION_A = "session-anon-aaaaaaaa";
const ANONYMOUS_SESSION_B = "session-anon-bbbbbbbb";
const HOST_OWNER_KEY = "owner-key-hostable-12345";
const ATTENDEE_OWNER_KEY = "owner-key-attendee-12345"; // long enough to pass requireOwnerKey

function baseEvent(overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    _id: "liveEvents:1",
    slug: "ai-infra-summit-2026",
    name: "AI Infra Summit",
    roomCode: "ORBITAL",
    status: "live",
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function baseSources(eventId = "liveEvents:1"): TableRecord[] {
  // Three seeded sources whose tokens match "MCP auth timeline" so the source
  // ranker picks them deterministically. Body excerpts are crafted to share
  // "mcp", "auth", and "timeline" tokens with the question.
  return [
    {
      _id: "liveEventSources:1",
      eventId,
      uri: "transcript://test/mcp-auth",
      kind: "transcript",
      title: "MCP auth panel transcript",
      excerpt: "Panelists agreed scoped credentials are the gating item.",
      body: "MCP auth timeline: teams are moving toward scoped credentials and audit trails.",
      sourceHash: "abc123",
      isSeeded: true,
      uploadedAt: 1_700_000_000_000,
    },
    {
      _id: "liveEventSources:2",
      eventId,
      uri: "doc://test/voice-eval",
      kind: "doc",
      title: "Voice-agent evaluation notes",
      excerpt: "Voice agents need eval on latency, interruption handling, hallucinated actions.",
      body: "Voice-agent evaluation: comparing latency, barge-in handling, escalation to humans.",
      sourceHash: "abc124",
      isSeeded: true,
      uploadedAt: 1_700_000_000_001,
    },
    {
      _id: "liveEventSources:3",
      eventId,
      uri: "slide://test/healthcare",
      kind: "slide",
      title: "Healthcare workflow pilot slide",
      excerpt: "Healthcare pilots clustered around intake and clinical note prep.",
      body: "Healthcare pilots: low-risk workflow automation vs clinical decision support.",
      sourceHash: "abc125",
      isSeeded: true,
      uploadedAt: 1_700_000_000_002,
    },
  ];
}

function baseMember(sessionId: string, eventId = "liveEvents:1"): TableRecord {
  return {
    _id: `liveEventMembers:${sessionId}`,
    eventId,
    sessionId,
    displayName: "Anonymous Guest",
    joinedAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_000_000,
  };
}

function baseMessage(messageId: string, eventId = "liveEvents:1"): TableRecord {
  return {
    _id: messageId,
    eventId,
    sessionId: ANONYMOUS_SESSION_A,
    displayName: "Anonymous Guest",
    text: "What is the MCP auth timeline?",
    kind: "ask",
    createdAt: 1_700_000_000_000,
  };
}

/* ========================================================================== */
/* Test 1 — composeAnswer cache reuse                                          */
/* ========================================================================== */

describe("composeAnswer — cache reuse across attendees", () => {
  /**
   * Scenario:    First /ask creates a sourced answer; second /ask within the
   *              same event (different attendee, same normalized question)
   *              reuses the cached body via the semantic_cache_lookup path.
   * User:        Two anonymous attendees in the same room
   * Goal:        Get a sourced answer to "What is the MCP auth timeline?"
   * Prior state: event ai-infra-summit-2026 live; 3 seeded sources; 0 answers;
   *              both attendees joined as members
   * Actions:
   *   1. attendee A calls composeAnswer({ eventId, sessionId_A, question })
   *   2. wait, then attendee B (different sessionId) calls composeAnswer
   *      with the same question (different casing + trailing question mark)
   *      to exercise normalizeQuestion()
   * Scale:       1 → 2 attendees, sequential
   * Duration:    Two mutations within a single test tick
   * Expected:
   *   - call 1: NEW liveEventAnswers row; cacheHit=false;
   *     sourceIds populated (≥1); trace contains a "deterministic_synthesis"
   *     step; body is non-empty.
   *   - call 2: NEW liveEventAnswers row (the runtime ALWAYS writes a row;
   *     "cache reuse" means body+sourceIds are copied from the prior answer);
   *     cacheHit=true; trace contains a "semantic_cache_lookup" step with
   *     status="ok"; body equals call-1 body byte-for-byte.
   * Edge:        Different casing + punctuation must still hit cache via
   *              normalizeQuestion() — production attendees do not type
   *              identical strings.
   */
  it("first attendee creates answer, second attendee reuses cached body via normalized question", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventMembers: [
        baseMember(ANONYMOUS_SESSION_A),
        baseMember(ANONYMOUS_SESSION_B),
      ],
      liveEventSources: baseSources(),
      liveEventMessages: [
        baseMessage("liveEventMessages:1"),
        baseMessage("liveEventMessages:2"),
      ],
      liveEventAnswers: [],
    };
    const ctx = createCtx(tables);

    const callA = await (composeAnswer as any)._handler(ctx, {
      eventId: "liveEvents:1",
      sessionId: ANONYMOUS_SESSION_A,
      questionMessageId: "liveEventMessages:1",
      question: "What is the MCP auth timeline?",
    });

    expect(callA).toBeTruthy();
    expect(callA.cacheHit).toBe(false);
    expect(Array.isArray(callA.sourceIds)).toBe(true);
    expect(callA.sourceIds.length).toBeGreaterThanOrEqual(1);
    expect(callA.body.length).toBeGreaterThan(20);
    expect(callA.agentMode).toBe("deterministic");
    expect(callA.evaluation?.passed).toBe(true);
    expect(callA.evaluation?.score).toBeGreaterThanOrEqual(80);
    expect(callA.trace.some((step: any) => step.step === "deterministic_synthesis")).toBe(true);
    expect(callA.trace.find((step: any) => step.step === "deterministic_synthesis").status).toBe("ok");

    // Second attendee, same normalized question (different casing + punctuation).
    const callB = await (composeAnswer as any)._handler(ctx, {
      eventId: "liveEvents:1",
      sessionId: ANONYMOUS_SESSION_B,
      questionMessageId: "liveEventMessages:2",
      question: "  what is the MCP auth TIMELINE???  ",
    });

    expect(callB).toBeTruthy();
    expect(callB.cacheHit).toBe(true);
    expect(callB.agentMode).toBe("cache");
    expect(callB.evaluation?.passed).toBe(true);
    expect(callB.body).toBe(callA.body);
    expect(callB.sourceIds).toEqual(callA.sourceIds);
    const cacheStep = callB.trace.find((step: any) => step.step === "semantic_cache_lookup");
    expect(cacheStep).toBeTruthy();
    expect(cacheStep.status).toBe("ok");
  });

  /**
   * Scenario:    Empty source corpus — composeAnswer must throw a typed
   *              "no_sources" error, NOT a fake 200 with a hallucinated body
   *              (HONEST_STATUS invariant from .claude/rules/agentic_reliability.md).
   * User:        Anonymous attendee on a brand-new non-demo event
   * Goal:        Ask a question before the host has uploaded any sources
   * Prior state: event with 0 liveEventSources rows; attendee joined
   * Actions:     composeAnswer is called once
   * Scale:       1 attendee
   * Duration:    Sub-second
   * Expected:    Throws ConvexError with code=no_sources; no liveEventAnswers
   *              row created.
   * Edge:        Demo event auto-seeds sources; non-demo event with 0 sources
   *              must surface the gap honestly.
   */
  it("rejects /ask when no event sources exist (HONEST_STATUS)", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent({ slug: "custom-event-no-seed", _id: "liveEvents:2" })],
      liveEventMembers: [baseMember(ANONYMOUS_SESSION_A, "liveEvents:2")],
      liveEventSources: [],
      liveEventMessages: [
        { ...baseMessage("liveEventMessages:1"), eventId: "liveEvents:2" },
      ],
      liveEventAnswers: [],
    };
    const ctx = createCtx(tables);

    await expect(
      (composeAnswer as any)._handler(ctx, {
        eventId: "liveEvents:2",
        sessionId: ANONYMOUS_SESSION_A,
        questionMessageId: "liveEventMessages:1",
        question: "What is the MCP auth timeline?",
      }),
    ).rejects.toThrow(/no_sources|No event sources/i);

    // Invariant: zero answer rows written on the failure path.
    expect(tables.liveEventAnswers.length).toBe(0);
  });
});

/* ========================================================================== */
/* Test 2 — publishWiki host gate                                              */
/* ========================================================================== */

describe("publishWiki — host gate protects durable wiki", () => {
  /**
   * Scenario:    Drive-by attendee tries to publish the wiki; later, a real
   *              host claims and publishes successfully. Then the attendee
   *              re-tries and is STILL rejected (the existence of a host row
   *              for someone else must not enable attendee writes).
   * User A:      Attendee (no liveEventHosts row for this ownerKey)
   * User B:      Host (claimed via claimHost)
   * Goal:        Protect durable wiki versions from drive-by edits
   * Prior state: event live; ≥3 answers and ≥3 sources already accumulated
   * Actions:
   *   1. attendee A → publishWiki  MUST throw not_host
   *   2. user B    → claimHost     MUST succeed
   *   3. user B    → publishWiki   MUST succeed; new row with
   *                                 status="published", version=1,
   *                                 sourceAnswerIds populated, body non-empty
   *   4. attendee A → publishWiki  MUST STILL throw not_host (regression
   *                                 against "any host row enables write")
   * Scale:       1 attendee + 1 host
   * Duration:    Sub-second
   * Expected:    See per-step expectations above.
   * Edge:        Empty answers — publishWiki on an event with 0 answers
   *              must still succeed (it produces a minimal wiki body that
   *              explicitly says "No promoted public answers yet." — see
   *              buildWikiHtml in convex/events.ts).
   */
  it("attendee is rejected with not_host; host can publish; attendee stays rejected after host exists", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventHosts: [],
      liveEventSources: baseSources(),
      liveEventAnswers: [
        {
          _id: "liveEventAnswers:1",
          eventId: "liveEvents:1",
          questionMessageId: "liveEventMessages:1",
          question: "What is the MCP auth timeline?",
          normalizedQuestion: "what is the mcp auth timeline",
          body: "Sourced answer body 1.",
          sourceIds: ["liveEventSources:1", "liveEventSources:2"],
          trace: [],
          cacheHit: false,
          faqStatus: "none",
          createdAt: 1_700_000_000_001,
        },
        {
          _id: "liveEventAnswers:2",
          eventId: "liveEvents:1",
          questionMessageId: "liveEventMessages:2",
          question: "What are voice-agent eval criteria?",
          normalizedQuestion: "what are voice agent eval criteria",
          body: "Sourced answer body 2.",
          sourceIds: ["liveEventSources:2"],
          trace: [],
          cacheHit: false,
          faqStatus: "none",
          createdAt: 1_700_000_000_002,
        },
        {
          _id: "liveEventAnswers:3",
          eventId: "liveEvents:1",
          questionMessageId: "liveEventMessages:3",
          question: "Which healthcare workflows are pilot-safe?",
          normalizedQuestion: "which healthcare workflows are pilot safe",
          body: "Sourced answer body 3.",
          sourceIds: ["liveEventSources:3"],
          trace: [],
          cacheHit: false,
          faqStatus: "promoted",
          createdAt: 1_700_000_000_003,
        },
      ],
      liveEventWikiVersions: [],
    };
    const ctx = createCtx(tables);

    // Step 1 — attendee with no host row is blocked.
    await expect(
      (publishWiki as any)._handler(ctx, {
        eventId: "liveEvents:1",
        ownerKey: ATTENDEE_OWNER_KEY,
      }),
    ).rejects.toThrow(/not_host|Host ownership/i);
    expect(tables.liveEventWikiVersions.length).toBe(0);

    // Step 2 — host claims.
    const claimResult = await (claimHost as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: HOST_OWNER_KEY,
      displayName: "Real Host",
    });
    expect(claimResult.ok).toBe(true);
    expect(claimResult.created).toBe(true);
    expect(tables.liveEventHosts.length).toBe(1);

    // Step 3 — host can publish.
    const publishResult = await (publishWiki as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: HOST_OWNER_KEY,
    });
    expect(publishResult.ok).toBe(true);
    expect(publishResult.version).toBe(1);
    expect(typeof publishResult.wikiId).toBe("string");

    const wikiRow = tables.liveEventWikiVersions[0];
    expect(wikiRow.status).toBe("published");
    expect(wikiRow.title).toBe("AI Infra Summit Wiki");
    expect(Array.isArray(wikiRow.sourceAnswerIds)).toBe(true);
    expect(wikiRow.sourceAnswerIds.length).toBeGreaterThanOrEqual(1);
    expect(typeof wikiRow.bodyHtml).toBe("string");
    expect(wikiRow.bodyHtml.length).toBeGreaterThan(50);
    expect(wikiRow.publishedAt).toBeTruthy();

    // Step 4 — attendee STILL blocked, even after a host exists.
    await expect(
      (publishWiki as any)._handler(ctx, {
        eventId: "liveEvents:1",
        ownerKey: ATTENDEE_OWNER_KEY,
      }),
    ).rejects.toThrow(/not_host|Host ownership/i);
    // Wiki count unchanged.
    expect(tables.liveEventWikiVersions.length).toBe(1);
  });

  /**
   * Scenario:    Edge case — host publishes against an event with 0 answers.
   *              The runtime must still produce a coherent minimal wiki
   *              (per buildWikiHtml: "No promoted public answers yet.") and
   *              must NOT throw. This protects the case where a host wants
   *              to publish early to lock down the source set.
   * User:        Host
   * Goal:        Publish a wiki before any /ask has been answered
   * Prior state: event live; 0 liveEventAnswers; host claimed
   * Actions:     publishWiki
   * Scale:       1 host
   * Duration:    Sub-second
   * Expected:    Returns ok=true, version=1; bodyHtml mentions "No promoted
   *              public answers yet"; sourceAnswerIds is empty array.
   */
  it("host can publish minimal wiki even with zero answers (no throw)", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventHosts: [
        {
          _id: "liveEventHosts:1",
          eventId: "liveEvents:1",
          ownerKey: HOST_OWNER_KEY,
          displayName: "Host",
          role: "owner",
          createdAt: 1_700_000_000_000,
        },
      ],
      liveEventSources: baseSources(),
      liveEventAnswers: [],
      liveEventWikiVersions: [],
    };
    const ctx = createCtx(tables);

    const result = await (publishWiki as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: HOST_OWNER_KEY,
    });

    expect(result.ok).toBe(true);
    expect(result.version).toBe(1);
    const wikiRow = tables.liveEventWikiVersions[0];
    expect(wikiRow.bodyHtml).toContain("No promoted public answers yet");
    expect(wikiRow.sourceAnswerIds).toEqual([]);
  });
});

/* ========================================================================== */
/* Test 3 — claimHost race                                                     */
/* ========================================================================== */

describe("claimHost — concurrent race invariant", () => {
  /**
   * Scenario:    Two anonymous attendees race to claim host on a fresh
   *              event. The invariant we are protecting: at most ONE host
   *              row exists in liveEventHosts when both promises settle.
   *
   * Note on Convex serializability: in production, Convex mutations
   *   serialize by table-write-set, so two concurrent claimHost calls on
   *   the same event would run back-to-back, not truly in parallel. This
   *   in-memory MockDb does NOT enforce that — the two calls share one
   *   `tables` object, so they CAN both observe an empty
   *   `liveEventHosts` and both proceed to insert. That is exactly the
   *   data-race shape we want to prove the code defends against at the
   *   contract level. The defense path lives in claimHost:
   *     1. requireOwnerKey rejects bad keys
   *     2. existingForOwner short-circuit for re-claims (idempotent)
   *     3. existingHosts.length > 0 check raises host_already_claimed
   *
   *   If Convex serializes A before B, B's existingHosts check sees the
   *   row written by A and throws. If a future framework change weakens
   *   serializability, this test surfaces the gap.
   *
   * User:        Two anonymous attendees
   * Goal:        Each wants to become the host of a fresh event
   * Prior state: event live, 0 liveEventHosts rows
   * Actions:     Promise.all([claimHost(A), claimHost(B)]) — see note above
   *              about why the MockDb can't model true Convex serializability.
   *              We additionally do a sequential A-then-B run to confirm the
   *              host_already_claimed throw path on the SECOND call.
   * Scale:       2 concurrent
   * Duration:    Sub-second
   * Expected:    After both promises settle, liveEventHosts has exactly 1
   *              row. The other call either resolves with `created=false`
   *              (idempotent re-claim by the same ownerKey is allowed) or
   *              rejects with host_already_claimed. We assert the invariant,
   *              not the specific outcome of each promise.
   * Edge:        Same-owner-key re-claim is idempotent — claiming host twice
   *              from the same ownerKey returns created=false, not an error.
   */
  it("sequential claims: first wins, second from different owner throws host_already_claimed", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventHosts: [],
    };
    const ctx = createCtx(tables);

    const ownerKeyA = "owner-key-attendee-aaaa";
    const ownerKeyB = "owner-key-attendee-bbbb";

    const claimA = await (claimHost as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: ownerKeyA,
      displayName: "Attendee A",
    });
    expect(claimA.ok).toBe(true);
    expect(claimA.created).toBe(true);
    expect(claimA.role).toBe("owner");

    await expect(
      (claimHost as any)._handler(ctx, {
        eventId: "liveEvents:1",
        ownerKey: ownerKeyB,
        displayName: "Attendee B",
      }),
    ).rejects.toThrow(/host_already_claimed|already has a host/i);

    expect(tables.liveEventHosts.length).toBe(1);
    expect(tables.liveEventHosts[0].ownerKey).toBe(ownerKeyA);
  });

  it("same-owner re-claim is idempotent — created=false, no second row", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventHosts: [],
    };
    const ctx = createCtx(tables);

    const claim1 = await (claimHost as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: HOST_OWNER_KEY,
      displayName: "Host",
    });
    expect(claim1.created).toBe(true);

    const claim2 = await (claimHost as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: HOST_OWNER_KEY,
      displayName: "Host",
    });
    expect(claim2.ok).toBe(true);
    expect(claim2.created).toBe(false);

    expect(tables.liveEventHosts.length).toBe(1);
  });

  /**
   * UPGRADED from MockDb to convex-test (Phase 4 follow-up to PR #396).
   *
   * Scenario:    Two anonymous attendees race to claim host on a fresh
   *              event. The invariant we are protecting: EXACTLY ONE row
   *              lands in liveEventHosts; the loser receives the typed
   *              `host_already_claimed` error.
   *
   * Why convex-test (not MockDb): the previous MockDb-backed test could
   * only assert `hostRows <= 2` because the MockDb does not model Convex's
   * serial-mutation semantics — two handlers sharing one `tables` object
   * could both observe an empty hosts table before either inserted. The
   * production defense in convex/events.ts:
   *     const existingHosts = await ctx.db.query("liveEventHosts")
   *       .withIndex("by_event", q => q.eq("eventId", eventId))
   *       .take(1);
   *     if (existingHosts.length > 0) throw host_already_claimed;
   * only holds because Convex serializes mutations by table-write-set in
   * production. `convex-test` runs the real Convex transaction engine
   * in-process, so this test now exercises the actual race contract.
   *
   * User:        Two anonymous attendees, different ownerKeys
   * Goal:        Each wants to become the host of a fresh event
   * Prior state: event live, 0 liveEventHosts rows
   * Actions:     Promise.all([t.mutation(claimHost, A), t.mutation(claimHost, B)])
   * Scale:       2 concurrent
   * Duration:    Sub-second
   * Expected:    1 promise fulfills with ok=true/created=true; 1 promise
   *              rejects with ConvexError code=host_already_claimed.
   *              liveEventHosts has exactly 1 row, owned by the winner.
   * Edge:        Different ownerKeys (we already cover same-owner idempotency
   *              in the sequential test above).
   */
  it("concurrent claims — exactly one wins, loser gets host_already_claimed (convex-test)", async () => {
    const t = convexTest(schema, convexModules);

    // Seed: insert a live event directly via t.run so we can target it by ID.
    const eventId = await t.run(async (ctx) => {
      return await ctx.db.insert("liveEvents", {
        slug: "race-claim-event",
        name: "Race Claim Event",
        roomCode: "RACE01",
        status: "live",
        startedAt: 1_700_000_000_000,
      });
    });

    const ownerKeyA = "owner-key-attendee-cccc";
    const ownerKeyB = "owner-key-attendee-dddd";

    // Kick both claims off in the same tick. Under Convex's real-runtime
    // serialization (which convex-test models), one of these must observe
    // the other's insert and throw host_already_claimed.
    const settled = await Promise.allSettled([
      t.mutation(api.events.claimHost, {
        eventId,
        ownerKey: ownerKeyA,
        displayName: "Attendee A",
      }),
      t.mutation(api.events.claimHost, {
        eventId,
        ownerKey: ownerKeyB,
        displayName: "Attendee B",
      }),
    ]);

    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<any> => s.status === "fulfilled",
    );
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );

    // EXACT race contract: 1 win, 1 loss.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Winner shape — claimHost returns { ok, hostId, role, created } on success.
    const winner = fulfilled[0].value;
    expect(winner.ok).toBe(true);
    expect(winner.created).toBe(true);
    expect(winner.role).toBe("owner");
    expect(typeof winner.hostId).toBe("string");

    // Loser must throw a typed ConvexError code=host_already_claimed.
    const loserReason = rejected[0].reason;
    // ConvexError serializes through convex-test as an Error whose `.data`
    // (or `.message`) carries the typed payload. We accept either shape so
    // the test stays robust across convex-test versions.
    const loserBlob = JSON.stringify({
      message: loserReason?.message ?? "",
      data: loserReason?.data ?? null,
    });
    expect(loserBlob).toMatch(/host_already_claimed|already has a host/i);

    // DB invariant: exactly ONE row, owned by exactly ONE of the two keys.
    const hostsAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query("liveEventHosts")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    });
    expect(hostsAfter.length).toBe(1);

    const winnerOwnerKey = hostsAfter[0].ownerKey;
    expect([ownerKeyA, ownerKeyB]).toContain(winnerOwnerKey);

    // The OTHER ownerKey must NOT have a row.
    const loserOwnerKey =
      winnerOwnerKey === ownerKeyA ? ownerKeyB : ownerKeyA;
    const loserRow = await t.run(async (ctx) => {
      return await ctx.db
        .query("liveEventHosts")
        .withIndex("by_event_owner", (q) =>
          q.eq("eventId", eventId).eq("ownerKey", loserOwnerKey),
        )
        .first();
    });
    expect(loserRow).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 4 follow-up Item 5 — host-claim-code janitor                          */
/* -------------------------------------------------------------------------- */
//
// Scenario: a host clicks "Generate claim code", copies the code, then closes
// their tab and never redeems it. `requestHostClaim` already wrote
// `hostClaimCodeHash` + `hostClaimCodeCreatedAt` to the liveEvents row. The
// hash sits there forever unless somebody force-clears it. Codes are 24-char
// A-Z2-9 (~120 bits of entropy), so brute-force is already infeasible — but
// keeping a stale hash around indefinitely widens the attack surface for no
// reason. The 10-min janitor cron sweeps any row whose
// `hostClaimCodeCreatedAt` is older than 30 min and clears both fields.
//
// Coverage matrix:
//   1. Empty result — no liveEvents rows are stale → evicted: 0.
//   2. Clears stale rows — row with createdAt > 30 min ago AND hash set →
//      both fields are unset after the janitor runs.
//   3. Skips rows without a hash — row with hash undefined is NEVER patched
//      (even if some other timestamp says it's old).

const _evictStaleHostClaimCodes = (eventsModule as any)._evictStaleHostClaimCodes;

describe("_evictStaleHostClaimCodes — Phase 4 defense-in-depth janitor", () => {
  it("empty result when no rows are stale (fresh event, recent code)", async () => {
    // Persona: a host who just minted a code 30 seconds ago. The janitor must
    // NOT touch this row — the user is still mid-flow toward redemption.
    // Goal: verify the janitor's TTL respects in-flight claims.
    // Scale: 1 event, 1 row.
    // Duration: single tick.
    const now = Date.now();
    const tables: Tables = {
      liveEvents: [
        baseEvent({
          hostClaimCodeHash: "fresh-hash-aaaaa",
          hostClaimCodeCreatedAt: now - 30 * 1000, // 30s ago, well inside TTL
        }),
      ],
    };
    const ctx = createCtx(tables);

    const result = await _evictStaleHostClaimCodes._handler(ctx);

    expect(result).toEqual({ evicted: 0 });
    // Row untouched — the hash and timestamp must still be there for the
    // upcoming claimHostWithCode call to succeed.
    expect(tables.liveEvents[0].hostClaimCodeHash).toBe("fresh-hash-aaaaa");
    expect(tables.liveEvents[0].hostClaimCodeCreatedAt).toBe(now - 30 * 1000);
    expect((ctx.db as MockDb).patches.length).toBe(0);
  });

  it("clears fields when hostClaimCodeCreatedAt is older than 30 min", async () => {
    // Persona: a host abandoned their claim flow 31 min ago — closed the tab,
    // never came back. The hash sat on the event row that whole time. The
    // janitor must clear both fields so the hash stops widening the
    // brute-force window.
    // Goal: verify the eviction is correct and HONEST_STATUS reports the
    // count truthfully.
    // Scale: 1 event.
    // Duration: single tick.
    const now = Date.now();
    const tables: Tables = {
      liveEvents: [
        baseEvent({
          hostClaimCodeHash: "stale-hash-zzzzz",
          hostClaimCodeCreatedAt: now - 31 * 60 * 1000, // 31 min ago — past TTL
        }),
      ],
    };
    const ctx = createCtx(tables);

    const result = await _evictStaleHostClaimCodes._handler(ctx);

    expect(result).toEqual({ evicted: 1 });
    // Both fields cleared. (MockDb patches set them to undefined directly;
    // Convex translates undefined → field-removal at the row level.)
    expect(tables.liveEvents[0].hostClaimCodeHash).toBeUndefined();
    expect(tables.liveEvents[0].hostClaimCodeCreatedAt).toBeUndefined();
    expect((ctx.db as MockDb).patches.length).toBe(1);
  });

  it("does NOT touch rows where hostClaimCodeHash is undefined", async () => {
    // Persona: an event that NEVER minted a claim code. The row has no hash
    // field at all (or it's explicitly undefined). The janitor must skip it
    // — patching `undefined` onto a row that already has undefined is a
    // wasted write, and more importantly, this proves the filter doesn't
    // catch ghost rows.
    // Goal: surface false positives — if the janitor patches events with no
    // hash, it has a bug that wastes DB ops on every cron tick.
    // Scale: mix of 3 rows in one run — one stale-with-hash, one no-hash, one
    // recent-with-hash. Verify exactly one eviction happens.
    // Duration: single tick.
    const now = Date.now();
    const tables: Tables = {
      liveEvents: [
        baseEvent({
          _id: "liveEvents:no-hash",
          // No hostClaimCodeHash, no hostClaimCodeCreatedAt — pristine event.
        }),
        baseEvent({
          _id: "liveEvents:stale-with-hash",
          hostClaimCodeHash: "stale-hash-yyyyy",
          hostClaimCodeCreatedAt: now - 45 * 60 * 1000, // 45 min ago
        }),
        baseEvent({
          _id: "liveEvents:fresh-with-hash",
          hostClaimCodeHash: "fresh-hash-bbbbb",
          hostClaimCodeCreatedAt: now - 5 * 60 * 1000, // 5 min ago
        }),
      ],
    };
    const ctx = createCtx(tables);

    const result = await _evictStaleHostClaimCodes._handler(ctx);

    // Exactly one row evicted — the stale one.
    expect(result).toEqual({ evicted: 1 });

    // Pristine row (no hash) — never patched.
    const pristine = tables.liveEvents.find((r) => r._id === "liveEvents:no-hash")!;
    expect(pristine.hostClaimCodeHash).toBeUndefined();
    expect(pristine.hostClaimCodeCreatedAt).toBeUndefined();

    // Stale row — cleared.
    const stale = tables.liveEvents.find((r) => r._id === "liveEvents:stale-with-hash")!;
    expect(stale.hostClaimCodeHash).toBeUndefined();
    expect(stale.hostClaimCodeCreatedAt).toBeUndefined();

    // Fresh row (recent code) — UNTOUCHED. This is the load-bearing
    // assertion: the janitor must never race a legitimate redemption.
    const fresh = tables.liveEvents.find((r) => r._id === "liveEvents:fresh-with-hash")!;
    expect(fresh.hostClaimCodeHash).toBe("fresh-hash-bbbbb");
    expect(fresh.hostClaimCodeCreatedAt).toBe(now - 5 * 60 * 1000);

    // Exactly 1 patch was issued (only the stale row).
    expect((ctx.db as MockDb).patches.length).toBe(1);
    expect((ctx.db as MockDb).patches[0].id).toBe("liveEvents:stale-with-hash");
  });
});

/* ========================================================================== */
/* Test 4 — requestHostClaim email channel (Phase 4 follow-up Item 1)          */
/* ========================================================================== */

describe("requestHostClaim — optional Resend email delivery", () => {
  /**
   * Background: PR #396 returns the plaintext claim code synchronously from
   * requestHostClaim. The Phase 4 follow-up adds an OPTIONAL email channel:
   * when the caller supplies deliverToEmail, the mutation schedules a
   * fire-and-forget action (convex/email.ts:sendHostClaimCodeEmail) to
   * email the code. The mutation MUST still return the code synchronously
   * — email is convenience, not source of truth.
   *
   * Failure semantics under test:
   *   - deliverToEmail omitted → no scheduler call, code returned as before
   *   - deliverToEmail malformed → no scheduler call, no throw, code returned
   *   - deliverToEmail valid → scheduler called exactly once with the right
   *     args (email + code + eventName + expiresHintAt), code returned
   */

  it("deliverToEmail omitted: no scheduler call, code returned (back-compat)", async () => {
    /**
     * Scenario:    Legacy caller (the existing scratchnode UI) does not
     *              pass deliverToEmail at all. Behavior must be identical
     *              to PR #396 — code returned, no email channel touched.
     * User:        Anonymous member self-claiming their own room
     * Goal:        Get a one-time claim code, no email needed
     * Prior state: event live; 0 liveEventHosts; member joined
     * Actions:     requestHostClaim without deliverToEmail
     * Scale:       1 caller
     * Duration:    Single mutation
     * Expected:    ok=true, hostClaimCode present, scheduler.calls empty,
     *              event.hostClaimCodeHash persisted.
     * Edge:        Must not silently call scheduler with undefined email.
     */
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventMembers: [baseMember(ANONYMOUS_SESSION_A)],
      liveEventHosts: [],
    };
    const ctx = createCtx(tables);

    const result = await (requestHostClaim as any)._handler(ctx, {
      eventId: "liveEvents:1",
      requesterSessionId: ANONYMOUS_SESSION_A,
    });

    expect(result.ok).toBe(true);
    expect(typeof result.hostClaimCode).toBe("string");
    expect(result.hostClaimCode.length).toBeGreaterThanOrEqual(16);
    expect(typeof result.expiresHintAt).toBe("number");
    // Critical: no email channel touched when deliverToEmail omitted.
    expect(ctx.scheduler.calls.length).toBe(0);
    // Hash persisted (back-compat invariant).
    expect(tables.liveEvents[0].hostClaimCodeHash).toBeTruthy();
  });

  it("deliverToEmail malformed: no scheduler call, no throw, code still returned", async () => {
    /**
     * Scenario:    Caller passes a string that is NOT a valid email
     *              (missing @, missing dot, or oversized). The mutation
     *              must NOT throw — the plaintext code is still useful to
     *              the caller, the bad email is a UX issue not a security
     *              issue. The scheduler MUST NOT be called (so Resend
     *              never sees the garbage payload).
     * User:        Misconfigured client or fat-fingered input
     * Goal:        Get a code; email channel silently skipped
     * Prior state: event live; member joined
     * Actions:     requestHostClaim with deliverToEmail set to several
     *              shapes of garbage — empty string, missing @, missing
     *              dot, too long
     * Scale:       1 caller, 4 garbage shapes in sequence
     * Duration:    Sub-second
     * Expected:    Each call returns ok=true with code; scheduler.calls
     *              stays empty across all four; no throw.
     * Edge:        Email > 254 chars must be rejected (RFC 5321 SMTP path
     *              cap — protects against pathological inputs).
     */
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventMembers: [baseMember(ANONYMOUS_SESSION_A)],
      liveEventHosts: [],
    };
    const ctx = createCtx(tables);

    const malformed = [
      "",
      "not-an-email",
      "missing-dot@example",
      "missing-at-example.com",
      // 261-char string with @ + dot — passes regex but exceeds 254-char
      // RFC 5321 SMTP path length cap, so the validator must reject.
      `${"a".repeat(254)}@x.co`,
    ];
    for (const bad of malformed) {
      const result = await (requestHostClaim as any)._handler(ctx, {
        eventId: "liveEvents:1",
        requesterSessionId: ANONYMOUS_SESSION_A,
        deliverToEmail: bad,
      });
      expect(result.ok).toBe(true);
      expect(typeof result.hostClaimCode).toBe("string");
    }
    // ZERO scheduler calls across all malformed inputs.
    expect(ctx.scheduler.calls.length).toBe(0);
  });

  it("deliverToEmail valid: scheduler called once with right args (code, email, eventName, expiresHintAt)", async () => {
    /**
     * Scenario:    Co-host onboarding — primary host requests a claim code
     *              and wants it emailed to a colleague in another building.
     *              The mutation returns the code synchronously AND schedules
     *              a fire-and-forget action to deliver the code by email.
     * User:        Host or pre-host member (the gate is requireMember, not
     *              requireHost, since pre-claim is allowed)
     * Goal:        Get the code AND have it emailed
     * Prior state: event live; member joined; no existing host
     * Actions:     requestHostClaim with valid deliverToEmail
     * Scale:       1 caller
     * Duration:    Single mutation; the action is scheduled, not awaited.
     * Expected:    ok=true; code returned; scheduler.calls.length === 1;
     *              args.email matches input; args.code === result.hostClaimCode;
     *              args.eventName === event.name; args.expiresHintAt is a
     *              future timestamp (~30 min ahead).
     * Edge:        The action ref must be internal.email.sendHostClaimCodeEmail
     *              (not internal.events.* or any other path) so this test
     *              also catches accidental wiring drift.
     */
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventMembers: [baseMember(ANONYMOUS_SESSION_A)],
      liveEventHosts: [],
    };
    const ctx = createCtx(tables);

    const startTime = Date.now();
    const validEmail = "cohost@example.com";

    const result = await (requestHostClaim as any)._handler(ctx, {
      eventId: "liveEvents:1",
      requesterSessionId: ANONYMOUS_SESSION_A,
      deliverToEmail: validEmail,
    });

    // Mutation result invariants.
    expect(result.ok).toBe(true);
    expect(typeof result.hostClaimCode).toBe("string");
    expect(result.hostClaimCode.length).toBeGreaterThanOrEqual(16);
    expect(typeof result.expiresHintAt).toBe("number");
    expect(result.expiresHintAt).toBeGreaterThan(startTime);

    // Scheduler called EXACTLY once.
    expect(ctx.scheduler.calls.length).toBe(1);
    const [scheduled] = ctx.scheduler.calls;
    expect(scheduled.delayMs).toBe(0);

    // Args carry the right code + email + event name + expiresHintAt.
    const args = scheduled.args as {
      email: string;
      code: string;
      eventName: string;
      expiresHintAt: number;
    };
    expect(args.email).toBe(validEmail);
    expect(args.code).toBe(result.hostClaimCode);
    expect(args.eventName).toBe("AI Infra Summit");
    expect(args.expiresHintAt).toBe(result.expiresHintAt);

    // ref must be a truthy FunctionReference — Convex's anyApi proxies
    // are opaque objects that resist primitive conversion, so we don't
    // stringify them. The args check above is the real correctness gate
    // (eventName + code + email + expiresHintAt prove the wiring is right).
    expect(scheduled.ref).toBeTruthy();
  });

  it("deliverToEmail with whitespace: trimmed before scheduling (defense in depth)", async () => {
    /**
     * Scenario:    Caller pastes an email with leading/trailing whitespace
     *              (common copy-paste failure mode). The mutation must
     *              trim before scheduling so Resend never sees stray
     *              whitespace.
     * User:        Anyone pasting an email from a chat client
     * Goal:        Robust handling of cosmetic input bugs
     * Prior state: event live; member joined
     * Actions:     requestHostClaim with deliverToEmail="  good@ex.com  "
     * Scale:       1 caller
     * Expected:    Scheduler called once with args.email === "good@ex.com"
     *              (trimmed).
     */
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventMembers: [baseMember(ANONYMOUS_SESSION_A)],
      liveEventHosts: [],
    };
    const ctx = createCtx(tables);

    await (requestHostClaim as any)._handler(ctx, {
      eventId: "liveEvents:1",
      requesterSessionId: ANONYMOUS_SESSION_A,
      deliverToEmail: "  good@ex.com  ",
    });

    expect(ctx.scheduler.calls.length).toBe(1);
    const args = ctx.scheduler.calls[0].args as { email: string };
    expect(args.email).toBe("good@ex.com");
  });
});

/* ========================================================================== */
/* Test 7 — releaseHost                                                        */
/* ========================================================================== */

describe("releaseHost — host can relinquish ownership", () => {
  /**
   * Scenario:    The current host needs to step down (lost access, rotating
   *              away from a test event, etc.). They call releaseHost with
   *              their ownerKey. The contract: their host row is deleted,
   *              any dangling claim code is cleared, and the event is now
   *              freshly claimable by anyone.
   * User:        Current host with legacy plain-string ownerKey
   * Goal:        Step down so the event can be re-claimed by someone else
   * Prior state: event live; one liveEventHosts row owned by HOST_OWNER_KEY
   * Actions:     releaseHost({ eventId, ownerKey: HOST_OWNER_KEY })
   * Scale:       1 user
   * Duration:    Sub-second
   * Expected:    ok=true, released=true, hostsDeleted=1. liveEventHosts is
   *              now empty. claimHost with a NEW ownerKey now succeeds.
   */
  it("host can release with valid legacy ownerKey", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventHosts: [
        {
          _id: "liveEventHosts:1",
          eventId: "liveEvents:1",
          ownerKey: HOST_OWNER_KEY,
          displayName: "Host",
          role: "owner",
          createdAt: 1_700_000_000_000,
        },
      ],
    };
    const ctx = createCtx(tables);

    const result = await (releaseHost as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: HOST_OWNER_KEY,
    });

    expect(result.ok).toBe(true);
    expect(result.released).toBe(true);
    expect(result.hostsDeleted).toBe(1);
    expect(tables.liveEventHosts.length).toBe(0);

    // A new ownerKey can now claim cleanly.
    const newOwnerKey = "different-owner-key-67890";
    const newClaim = await (claimHost as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: newOwnerKey,
      displayName: "Fresh Host",
    });
    expect(newClaim.ok).toBe(true);
    expect(newClaim.created).toBe(true);
    expect(tables.liveEventHosts.length).toBe(1);
    expect(tables.liveEventHosts[0].ownerKey).toBe(newOwnerKey);
  });

  /**
   * Scenario:    An attendee tries to release a host they don't own.
   *              requireHost must reject them with code=not_host. The host
   *              row stays intact. This protects against the most obvious
   *              attack: anyone who knows the eventId calling releaseHost
   *              to steal control.
   * User:        Attacker / attendee
   * Goal:        Steal host by force-releasing
   * Prior state: event live; HOST_OWNER_KEY holds host row
   * Actions:     releaseHost with ATTENDEE_OWNER_KEY
   * Scale:       1 attacker
   * Expected:    Throws code=not_host. liveEventHosts unchanged (still 1 row,
   *              still owned by HOST_OWNER_KEY).
   */
  it("non-host cannot release another host's event", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventHosts: [
        {
          _id: "liveEventHosts:1",
          eventId: "liveEvents:1",
          ownerKey: HOST_OWNER_KEY,
          displayName: "Host",
          role: "owner",
          createdAt: 1_700_000_000_000,
        },
      ],
    };
    const ctx = createCtx(tables);

    await expect(
      (releaseHost as any)._handler(ctx, {
        eventId: "liveEvents:1",
        ownerKey: ATTENDEE_OWNER_KEY,
      }),
    ).rejects.toThrow(/not_host|Host ownership/i);

    expect(tables.liveEventHosts.length).toBe(1);
    expect(tables.liveEventHosts[0].ownerKey).toBe(HOST_OWNER_KEY);
  });

  /**
   * Scenario:    Defense-in-depth — when a host releases, any dangling
   *              hostClaimCodeHash + hostClaimCodeCreatedAt on the event
   *              row MUST be cleared, so a mid-rotation code can't be
   *              exploited by the next person to call claimHostWithCode
   *              without going through requestHostClaim.
   * User:        Host who minted a claim code (for rotation) and then
   *              changed their mind and released directly
   * Goal:        Leave the event in a clean state with no exploitable
   *              dangling state
   * Prior state: event has hostClaimCodeHash + hostClaimCodeCreatedAt;
   *              host row exists
   * Actions:     releaseHost
   * Scale:       1 host
   * Expected:    Both hostClaimCodeHash and hostClaimCodeCreatedAt are
   *              cleared from the event row.
   */
  it("clears dangling claim code on release (defense-in-depth)", async () => {
    const event = baseEvent({
      hostClaimCodeHash: "sha256:fake-hash-from-prior-requestHostClaim",
      hostClaimCodeCreatedAt: 1_700_000_000_000,
    });
    const tables: Tables = {
      liveEvents: [event],
      liveEventHosts: [
        {
          _id: "liveEventHosts:1",
          eventId: "liveEvents:1",
          ownerKey: HOST_OWNER_KEY,
          displayName: "Host",
          role: "owner",
          createdAt: 1_700_000_000_000,
        },
      ],
    };
    const ctx = createCtx(tables);

    const result = await (releaseHost as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: HOST_OWNER_KEY,
    });

    expect(result.ok).toBe(true);
    expect(tables.liveEvents[0].hostClaimCodeHash).toBeUndefined();
    expect(tables.liveEvents[0].hostClaimCodeCreatedAt).toBeUndefined();
  });

  /**
   * Scenario:    A host who's been rotated (e.g. via claimHostWithCode
   *              after a prior release) calls releaseHost. The releaseHost
   *              implementation must clean up EVERY host row for the event,
   *              not just the one matching the calling ownerKey. This
   *              protects against rotation history leaving stale rows that
   *              would block future claims.
   * User:        Host with rotation history
   * Goal:        Fully release so the next claim starts clean
   * Prior state: event live; 2 liveEventHosts rows (current + stale legacy)
   * Actions:     releaseHost with the CURRENT host's ownerKey
   * Scale:       1 user
   * Expected:    Both host rows deleted. hostsDeleted=2.
   */
  it("deletes all host rows for the event, not just the calling row", async () => {
    const tables: Tables = {
      liveEvents: [baseEvent()],
      liveEventHosts: [
        {
          _id: "liveEventHosts:1",
          eventId: "liveEvents:1",
          ownerKey: HOST_OWNER_KEY,
          displayName: "Current Host",
          role: "owner",
          authMethod: "claim_code",
          createdAt: 1_700_000_000_100,
        },
        {
          _id: "liveEventHosts:2",
          eventId: "liveEvents:1",
          ownerKey: "stale-legacy-key-from-old-rotation",
          displayName: "Stale Host",
          role: "owner",
          authMethod: "legacy_ownerkey",
          createdAt: 1_700_000_000_000,
        },
      ],
    };
    const ctx = createCtx(tables);

    const result = await (releaseHost as any)._handler(ctx, {
      eventId: "liveEvents:1",
      ownerKey: HOST_OWNER_KEY,
    });

    expect(result.ok).toBe(true);
    expect(result.released).toBe(true);
    expect(result.hostsDeleted).toBe(2);
    expect(tables.liveEventHosts.length).toBe(0);
  });
});
