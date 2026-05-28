import { describe, expect, it } from "vitest";
import {
  assertValidAgentOutput,
  evaluateAgentOutput,
  getOutputPolicy,
  isValidTaxonomy,
  type AgentOutputEnvelope,
} from "./agentOutputContract";

const baseEnvelope = {
  id: "out_1",
  target: { eventId: "evt_ai_infra_summit", messageId: "msg_sarah_latency" },
  visibility: "event_public",
  sourceRefs: ["source:event-wiki:v3", "source:orbital-panel"],
  citationRefs: ["citation:latency-budget"],
  traceRef: "trace_public_ask_1",
  producedBy: {
    runId: "run_public_ask_1",
    skill: "event-room-qa",
    toolChain: ["semantic_cache_lookup", "retrieve_event_context"],
  },
  version: { wikiVersion: 3, sourceBundleVersion: 7 },
} satisfies Partial<AgentOutputEnvelope>;

describe("agent output L1/L2/L3 contract", () => {
  it("accepts a cached public FAQ answer with source refs and a public trace", () => {
    const envelope: AgentOutputEnvelope = {
      ...baseEnvelope,
      l1: "public_knowledge",
      l2: "event_faq",
      l3: "faq.cached_reuse_answer",
      output: {
        parentAskMessageId: "msg_sarah_latency",
        canonicalQuestion: "What is the p95 latency budget for clinical triage voice agents?",
        answerMarkdown: "Clinical-grade voice agents converge on a sub-350ms round-trip budget.",
        answerMode: "cache_hit",
        reuseSummary: {
          similarQuestions: 15,
          reusedSources: 4,
          newSearches: 0,
          privateNotesUsed: false,
        },
        promotionState: "suggested",
        noPrivateNotesUsed: true,
      },
    };

    const result = evaluateAgentOutput(envelope);

    expect(result.passed).toBe(true);
    expect(result.policy?.renderer).toBe("AgentAnswerCard");
    expect(result.policy?.evaluator).toBe("faq_validator");
    expect(() => assertValidAgentOutput(envelope)).not.toThrow();
  });

  it("accepts a private anchored note and maps it to the private-note marker renderer", () => {
    const envelope: AgentOutputEnvelope = {
      ...baseEnvelope,
      id: "note_out_1",
      l1: "private_memory",
      l2: "private_note",
      l3: "note.anchored_to_chat",
      visibility: "private",
      sourceRefs: ["message:msg_sarah_latency"],
      citationRefs: [],
      traceRef: "trace_private_note_1",
      producedBy: {
        runId: "run_private_note_1",
        skill: "private-note-builder",
        toolChain: ["save_private_note_patch"],
      },
      output: {
        body: "Latency framing useful for JPM healthcare AI coverage.",
        anchor: { type: "message", id: "msg_sarah_latency" },
        extractedEntities: ["@Orbital Labs"],
        followUps: ["Ask Alex about p95 latency."],
      },
    };

    const result = evaluateAgentOutput(envelope);

    expect(result.passed).toBe(true);
    expect(result.policy?.renderer).toBe("PrivateNoteMarker");
  });

  it("accepts a private Live Assist cue and rejects auto-posting cues", () => {
    const envelope: AgentOutputEnvelope = {
      ...baseEnvelope,
      id: "cue_1",
      l1: "private_memory",
      l2: "live_cue",
      l3: "cue.question_suggestion",
      visibility: "private",
      sourceRefs: ["message:msg_sarah_latency"],
      citationRefs: [],
      traceRef: "trace_cue_1",
      producedBy: {
        runId: "run_cue_1",
        skill: "meeting-live-cue",
        toolChain: ["retrieve_event_context"],
      },
      output: {
        cueText: "Clarify whether this is p95 or average latency.",
        trigger: "question_detected",
        autoPost: false,
        actions: ["save_note", "ask_private", "make_followup"],
      },
    };

    const result = evaluateAgentOutput(envelope);

    expect(result.passed).toBe(true);
    expect(result.policy?.renderer).toBe("LiveAssistCueCard");

    const unsafe = {
      ...envelope,
      id: "cue_unsafe",
      output: { ...envelope.output, autoPost: true },
    };

    expect(evaluateAgentOutput(unsafe).issues.map((issue) => issue.code)).toContain("CUE-003");
  });

  it("accepts private meeting brief artifacts and blocks private content from workspace summaries", () => {
    const envelope: AgentOutputEnvelope = {
      ...baseEnvelope,
      id: "brief_1",
      l1: "generated_artifact",
      l2: "meeting_brief",
      l3: "artifact.private_meeting_summary",
      visibility: "private",
      traceRef: "trace_meeting_brief_1",
      producedBy: {
        runId: "run_meeting_brief_1",
        skill: "post-meeting-brief",
        toolChain: ["retrieve_event_context", "save_private_note_patch"],
      },
      output: {
        summary: "Orbital Labs and clinical triage latency dominated the meeting.",
        actionItems: ["Ask Alex about p95 latency targets."],
        sourceTranscriptAnchors: ["msg_sarah_latency"],
        privateNotesUsed: true,
      },
    };

    expect(evaluateAgentOutput(envelope).passed).toBe(true);

    const unsafeWorkspaceSummary: AgentOutputEnvelope = {
      ...envelope,
      id: "brief_workspace_unsafe",
      l3: "artifact.team_meeting_summary",
      visibility: "workspace",
    };

    const result = evaluateAgentOutput(unsafeWorkspaceSummary);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("ART-005");
  });

  it("rejects public answers that use private notes", () => {
    const envelope: AgentOutputEnvelope = {
      ...baseEnvelope,
      l1: "public_knowledge",
      l2: "event_faq",
      l3: "faq.cached_reuse_answer",
      sourceRefs: ["source:event-wiki:v3", "private_note:note_123"],
      output: {
        parentAskMessageId: "msg_sarah_latency",
        canonicalQuestion: "What changed?",
        answerMarkdown: "This incorrectly uses a private note.",
        answerMode: "cache_hit",
        reuseSummary: {
          similarQuestions: 4,
          reusedSources: 2,
          newSearches: 0,
          privateNotesUsed: true,
        },
      },
    };

    const result = evaluateAgentOutput(envelope);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["EVAL-POLICY-001", "FAQ-003"]),
    );
  });

  it("rejects taxonomy mismatches and missing policy mappings", () => {
    expect(isValidTaxonomy("public_knowledge", "event_faq", "note.anchored_to_chat")).toBe(false);
    expect(getOutputPolicy("note.anchored_to_chat")?.l1).toBe("private_memory");

    const envelope: AgentOutputEnvelope = {
      ...baseEnvelope,
      l1: "public_knowledge",
      l2: "event_faq",
      l3: "note.anchored_to_chat",
      output: {
        parentAskMessageId: "msg_sarah_latency",
        reuseSummary: { privateNotesUsed: false },
      },
    };

    const result = evaluateAgentOutput(envelope);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["EVAL-SCHEMA-001", "EVAL-SCHEMA-003", "EVAL-POLICY-006"]),
    );
  });

  it("requires public semantic cache entries to include event/wiki/source versions and forbid private context", () => {
    const validCache: AgentOutputEnvelope = {
      ...baseEnvelope,
      id: "cache_1",
      l1: "operational_cache",
      l2: "semantic_answer_cache",
      l3: "cache.public_faq_answer",
      output: {
        normalizedQuestion: "p95 latency budget clinical triage",
        privateContextAllowed: false,
        reuseCount: 4,
      },
    };

    expect(evaluateAgentOutput(validCache).passed).toBe(true);

    const missingVersion: AgentOutputEnvelope = {
      ...validCache,
      id: "cache_2",
      version: { wikiVersion: 3 },
      output: {
        normalizedQuestion: "p95 latency budget clinical triage",
        privateContextAllowed: true,
      },
    };

    const result = evaluateAgentOutput(missingVersion);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["CACHE-004", "CACHE-005"]),
    );
  });

  it("rejects public retrieval packets that include private results", () => {
    const envelope: AgentOutputEnvelope = {
      ...baseEnvelope,
      id: "retrieval_1",
      l1: "retrieval_context",
      l2: "index_search",
      l3: "retrieval.context_packet",
      output: {
        scope: { eventId: "evt_ai_infra_summit", includePrivate: false, visibility: "event_public" },
        results: [
          {
            uri: "event_wiki:evt_ai_infra_summit:v3",
            type: "event_wiki",
            title: "AI Infra Summit wiki",
            snippet: "Clinical triage latency",
            visibility: "event_public",
          },
          {
            uri: "private_note:note_1",
            type: "private_note",
            title: "Private note",
            snippet: "Owner-only note",
            visibility: "private",
          },
        ],
      },
    };

    const result = evaluateAgentOutput(envelope);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("RET-003");
  });
});
