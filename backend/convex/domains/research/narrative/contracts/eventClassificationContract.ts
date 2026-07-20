/**
 * Event Classification Decision Contract
 *
 * Defines the formal rules for classifying incoming content as:
 * - NEW: Distinct event, creates new temporalFact
 * - UPDATE: Same event with material changes, supersedes existing fact
 * - DUPLICATE: No new information, skip entirely
 * - CONTRADICTION: Conflicts with existing fact, requires adjudication
 *
 * This contract is the authoritative specification for dedup + supersession.
 *
 * @module domains/narrative/contracts/eventClassificationContract
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// DECISION CONTRACT SPECIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CLASSIFICATION DECISION MATRIX
 *
 * ┌──────────────────┬─────────────────┬────────────────────────────────────┐
 * │ Classification   │ Threshold       │ Action                             │
 * ├──────────────────┼─────────────────┼────────────────────────────────────┤
 * │ DUPLICATE        │ similarity ≥0.90│ Skip, log occurrence               │
 * │                  │ OR hash match   │                                    │
 * ├──────────────────┼─────────────────┼────────────────────────────────────┤
 * │ UPDATE           │ 0.50 ≤ sim <0.90│ Create superseding fact            │
 * │                  │ AND material    │ Mark old as superseded             │
 * │                  │ change detected │ Preserve old in history            │
 * ├──────────────────┼─────────────────┼────────────────────────────────────┤
 * │ CONTRADICTION    │ Any similarity  │ Create dispute chain               │
 * │                  │ AND conflicting │ Both facts remain until resolved   │
 * │                  │ claims detected │ Require HITL adjudication          │
 * ├──────────────────┼─────────────────┼────────────────────────────────────┤
 * │ NEW              │ similarity <0.50│ Create new temporalFact            │
 * │                  │ OR different    │ No supersession                    │
 * │                  │ entity/topic    │                                    │
 * └──────────────────┴─────────────────┴────────────────────────────────────┘
 */

export type EventClassification = "new" | "update" | "duplicate" | "contradiction";

export interface ClassificationThresholds {
  // Similarity thresholds (Jaccard on normalized text)
  duplicateMinSimilarity: number;      // ≥ this = duplicate
  updateMinSimilarity: number;         // ≥ this AND < duplicate = update candidate
  newMaxSimilarity: number;            // < this = new event

  // Hash-based dedup
  exactHashMatchIsDuplicate: boolean;

  // LLM materiality gate
  requireLLMForUpdates: boolean;       // Use LLM to verify "material" change
  llmMaterialityConfidence: number;    // Min confidence from LLM

  // Contradiction detection
  contradictionConfidenceThreshold: number;

  // Temporal constraints
  lookbackWindowHours: number;         // Only compare with events in this window
  sameEntityRequired: boolean;         // Must share entity key for update/dup
}

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  duplicateMinSimilarity: 0.90,
  updateMinSimilarity: 0.50,
  newMaxSimilarity: 0.50,
  exactHashMatchIsDuplicate: true,
  requireLLMForUpdates: true,
  llmMaterialityConfidence: 0.7,
  contradictionConfidenceThreshold: 0.6,
  lookbackWindowHours: 168,  // 7 days
  sameEntityRequired: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// MATERIALITY CRITERIA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * MATERIALITY DEFINITION
 *
 * A change is "material" if it affects decision-making. Specifically:
 *
 * MATERIAL CHANGES (trigger UPDATE):
 * 1. Quantitative: Numbers differ by >5% or any amount if <$1M → >$1M threshold
 * 2. Temporal: Dates differ by >1 day
 * 3. Status: State change (announced → confirmed, rumored → denied)
 * 4. Entity: New parties added (co-investor, acquirer, etc.)
 * 5. Causal: Different cause/effect relationship
 *
 * NON-MATERIAL CHANGES (remain DUPLICATE):
 * 1. Reworded same information
 * 2. Different source saying same thing
 * 3. Formatting/style differences
 * 4. Additional color/quotes without new facts
 */

export type MaterialityType =
  | "quantitative"   // Numbers changed materially
  | "temporal"       // Dates/timing changed
  | "status"         // State transition
  | "entity"         // New parties involved
  | "causal"         // Cause/effect changed
  | "none";          // No material change

export interface MaterialityAssessment {
  hasMaterialChange: boolean;
  materialityTypes: MaterialityType[];
  changes: Array<{
    field: string;
    oldValue: string;
    newValue: string;
    materialityType: MaterialityType;
    significance: "low" | "medium" | "high";
  }>;
  confidence: number;
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPERSESSION SEMANTICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SUPERSESSION RULES
 *
 * When fact A supersedes fact B:
 * 1. A.supersedes = B._id (forward link)
 * 2. B.supersededBy = A._id (back link)
 * 3. B.truthState.status = "superseded"
 * 4. B.truthState.showInDefault = false
 * 5. A inherits B's dispute history (if any)
 * 6. Both remain queryable for audit
 *
 * SUPERSESSION CHAIN INTEGRITY:
 * - No cycles allowed (A→B→A)
 * - Max chain depth = 10 (alert if exceeded)
 * - Chain must be traversable both directions
 */

export interface SupersessionRecord {
  newFactId: Id<"temporalFacts">;
  oldFactId: Id<"temporalFacts">;
  supersessionType: "update" | "correction" | "retraction";
  materialChanges: MaterialityAssessment;
  preserveOldInHistory: boolean;
  inheritDisputes: boolean;
  supersededAt: number;
  supersededBy: string;  // Agent or human ID
  auditNote: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT REQUIREMENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * AUDIT TRAIL REQUIREMENTS
 *
 * Every classification decision MUST record:
 * 1. Input content hash
 * 2. Candidate matches considered (with similarity scores)
 * 3. Classification decision
 * 4. Thresholds used
 * 5. LLM reasoning (if applicable)
 * 6. Actor (agent ID or human ID)
 * 7. Timestamp
 *
 * For SUPERSESSION additionally:
 * 8. Materiality assessment
 * 9. Link to superseded fact
 * 10. Link to superseding fact
 */

export interface ClassificationAuditEntry {
  // Input
  inputContentHash: string;
  inputEntityKeys: string[];
  inputTimestamp: number;

  // Candidates
  candidatesConsidered: Array<{
    factId: Id<"temporalFacts">;
    similarity: number;
    matchType: "hash" | "similarity" | "entity";
  }>;

  // Decision
  classification: EventClassification;
  thresholdsUsed: ClassificationThresholds;
  confidence: number;

  // LLM (if used)
  llmUsed: boolean;
  llmModel?: string;
  llmReasoning?: string;
  llmConfidence?: number;

  // Supersession (if applicable)
  supersessionRecord?: SupersessionRecord;

  // Actor
  classifiedBy: string;
  classifiedAt: number;

  // Traceability
  sourceUrl?: string;
  sourceArtifactId?: Id<"sourceArtifacts">;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute the classification contract
 */
export const classifyEvent = internalAction({
  args: {
    content: v.string(),
    entityKeys: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceArtifactId: v.optional(v.id("sourceArtifacts")),
    thresholds: v.optional(v.object({
      duplicateMinSimilarity: v.number(),
      updateMinSimilarity: v.number(),
      newMaxSimilarity: v.number(),
      exactHashMatchIsDuplicate: v.boolean(),
      requireLLMForUpdates: v.boolean(),
      llmMaterialityConfidence: v.number(),
      contradictionConfidenceThreshold: v.number(),
      lookbackWindowHours: v.number(),
      sameEntityRequired: v.boolean(),
    })),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const thresholds = args.thresholds || DEFAULT_THRESHOLDS;
    const now = Date.now();

    // Step 1: Find candidates within lookback window
    const candidates = await ctx.runQuery(
      internal.domains.narrative.contracts.eventClassificationContract.findCandidates,
      {
        entityKeys: args.entityKeys,
        lookbackHours: thresholds.lookbackWindowHours,
        sameEntityRequired: thresholds.sameEntityRequired,
      }
    );

    // Step 2: Compute content hash
    const contentHash = computeContentHash(args.content);

    // Step 3: Check for exact hash match
    const hashMatch = candidates.find(c => c.contentHash === contentHash);
    if (hashMatch && thresholds.exactHashMatchIsDuplicate) {
      const auditEntry = createAuditEntry({
        contentHash,
        entityKeys: args.entityKeys,
        candidates: [{ factId: hashMatch.factId, similarity: 1.0, matchType: "hash" }],
        classification: "duplicate",
        thresholds,
        confidence: 0.99,
        actor: args.actor,
        sourceUrl: args.sourceUrl,
      });

      await ctx.runMutation(
        internal.domains.narrative.contracts.eventClassificationContract.recordAuditEntry,
        { entry: auditEntry }
      );

      return {
        classification: "duplicate" as EventClassification,
        matchedFactId: hashMatch.factId,
        confidence: 0.99,
        auditId: auditEntry.inputContentHash,
      };
    }

    // Step 4: Compute similarity scores
    const scoredCandidates = candidates.map(c => ({
      ...c,
      similarity: computeJaccardSimilarity(args.content, c.content),
    })).sort((a, b) => b.similarity - a.similarity);

    // Step 5: Apply classification rules
    const topCandidate = scoredCandidates[0];

    if (!topCandidate || topCandidate.similarity < thresholds.newMaxSimilarity) {
      // NEW event
      const auditEntry = createAuditEntry({
        contentHash,
        entityKeys: args.entityKeys,
        candidates: scoredCandidates.slice(0, 5).map(c => ({
          factId: c.factId,
          similarity: c.similarity,
          matchType: "similarity" as const,
        })),
        classification: "new",
        thresholds,
        confidence: 0.95,
        actor: args.actor,
        sourceUrl: args.sourceUrl,
      });

      await ctx.runMutation(
        internal.domains.narrative.contracts.eventClassificationContract.recordAuditEntry,
        { entry: auditEntry }
      );

      return {
        classification: "new" as EventClassification,
        confidence: 0.95,
        auditId: auditEntry.inputContentHash,
      };
    }

    if (topCandidate.similarity >= thresholds.duplicateMinSimilarity) {
      // DUPLICATE
      const auditEntry = createAuditEntry({
        contentHash,
        entityKeys: args.entityKeys,
        candidates: [{ factId: topCandidate.factId, similarity: topCandidate.similarity, matchType: "similarity" }],
        classification: "duplicate",
        thresholds,
        confidence: topCandidate.similarity,
        actor: args.actor,
        sourceUrl: args.sourceUrl,
      });

      await ctx.runMutation(
        internal.domains.narrative.contracts.eventClassificationContract.recordAuditEntry,
        { entry: auditEntry }
      );

      return {
        classification: "duplicate" as EventClassification,
        matchedFactId: topCandidate.factId,
        confidence: topCandidate.similarity,
        auditId: auditEntry.inputContentHash,
      };
    }

    // Step 6: UPDATE candidate - requires LLM materiality check
    if (thresholds.requireLLMForUpdates) {
      const materialityResult = await ctx.runAction(
        internal.domains.narrative.contracts.eventClassificationContract.assessMateriality,
        {
          newContent: args.content,
          existingContent: topCandidate.content,
          existingFactId: topCandidate.factId,
        }
      );

      if (materialityResult.classification === "contradiction") {
        // CONTRADICTION detected
        const auditEntry = createAuditEntry({
          contentHash,
          entityKeys: args.entityKeys,
          candidates: [{ factId: topCandidate.factId, similarity: topCandidate.similarity, matchType: "similarity" }],
          classification: "contradiction",
          thresholds,
          confidence: materialityResult.confidence,
          actor: args.actor,
          sourceUrl: args.sourceUrl,
          llmUsed: true,
          llmReasoning: materialityResult.reasoning,
          llmConfidence: materialityResult.confidence,
        });

        await ctx.runMutation(
          internal.domains.narrative.contracts.eventClassificationContract.recordAuditEntry,
          { entry: auditEntry }
        );

        return {
          classification: "contradiction" as EventClassification,
          matchedFactId: topCandidate.factId,
          contradictionDetails: materialityResult.reasoning,
          confidence: materialityResult.confidence,
          auditId: auditEntry.inputContentHash,
        };
      }

      if (materialityResult.hasMaterialChange) {
        // UPDATE with material changes
        const auditEntry = createAuditEntry({
          contentHash,
          entityKeys: args.entityKeys,
          candidates: [{ factId: topCandidate.factId, similarity: topCandidate.similarity, matchType: "similarity" }],
          classification: "update",
          thresholds,
          confidence: materialityResult.confidence,
          actor: args.actor,
          sourceUrl: args.sourceUrl,
          llmUsed: true,
          llmReasoning: materialityResult.reasoning,
          llmConfidence: materialityResult.confidence,
        });

        await ctx.runMutation(
          internal.domains.narrative.contracts.eventClassificationContract.recordAuditEntry,
          { entry: auditEntry }
        );

        return {
          classification: "update" as EventClassification,
          matchedFactId: topCandidate.factId,
          materialChanges: materialityResult.changes,
          confidence: materialityResult.confidence,
          auditId: auditEntry.inputContentHash,
        };
      }

      // LLM says no material change - treat as duplicate
      const auditEntry = createAuditEntry({
        contentHash,
        entityKeys: args.entityKeys,
        candidates: [{ factId: topCandidate.factId, similarity: topCandidate.similarity, matchType: "similarity" }],
        classification: "duplicate",
        thresholds,
        confidence: materialityResult.confidence,
        actor: args.actor,
        sourceUrl: args.sourceUrl,
        llmUsed: true,
        llmReasoning: "No material change detected",
        llmConfidence: materialityResult.confidence,
      });

      await ctx.runMutation(
        internal.domains.narrative.contracts.eventClassificationContract.recordAuditEntry,
        { entry: auditEntry }
      );

      return {
        classification: "duplicate" as EventClassification,
        matchedFactId: topCandidate.factId,
        confidence: materialityResult.confidence,
        auditId: auditEntry.inputContentHash,
      };
    }

    // Without LLM, treat as UPDATE by default
    const auditEntry = createAuditEntry({
      contentHash,
      entityKeys: args.entityKeys,
      candidates: [{ factId: topCandidate.factId, similarity: topCandidate.similarity, matchType: "similarity" }],
      classification: "update",
      thresholds,
      confidence: 0.7,
      actor: args.actor,
      sourceUrl: args.sourceUrl,
    });

    await ctx.runMutation(
      internal.domains.narrative.contracts.eventClassificationContract.recordAuditEntry,
      { entry: auditEntry }
    );

    return {
      classification: "update" as EventClassification,
      matchedFactId: topCandidate.factId,
      confidence: 0.7,
      auditId: auditEntry.inputContentHash,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function computeContentHash(content: string): string {
  const normalized = content.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function computeJaccardSimilarity(text1: string, text2: string): number {
  const normalize = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  const words1 = new Set(normalize(text1).split(" ").filter(w => w.length > 3));
  const words2 = new Set(normalize(text2).split(" ").filter(w => w.length > 3));

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return union > 0 ? intersection / union : 0;
}

function createAuditEntry(params: {
  contentHash: string;
  entityKeys: string[];
  candidates: Array<{ factId: Id<"temporalFacts">; similarity: number; matchType: "hash" | "similarity" | "entity" }>;
  classification: EventClassification;
  thresholds: ClassificationThresholds;
  confidence: number;
  actor: string;
  sourceUrl?: string;
  llmUsed?: boolean;
  llmReasoning?: string;
  llmConfidence?: number;
}): ClassificationAuditEntry {
  return {
    inputContentHash: params.contentHash,
    inputEntityKeys: params.entityKeys,
    inputTimestamp: Date.now(),
    candidatesConsidered: params.candidates,
    classification: params.classification,
    thresholdsUsed: params.thresholds,
    confidence: params.confidence,
    llmUsed: params.llmUsed || false,
    llmReasoning: params.llmReasoning,
    llmConfidence: params.llmConfidence,
    classifiedBy: params.actor,
    classifiedAt: Date.now(),
    sourceUrl: params.sourceUrl,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const findCandidates = internalQuery({
  args: {
    entityKeys: v.array(v.string()),
    lookbackHours: v.number(),
    sameEntityRequired: v.boolean(),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.lookbackHours * 60 * 60 * 1000);

    const candidates: Array<{
      factId: Id<"temporalFacts">;
      content: string;
      contentHash: string;
      entityKey: string;
      validFrom: number;
    }> = [];

    if (args.sameEntityRequired) {
      // Only look at facts with matching entity keys
      for (const entityKey of args.entityKeys) {
        const facts = await ctx.db
          .query("temporalFacts")
          .withIndex("by_entity", q => q.eq("entityKey", entityKey))
          .filter(q => q.gte(q.field("validFrom"), cutoff))
          .take(50);

        for (const fact of facts) {
          candidates.push({
            factId: fact._id,
            content: fact.claim,
            contentHash: computeContentHash(fact.claim),
            entityKey: fact.entityKey,
            validFrom: fact.validFrom,
          });
        }
      }
    } else {
      // Look at all recent facts
      const facts = await ctx.db
        .query("temporalFacts")
        .filter(q => q.gte(q.field("validFrom"), cutoff))
        .take(200);

      for (const fact of facts) {
        candidates.push({
          factId: fact._id,
          content: fact.claim,
          contentHash: computeContentHash(fact.claim),
          entityKey: fact.entityKey,
          validFrom: fact.validFrom,
        });
      }
    }

    return candidates;
  },
});

export const recordAuditEntry = internalMutation({
  args: {
    entry: v.any(),  // ClassificationAuditEntry
  },
  handler: async (ctx, args) => {
    // Store in audit log (would need schema table)
    console.log("[ClassificationAudit]", JSON.stringify(args.entry, null, 2));
    return args.entry.inputContentHash;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// LLM MATERIALITY ASSESSMENT
// ═══════════════════════════════════════════════════════════════════════════

export const assessMateriality = internalAction({
  args: {
    newContent: v.string(),
    existingContent: v.string(),
    existingFactId: v.id("temporalFacts"),
  },
  handler: async (ctx, args) => {
    const { generateText } = await import("ai");
    const { openai } = await import("@ai-sdk/openai");

    const prompt = `You are a fact-checker assessing whether new information represents a MATERIAL UPDATE or is merely a DUPLICATE of existing information.

EXISTING FACT:
${args.existingContent}

NEW INFORMATION:
${args.newContent}

MATERIALITY CRITERIA:
A change is "material" if it affects decision-making:
1. QUANTITATIVE: Numbers differ by >5% or cross significant thresholds
2. TEMPORAL: Dates differ by >1 day
3. STATUS: State change (announced → confirmed, rumored → denied)
4. ENTITY: New parties added (investor, acquirer, partner)
5. CAUSAL: Different cause/effect relationship

Non-material changes (DUPLICATE):
- Reworded same information
- Different source saying same thing
- Formatting differences
- Color/quotes without new facts

Also check for CONTRADICTIONS:
- Claims that conflict with the existing fact
- Opposite assertions about the same topic

Return JSON:
{
  "classification": "update" | "duplicate" | "contradiction",
  "hasMaterialChange": boolean,
  "materialityTypes": ["quantitative", "temporal", "status", "entity", "causal"],
  "changes": [
    {
      "field": "funding amount",
      "oldValue": "$5M",
      "newValue": "$6.6M",
      "materialityType": "quantitative",
      "significance": "high"
    }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

    try {
      const result = await generateText({
        model: openai.chat("gpt-5.4-nano"),
        prompt,
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          classification: "update" as const,
          hasMaterialChange: true,
          materialityTypes: [] as MaterialityType[],
          changes: [],
          confidence: 0.5,
          reasoning: "Failed to parse LLM response, defaulting to update",
        };
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error("[assessMateriality] Error:", error);
      return {
        classification: "update" as const,
        hasMaterialChange: true,
        materialityTypes: [] as MaterialityType[],
        changes: [],
        confidence: 0.5,
        reasoning: "LLM error, defaulting to update",
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SUPERSESSION EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

export const executeSupersession = internalMutation({
  args: {
    newFactId: v.id("temporalFacts"),
    oldFactId: v.id("temporalFacts"),
    supersessionType: v.union(v.literal("update"), v.literal("correction"), v.literal("retraction")),
    materialChanges: v.any(),  // MaterialityAssessment
    actor: v.string(),
    auditNote: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // 1. Update new fact with supersedes link
    await ctx.db.patch(args.newFactId, {
      supersedes: args.oldFactId,
    });

    // 2. Update old fact with supersededBy link
    await ctx.db.patch(args.oldFactId, {
      supersededBy: args.newFactId,
      isActive: false,
    });

    // 3. Update truth state for old fact
    const oldTruthState = await ctx.db
      .query("truthState")
      .withIndex("by_fact", q => q.eq("factId", args.oldFactId))
      .first();

    if (oldTruthState) {
      await ctx.db.patch(oldTruthState._id, {
        status: "superseded",
        showInDefault: false,
        requiresContext: false,
        resolutionNote: `Superseded by ${args.newFactId}: ${args.auditNote}`,
        lastStateChange: now,
        stateChangedBy: args.actor,
      });
    }

    // 4. Create truth state for new fact (canonical)
    const newFact = await ctx.db.get(args.newFactId);
    if (newFact) {
      await ctx.db.insert("truthState", {
        factId: args.newFactId,
        threadId: newFact.threadId || ("" as Id<"narrativeThreads">),  // fallback
        status: "canonical",
        showInDefault: true,
        requiresContext: false,
        activeDisputeIds: [],
        lastStateChange: now,
        stateChangedBy: args.actor,
      });
    }

    // 5. Log supersession record
    console.log("[Supersession]", {
      newFactId: args.newFactId,
      oldFactId: args.oldFactId,
      type: args.supersessionType,
      actor: args.actor,
      timestamp: now,
      note: args.auditNote,
    });

    return {
      success: true,
      newFactId: args.newFactId,
      oldFactId: args.oldFactId,
    };
  },
});
