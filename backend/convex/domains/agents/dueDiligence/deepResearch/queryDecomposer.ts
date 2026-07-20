/**
 * Query Decomposer
 *
 * Breaks down complex user queries into structured sub-questions,
 * extracts entities, hypotheses, and relationships.
 *
 * Implements the "extended thinking" pattern where the lead agent
 * plans its approach before spawning sub-agents.
 *
 * @module deepResearch/queryDecomposer
 */

import type {
  DecomposedQuery,
  QueryIntent,
  SubQuestion,
  ExtractedHypothesis,
  ExtractedEntity,
  ExtractedRelationship,
  TimeConstraint,
  SubAgentType,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DECOMPOSITION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decompose a complex query into structured components for multi-agent research
 */
export async function decomposeQuery(
  query: string,
  generateTextFn?: (prompt: string) => Promise<string>
): Promise<DecomposedQuery> {
  console.log(`[QueryDecomposer] Decomposing query: ${query.slice(0, 100)}...`);

  // If we have LLM access, use it for better decomposition
  if (generateTextFn) {
    return await decomposeWithLLM(query, generateTextFn);
  }

  // Fallback to rule-based decomposition
  return decomposeWithRules(query);
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM-BASED DECOMPOSITION
// ═══════════════════════════════════════════════════════════════════════════

async function decomposeWithLLM(
  query: string,
  generateTextFn: (prompt: string) => Promise<string>
): Promise<DecomposedQuery> {
  const prompt = `You are a research planning agent. Analyze this query and decompose it for multi-agent investigation.

QUERY:
${query}

Return ONLY valid JSON with this exact structure:
{
  "intent": {
    "primaryGoal": "research|verification|hypothesis_testing|relationship_mapping",
    "requiresVerification": true/false,
    "requiresSkepticism": true/false,
    "timelinessRequired": true/false,
    "depth": "quick|standard|comprehensive|exhaustive"
  },
  "subQuestions": [
    {
      "question": "The specific question to answer",
      "type": "who|what|when|where|why|how|verify|relationship",
      "targetEntity": "Name of entity if applicable",
      "targetEntityType": "person|company|event|concept",
      "priority": 1-10,
      "dependencies": []
    }
  ],
  "hypotheses": [
    {
      "statement": "A claim that needs verification",
      "claimsToVerify": ["specific claim 1", "specific claim 2"],
      "impliedRelationships": ["entity1 -> entity2: relationship"]
    }
  ],
  "entities": [
    {
      "name": "Entity Name",
      "type": "person|company|product|event|concept",
      "identifiers": {"linkedinUrl": "...", "website": "..."},
      "mentionedClaims": ["claims about this entity"]
    }
  ],
  "relationships": [
    {
      "entity1": "Name",
      "entity2": "Name",
      "relationshipType": "works_for|acquired|partners_with|etc",
      "isHypothetical": true/false
    }
  ],
  "timeConstraints": {
    "recentNewsRequired": true/false,
    "dateRange": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}
  },
  "verificationRequests": ["things user explicitly asked to verify"]
}

Rules:
- Extract ALL entities mentioned (people, companies, products)
- Identify hypotheses (claims with "if", "because", "can", "would", "might")
- Note relationships both explicit and implied
- Prioritize questions (1=highest priority)
- If user asks to "verify" or "be honest" or "critique", set requiresSkepticism=true
- If query mentions recent events, set timelinessRequired=true`;

  try {
    const response = await generateTextFn(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return formatLLMResponse(query, parsed);
    }
  } catch (error) {
    console.error("[QueryDecomposer] LLM decomposition failed:", error);
  }

  // Fallback to rules
  return decomposeWithRules(query);
}

function formatLLMResponse(
  originalQuery: string,
  parsed: Record<string, unknown>
): DecomposedQuery {
  const intent = parsed.intent as QueryIntent || {
    primaryGoal: "research",
    requiresVerification: false,
    requiresSkepticism: false,
    timelinessRequired: false,
    depth: "standard",
  };

  const subQuestions: SubQuestion[] = [];
  if (Array.isArray(parsed.subQuestions)) {
    for (let i = 0; i < parsed.subQuestions.length; i++) {
      const q = parsed.subQuestions[i] as Record<string, unknown>;
      subQuestions.push({
        id: `sq-${i + 1}`,
        question: String(q.question || ""),
        type: (q.type as SubQuestion["type"]) || "what",
        targetEntity: q.targetEntity as string | undefined,
        targetEntityType: q.targetEntityType as SubQuestion["targetEntityType"],
        priority: Number(q.priority) || 5,
        dependencies: (q.dependencies as string[]) || [],
        assignedAgent: inferAgentType(q),
      });
    }
  }

  const hypotheses: ExtractedHypothesis[] = [];
  if (Array.isArray(parsed.hypotheses)) {
    for (let i = 0; i < parsed.hypotheses.length; i++) {
      const h = parsed.hypotheses[i] as Record<string, unknown>;
      hypotheses.push({
        id: `hyp-${i + 1}`,
        statement: String(h.statement || ""),
        confidence: 0.5, // Default, will be evaluated
        claimsToVerify: (h.claimsToVerify as string[]) || [],
        impliedRelationships: (h.impliedRelationships as string[]) || [],
      });
    }
  }

  const entities: ExtractedEntity[] = [];
  if (Array.isArray(parsed.entities)) {
    for (const e of parsed.entities) {
      const ent = e as Record<string, unknown>;
      entities.push({
        name: String(ent.name || ""),
        type: (ent.type as ExtractedEntity["type"]) || "concept",
        identifiers: (ent.identifiers as Record<string, string>) || {},
        mentionedClaims: (ent.mentionedClaims as string[]) || [],
      });
    }
  }

  const relationships: ExtractedRelationship[] = [];
  if (Array.isArray(parsed.relationships)) {
    for (const r of parsed.relationships) {
      const rel = r as Record<string, unknown>;
      relationships.push({
        entity1: String(rel.entity1 || ""),
        entity2: String(rel.entity2 || ""),
        relationshipType: String(rel.relationshipType || "related"),
        confidence: rel.isHypothetical ? 0.3 : 0.7,
        isHypothetical: Boolean(rel.isHypothetical),
      });
    }
  }

  let timeConstraints: TimeConstraint | undefined;
  if (parsed.timeConstraints) {
    const tc = parsed.timeConstraints as Record<string, unknown>;
    timeConstraints = {
      recentNewsRequired: Boolean(tc.recentNewsRequired),
      dateRange: tc.dateRange as { start: string; end: string } | undefined,
    };
  }

  const verificationRequests = (parsed.verificationRequests as string[]) || [];

  return {
    originalQuery,
    intent,
    subQuestions,
    hypotheses,
    entities,
    relationships,
    timeConstraints,
    verificationRequests,
  };
}

function inferAgentType(question: Record<string, unknown>): SubAgentType {
  const type = question.type as string;
  const targetType = question.targetEntityType as string;

  if (type === "verify") return "verification";
  if (type === "relationship") return "relationship";
  if (targetType === "person") return "person";
  if (targetType === "company") return "company";
  if (type === "when" || type === "what") return "news";

  return "company"; // Default
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE-BASED DECOMPOSITION (Fallback)
// ═══════════════════════════════════════════════════════════════════════════

function decomposeWithRules(query: string): DecomposedQuery {
  const queryLower = query.toLowerCase();

  // Detect intent
  const intent: QueryIntent = {
    primaryGoal: detectPrimaryGoal(queryLower),
    requiresVerification: detectVerificationRequired(queryLower),
    requiresSkepticism: detectSkepticismRequired(queryLower),
    timelinessRequired: detectTimelinessRequired(queryLower),
    depth: detectDepth(queryLower),
  };

  // Extract entities
  const entities = extractEntitiesWithRules(query);

  // Extract relationships
  const relationships = extractRelationshipsWithRules(query, entities);

  // Generate sub-questions
  const subQuestions = generateSubQuestions(query, entities, intent);

  // Extract hypotheses
  const hypotheses = extractHypothesesWithRules(query);

  // Time constraints
  const timeConstraints = extractTimeConstraints(queryLower);

  // Verification requests
  const verificationRequests = extractVerificationRequests(queryLower);

  return {
    originalQuery: query,
    intent,
    subQuestions,
    hypotheses,
    entities,
    relationships,
    timeConstraints,
    verificationRequests,
  };
}

function detectPrimaryGoal(query: string): QueryIntent["primaryGoal"] {
  if (query.includes("verify") || query.includes("confirm") || query.includes("check")) {
    return "verification";
  }
  if (query.includes("hypothesis") || query.includes("theory") || query.includes("think") ||
      query.includes("believe") || query.includes("can be wrong")) {
    return "hypothesis_testing";
  }
  if (query.includes("relationship") || query.includes("connected") || query.includes("link")) {
    return "relationship_mapping";
  }
  return "research";
}

function detectVerificationRequired(query: string): boolean {
  return query.includes("verify") || query.includes("confirm") ||
         query.includes("check") || query.includes("true") ||
         query.includes("accurate") || query.includes("due diligence");
}

function detectSkepticismRequired(query: string): boolean {
  return query.includes("honest") || query.includes("critique") ||
         query.includes("wrong") || query.includes("skeptic") ||
         query.includes("critical") || query.includes("brutally");
}

function detectTimelinessRequired(query: string): boolean {
  return query.includes("recent") || query.includes("news") ||
         query.includes("acquisition") || query.includes("latest") ||
         query.includes("announced") || query.includes("2024") ||
         query.includes("2025") || query.includes("2026");
}

function detectDepth(query: string): QueryIntent["depth"] {
  const wordCount = query.split(/\s+/).length;

  if (query.includes("deep") || query.includes("comprehensive") ||
      query.includes("thorough") || query.includes("fully") ||
      wordCount > 100) {
    return "exhaustive";
  }
  if (query.includes("detailed") || wordCount > 50) {
    return "comprehensive";
  }
  if (query.includes("quick") || query.includes("brief") || wordCount < 20) {
    return "quick";
  }
  return "standard";
}

function extractEntitiesWithRules(query: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  // Extract LinkedIn URLs
  const linkedinMatches = query.matchAll(/https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9-]+)\/?/gi);
  for (const match of linkedinMatches) {
    const handle = match[1];
    if (!seen.has(handle)) {
      seen.add(handle);
      entities.push({
        name: handle,
        type: "person",
        identifiers: { linkedinUrl: match[0] },
        mentionedClaims: [],
      });
    }
  }

  // Extract proper nouns (capitalized words not at sentence start)
  const properNounPattern = /(?:^|\.\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
  const matches = query.matchAll(properNounPattern);

  for (const match of matches) {
    const name = match[1];
    if (name.length < 3 || seen.has(name.toLowerCase())) continue;

    // Skip common words
    const commonWords = ["the", "this", "that", "here", "there", "what", "when", "where", "why", "how",
                         "does", "can", "will", "would", "could", "should", "may", "might", "must"];
    if (commonWords.includes(name.toLowerCase())) continue;

    seen.add(name.toLowerCase());

    // Infer type from context
    const context = query.toLowerCase();
    let type: ExtractedEntity["type"] = "concept";

    if (context.includes(name.toLowerCase() + " ceo") ||
        context.includes(name.toLowerCase() + " founder") ||
        context.includes("mr " + name.toLowerCase()) ||
        context.includes("ms " + name.toLowerCase())) {
      type = "person";
    } else if (context.includes(name.toLowerCase() + " inc") ||
               context.includes(name.toLowerCase() + " llc") ||
               context.includes(name.toLowerCase() + " company") ||
               context.includes("at " + name.toLowerCase())) {
      type = "company";
    }

    entities.push({
      name,
      type,
      identifiers: {},
      mentionedClaims: extractClaimsAboutEntity(query, name),
    });
  }

  // Known company names to detect
  const knownCompanies = ["Meta", "Google", "Manus", "OpenAI", "Anthropic", "Microsoft"];
  for (const company of knownCompanies) {
    if (query.includes(company) && !seen.has(company.toLowerCase())) {
      seen.add(company.toLowerCase());
      entities.push({
        name: company,
        type: "company",
        identifiers: {},
        mentionedClaims: extractClaimsAboutEntity(query, company),
      });
    }
  }

  return entities;
}

function extractClaimsAboutEntity(query: string, entityName: string): string[] {
  const claims: string[] = [];
  const sentences = query.split(/[.!?]+/);

  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(entityName.toLowerCase()) &&
        sentence.length > 20) {
      claims.push(sentence.trim());
    }
  }

  return claims.slice(0, 5); // Max 5 claims per entity
}

function extractRelationshipsWithRules(
  query: string,
  entities: ExtractedEntity[]
): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  // Relationship patterns
  const patterns = [
    { regex: /(\w+)\s+(?:acquired|bought|purchased)\s+(\w+)/gi, type: "acquired" },
    { regex: /(\w+)\s+(?:works?\s+(?:at|for))\s+(\w+)/gi, type: "works_for" },
    { regex: /(\w+)\s+(?:founded|created|started)\s+(\w+)/gi, type: "founded" },
    { regex: /(\w+)\s+(?:joined|joined)\s+(\w+)/gi, type: "joined" },
    { regex: /(\w+)\s+(?:partners?\s+with)\s+(\w+)/gi, type: "partners_with" },
    { regex: /(\w+)\s+(?:and)\s+(\w+)/gi, type: "associated" },
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(query)) !== null) {
      const e1 = match[1];
      const e2 = match[2];

      // Check if entities are known
      const entity1 = entities.find(e => e.name.toLowerCase() === e1.toLowerCase());
      const entity2 = entities.find(e => e.name.toLowerCase() === e2.toLowerCase());

      if (entity1 || entity2) {
        relationships.push({
          entity1: e1,
          entity2: e2,
          relationshipType: pattern.type,
          confidence: 0.7,
          isHypothetical: false,
        });
      }
    }
  }

  // Detect hypothetical relationships
  const hypotheticalPatterns = [
    /(\w+)\s+(?:can|could|would|might)\s+(?:benefit|help|acquire|partner)/gi,
    /(\w+)\s+(?:should|may)\s+(?:work\s+with|join|acquire)/gi,
  ];

  for (const pattern of hypotheticalPatterns) {
    let match;
    while ((match = pattern.exec(query)) !== null) {
      const entity = match[1];
      if (entities.some(e => e.name.toLowerCase() === entity.toLowerCase())) {
        // Find mentioned second entity in same sentence
        const sentence = query.slice(Math.max(0, match.index - 50), match.index + 100);
        for (const e of entities) {
          if (e.name.toLowerCase() !== entity.toLowerCase() &&
              sentence.toLowerCase().includes(e.name.toLowerCase())) {
            relationships.push({
              entity1: entity,
              entity2: e.name,
              relationshipType: "hypothetical_connection",
              confidence: 0.3,
              isHypothetical: true,
            });
          }
        }
      }
    }
  }

  return relationships;
}

function generateSubQuestions(
  query: string,
  entities: ExtractedEntity[],
  intent: QueryIntent
): SubQuestion[] {
  const subQuestions: SubQuestion[] = [];
  let priority = 1;

  // Generate questions for each entity
  for (const entity of entities) {
    if (entity.type === "person") {
      subQuestions.push({
        id: `sq-${priority}`,
        question: `Who is ${entity.name}? What is their background, role, and expertise?`,
        type: "who",
        targetEntity: entity.name,
        targetEntityType: "person",
        priority: priority++,
        dependencies: [],
        assignedAgent: "person",
      });
    } else if (entity.type === "company") {
      subQuestions.push({
        id: `sq-${priority}`,
        question: `What is ${entity.name}? What do they do, and what is their current status?`,
        type: "what",
        targetEntity: entity.name,
        targetEntityType: "company",
        priority: priority++,
        dependencies: [],
        assignedAgent: "company",
      });
    }
  }

  // Add verification questions if needed
  if (intent.requiresVerification) {
    subQuestions.push({
      id: `sq-${priority}`,
      question: "What claims in the query need verification? Are they accurate?",
      type: "verify",
      priority: priority++,
      dependencies: [],
      assignedAgent: "verification",
    });
  }

  // Add news question if timely
  if (intent.timelinessRequired) {
    subQuestions.push({
      id: `sq-${priority}`,
      question: "What recent news or events are relevant to this query?",
      type: "when",
      priority: priority++,
      dependencies: [],
      assignedAgent: "news",
    });
  }

  // Add relationship question
  if (entities.length >= 2) {
    subQuestions.push({
      id: `sq-${priority}`,
      question: `How are ${entities.map(e => e.name).join(", ")} connected?`,
      type: "relationship",
      priority: priority++,
      dependencies: subQuestions.map(q => q.id),
      assignedAgent: "relationship",
    });
  }

  return subQuestions;
}

function extractHypothesesWithRules(query: string): ExtractedHypothesis[] {
  const hypotheses: ExtractedHypothesis[] = [];
  const sentences = query.split(/[.!?]+/);

  const hypothesisIndicators = [
    "can", "could", "would", "might", "may", "should",
    "believe", "think", "suspect", "hypothesis", "theory",
    "because", "since", "therefore", "aligns", "narrative",
  ];

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();

    if (hypothesisIndicators.some(ind => sentenceLower.includes(ind)) &&
        sentence.length > 30) {
      hypotheses.push({
        id: `hyp-${hypotheses.length + 1}`,
        statement: sentence.trim(),
        confidence: 0.5,
        claimsToVerify: extractVerifiableClaims(sentence),
        impliedRelationships: [],
      });
    }
  }

  return hypotheses;
}

function extractVerifiableClaims(sentence: string): string[] {
  const claims: string[] = [];

  // Look for factual assertions
  const factPatterns = [
    /(\w+)\s+(?:is|are|was|were)\s+[^,]+/gi,
    /(\w+)\s+(?:has|have|had)\s+[^,]+/gi,
    /(\w+)\s+(?:trains?|builds?|creates?|scales?)\s+[^,]+/gi,
  ];

  for (const pattern of factPatterns) {
    const matches = sentence.matchAll(pattern);
    for (const match of matches) {
      if (match[0].length > 10 && match[0].length < 100) {
        claims.push(match[0].trim());
      }
    }
  }

  return claims.slice(0, 5);
}

function extractTimeConstraints(query: string): TimeConstraint | undefined {
  const recentNewsRequired = query.includes("recent") || query.includes("news") ||
                              query.includes("latest") || query.includes("announced");

  // Extract date range if mentioned
  const yearMatch = query.match(/20\d{2}/);
  const monthMatch = query.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);

  if (recentNewsRequired || yearMatch) {
    return {
      recentNewsRequired,
      dateRange: yearMatch ? {
        start: `${yearMatch[0]}-01-01`,
        end: `${yearMatch[0]}-12-31`,
      } : undefined,
    };
  }

  return undefined;
}

function extractVerificationRequests(query: string): string[] {
  const requests: string[] = [];

  if (query.includes("verify")) requests.push("Verify all factual claims");
  if (query.includes("honest") || query.includes("brutally")) requests.push("Provide honest assessment including counter-evidence");
  if (query.includes("critique")) requests.push("Critically evaluate the hypothesis");
  if (query.includes("wrong")) requests.push("Identify where the hypothesis may be incorrect");
  if (query.includes("due diligence")) requests.push("Perform thorough due diligence verification");

  return requests;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { decomposeWithRules as decomposeQuerySync };
