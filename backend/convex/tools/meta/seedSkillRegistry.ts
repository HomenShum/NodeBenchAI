"use node";

/**
 * Skill Registry Seeding
 *
 * Seeds the skills table with core workflow definitions.
 * Based on Anthropic's Skills specification (v1.0, October 2025).
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// SKILL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

interface SkillDefinition {
  name: string;
  description: string;
  fullInstructions: string;
  category: string;
  categoryName: string;
  keywords: string[];
  allowedTools?: string[];
  license?: string;
}

const CORE_SKILLS: SkillDefinition[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 1: Company Research
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "company-research",
    description: "Research a company comprehensively including SEC filings, news, media, and create a dossier document",
    category: "research",
    categoryName: "Research Workflows",
    keywords: ["company", "research", "dossier", "SEC", "filings", "news", "analysis", "due diligence"],
    allowedTools: ["searchAvailableTools", "describeTools", "invokeTool", "delegateToAgent"],
    license: "Apache-2.0",
    fullInstructions: `## Company Research Workflow

### Overview
This skill guides you through comprehensive company research, combining SEC filings, news, media, and web data into a structured dossier.

### Step 1: Identify the Company
1. Confirm the company name and ticker symbol
2. If ambiguous, search SEC EDGAR to find the correct CIK
3. Note any subsidiaries or related entities

### Step 2: Gather SEC Filings
1. Use \`delegateToAgent({ agentType: "sec" })\` to:
   - Fetch recent 10-K (annual) and 10-Q (quarterly) filings
   - Extract key financial metrics
   - Identify risk factors and management discussion
2. Summarize findings in structured format

### Step 3: Collect News & Media
1. Use \`delegateToAgent({ agentType: "media" })\` to:
   - Search for recent news articles
   - Find relevant YouTube videos and interviews
   - Gather analyst reports if available
2. Prioritize sources by recency and credibility

### Step 4: Research Founders & Leadership
1. Use \`delegateToAgent({ agentType: "entity" })\` to:
   - Research key executives and founders
   - Find LinkedIn profiles and backgrounds
   - Identify board members and advisors

### Step 5: Competitive Analysis
1. Identify 3-5 key competitors
2. Compare market positioning
3. Note competitive advantages and threats

### Step 6: Create Dossier Document
1. Use \`invokeTool({ toolName: "createDocument" })\` to create a new dossier
2. Structure the document with sections:
   - Executive Summary
   - Company Overview
   - Financial Highlights
   - Leadership Team
   - Recent News & Developments
   - Competitive Landscape
   - Key Risks
   - Sources & References

### Output Format
Return a summary of findings and the created dossier document ID.`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 2: Document Creation
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "document-creation",
    description: "Create well-structured documents with proper formatting, sections, and content organization",
    category: "document",
    categoryName: "Document Management",
    keywords: ["document", "create", "write", "format", "structure", "template", "report", "memo"],
    allowedTools: ["createDocument", "updateDocument", "searchDocuments"],
    license: "Apache-2.0",
    fullInstructions: `## Document Creation Workflow

### Overview
This skill guides you through creating well-structured documents with proper formatting and organization.

### Step 1: Understand Requirements
1. Clarify the document type (report, memo, analysis, notes)
2. Identify the target audience
3. Determine required sections and length

### Step 2: Create Document Structure
1. Use \`invokeTool({ toolName: "createDocument" })\` with:
   - Descriptive title
   - Appropriate document type
2. Plan the section hierarchy:
   - Main headings (H1)
   - Subheadings (H2, H3)
   - Bullet points for lists

### Step 3: Draft Content
1. Write clear, concise content for each section
2. Use formatting appropriately:
   - **Bold** for emphasis
   - *Italics* for terms
   - \`Code\` for technical content
   - > Blockquotes for citations

### Step 4: Add Supporting Elements
1. Include relevant links and references
2. Add tables for structured data
3. Reference related documents if applicable

### Step 5: Review and Polish
1. Check for logical flow
2. Verify formatting consistency
3. Ensure all sections are complete

### Document Types
- **Dossier**: Research compilation with sources
- **Report**: Formal analysis with conclusions
- **Notes**: Quick capture of information
- **Memo**: Brief communication
- **Template**: Reusable structure

### Output Format
Return the document ID and a brief summary of what was created.`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 3: Media Research
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "media-research",
    description: "Discover and analyze media content including videos, news articles, and images for a topic",
    category: "media",
    categoryName: "Media Discovery",
    keywords: ["media", "video", "youtube", "news", "images", "search", "discover", "content"],
    allowedTools: ["delegateToAgent", "searchAvailableTools", "invokeTool"],
    license: "Apache-2.0",
    fullInstructions: `## Media Research Workflow

### Overview
This skill guides you through discovering and analyzing media content across multiple sources.

### Step 1: Define Search Scope
1. Clarify the topic or entity to research
2. Determine media types needed:
   - Videos (YouTube, interviews)
   - News articles
   - Images and infographics
   - Podcasts or audio content

### Step 2: Video Discovery
1. Use \`delegateToAgent({ agentType: "media" })\` to:
   - Search YouTube for relevant videos
   - Find interviews and presentations
   - Identify educational content
2. Prioritize by:
   - View count and engagement
   - Recency
   - Source credibility

### Step 3: News Collection
1. Search for recent news articles
2. Include multiple sources for balance
3. Note publication dates and authors

### Step 4: Image Search
1. Find relevant images and infographics
2. Verify image sources and rights
3. Prioritize high-quality visuals

### Step 5: Organize Findings
1. Group media by type and relevance
2. Create summaries for key pieces
3. Note any conflicting information

### Step 6: Create Media Summary
1. Compile findings into a structured format:
   - Top Videos (with links and descriptions)
   - Key News Articles (with summaries)
   - Notable Images (with context)
   - Recommended Content (prioritized list)

### Output Format
Return a structured media summary with links, descriptions, and recommendations.`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 4: Financial Analysis
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "financial-analysis",
    description: "Analyze financial data from SEC filings, market data, and create financial summaries",
    category: "financial",
    categoryName: "Financial Analysis",
    keywords: ["financial", "SEC", "10-K", "10-Q", "earnings", "revenue", "analysis", "metrics", "stocks"],
    allowedTools: ["delegateToAgent", "searchAvailableTools", "invokeTool"],
    license: "Apache-2.0",
    fullInstructions: `## Financial Analysis Workflow

### Overview
This skill guides you through comprehensive financial analysis using SEC filings and market data.

### Step 1: Identify the Company
1. Confirm company name and ticker symbol
2. Find the CIK number for SEC lookups
3. Note the fiscal year end date

### Step 2: Gather SEC Filings
1. Use \`delegateToAgent({ agentType: "sec" })\` to:
   - Fetch most recent 10-K (annual report)
   - Fetch recent 10-Q (quarterly reports)
   - Get 8-K filings for material events
2. Extract key sections:
   - Financial statements
   - Management Discussion & Analysis (MD&A)
   - Risk factors

### Step 3: Extract Key Metrics
1. Revenue and revenue growth
2. Net income and margins
3. Cash flow from operations
4. Debt levels and ratios
5. Key performance indicators (KPIs)

### Step 4: Market Data (if available)
1. Use \`delegateToAgent({ agentType: "openbb" })\` for:
   - Current stock price and market cap
   - Historical price performance
   - Analyst ratings and price targets
   - Peer comparisons

### Step 5: Trend Analysis
1. Compare metrics across periods
2. Identify growth or decline patterns
3. Note any significant changes

### Step 6: Create Financial Summary
1. Structure the analysis:
   - Company Overview
   - Key Financial Metrics (table format)
   - Revenue & Profitability Trends
   - Balance Sheet Highlights
   - Cash Flow Analysis
   - Risk Factors
   - Outlook & Recommendations

### Output Format
Return a structured financial summary with key metrics, trends, and analysis.`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 5: Bulk Entity Research
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "bulk-entity-research",
    description: "Research multiple companies or entities in parallel with criteria-based filtering and CSV export",
    category: "research",
    categoryName: "Research Workflows",
    keywords: ["bulk", "batch", "multiple", "companies", "entities", "list", "CSV", "export", "parallel"],
    allowedTools: ["delegateToAgent", "searchAvailableTools", "invokeTool"],
    license: "Apache-2.0",
    fullInstructions: `## Bulk Entity Research Workflow

### Overview
This skill guides you through researching multiple companies or entities efficiently with parallel processing.

### Step 1: Define Entity List
1. Get the list of companies/entities to research
2. Options for input:
   - Named list (e.g., "Apple, Google, Microsoft")
   - Criteria-based (e.g., "healthcare startups, seed stage, founded after 2022")
3. Confirm the list before proceeding

### Step 2: Define Research Fields
1. Standard CRM fields:
   - Company name and HQ location
   - Founders and key executives
   - Contact information (phones, emails)
   - Company description and product
   - Industry and stage
2. Optional fields:
   - FDA timeline (for healthcare)
   - News timeline with sources
   - Investors and their backgrounds
   - Competitors with rationale
   - Research papers

### Step 3: Parallel Research Execution
1. For each entity in the list:
   - Use \`delegateToAgent({ agentType: "entity" })\` for basic info
   - Use \`delegateToAgent({ agentType: "media" })\` for news
   - Use \`delegateToAgent({ agentType: "sec" })\` for public companies
2. Execute in parallel batches (3-5 at a time)
3. Collect and normalize results

### Step 4: Apply Filters (if criteria-based)
1. Filter by funding stage
2. Filter by industry/sector
3. Filter by founding year
4. Filter by founder experience
5. Remove entities that don't match criteria

### Step 5: Compile Results
1. Aggregate all research into structured format
2. Normalize field names and values
3. Handle missing data gracefully

### Step 6: Export to CSV
1. Create CSV with columns for each field
2. Include source URLs where available
3. Add timestamp and research date

### Output Format
Return:
- Summary of entities researched
- Count of matches (if filtered)
- CSV file or structured data for export`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 6: Persona Inference (Dynamic Skills for Evaluation)
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "persona-inference",
    description: "Infer the correct professional persona from a user query by analyzing keywords and context. Critical for evaluation and entity research workflows.",
    category: "evaluation",
    categoryName: "Evaluation & Quality",
    keywords: [
      "persona", "infer", "classify", "detect", "VC", "banker", "CTO", "quant",
      "product", "sales", "founder", "exec", "academic", "partner", "evaluation"
    ],
    allowedTools: ["lookupGroundTruthEntity", "evaluateEntityForPersona"],
    license: "Apache-2.0",
    fullInstructions: `## Persona Inference Skill

### Overview
This skill helps you correctly identify the professional persona that best matches a user's query.
**CRITICAL**: DO NOT default to JPM_STARTUP_BANKER unless explicitly warranted.

### Step 1: Scan for Keyword Cues
Analyze the query for these PRIORITY keywords (check in this exact order):

| Keywords Found | → Use Persona |
|----------------|---------------|
| wedge, thesis, comps, market fit, TAM, investment | EARLY_STAGE_VC |
| signal, metrics, track, time-series, forecast, backtest | QUANT_ANALYST |
| schema, UI, card, rendering, JSON fields, display | PRODUCT_DESIGNER |
| share-ready, one-screen, objections, CTA, send to customer | SALES_ENGINEER |
| CVE, security, patch, upgrade, dependency, vulnerability | CTO_TECH_LEAD |
| partnerships, ecosystem, second-order, platform effects | ECOSYSTEM_PARTNER |
| positioning, strategy, pivot, moat, go-to-market | FOUNDER_STRATEGY |
| pricing, vendor, cost, procurement, P&L, compliance | ENTERPRISE_EXEC |
| papers, methodology, literature, citations, replication | ACADEMIC_RD |
| outreach, pipeline, "this week", contact, talk track | JPM_STARTUP_BANKER |

### Step 2: Apply Priority Rules
1. The FIRST keyword match wins - stop checking once you find a match
2. If NO keywords match AND the query is just an entity name with no context:
   - Use JPM_STARTUP_BANKER as the default (most common use case)
3. If NO keywords match BUT there IS context:
   - Analyze the context to determine the most relevant persona
   - State your reasoning in the response

### Step 3: Validate Your Choice
Before committing to a persona:
1. Re-read the query to ensure you didn't miss a stronger keyword cue
2. If the query mentions "wedge" - it's ALWAYS EARLY_STAGE_VC (not banker)
3. If the query mentions "signal" or "track" - it's ALWAYS QUANT_ANALYST
4. If the query mentions "schema" or "UI" - it's ALWAYS PRODUCT_DESIGNER

### Step 4: Set Persona in Output
In your DEBRIEF_V1_JSON:
\`\`\`json
{
  "persona": {
    "inferred": "<CORRECT_PERSONA>",
    "confidence": 0.8,
    "assumptions": ["<why you chose this persona>"]
  }
}
\`\`\`

### Common Mistakes to Avoid
- ❌ Defaulting to JPM_STARTUP_BANKER when "wedge" is in the query
- ❌ Defaulting to JPM_STARTUP_BANKER when "signal" or "metrics" is in the query
- ❌ Ignoring clear non-banker cues in the query
- ❌ Not stating assumptions when the persona wasn't explicitly requested

### Output Format
Include the inferred persona at the start of your response:
"[Inferred persona: EARLY_STAGE_VC based on 'wedge' and 'thesis' keywords]"`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 7: VC Thesis Evaluation
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "vc-thesis-evaluation",
    description: "Evaluate a company from an early-stage VC perspective: wedge, thesis, comps, TAM, and investment rationale",
    category: "evaluation",
    categoryName: "Evaluation & Quality",
    keywords: [
      "VC", "venture capital", "thesis", "wedge", "comps", "TAM", "investment",
      "market fit", "early stage", "seed", "series A", "competitive"
    ],
    allowedTools: ["getBankerGradeEntityInsights", "evaluateEntityForPersona", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## VC Thesis Evaluation Skill

### Overview
Evaluate an entity from an EARLY_STAGE_VC perspective with thesis generation and competitive mapping.

### Persona: EARLY_STAGE_VC
**Definition of Done:**
- Investment thesis clearly articulated
- Wedge identified (unique entry point)
- Competitive landscape mapped
- "What would change my mind" reasoning
- TAM/SAM/SOM if available

### Step 1: Identify the Wedge
The "wedge" is the company's unique angle or timing advantage:
- What's the non-obvious insight?
- Why now? Why this team?
- What structural change enables this opportunity?

### Step 2: Build Investment Thesis
Structure as:
1. **Problem**: What pain point exists?
2. **Solution**: How does this company solve it?
3. **Why Now**: Timing/market dynamics
4. **Why This Team**: Founder-market fit
5. **Market Size**: TAM, growth trajectory

### Step 3: Competitive Mapping
- Identify 3-5 direct competitors
- Map positioning (feature matrix if possible)
- Note defensibility (moat, network effects, switching costs)

### Step 4: Risk Assessment
- Execution risks
- Market risks
- Regulatory risks
- "What would change my mind" - articulate the bull/bear cases

### Output Template
\`\`\`
## [Company] - VC Thesis

**Investment Thesis**: [2-3 sentences]

**Wedge**: [The non-obvious insight]

**Why It Matters**: [Market dynamics]

**Competitive Map**:
| Company | Focus | Funding | Key Differentiator |
|---------|-------|---------|-------------------|
| ... | ... | ... | ... |

**What Would Change My Mind**: [Bear case]

**Risks**: [Top 3]

**Next Steps**: [Recommended actions]

**Grounding**: [Sources]
\`\`\``,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 8: Quant Signal Analysis
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "quant-signal-analysis",
    description: "Extract quantitative signals, metrics, and time-series data for analysis and tracking",
    category: "evaluation",
    categoryName: "Evaluation & Quality",
    keywords: [
      "quant", "signal", "metrics", "time-series", "track", "forecast",
      "backtest", "regression", "data", "variables", "KPI"
    ],
    allowedTools: ["getBankerGradeEntityInsights", "evaluateEntityForPersona", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Quant Signal Analysis Skill

### Overview
Extract and structure quantitative signals for QUANT_ANALYST persona.

### Persona: QUANT_ANALYST
**Definition of Done:**
- Structured signal table with variables
- Data gaps identified
- Tracking recommendations
- Numerical precision (no vague estimates)

### Step 1: Identify Trackable Signals
For the entity, identify:
- Revenue/growth metrics
- Engagement metrics (DAU, MAU, retention)
- Market metrics (share, penetration)
- Operational metrics (efficiency, margins)
- External signals (news sentiment, job postings)

### Step 2: Structure Signal Table
| Signal | Current Value | Frequency | Source | Reliability |
|--------|--------------|-----------|--------|-------------|
| Revenue | $X.XM | Quarterly | SEC 10-Q | High |
| DAU | X.XM | Monthly | Press releases | Medium |
| ... | ... | ... | ... | ... |

### Step 3: Identify Data Gaps
- What metrics are NOT available?
- What proxies could be used?
- What would need to be estimated vs. measured?

### Step 4: Recommend Tracking Plan
- Which signals should be monitored?
- At what frequency?
- What thresholds trigger alerts?

### Output Template
\`\`\`
## [Entity] - Quant Signal Summary

**Key Variables to Track**:
| Variable | Current | Target | Source |
|----------|---------|--------|--------|
| ... | ... | ... | ... |

**Data Gaps**: [What's missing]

**Signal Reliability**: [Assessment of data quality]

**Next Steps**: [Tracking recommendations]

**Grounding**: [Sources]
\`\`\``,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 9: Product Designer Schema
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "product-designer-schema",
    description: "Generate UI-ready schema/card fields with display priorities and null handling for product design",
    category: "evaluation",
    categoryName: "Evaluation & Quality",
    keywords: [
      "product", "designer", "UI", "schema", "card", "rendering", "JSON",
      "fields", "display", "null handling", "structure"
    ],
    allowedTools: ["getBankerGradeEntityInsights", "evaluateEntityForPersona", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Product Designer Schema Skill

### Overview
Generate structured, UI-ready data for PRODUCT_DESIGNER persona.

### Persona: PRODUCT_DESIGNER
**Definition of Done:**
- Schema with typed fields
- Display priority ranking
- Null handling strategy
- Sample rendering guidance

### Step 1: Define Schema Fields
For the entity, define:
\`\`\`typescript
interface EntityCard {
  // Primary (always shown)
  name: string;
  type: "company" | "person" | "project";
  tagline?: string;

  // Secondary (shown if space permits)
  hqLocation?: string;
  fundingStage?: string;
  industry?: string;

  // Tertiary (expandable/detail view)
  founders?: string[];
  fundingAmount?: { amount: number; currency: string; unit: string };
  contactEmail?: string;
}
\`\`\`

### Step 2: Set Display Priorities
1. **P1 (Always visible)**: name, type, tagline
2. **P2 (Summary view)**: hqLocation, fundingStage, industry
3. **P3 (Detail view)**: founders, fundingAmount, contactEmail

### Step 3: Null Handling Strategy
- Use "—" for missing required fields
- Hide optional fields if null (don't show empty)
- Use "Unknown" only for fields where absence is meaningful

### Step 4: Rendering Guidance
- Card width constraints (min/max)
- Typography hierarchy
- Icon/badge recommendations
- Color coding for status

### Output Template
\`\`\`json
{
  "schema": { /* TypeScript-style schema */ },
  "displayPriority": {
    "P1": ["name", "type"],
    "P2": ["hqLocation", "fundingStage"],
    "P3": ["founders", "fundingAmount"]
  },
  "nullHandling": {
    "name": "REQUIRED",
    "tagline": "HIDE_IF_NULL",
    "fundingAmount": "SHOW_DASH"
  },
  "sampleData": { /* Populated example */ }
}
\`\`\``,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 10: Sales Engineer Summary
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "sales-engineer-summary",
    description: "Create share-ready, one-screen summaries with objection handling and CTA for sales enablement",
    category: "evaluation",
    categoryName: "Evaluation & Quality",
    keywords: [
      "sales", "engineer", "share-ready", "one-screen", "summary", "objections",
      "CTA", "customer", "outbound", "enablement", "send"
    ],
    allowedTools: ["getBankerGradeEntityInsights", "evaluateEntityForPersona", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Sales Engineer Summary Skill

### Overview
Create share-ready content for SALES_ENGINEER persona.

### Persona: SALES_ENGINEER
**Definition of Done:**
- Single-screen summary (fits above the fold)
- 3 key bullets
- Objection handling prepared
- Clear CTA

### Step 1: One-Screen Summary
Fit everything in ~200 words:
- **Headline**: What this entity does in one line
- **3 Bullets**: Core value propositions
- **Proof Point**: One compelling metric or case study

### Step 2: Prepare Objection Handling
Anticipate common objections:
| Objection | Response |
|-----------|----------|
| "Too expensive" | [Value justification] |
| "We already use X" | [Differentiation] |
| "Not proven yet" | [Validation/references] |

### Step 3: Define Clear CTA
What's the next action?
- "Schedule a demo"
- "Review technical docs"
- "Connect with reference customer"

### Output Template
\`\`\`
# [Entity] - One-Screen Summary

**What they do**: [One sentence]

**Why it matters**:
• [Bullet 1]
• [Bullet 2]
• [Bullet 3]

**Proof point**: [Key metric/case study]

**Objection handling**: [Prepared responses]

**Next step**: [CTA]

---
*Ready to send to customer*
\`\`\``,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 11: Meeting Scheduler
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "meeting-scheduler",
    description: "Schedule meetings with calendar availability checking and conflict detection",
    category: "workflow",
    categoryName: "Workflow & Automation",
    keywords: ["schedule", "meeting", "calendar", "availability", "book", "appointment", "time slot"],
    allowedTools: ["listEvents", "createEvent"],
    license: "Apache-2.0",
    fullInstructions: `## Meeting Scheduler Skill

### Overview
This skill guides you through scheduling meetings with proper availability checking.

### Step 1: Check Availability
1. Call \`listEvents\` for the requested date range to identify free slots
2. Parse the calendar to find open time windows
3. Consider typical meeting lengths (30min, 1hr)

### Step 2: Propose Options
1. Present 2-3 available time slots to the user
2. Note any nearby conflicts or back-to-back meetings
3. Consider time zone if mentioned

### Step 3: Confirm and Create
1. After user selects a slot, gather meeting details:
   - Title
   - Duration
   - Location (optional)
   - Description (optional)
2. Call \`createEvent\` with the confirmed details
3. Confirm the event was created successfully

### Output Format
- "I found these available slots: [list with times]"
- "Created: [event title] on [date/time]"

### Error Handling
- If no slots available: suggest alternative dates
- If conflict detected: warn user before creating
- If creation fails: report error and suggest retry
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 12: Email Outreach
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "email-outreach",
    description: "Draft and send professional outreach emails with context awareness",
    category: "workflow",
    categoryName: "Workflow & Automation",
    keywords: ["email", "outreach", "send", "draft", "message", "contact", "follow-up"],
    allowedTools: ["sendEmail", "queryMemory", "searchTeachings"],
    license: "Apache-2.0",
    fullInstructions: `## Email Outreach Skill

### Overview
This skill guides you through composing and sending professional outreach emails.

### Step 1: Gather Context
1. Search for relevant context about the recipient using \`queryMemory\`
2. Check for prior communications or relationship notes
3. Identify the purpose and desired outcome

### Step 2: Draft Email
1. Use professional business email format
2. Keep subject line clear and actionable
3. Structure body:
   - Opening: personalized greeting
   - Context: why you're reaching out
   - Value prop: what's in it for them
   - CTA: specific next step
   - Closing: professional sign-off

### Step 3: Review and Send
1. Show the draft to the user for approval
2. Confirm recipient email address
3. Call \`sendEmail\` with confirmed content
4. Report success/failure

### Output Format
\`\`\`
Subject: [subject line]
To: [recipient]

[email body]

---
Ready to send? (yes/no)
\`\`\`

### Guidelines
- Keep emails concise (under 200 words ideal)
- One clear call-to-action per email
- Avoid jargon unless recipient is technical
- Include context for cold outreach
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 13: Document Section Enrichment
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "document-section-enrichment",
    description: "Enrich a document section with additional research, data, and citations",
    category: "document",
    categoryName: "Document Operations",
    keywords: ["expand", "enrich", "section", "detail", "document", "elaborate", "research", "citation"],
    allowedTools: ["enrichDataPoint", "updateNarrativeSection", "lookupGroundTruthEntity", "getBankerGradeEntityInsights"],
    license: "Apache-2.0",
    fullInstructions: `## Document Section Enrichment Skill

### Overview
This skill guides you through enriching a document section with additional context, data, and citations.

### Step 1: Analyze Current Content
1. Read the target section to understand existing content
2. Identify gaps: missing data, weak claims, areas needing elaboration
3. Note existing citations and grounding anchors

### Step 2: Research Gaps
1. Use \`lookupGroundTruthEntity\` for verified facts about entities mentioned
2. Use \`getBankerGradeEntityInsights\` for deeper analysis if needed
3. Use \`enrichDataPoint\` to gather specific data points:
   - Financial metrics
   - Market data
   - Recent developments

### Step 3: Update Section
1. Use \`updateNarrativeSection\` to integrate new content:
   - Add data points with proper citations
   - Expand thin paragraphs with context
   - Ensure smooth transitions
2. Maintain consistent tone and style

### Step 4: Verify
1. Confirm all new facts have grounding anchors
2. Check citations are properly formatted
3. Verify section flows logically

### Output Format
Return the enriched section with:
- New content clearly integrated
- Citations in [source] format
- Brief summary of changes made

### Guidelines
- Preserve original voice and style
- Add value, don't pad with filler
- Every new fact needs a source
- Max section size: 2000 tokens
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 14: Document Citation Audit
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "document-citation-audit",
    description: "Audit and fix citations in a document for accuracy and completeness",
    category: "document",
    categoryName: "Document Operations",
    keywords: ["citation", "audit", "reference", "source", "verify", "grounding", "fact-check"],
    allowedTools: ["generateAnnotation", "getChartContext", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Document Citation Audit Skill

### Overview
This skill guides you through auditing document citations for accuracy and completeness.

### Step 1: Inventory Citations
1. List all citations and grounding anchors in the section
2. Categorize by type: primary source, secondary, data point
3. Flag any claims without citations

### Step 2: Verify Sources
1. For each citation, verify:
   - Source still exists and is accessible
   - Cited content matches the claim
   - Source is authoritative
2. Use \`lookupGroundTruthEntity\` to cross-reference key facts

### Step 3: Fix Issues
1. Replace broken/outdated citations
2. Add citations to unsupported claims
3. Strengthen weak sources with better alternatives
4. Use \`generateAnnotation\` to create proper citation format

### Step 4: Report
Provide audit summary:
- Citations verified: X
- Citations fixed: Y
- Issues remaining: Z

### Output Format
\`\`\`
## Citation Audit Report

### Verified ✓
- [Citation 1] - Valid, authoritative
- [Citation 2] - Valid, cross-referenced

### Fixed 🔧
- [Claim] - Added citation [new source]
- [Old citation] → [New citation]

### Needs Attention ⚠️
- [Claim without available source]
\`\`\`
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL 15: Calendar Availability Check
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "calendar-availability-check",
    description: "Check calendar availability and find open time slots for scheduling",
    category: "workflow",
    categoryName: "Workflow & Automation",
    keywords: ["availability", "calendar", "free", "busy", "open", "slots", "when", "available"],
    allowedTools: ["listEvents"],
    license: "Apache-2.0",
    fullInstructions: `## Calendar Availability Check Skill

### Overview
This skill helps find available time slots by analyzing the calendar.

### Step 1: Define Time Window
1. Clarify the date range to check
2. Confirm working hours (default: 9am-5pm)
3. Note minimum meeting duration needed

### Step 2: Fetch Calendar Data
1. Call \`listEvents\` for the date range
2. Parse events to identify blocked time
3. Account for buffer time between meetings (10-15 min)

### Step 3: Calculate Free Slots
1. Subtract busy time from working hours
2. Group contiguous free time into slots
3. Filter by minimum duration requirement

### Step 4: Present Options
Format availability clearly:
- Date: [available windows]
- Highlight best options (longest gaps, preferred times)

### Output Format
\`\`\`
📅 Availability for [date range]:

Monday 1/8:
  ✓ 9:00am - 11:30am (2.5 hrs)
  ✓ 2:00pm - 5:00pm (3 hrs)

Tuesday 1/9:
  ✓ 10:00am - 12:00pm (2 hrs)
  ⚠️ Otherwise fully booked

Best slot: Monday 1/8, 2:00pm - 5:00pm
\`\`\`
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DIGEST PERSONA SKILLS (16 total)
  // Each persona has a specialized digest generation skill
  // ─────────────────────────────────────────────────────────────────────────

  // Digest Skill 1: JPM Startup Banker
  {
    name: "digest-jpm-startup-banker",
    description: "Generate daily digest focused on funding rounds, M&A activity, deal flow, and investor movements",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "banker", "funding", "M&A", "deal", "investor", "IPO", "fintech"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity", "getBankerGradeEntityInsights"],
    license: "Apache-2.0",
    fullInstructions: `## JPM Startup Banker Digest Skill

### Persona Focus
Funding rounds, M&A activity, deal flow opportunities, investor movements

### Priority Categories
- Funding announcements
- Acquisition news
- IPO signals
- Fintech developments

### Output Structure

#### Act I: The Setup
Lead with the biggest deal or funding round of the day. Frame it as an opportunity signal.

#### Act II: The Signal
- 3-5 stories with hard numbers (round size, valuation, multiples)
- Direct quotes from founders/investors when available
- Secondary market implications

#### Act III: The Move
Generate specific action items:
- Outreach targets (who to contact)
- Secondary opportunities (which LPs might be selling)
- Deal flow insights (which sectors are hot)

### Formatting
- Use 💰 for funding, 📈 for metrics, 💼 for deals
- Include $ amounts prominently
- Link to source when available
`,
  },

  // Digest Skill 2: Early Stage VC
  {
    name: "digest-early-stage-vc",
    description: "Generate daily digest focused on seed/Series A rounds, emerging signals, and thesis validation",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "VC", "seed", "Series A", "startup", "thesis", "investment"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity", "getBankerGradeEntityInsights"],
    license: "Apache-2.0",
    fullInstructions: `## Early Stage VC Digest Skill

### Persona Focus
Seed/Series A rounds, emerging market signals, thesis validation, competitive landscape

### Priority Categories
- Early-stage funding
- Startup launches
- AI/ML developments
- Enterprise opportunities

### Output Structure

#### Act I: The Setup
Lead with emerging market signal or thesis-validating announcement.

#### Act II: The Signal
- 3-5 stories focused on early indicators
- Founder backgrounds and pedigree
- Market timing signals

#### Act III: The Move
Generate specific action items:
- Thesis validation points
- Investment opportunities to evaluate
- Market signals to track

### Formatting
- Use 🚀 for launches, 🌱 for seed, 🔍 for signals
- Highlight founder backgrounds
- Note competitive dynamics
`,
  },

  // Digest Skill 3: CTO Tech Lead
  {
    name: "digest-cto-tech-lead",
    description: "Generate daily digest focused on technical architecture, security, and engineering trends",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "CTO", "tech", "security", "architecture", "engineering", "devtools"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## CTO Tech Lead Digest Skill

### Persona Focus
Technical architecture, security vulnerabilities, adoption patterns, engineering trends

### Priority Categories
- Security advisories
- Open source releases
- Infrastructure updates
- DevTools innovations

### Output Structure

#### Act I: The Setup
Lead with critical security issue or major technical release.

#### Act II: The Signal
- 3-5 stories with technical depth
- CVE numbers and severity ratings
- Adoption metrics and benchmarks

#### Act III: The Move
Generate specific action items:
- Technical risks to review
- Adoption opportunities
- Architecture decisions

### Formatting
- Use ⚙️ for tech, 🛡️ for security, 🔧 for tools
- Include version numbers
- Link to GitHub/docs
`,
  },

  // Digest Skill 4: Founder Strategy
  {
    name: "digest-founder-strategy",
    description: "Generate daily digest focused on market positioning, competitive moves, and strategic pivots",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "founder", "strategy", "competitive", "pivot", "market", "positioning"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Founder Strategy Digest Skill

### Persona Focus
Market positioning, competitive moves, strategic pivots, fundraising signals

### Priority Categories
- Strategic announcements
- Competitive dynamics
- Funding landscape
- Market shifts

### Output Structure

#### Act I: The Setup
Lead with market-defining move or competitive shift.

#### Act II: The Signal
- 3-5 stories about positioning
- Competitive implications
- Market timing insights

#### Act III: The Move
Generate specific action items:
- Strategic pivots to consider
- Market positioning insights
- Competitive responses

### Formatting
- Use ♟️ for strategy, 🎯 for positioning, 💡 for insights
`,
  },

  // Digest Skill 5: Academic R&D
  {
    name: "digest-academic-rd",
    description: "Generate daily digest focused on research papers, methodology, and scientific rigor",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "academic", "research", "paper", "methodology", "study", "science"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Academic R&D Digest Skill

### Persona Focus
Research papers, methodology, replication signals, scientific rigor, limitations

### Priority Categories
- Research publications
- Paper announcements
- Methodology developments
- Study findings

### Output Structure

#### Act I: The Setup
Lead with breakthrough paper or methodology advancement.

#### Act II: The Signal
- 3-5 papers/studies with key findings
- Methodology notes
- Replication considerations

#### Act III: The Move
Generate specific action items:
- Papers to read in depth
- Methods to verify
- Experiments to replicate

### Formatting
- Use 🔬 for research, 📚 for papers, 🧪 for experiments
- Include citation info
- Note limitations
`,
  },

  // Digest Skill 6: Enterprise Exec
  {
    name: "digest-enterprise-exec",
    description: "Generate daily digest focused on vendor risk, procurement, and P&L impact",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "enterprise", "procurement", "vendor", "risk", "governance", "executive"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Enterprise Exec Digest Skill

### Persona Focus
Vendor risk, procurement readiness, unit economics, governance, P&L impact

### Priority Categories
- Pricing changes
- Vendor announcements
- Enterprise features
- Security/compliance

### Output Structure

#### Act I: The Setup
Lead with major vendor move or pricing change.

#### Act II: The Signal
- 3-5 stories with business impact
- Pricing/packaging details
- Risk implications

#### Act III: The Move
Generate specific action items:
- Procurement next steps
- Cost model checkpoints
- Risk mitigations

### Formatting
- Use 🏢 for enterprise, 💰 for costs, 📋 for governance
`,
  },

  // Digest Skill 7: Ecosystem Partner
  {
    name: "digest-ecosystem-partner",
    description: "Generate daily digest focused on partnership plays and ecosystem shifts",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "partner", "ecosystem", "platform", "integration", "alliance"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Ecosystem Partner Digest Skill

### Persona Focus
Partnership plays, second-order effects, beneficiaries, ecosystem shifts

### Priority Categories
- Partnership announcements
- Platform updates
- Ecosystem developments
- Market dynamics

### Output Structure

#### Act I: The Setup
Lead with major partnership or platform shift.

#### Act II: The Signal
- 3-5 stories about ecosystem moves
- Second-order beneficiaries
- Integration opportunities

#### Act III: The Move
Generate specific action items:
- Partner outreach targets
- Co-sell ideas
- Ecosystem bets to validate

### Formatting
- Use 🤝 for partnerships, 🔗 for integrations, 🌐 for ecosystem
`,
  },

  // Digest Skill 8: Quant Analyst
  {
    name: "digest-quant-analyst",
    description: "Generate daily digest focused on signals, metrics, and trackable KPIs",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "quant", "signal", "metrics", "KPI", "data", "analytics"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Quant Analyst Digest Skill

### Persona Focus
Signals, time-series hooks, measurable KPIs, tracking opportunities

### Priority Categories
- Metrics announcements
- Signal indicators
- Timeline events
- Data releases

### Output Structure

#### Act I: The Setup
Lead with significant metric or signal shift.

#### Act II: The Signal
- 3-5 stories with hard numbers
- Time-series implications
- Correlation opportunities

#### Act III: The Move
Generate specific action items:
- Trackable KPIs to monitor
- Data sources to integrate
- Monitoring follow-ups

### Formatting
- Use 📈 for metrics, 📊 for data, 🔍 for signals
- Always include numbers
`,
  },

  // Digest Skill 9: Product Designer
  {
    name: "digest-product-designer",
    description: "Generate daily digest focused on UI patterns, information architecture, and design systems",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "design", "UI", "UX", "product", "schema", "rendering"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Product Designer Digest Skill

### Persona Focus
UI-ready schemas, information architecture, confidence/freshness UX, rendering needs

### Priority Categories
- Product launches
- UI/UX updates
- Design system changes
- Schema updates

### Output Structure

#### Act I: The Setup
Lead with major product or design system update.

#### Act II: The Signal
- 3-5 stories about design patterns
- Information architecture insights
- Rendering considerations

#### Act III: The Move
Generate specific action items:
- UI-ready sections to build
- Missing-field UX to address
- Validation tasks for rendering

### Formatting
- Use 🎨 for design, ✏️ for UI, 🗂️ for architecture
`,
  },

  // Digest Skill 10: Sales Engineer
  {
    name: "digest-sales-engineer",
    description: "Generate daily digest focused on shareable summaries, objection handling, and outbound packaging",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "sales", "engineer", "outbound", "objection", "demo", "talk track"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Sales Engineer Digest Skill

### Persona Focus
Shareable one-screen summaries, objections/answers, talk tracks, outbound packaging

### Priority Categories
- Sales-relevant news
- Outbound opportunities
- Market developments
- Enterprise announcements

### Output Structure

#### Act I: The Setup
Lead with customer-relevant news or competitive move.

#### Act II: The Signal
- 3-5 stories packaged for sharing
- Objection handling angles
- Talk track hooks

#### Act III: The Move
Generate specific action items:
- One-pagers to create
- Talk tracks to develop
- Objection handling prep

### Formatting
- Use 📣 for outbound, 🤝 for sales, 📄 for assets
`,
  },

  // Digest Skill 11: PM Product Manager
  {
    name: "digest-pm-product-manager",
    description: "Generate daily digest focused on product launches, user behavior, and feature adoption",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "PM", "product", "launch", "feature", "user", "roadmap"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## PM Product Manager Digest Skill

### Persona Focus
Product launches, user behavior trends, feature adoption, market needs

### Priority Categories
- Product announcements
- User research signals
- SaaS updates
- Consumer trends

### Output Structure

#### Act I: The Setup
Lead with major product launch or user behavior insight.

#### Act II: The Signal
- 3-5 stories about product trends
- Adoption metrics
- User need signals

#### Act III: The Move
Generate specific action items:
- Roadmap insights
- User need signals to investigate
- Feature prioritization inputs

### Formatting
- Use 📦 for products, 📊 for metrics, 📋 for roadmap
`,
  },

  // Digest Skill 12: ML Engineer
  {
    name: "digest-ml-engineer",
    description: "Generate daily digest focused on model releases, training techniques, and ML benchmarks",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "ML", "AI", "model", "training", "benchmark", "MLOps"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## ML Engineer Digest Skill

### Persona Focus
Model releases, training techniques, MLOps, benchmarks, research papers

### Priority Categories
- AI/ML announcements
- Research papers
- Open source models
- Infrastructure updates

### Output Structure

#### Act I: The Setup
Lead with major model release or benchmark result.

#### Act II: The Signal
- 3-5 stories with technical depth
- Benchmark comparisons
- Training insights

#### Act III: The Move
Generate specific action items:
- Models to evaluate
- Techniques to adopt
- Research to review

### Formatting
- Use 🤖 for AI, 🧠 for models, 🔬 for research
`,
  },

  // Digest Skill 13: Security Analyst
  {
    name: "digest-security-analyst",
    description: "Generate daily digest focused on CVEs, breaches, compliance, and threat intelligence",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "security", "CVE", "breach", "compliance", "threat", "vulnerability"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Security Analyst Digest Skill

### Persona Focus
CVEs, breaches, compliance, threat intelligence, security tools

### Priority Categories
- Security advisories
- Compliance updates
- Privacy developments
- Infrastructure security

### Output Structure

#### Act I: The Setup
Lead with critical CVE or breach disclosure.

#### Act II: The Signal
- 3-5 stories with severity ratings
- Affected systems
- Mitigation steps

#### Act III: The Move
Generate specific action items:
- Vulnerability assessments needed
- Compliance reviews
- Threat mitigations

### Formatting
- Use ⚠️ for critical, 🔒 for security, 🛡️ for protection
- Include CVE numbers
`,
  },

  // Digest Skill 14: Growth Marketer
  {
    name: "digest-growth-marketer",
    description: "Generate daily digest focused on viral trends, channel opportunities, and competitive marketing",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "growth", "marketing", "viral", "channel", "brand", "content"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Growth Marketer Digest Skill

### Persona Focus
Viral trends, channel opportunities, competitive marketing, brand moves

### Priority Categories
- Marketing news
- Social trends
- Growth tactics
- Consumer behavior

### Output Structure

#### Act I: The Setup
Lead with viral trend or major brand move.

#### Act II: The Signal
- 3-5 stories about marketing trends
- Channel insights
- Competitive positioning

#### Act III: The Move
Generate specific action items:
- Channel experiments to run
- Content opportunities
- Competitive positioning moves

### Formatting
- Use 📈 for growth, 📢 for marketing, 🔥 for viral
`,
  },

  // Digest Skill 15: Data Analyst
  {
    name: "digest-data-analyst",
    description: "Generate daily digest focused on data tools, analytics platforms, and data infrastructure",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "data", "analytics", "visualization", "infrastructure", "pipeline"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## Data Analyst Digest Skill

### Persona Focus
Data tools, analytics platforms, visualization, data infrastructure

### Priority Categories
- Data tool releases
- Analytics updates
- Infrastructure changes
- Enterprise data

### Output Structure

#### Act I: The Setup
Lead with major data tool release or platform update.

#### Act II: The Signal
- 3-5 stories about data tooling
- Performance comparisons
- Integration opportunities

#### Act III: The Move
Generate specific action items:
- Data pipeline improvements
- Tool evaluations
- Metric frameworks

### Formatting
- Use 📊 for analytics, 💾 for data, 🔍 for insights
`,
  },

  // Digest Skill 16: General
  {
    name: "digest-general",
    description: "Generate daily digest with broad tech and business coverage for general audiences",
    category: "digest",
    categoryName: "Daily Digest",
    keywords: ["digest", "general", "news", "tech", "business", "industry", "trends"],
    allowedTools: ["searchNews", "lookupGroundTruthEntity"],
    license: "Apache-2.0",
    fullInstructions: `## General Digest Skill

### Persona Focus
Broad tech and business news, major announcements, industry trends

### Priority Categories
- AI/ML developments
- Funding news
- Security updates
- Open source

### Output Structure

#### Act I: The Setup
Lead with the day's biggest story.

#### Act II: The Signal
- 3-5 diverse stories covering multiple topics
- Balance of tech and business
- Variety of sources

#### Act III: The Move
Generate action items for multiple personas:
- What each persona type should do

### Formatting
- Use 📰 for news, 🤖 for AI, 💼 for business
- Balanced coverage
`,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SEEDING ACTION
// ═══════════════════════════════════════════════════════════════════════════

export const seedSkillRegistry = internalAction({
  args: {
    generateEmbeddings: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    seeded: number;
    updated: number;
    errors: string[];
  }> => {
    const { generateEmbeddings = true } = args;
    let seeded = 0;
    let updated = 0;
    const errors: string[] = [];

    console.log(`[seedSkillRegistry] Seeding ${CORE_SKILLS.length} skills...`);

    for (const skill of CORE_SKILLS) {
      try {
        // Generate embedding if requested
        let embedding: number[] | undefined;
        if (generateEmbeddings) {
          try {
            embedding = await ctx.runAction(
              internal.tools.meta.skillDiscovery.generateSkillEmbedding,
              {
                skillName: skill.name,
                description: skill.description,
                keywords: skill.keywords,
                fullInstructions: skill.fullInstructions,
              }
            );
          } catch (embError: any) {
            console.warn(`[seedSkillRegistry] Embedding failed for ${skill.name}:`, embError.message);
          }
        }

        // Upsert the skill (mutation is in seedSkillRegistryQueries.ts)
        const result = await ctx.runMutation(
          internal.tools.meta.seedSkillRegistryQueries.upsertSkill,
          {
            name: skill.name,
            description: skill.description,
            fullInstructions: skill.fullInstructions,
            category: skill.category,
            categoryName: skill.categoryName,
            keywords: skill.keywords,
            keywordsText: skill.keywords.join(" "),
            embedding,
            allowedTools: skill.allowedTools,
            license: skill.license,
          }
        );

        if (result.action === "created") {
          seeded++;
          console.log(`[seedSkillRegistry] Created skill: ${skill.name}`);
        } else {
          updated++;
          console.log(`[seedSkillRegistry] Updated skill: ${skill.name}`);
        }
      } catch (error: any) {
        errors.push(`${skill.name}: ${error.message}`);
        console.error(`[seedSkillRegistry] Error seeding ${skill.name}:`, error);
      }
    }

    console.log(`[seedSkillRegistry] Complete: ${seeded} created, ${updated} updated, ${errors.length} errors`);

    return { seeded, updated, errors };
  },
});

