# Financial Tools

This directory contains tools for financial research, funding detection, and investment analysis.

## Tool Categories

### 1. Funding Research Tools (`fundingResearchTools.ts`)

External API-based tools for searching funding announcements:

- **`searchTodaysFunding`** - Search for today's funding announcements using LinkUp API
  - Searches specific industries (healthcare, life sciences, tech)
  - Filters by funding stage (seed, series-a, series-b)
  - Returns structured data with company info, investors, amounts
  - Uses LinkUp's deep search with structured output

### 2. Enhanced Funding Tools (`enhancedFundingTools.ts`)

Advanced enrichment tools for deep company research:

- **`smartFundingSearch`** - Smart funding search with auto-fallback
  - Tries today → last 3 days → last 7 days
  - Triggers deep enrichment for sparse results
  
- **`enrichFounderInfo`** - Deep dive into founder backgrounds
  - Prior companies and exits
  - Educational background
  - LinkedIn profiles
  
- **`enrichInvestmentThesis`** - Understand why company was funded
  - Market opportunity analysis
  - Competitive positioning
  - Investor rationale
  
- **`enrichPatentsAndResearch`** - IP and research validation
  - Patent portfolio analysis
  - Research publications
  - Clinical trial data (for life sciences)
  
- **`enrichCompanyDossier`** - Orchestrates full enrichment workflow
  - Coordinates all enrichment tools
  - Builds comprehensive company profile

### 3. Funding Detection Tools (`fundingDetectionTools.ts`) 🆕

**NEW**: Internal pipeline tools for accessing detected funding events:

- **`getTodaysFundingEvents`** - Get funding events detected from news feeds
  - Returns structured funding data from internal database
  - Includes company names, amounts, investors, confidence scores
  - Filters by lookback period and confidence threshold
  - **Use case**: "What funding events happened today?"
  
- **`searchFundingEvents`** - Search funding events by criteria
  - Search by company name
  - Filter by round type (seed, series-a, etc.)
  - Historical funding data
  - **Use case**: "Show me funding history for [company]"
  
- **`detectFundingFromFeeds`** - Trigger manual funding detection
  - Scans recent feed items for funding announcements
  - Creates funding events in database
  - Returns detected candidates with confidence scores
  - **Use case**: "Scan recent news for funding announcements"

## Integration with Agent System

All tools are integrated into the **Coordinator Agent** (`convex/domains/agents/core/coordinatorAgent.ts`):

```typescript
// Funding research tools (external API)
searchTodaysFunding,
enrichFounderInfo,
enrichInvestmentThesis,
enrichPatentsAndResearch,
enrichCompanyDossier,

// Funding detection tools (internal pipeline)
getTodaysFundingEvents,
searchFundingEvents,
detectFundingFromFeeds,
```

### Usage in Fast Agent Panel

Users can query funding information through natural language:

**Examples:**
- "What funding events happened today?"
- "Show me recent seed rounds in healthcare"
- "Tell me about [company]'s funding history"
- "Scan recent news for funding announcements"
- "Who invested in [company]?"

The agent will automatically select the appropriate tool based on the query.

## Data Flow

### External Research Flow (LinkUp API)
```
User Query → searchTodaysFunding → LinkUp API → Structured Results → Agent Response
```

### Internal Detection Flow (Feed Pipeline)
```
RSS Feeds → Feed Items → detectFundingCandidates → Funding Events DB
                                                          ↓
User Query → getTodaysFundingEvents → Funding Events DB → Agent Response
```

### Enrichment Flow
```
Funding Event → enrichCompanyDossier → enrichFounderInfo
                                     → enrichInvestmentThesis
                                     → enrichPatentsAndResearch
                                     → Comprehensive Dossier
```

## Backend Integration

### Funding Detection Pipeline

Located in `convex/domains/enrichment/`:

- **`fundingDetection.ts`** - Core detection logic
  - Pattern matching for funding announcements
  - Amount extraction (USD conversion)
  - Round type classification
  - Investor extraction
  - Company name extraction
  - Confidence scoring

- **`fundingMutations.ts`** - Database operations
  - Create/update funding events
  - Merge duplicate events
  - Verification status tracking

- **`fundingQueries.ts`** - Data retrieval
  - Query recent funding events
  - Search by company name
  - Filter by round type, confidence, date range

### Database Schema

**`fundingEvents` table:**
- `companyName` - Company name
- `companyId` - Link to entities table (optional)
- `roundType` - seed, series-a, series-b, etc.
- `amountRaw` - Raw amount string from source
- `amountUsd` - Parsed USD amount
- `announcedAt` - Announcement timestamp
- `leadInvestors` - Array of lead investor names
- `coInvestors` - Array of co-investor names
- `sourceUrls` - Array of source URLs
- `sourceNames` - Array of source names
- `confidence` - Detection confidence (0-1)
- `verificationStatus` - single-source, multi-source, verified
- `sector` - Industry sector
- `location` - Company location
- `feedItemIds` - Links to source feed items

## Testing

See `tests/funding-detection-agent.spec.ts` for integration tests.

## Future Enhancements

- [ ] Real-time funding alerts
- [ ] Investor network analysis
- [ ] Funding trend analytics
- [ ] Company valuation tracking
- [ ] Integration with CRM systems
- [ ] Automated dossier generation for new funding events

