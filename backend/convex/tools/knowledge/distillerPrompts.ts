// convex/tools/knowledge/distillerPrompts.ts
// Extraction prompts for the distiller tool

/**
 * System prompt for fact extraction
 */
export const FACT_EXTRACTION_SYSTEM_PROMPT = `You are a fact extraction specialist. Your task is to extract verifiable facts and claims from provided text content.

Rules:
1. Extract only factual statements that can be verified
2. Include confidence scores based on source quality and specificity
3. Provide exact quotes from the source as citations
4. Categorize facts appropriately
5. Be conservative - only extract facts you're confident about

Output JSON array of facts with this schema:
{
  "facts": [
    {
      "id": "fact_1",
      "text": "The extracted fact statement",
      "confidence": 0.95,
      "category": "financial|product|opinion|technical|biographical|temporal",
      "citations": [
        {
          "quote": "exact quote from source",
          "chunkIndex": 0
        }
      ]
    }
  ]
}`;

/**
 * Generate user prompt for fact extraction
 */
export function generateFactExtractionPrompt(
  query: string,
  chunks: Array<{ index: number; text: string; sourceUrl?: string }>,
  persona?: string,
  maxFacts: number = 10
): string {
  const chunksText = chunks.map((chunk, i) =>
    `[Chunk ${i}]${chunk.sourceUrl ? ` (Source: ${chunk.sourceUrl})` : ''}\n${chunk.text}`
  ).join("\n\n---\n\n");

  const personaContext = persona
    ? `\nPersona context: You are analyzing this content for a ${persona}. Focus on facts relevant to their perspective.`
    : '';

  return `Extract up to ${maxFacts} facts relevant to this query: "${query}"
${personaContext}

Content to analyze:
${chunksText}

Return a JSON object with a "facts" array. Each fact must have:
- id: unique identifier (fact_1, fact_2, etc.)
- text: clear statement of the fact
- confidence: 0-1 score (>0.8 = high confidence, 0.5-0.8 = medium, <0.5 = low)
- category: one of [financial, product, opinion, technical, biographical, temporal, other]
- citations: array with at least one {quote, chunkIndex} pair

Only return valid JSON.`;
}

/**
 * System prompt for claim verification
 */
export const CLAIM_VERIFICATION_SYSTEM_PROMPT = `You are a claim verification specialist. Your task is to verify claims against provided evidence.

For each claim, determine:
1. SUPPORTED - Evidence directly supports the claim
2. CONTRADICTED - Evidence contradicts the claim
3. INSUFFICIENT - Not enough evidence to verify
4. PARTIALLY_SUPPORTED - Evidence supports some aspects

Provide reasoning and cite specific evidence.`;

/**
 * Generate user prompt for claim verification
 */
export function generateClaimVerificationPrompt(
  claims: string[],
  evidence: Array<{ index: number; text: string; sourceUrl?: string }>
): string {
  const claimsList = claims.map((claim, i) => `${i + 1}. ${claim}`).join("\n");
  const evidenceText = evidence.map((e, i) =>
    `[Evidence ${i}]${e.sourceUrl ? ` (${e.sourceUrl})` : ''}\n${e.text}`
  ).join("\n\n");

  return `Verify these claims against the provided evidence:

Claims:
${claimsList}

Evidence:
${evidenceText}

For each claim, return JSON:
{
  "verifications": [
    {
      "claimIndex": 0,
      "status": "SUPPORTED|CONTRADICTED|INSUFFICIENT|PARTIALLY_SUPPORTED",
      "confidence": 0.9,
      "reasoning": "explanation",
      "evidenceIndices": [0, 2]
    }
  ]
}`;
}

/**
 * System prompt for summarization with citations
 */
export const SUMMARY_WITH_CITATIONS_SYSTEM_PROMPT = `You are a summarization specialist. Create concise summaries while preserving citations.

Rules:
1. Summarize key points from provided chunks
2. Use citation anchors in format: {{cite:artifactId:chunkId}}
3. Maintain factual accuracy
4. Prioritize information relevant to the query`;

/**
 * Generate user prompt for summarization
 */
export function generateSummaryPrompt(
  query: string,
  chunks: Array<{
    chunkId: string;
    artifactId: string;
    text: string;
    sourceUrl?: string
  }>,
  maxTokens: number = 500
): string {
  const chunksText = chunks.map((chunk, i) =>
    `[Chunk ${i}: ${chunk.artifactId}:${chunk.chunkId}]${chunk.sourceUrl ? ` (${chunk.sourceUrl})` : ''}\n${chunk.text}`
  ).join("\n\n---\n\n");

  return `Summarize the following content in response to: "${query}"

Target length: ~${Math.floor(maxTokens * 4)} characters (${maxTokens} tokens)

When citing information, use this format: {{cite:artifactId:chunkId}}
Example: "The company reported $10M in revenue {{cite:art_123:chunk_456}}"

Content:
${chunksText}

Provide a concise summary with inline citations.`;
}

/**
 * Parse fact extraction response
 */
export function parseFactExtractionResponse(response: string): {
  facts: Array<{
    id: string;
    text: string;
    confidence: number;
    category: string;
    citations: Array<{ quote: string; chunkIndex: number }>;
  }>;
} | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*"facts"[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!Array.isArray(parsed.facts)) return null;

    return {
      facts: parsed.facts.map((fact: any, index: number) => ({
        id: fact.id || `fact_${index + 1}`,
        text: String(fact.text || ""),
        confidence: Number(fact.confidence) || 0.5,
        category: String(fact.category || "other"),
        citations: Array.isArray(fact.citations)
          ? fact.citations.map((c: any) => ({
              quote: String(c.quote || ""),
              chunkIndex: Number(c.chunkIndex) || 0,
            }))
          : [],
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Parse claim verification response
 */
export function parseClaimVerificationResponse(response: string): {
  verifications: Array<{
    claimIndex: number;
    status: string;
    confidence: number;
    reasoning: string;
    evidenceIndices: number[];
  }>;
} | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*"verifications"[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed.verifications)) return null;

    return {
      verifications: parsed.verifications.map((v: any) => ({
        claimIndex: Number(v.claimIndex) || 0,
        status: String(v.status || "INSUFFICIENT"),
        confidence: Number(v.confidence) || 0.5,
        reasoning: String(v.reasoning || ""),
        evidenceIndices: Array.isArray(v.evidenceIndices)
          ? v.evidenceIndices.map(Number)
          : [],
      })),
    };
  } catch {
    return null;
  }
}
