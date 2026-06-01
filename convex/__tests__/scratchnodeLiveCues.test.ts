/// <reference types="vite/client" />
/**
 * Scenario tests for the Live Assist cue rail backend
 * (convex/scratchnodeLiveCues.ts — deployed as users:generateLiveCues +
 * users:generateLiveCuesLLM).
 *
 * Per .claude/rules/scenario_testing.md — every test names a persona, a goal,
 * prior state, an action sequence, and a duration/scale axis. The
 * release-blocker here is the PRIVACY INVARIANT: a cue must NEVER surface
 * content from another user's private notes. That gets a dedicated, two-way
 * adversarial scenario.
 *
 * Harness: in-memory MockDb driving `(handler)._handler(ctx, args)` directly —
 * the same pattern as scratchnode.events.test.ts. No network, no live Convex
 * deploy. The MockDb adds `normalizeId` (the cue handler resolves a
 * client-supplied string eventId), which the events handlers don't use.
 *
 * The mutation path (generateLiveCues) and the action path
 * (generateLiveCuesLLM) share `gateAndReadContext`, so the presence /
 * rate-limit / privacy invariants are proven once through the mutation. The
 * action gets focused tests: (a) LLM→deterministic fallback honestly labeled
 * `source: "fallback"` (via the SCRATCHNODE_CUE_LLM_DISABLED kill-switch, no
 * network), and (b) the Gemini 3.5 Flash request shape + response parsing via a
 * stubbed global `fetch` — proves the deployed-provider call without a live key.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  generateLiveCues,
  generateLiveCuesLLM,
  _prepareLiveCueContext,
} from "../scratchnodeLiveCues";

/* -------------------------------------------------------------------------- */
/* In-memory MockDb (mirrors scratchnode.events.test.ts) + normalizeId         */
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

function sortValue(row: TableRecord) {
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

class MockQueryChain {
  private orderDirection: "asc" | "desc" = "asc";
  constructor(
    private readonly rows: TableRecord[],
    private readonly filters: Array<{ field: string; op: "eq" | "gte" | "lt"; value: unknown }>,
  ) {}
  order(direction: "asc" | "desc") {
    this.orderDirection = direction;
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
  private getRows() {
    const filtered = this.rows.filter((row) =>
      this.filters.every(({ field, op, value }) => {
        const v = row[field];
        if (op === "eq") return v === value;
        if (op === "gte") return v >= (value as any);
        if (op === "lt") return v < (value as any);
        return true;
      }),
    );
    const sorted = [...filtered].sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      return this.orderDirection === "desc" ? right - left : left - right;
    });
    return sorted;
  }
}

class MockDb {
  public patches: Array<{ id: string; value: TableRecord }> = [];
  constructor(private readonly tables: Tables) {}

  // Faithful enough for the cue handler: a string id is a valid id for `table`
  // iff it carries that table's prefix (seeded rows use `liveEvents:1` etc.).
  // Foreign / malformed strings → null, mirroring Convex's normalizeId.
  normalizeId(table: string, id: string): string | null {
    return typeof id === "string" && id.startsWith(`${table}:`) ? id : null;
  }

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
    };
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
}

function createMutationCtx(tables: Tables) {
  return { db: new MockDb(tables) };
}

// Action ctx: the action only touches the DB via ctx.runMutation, which we
// route to the internal prep handler against the same MockDb.
function createActionCtx(tables: Tables) {
  const mutationCtx = createMutationCtx(tables);
  return {
    runMutation: async (_ref: unknown, args: any) =>
      await (_prepareLiveCueContext as any)._handler(mutationCtx, args),
  };
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const EVENT_ID = "liveEvents:1";
const SESSION_A = "session-a-aaaaaaaa"; // member A
const SESSION_B = "session-b-bbbbbbbb"; // member B (caller in most scenarios)
// Real-now-relative: the handler clamps sinceTimestamp to a window around its
// own Date.now(), so fixtures must sit within the last few minutes of real
// time or the message read filters them all out.
const NOW = Date.now();

function baseEvent(overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    _id: EVENT_ID,
    slug: "ai-infra-summit-2026",
    name: "AI Infra Summit",
    roomCode: "ORBITAL",
    status: "live",
    startedAt: NOW - 60_000,
    ...overrides,
  };
}

function member(sessionId: string, overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    _id: `liveEventMembers:${sessionId}`,
    eventId: EVENT_ID,
    sessionId,
    displayName: sessionId === SESSION_A ? "Alex" : "Bailey",
    joinedAt: NOW - 30_000,
    lastSeenAt: NOW - 1_000,
    ...overrides,
  };
}

function message(i: number, sessionId: string, text: string, kind = "chat"): TableRecord {
  return {
    _id: `liveEventMessages:${i}`,
    eventId: EVENT_ID,
    sessionId,
    displayName: sessionId === SESSION_A ? "Alex" : "Bailey",
    text,
    kind,
    createdAt: NOW - (10 - i) * 1_000, // ascending recency
  };
}

function note(ownerKey: string, title: string, i: number): TableRecord {
  return {
    _id: `userNotes:${ownerKey}:${i}`,
    ownerKey,
    eventId: EVENT_ID,
    title,
    bodyHtml: `<p>${title} — secret body that must never leave the server</p>`,
    tags: [],
    pinned: false,
    isAsk: false,
    createdAt: NOW - 5_000,
    updatedAt: NOW - 5_000,
  };
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                   */
/* -------------------------------------------------------------------------- */

describe("generateLiveCues — presence gate", () => {
  it(
    "Scenario: a non-member opens Live Assist → no cues, status skipped_not_member\n" +
      "  User: a curious visitor whose session never joined this event\n" +
      "  Prior state: event exists, no membership row for the caller\n" +
      "  Expected: empty cues, status=skipped_not_member, source=skipped, no DB write",
    async () => {
      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_A)], // only A is a member, not the caller
        liveEventMessages: [message(1, SESSION_A, "talking about MCP auth")],
        userNotes: [],
      };
      const ctx = createMutationCtx(tables);
      const res = await (generateLiveCues as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW - 30_000,
      });
      expect(res.status).toBe("skipped_not_member");
      expect(res.source).toBe("skipped");
      expect(res.cues).toEqual([]);
      expect(ctx.db.patches).toHaveLength(0); // gate rejected before claiming a slot
    },
  );

  it(
    "Scenario: adversarial short/garbage sessionId → rejected before any DB read\n" +
      "  User: a malformed or probing client\n" +
      "  Expected: status=skipped_not_member, no event/member lookup needed",
    async () => {
      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_A)],
        liveEventMessages: [],
        userNotes: [],
      };
      const ctx = createMutationCtx(tables);
      const res = await (generateLiveCues as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: "short", // < MIN_SESSION_ID_LEN
        sinceTimestamp: NOW,
      });
      expect(res.status).toBe("skipped_not_member");
      expect(ctx.db.patches).toHaveLength(0);
    },
  );

  it(
    "Scenario: bogus eventId (not a liveEvents id) → status skipped_no_event\n" +
      "  User: a client with a stale/garbage eventId\n" +
      "  Expected: normalizeId returns null → skipped_no_event, no write",
    async () => {
      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_B)],
        liveEventMessages: [],
        userNotes: [],
      };
      const ctx = createMutationCtx(tables);
      const res = await (generateLiveCues as any)._handler(ctx, {
        eventId: "x", // not a liveEvents id
        sessionId: SESSION_B,
        sinceTimestamp: NOW,
      });
      expect(res.status).toBe("skipped_no_event");
      expect(ctx.db.patches).toHaveLength(0);
    },
  );
});

describe("generateLiveCues — happy path", () => {
  it(
    "Scenario: a member in a latency discussion gets a sharp, on-topic cue\n" +
      "  User: an attendee with Live Assist open during a 'p95 latency' debate\n" +
      "  Prior state: member B, recent chat mentioning tail latency\n" +
      "  Expected: status=ok, source=deterministic, a latency keyword cue, topic set,\n" +
      "            and the rate-limit slot is claimed",
    async () => {
      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_B)],
        liveEventMessages: [
          message(1, SESSION_A, "How do we measure p95 latency under load?"),
          message(2, SESSION_A, "tail latency is what clinicians actually feel"),
        ],
        userNotes: [],
      };
      const ctx = createMutationCtx(tables);
      const res = await (generateLiveCues as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW - 30_000,
      });
      expect(res.status).toBe("ok");
      expect(res.source).toBe("deterministic");
      expect(res.cues.length).toBeGreaterThan(0);
      expect(res.cues.some((c: string) => /p95|tail latency/i.test(c))).toBe(true);
      expect(res.topic.length).toBeGreaterThan(0);
      // claim-then-work: slot claimed exactly once
      expect(ctx.db.patches).toHaveLength(1);
      expect(typeof ctx.db.patches[0].value.lastCueGenAt).toBe("number");
    },
  );
});

describe("generateLiveCues — PRIVACY INVARIANT (release-blocker)", () => {
  it(
    "Scenario: cues NEVER surface another user's private notes (two-way)\n" +
      "  User: members A and B in the same event, each with their own private note\n" +
      "  Prior state: A's note 'Acquire Orbital Labs by Q3', B's note 'My roadmap question'\n" +
      "  Expected: calling as B never leaks A's note text; calling as A never leaks B's.\n" +
      "  Failure mode guarded: an eventId-only note read would cross owners — this proves\n" +
      "  the by_owner_event scoping holds end-to-end.",
    async () => {
      const A_SECRET = "Acquire Orbital Labs by Q3";
      const B_SECRET = "My roadmap question";
      const seed = (): Tables => ({
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_A), member(SESSION_B)],
        liveEventMessages: [message(1, SESSION_A, "general chat about the roadmap")],
        userNotes: [note(SESSION_A, A_SECRET, 1), note(SESSION_B, B_SECRET, 1)],
      });

      // Caller B: must never see A_SECRET; may see own B_SECRET.
      const ctxB = createMutationCtx(seed());
      const resB = await (generateLiveCues as any)._handler(ctxB, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW - 30_000,
      });
      const blobB = JSON.stringify(resB);
      expect(blobB).not.toContain(A_SECRET);
      expect(blobB).not.toContain("secret body"); // bodyHtml never leaves the server

      // Caller A: must never see B_SECRET; may see own A_SECRET.
      const ctxA = createMutationCtx(seed());
      const resA = await (generateLiveCues as any)._handler(ctxA, {
        eventId: EVENT_ID,
        sessionId: SESSION_A,
        sinceTimestamp: NOW - 30_000,
      });
      const blobA = JSON.stringify(resA);
      expect(blobA).not.toContain(B_SECRET);
      expect(blobA).not.toContain("secret body");

      // Sanity: the owner's own note title IS allowed to surface (proves the
      // privacy check isn't trivially passing by surfacing nothing at all).
      expect(blobA).toContain(A_SECRET);
    },
  );
});

describe("generateLiveCues — rate limit (duration axis)", () => {
  it(
    "Scenario: a fast poller / overlapping tick is rate-limited within 25s\n" +
      "  User: a client (or bot) calling twice inside the 25s window\n" +
      "  Prior state: member B, first call claims the slot\n" +
      "  Expected: 1st call status=ok; 2nd immediate call status=rate_limited, no 2nd write",
    async () => {
      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_B)],
        liveEventMessages: [message(1, SESSION_A, "quick chat")],
        userNotes: [],
      };
      const ctx = createMutationCtx(tables);
      const first = await (generateLiveCues as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW - 30_000,
      });
      expect(first.status).toBe("ok");

      const second = await (generateLiveCues as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW - 30_000,
      });
      expect(second.status).toBe("rate_limited");
      expect(second.cues).toEqual([]);
      // Only the first call wrote a timestamp.
      expect(ctx.db.patches).toHaveLength(1);
    },
  );
});

describe("generateLiveCuesLLM — graceful degradation (HONEST_SCORES)", () => {
  const priorFlag = process.env.SCRATCHNODE_CUE_LLM_DISABLED;
  afterEach(() => {
    if (priorFlag === undefined) delete process.env.SCRATCHNODE_CUE_LLM_DISABLED;
    else process.env.SCRATCHNODE_CUE_LLM_DISABLED = priorFlag;
  });

  it(
    "Scenario: the LLM is unavailable → the action degrades and labels it honestly\n" +
      "  User: a member whose tick hits a disabled / unreachable model\n" +
      "  Prior state: SCRATCHNODE_CUE_LLM_DISABLED=1 (hermetic — no network)\n" +
      "  Expected: status=ok, source=fallback (NOT 'llm'), cues still produced",
    async () => {
      process.env.SCRATCHNODE_CUE_LLM_DISABLED = "1"; // kill-switch → forces fallback
      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_B)],
        liveEventMessages: [
          message(1, SESSION_A, "debating MCP auth scopes vs tenant RBAC"),
        ],
        userNotes: [],
      };
      const ctx = createActionCtx(tables);
      const res = await (generateLiveCuesLLM as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW - 30_000,
      });
      expect(res.status).toBe("ok");
      expect(res.source).toBe("fallback"); // honest: LLM did not produce these
      expect(res.cues.length).toBeGreaterThan(0);
    },
  );

  it(
    "Scenario: a non-member hits the LLM action → skipped before any model call\n" +
      "  Expected: status=skipped_not_member, source=skipped",
    async () => {
      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_A)], // caller B is not a member
        liveEventMessages: [],
        userNotes: [],
      };
      const ctx = createActionCtx(tables);
      const res = await (generateLiveCuesLLM as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW,
      });
      expect(res.status).toBe("skipped_not_member");
      expect(res.source).toBe("skipped");
    },
  );
});

describe("generateLiveCuesLLM — Gemini 3.5 Flash request (fetch-mocked)", () => {
  const priorFetch = globalThis.fetch;
  const priorKey = process.env.GEMINI_API_KEY;
  const priorDisabled = process.env.SCRATCHNODE_CUE_LLM_DISABLED;
  afterEach(() => {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = priorKey;
    if (priorDisabled === undefined) delete process.env.SCRATCHNODE_CUE_LLM_DISABLED;
    else process.env.SCRATCHNODE_CUE_LLM_DISABLED = priorDisabled;
  });

  it(
    "Scenario: a member tick reaches Gemini → valid request, parsed cues, source=llm\n" +
      "  User: a member in an MCP-auth discussion who also has a private note\n" +
      "  Prior state: GEMINI_API_KEY set, kill-switch off, global fetch stubbed\n" +
      "  Expected: POST to gemini-3.5-flash:generateContent with x-goog-api-key +\n" +
      "            responseSchema body; cues come from the model; source=llm;\n" +
      "            the prompt carries the note TITLE but never its bodyHtml.",
    async () => {
      process.env.GEMINI_API_KEY = "test-key-abc";
      delete process.env.SCRATCHNODE_CUE_LLM_DISABLED;

      const modelCue = "Clarify scoped tool grant vs tenant RBAC";
      const cannedText = JSON.stringify({
        topic: "MCP auth",
        cues: [modelCue],
        context: ["[[MCP auth]]"],
      });
      let captured: { url: string; init: any } | null = null;
      globalThis.fetch = (async (url: any, init: any) => {
        captured = { url: String(url), init };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: cannedText }] } }],
          }),
          text: async () => cannedText,
        };
      }) as any;

      const NOTE_TITLE = "My roadmap question";
      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_B)],
        liveEventMessages: [message(1, SESSION_A, "scoped tool grant vs tenant RBAC?")],
        userNotes: [note(SESSION_B, NOTE_TITLE, 1)],
      };
      const ctx = createActionCtx(tables);
      const res = await (generateLiveCuesLLM as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW - 30_000,
      });

      // Output: model-produced cues, honestly labeled.
      expect(res.status).toBe("ok");
      expect(res.source).toBe("llm");
      expect(res.cues).toContain(modelCue);

      // Request shape: endpoint + auth header + structured-output body.
      expect(captured).not.toBeNull();
      expect(captured!.url).toContain("generativelanguage.googleapis.com");
      expect(captured!.url).toContain("gemini-3.5-flash:generateContent");
      expect(captured!.init.headers["x-goog-api-key"]).toBe("test-key-abc");
      const body = JSON.parse(captured!.init.body);
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      expect(body.generationConfig.responseSchema).toBeTruthy();
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("LOW"); // default, uppercased
      expect(body.systemInstruction.parts[0].text).toContain("UNTRUSTED");

      // Privacy at the prompt layer: the owner's note TITLE may be sent, but its
      // bodyHtml ("secret body") must never enter the request.
      const wire = JSON.stringify(body);
      expect(wire).toContain(NOTE_TITLE);
      expect(wire).not.toContain("secret body");
    },
  );

  it(
    "Scenario: Gemini safety-blocks the response (no text) → honest fallback\n" +
      "  Prior state: fetch returns finishReason=SAFETY with empty parts\n" +
      "  Expected: source=fallback (never a fabricated cue), cues still produced",
    async () => {
      process.env.GEMINI_API_KEY = "test-key-abc";
      delete process.env.SCRATCHNODE_CUE_LLM_DISABLED;
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
        text: async () => "{}",
      })) as any;

      const tables: Tables = {
        liveEvents: [baseEvent()],
        liveEventMembers: [member(SESSION_B)],
        liveEventMessages: [message(1, SESSION_A, "p95 latency under load")],
        userNotes: [],
      };
      const ctx = createActionCtx(tables);
      const res = await (generateLiveCuesLLM as any)._handler(ctx, {
        eventId: EVENT_ID,
        sessionId: SESSION_B,
        sinceTimestamp: NOW - 30_000,
      });
      expect(res.status).toBe("ok");
      expect(res.source).toBe("fallback");
      expect(res.cues.length).toBeGreaterThan(0);
    },
  );
});
