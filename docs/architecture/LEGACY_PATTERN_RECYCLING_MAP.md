# Legacy Pattern Recycling Map

How patterns from 9 older repos map into NodeBench's current architecture.

**Rule: Extract patterns, not code.** No copy-paste. Rewrite every implementation
in NodeBench's architecture (Convex + Vite + MCP + TypeScript).

---

## Architecture integration points

Each legacy pattern maps to one of these existing NodeBench layers:

```
Layer                    Where it lives now                       What it does
---                      ---                                      ---
MCP tools                packages/mcp-local/src/tools/            Tool handlers (304+ tools)
Convex mutations         convex/domains/*/                        Backend state + persistence
Convex actions           convex/domains/*/actions/                External API calls
Server routes            server/routes/                           Search, eval, API endpoints
React components         src/features/*/                          UI surfaces
Prototype                public/proto/home-v3.html                Interactive prototype
Skills                   packages/mcp-local/src/tools/*.ts        Skill manifest handlers
Eval harness             packages/mcp-local/src/benchmarks/       Quality gates
```

---

## P0: Port now (core loop dependencies)

### 1. Source quality gateway

**From:** `begone` (web content validation, entity disambiguation)
**Into:** `server/routes/search.ts` + new `server/pipeline/sourceQuality.ts`

```
Current state:
  search.ts has retrievalConfidence (high/medium/low) + isGrounded() filter

What to add:
  sourceQuality.isUsable(url, html) -> { usable, reason }
    - bot-blocked detection (Cloudflare challenge, CAPTCHA markers)
    - paywall detection (partial content + subscription CTA patterns)
    - 404 / soft-404 detection (error page templates)
    - SEO garbage detection (thin content, keyword-stuffed)
    - vendor-about-page detection (source is about the scraper service, not the target)

  entityDisambiguation.isSameEntity(extracted, target) -> { match, confidence }
    - same company vs different company with same name
    - subsidiary vs parent
    - stale entity (acquired, renamed, defunct)
    - negative examples registry (known false positives)

  fieldValidation.validateField(field, value, sources) -> { valid, evidence }
    - revenue figures cross-referenced across sources
    - founding year consistency
    - investor list corroboration
    - contact data freshness
```

**Wiring:**
- `isUsable()` runs BEFORE snippets enter `retrievalConfidence` scoring
- `isSameEntity()` runs AFTER entity extraction in company_search branch
- `validateField()` runs DURING structuring pass (claim-level grounding)

**Tests:** Scenario-based with known-bad URLs, ambiguous entities, stale data

---

### 2. Eval and validation core

**From:** `LLM-Prior-Authorization-Form-Auto-Fill-System-With-Eval`
**Into:** `packages/mcp-local/src/benchmarks/` + `server/pipeline/`

```
Current state:
  searchQualityEval.ts has 100+ query corpus with Gemini judge
  diligenceJudge.ts has 10-gate deterministic pipeline

What to add:
  validationPass(draft, context) -> { improved, changes[], degraded? }
    - Run ONLY when: high-stakes output, low confidence, claim conflict, export
    - Track improvement/degradation telemetry per run
    - Gate: skip validation if confidence > 0.9 AND no claim conflicts

  hashCache for source packs, entity reports, claim verifications
    - key = sha256(entitySlug + sourceUrls.sort().join() + extractionPromptVersion)
    - TTL = 24h for news, 7d for filings, 30d for corporate pages
    - Invalidate on: new source discovered, entity report patched, manual refresh

  claimLevelJudge(claim, sources) -> { grounded, evidence, confidence }
    - Layered: deterministic overlap check -> small model -> expensive model
    - Only escalate to expensive model when deterministic check is ambiguous
```

**Key lesson from Prior Auth repo:**
> Validation can degrade output if the validation prompt is not optimized.
> Gate validation behind confidence thresholds. Never run blindly.

---

### 3. Company dossier skill

**From:** `Banking_assistant_streamlit` + `Parsely-Targeted-Research-Framework`
**Into:** `packages/mcp-local/src/tools/entityEnrichmentTools.ts` + new Convex domain

```
Current state:
  entityEnrichmentTools.ts has basic entity extraction
  MENTION_DATA in home-v3.html has the display schema

What to add:
  CompanyDossierFields (Convex table + MCP tool schema):
    overview        -> string (1-para summary)
    financing       -> { rounds[], totalRaised, lastValuation, investors[] }
    board           -> { members[], advisors[] }
    cSuite          -> { executives[], recentChanges[] }
    revenue         -> { estimated, source, confidence, lastUpdated }
    ebitda          -> { estimated, source, confidence }
    contacts        -> { website, hq, keyContacts[] }
    news            -> { recent[], sentiment, trendDirection }
    prospecting     -> { topics[], emailTemplate, outreachAngle }
    sectorTags      -> string[]
    generalTags     -> string[]
    riskFlags       -> { regulatory, competitive, financial, operational }
```

**Wiring:**
- MCP tool: `company_dossier_extract(entitySlug)` -> populates fields
- Convex mutation: `domains/entities/mutations/patchDossier.ts`
- UI: Notebook entity context card (right rail) shows dossier summary
- Export: CRM-ready JSON/CSV from dossier fields

---

### 4. Multi-document research skill

**From:** `Parsely-Multi-Large-Documents-Targeted-Research`
**Into:** `packages/mcp-local/src/tools/` + context router

```
Current state:
  search.ts has single-query classification
  No multi-document orchestration

What to add:
  contextRouter.classify(input) -> route
    Routes:
    - simple_answer    -> memory/cache lookup, no agent spawn
    - report_update    -> patch existing entity report
    - event_capture    -> create capture + attach to entity
    - deep_diligence   -> spawn research run with subagents
    - multi_doc        -> ingest + cross-reference multiple documents
    - export           -> generate memo/CSV/PDF from existing data
    - approval_needed  -> flag for human review

  multiDocResearch(documents[], query) -> { synthesis, perDocFindings[], crossRefs[] }
    - Parallel document processing (one subagent per doc)
    - Cross-reference extraction (entity mentions across docs)
    - Conflict detection (contradicting claims across sources)
    - Synthesis with per-document attribution
```

**File ingestion support (from Parsely):**
```
PDF, DOCX, PPTX, XLSX, CSV, EML, HTML, XML, images, TXT
```

---

## P1: Port after core loop stabilizes

### 5. Notebook writing skills

**From:** `ai-research-writer`
**Into:** MCP tools + notebook UI actions

```
Skills to port as MCP tools:
  notebook_polish(section)      -> clean prose, fix grammar, improve flow
  notebook_compress(section)    -> reduce to key points, remove fluff
  notebook_expand(section)      -> add evidence, elaborate claims
  notebook_check_logic(section) -> flag logical gaps, unsupported leaps
  notebook_review(section)      -> simulate analyst peer review
  notebook_deai(section)        -> remove AI-style prose patterns

SkillManifest schema (from ai-research-writer):
  { name, command, description, systemPrompt,
    requiredContext, optionalContext, outputSchema, example }
```

**Wiring:** These become action chips in the notebook editor toolbar.

---

### 6. Recommendation answer packet

**From:** `clickcar_salesagent_with_custom_autogen`
**Into:** Chat response format + entity context

```
AnswerPacket schema:
  recommendation   -> string (what to do)
  rationale         -> string (why)
  confidence        -> number (0-1)
  evidence          -> { sources[], claims[] }
  nextAction        -> string (concrete next step)
  urgency           -> 'now' | 'this_week' | 'monitor'

NeedExtraction (pre-processing):
  userGoal          -> string
  desiredOutcome    -> string
  urgency           -> string
  relationshipCtx   -> string (who is this about)
  nextAction        -> string (what they want to happen)
```

**Wiring:** Chat responses include structured answer packets when the query
is action-oriented (detected by context router).

---

### 7. Multi-file ingestion core

**From:** `Parsely`
**Into:** Convex actions + MCP tools

```
Supported formats (from Parsely):
  PDF, DOCX, PPTX, XLSX, CSV, EML, MSG, HTML, XML, images, TXT

Ingestion pipeline:
  upload -> detect format -> extract text -> chunk -> embed -> store
  
Special handlers:
  PDF       -> PyMuPDF / LLM Sherpa layout-aware
  XLSX/CSV  -> structured data extraction, column mapping
  EML/MSG   -> sender/recipient/date/body/attachments
  Images    -> OCR via vision model (business cards, screenshots)
  Voice     -> transcription -> text pipeline
```

---

## P2: Enterprise / future

### 8. Regulated deployment policy

**From:** `Mana-Inno-Demo`
**Into:** Configuration + deployment docs

```
Capabilities to support:
  data_residency    -> tenant-local storage policy
  session_deletion  -> user can delete all session artifacts
  local_inference   -> run with local/open-source models
  multilingual      -> Arabic, CJK, European language support
  audit_trail       -> full provenance for regulatory compliance
```

---

## Hybrid retrieval architecture

**From:** `Banking_assistant_streamlit` (CustomRetriever) + `clickcar_salesagent_with_custom_autogen` (BM25 + Cohere rerank)
**Into:** Unified retrieval stack

```
Current:
  Typesense keyword/vector search (search.ts)
  Convex source-of-truth lookup
  isGrounded() claim filter

Target:
  1. Typesense keyword + vector recall (existing)
  2. Convex entity graph neighborhood lookup (existing)
  3. Source quality filter (from begone - P0)
  4. Cross-document reranker (from ClickCar pattern)
  5. Claim-level grounding (existing + Prior Auth validation)
```

---

## Provider fallback chain

**From:** `ai-research-writer` (Gemini -> OpenAI -> Anthropic)
**Into:** `server/routes/search.ts` autoRouter

```
Current:
  autoRouter.ts has Gemini + OpenRouter fallback

Target (cost-optimized):
  Fast/cheap    -> Gemini Flash Lite (classification, simple extraction)
  Mid-tier      -> Gemini Flash / Claude Haiku (structured extraction)
  Deep reasoning -> Claude Opus / GPT-4o (complex synthesis, validation)
  Fallback      -> OpenRouter free models (degraded but available)
```

---

## Migration protocol

For each module being ported:

```
1. Extract schemas      -> TypeScript types in convex/domains/ or packages/mcp-local/
2. Extract prompts      -> Prompt templates in tool handler files
3. Extract retrieval    -> Integrate into search.ts or new retrieval module
4. Extract validation   -> Integrate into diligenceJudge.ts pipeline
5. Extract eval cases   -> Add to searchQualityEval.ts corpus
6. Rewrite in NodeBench -> Convex mutations + MCP tools + React components
7. Test                 -> Scenario-based tests per scenario_testing rule
8. Dogfood              -> Verify in running UI per dogfood_verification rule
```

**Do NOT:**
- Copy-paste Python code into TypeScript
- Import old dependencies (Streamlit, FastAPI, Supabase, Google Drive)
- Create parallel persistence layers (Convex is the source of truth)
- Port UI code (NodeBench has its own design system)

---

## Highest-value combined workflow

This is the end-to-end flow that uses the most recycled patterns:

```
User: "Research Orbital Labs and tell me if I should follow up."

1. Need extraction (from ClickCar)
   -> extract goal, urgency, relationship context

2. Context router (from Parsely/PTRF)
   -> classify as deep_diligence

3. Company dossier schema (from Banking Assistant)
   -> structured field extraction

4. Source quality filter (from begone)
   -> validate scraped content before use

5. Structured extraction + validation (from Prior Auth)
   -> extract claims, validate, track changes

6. Notebook writing polish (from ai-research-writer)
   -> clean prose, check logic

7. Report persistence + graph update (NodeBench current)
   -> Convex mutations, entity graph edges

Output:
  Short answer + rationale + sources + risks
  + next actions + notebook patch + claims + graph edges
  + follow-up + telemetry
```

---

## File

`docs/architecture/LEGACY_PATTERN_RECYCLING_MAP.md`
