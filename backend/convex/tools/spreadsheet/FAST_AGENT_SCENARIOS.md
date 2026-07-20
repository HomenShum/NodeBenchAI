# Fast Agent Spreadsheet Tool - Usage Scenarios

## Overview

This document demonstrates how the Fast Agent uses the `bulkUpdateSpreadsheet` tool to manipulate spreadsheet data in response to natural language requests.

---

## Scenario 1: Simple Column Update

### User Request
> "Update all companies in the spreadsheet to mark them as 'High' priority for outreach"

### Fast Agent Reasoning
1. Identify the spreadsheet document (companies.csv)
2. Determine the relevant column (AlreadyTalkingTier)
3. Perform dry-run to preview changes
4. Request user confirmation
5. Execute commit if approved

### Agent Actions

**Step 1: Dry-Run Preview**
```typescript
await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [{
    type: "updateColumn",
    columnName: "AlreadyTalkingTier",
    value: "High"
  }],
  dryRun: true
});
```

**Agent Response to User:**
> "I found the companies spreadsheet with 13 companies. I can update the 'AlreadyTalkingTier' column to 'High' for all companies. This would change 10 cells across 13 rows. Here's a preview of the first few changes:
> 
> - Row 1 (Anthropic): Medium → High
> - Row 2 (Mistral AI): Low → High
> - Row 4 (MiniMax): Medium → High
> 
> Would you like me to proceed with this update?"

**Step 2: User Confirms**
> "Yes, proceed"

**Step 3: Commit Changes**
```typescript
await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [{
    type: "updateColumn",
    columnName: "AlreadyTalkingTier",
    value: "High"
  }],
  dryRun: false,
  confirm: true
});
```

**Agent Response:**
> "✅ Successfully updated 10 cells across 13 rows. All companies are now marked as 'High' priority for outreach."

---

## Scenario 2: Conditional Update Based on Analysis

### User Request
> "For all companies with funding over $500M, set their funding tier to 'Very High'"

### Fast Agent Reasoning
1. Read the spreadsheet to identify companies
2. Analyze funding amounts from FundingEvidence column
3. Identify which companies meet the criteria
4. Create vector update with specific values for each row
5. Preview and confirm

### Agent Actions

**Step 1: Read Spreadsheet**
```typescript
// Agent uses existing query to read spreadsheet data
const companies = await getSpreadsheetData(documentId);
```

**Step 2: Analyze and Prepare Update**
```typescript
// Agent identifies companies with >$500M funding:
// - Anthropic: $3B+ (Google + Amazon)
// - Mistral AI: $640M
// - MiniMax: $600M
// - Poolside AI: $600M+

// Create vector update (13 rows total)
const fundingTierValues = [
  "Very High",  // Anthropic
  "Very High",  // Mistral AI
  "High",       // Scale AI (no specific amount)
  "Very High",  // MiniMax
  "High",       // Rossum ($109.5M)
  "Medium",     // Prezent ($45M)
  "Very High",  // Adept ($350M)
  "Very High",  // Harvey ($300M)
  "Low",        // Together AI (no funding disclosed)
  "Very High",  // Poolside AI ($600M+)
  "High",       // Perplexity AI (strong funding, no amount)
  "Medium",     // LinkSquares (no funding disclosed)
  "Medium"      // Glean (no funding disclosed)
];
```

**Step 3: Dry-Run Preview**
```typescript
await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [{
    type: "updateColumn",
    columnName: "FundingTier",
    values: fundingTierValues
  }],
  dryRun: true
});
```

**Agent Response:**
> "I analyzed the funding data for all 13 companies. Based on funding amounts, I recommend updating the FundingTier column as follows:
> 
> **Very High** (>$500M):
> - Anthropic: $3B+ from Google and Amazon
> - Mistral AI: $640M Series B
> - MiniMax: $600M from Alibaba
> - Adept: $350M Series B
> - Harvey: $300M Series D
> - Poolside AI: $600M+
> 
> **High** (Significant but <$500M):
> - Scale AI, Perplexity AI
> 
> **Medium/Low** (Limited or undisclosed):
> - Rossum, Prezent, Together AI, LinkSquares, Glean
> 
> This would update all 13 rows. Proceed?"

---

## Scenario 3: Multi-Column Update

### User Request
> "Mark all companies with 'Very High' ML talent as high priority and set their burn-out risk to 'Low'"

### Fast Agent Reasoning
1. Identify companies with "Very High" MLTalentTier
2. Update two columns: AlreadyTalkingTier and BurnOutTier
3. Use multiple operations in one call

### Agent Actions

**Step 1: Analyze Data**
```typescript
// Companies with "Very High" ML talent:
// - Anthropic (row 0)
// - Mistral AI (row 1)
```

**Step 2: Prepare Targeted Update**
```typescript
// Create vector updates for both columns
const priorityValues = [
  "High",    // Anthropic (Very High ML talent)
  "High",    // Mistral AI (Very High ML talent)
  "Low",     // Scale AI (Medium ML talent)
  "Low",     // MiniMax (Medium ML talent)
  "Low",     // Rossum (Medium ML talent)
  "Low",     // Prezent (Medium ML talent)
  "Low",     // Adept (Medium ML talent)
  "Low",     // Harvey (Medium ML talent)
  "Low",     // Together AI (Medium ML talent)
  "Low",     // Poolside AI (Medium ML talent)
  "Low",     // Perplexity AI (Medium ML talent)
  "Low",     // LinkSquares (Medium ML talent)
  "Low"      // Glean (High ML talent)
];

const burnOutValues = [
  "Low",     // Anthropic (Very High ML talent = stable)
  "Low",     // Mistral AI (Very High ML talent = stable)
  "Medium",  // Others
  "Medium",
  "Medium",
  "Medium",
  "Medium",
  "Medium",
  "Medium",
  "Medium",
  "Medium",
  "Medium",
  "Medium"
];
```

**Step 3: Execute Multi-Operation Update**
```typescript
await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [
    {
      type: "updateColumn",
      columnName: "AlreadyTalkingTier",
      values: priorityValues
    },
    {
      type: "updateColumn",
      columnName: "BurnOutTier",
      values: burnOutValues
    }
  ],
  dryRun: true
});
```

**Agent Response:**
> "I identified 2 companies with 'Very High' ML talent (Anthropic and Mistral AI). I'll update:
> 
> 1. **AlreadyTalkingTier** → 'High' for these 2 companies
> 2. **BurnOutTier** → 'Low' for these 2 companies (stable due to top talent)
> 
> This will change 4 cells total. Proceed?"

---

## Scenario 4: Error Recovery

### User Request
> "Update the 'Status' column to 'Active' for all companies"

### Fast Agent Reasoning
1. Attempt to find "Status" column
2. Encounter error (column doesn't exist)
3. Suggest alternatives to user

### Agent Actions

**Step 1: Attempt Update**
```typescript
await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [{
    type: "updateColumn",
    columnName: "Status",
    value: "Active"
  }],
  dryRun: true
});
```

**Error Received:**
```
Error: Column "Status" not found in headers
```

**Agent Response:**
> "I couldn't find a 'Status' column in the spreadsheet. The available columns are:
> 
> - Company
> - Domain
> - Description
> - FoundersBackersTier
> - FundingTier
> - FoundationModelsTier
> - InferencePlatformTier
> - BurnOutTier
> - ReputableTier
> - PRTier
> - ProprietaryModelsTier
> - MLTalentTier
> - LatestFundingTier
> - VendorIntegrationTier
> - MLTeamSizeTier
> - ScalingInferenceTier
> - AlreadyTalkingTier
> - TotalScore
> - Coverage
> - Confidence
> - EvidenceLinks
> 
> Did you mean one of these columns? For example, 'AlreadyTalkingTier' might be what you're looking for to mark companies as active prospects."

---

## Scenario 5: Data Validation and Correction

### User Request
> "Fix the data quality issues in row 3 - the vendor integration tier has a URL instead of a tier value"

### Fast Agent Reasoning
1. Identify row 3 (MiniMax)
2. Examine the VendorIntegrationTier column
3. Prepare row update with corrected data
4. Preview and confirm

### Agent Actions

**Step 1: Read Current Data**
```typescript
// Current row 3 data shows:
// VendorIntegrationTier: "of%20speech%20and%2020%20million"
// This is clearly corrupted data
```

**Step 2: Prepare Correction**
```typescript
// Agent determines correct value should be "High" based on context
await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [{
    type: "updateColumn",
    columnName: "VendorIntegrationTier",
    columnIndex: 23,  // Use index if name is unclear
    values: [
      "Low",   // Row 0: Anthropic
      "Medium", // Row 1: Mistral AI
      "High",   // Row 2: Scale AI
      "High",   // Row 3: MiniMax (CORRECTED)
      "High",   // Row 4: Rossum
      // ... rest of rows
    ]
  }],
  dryRun: true
});
```

**Agent Response:**
> "I found the data quality issue in row 3 (MiniMax). The VendorIntegrationTier column contains corrupted data: 'of%20speech%20and%2020%20million'
> 
> Based on the company profile (MiniMax provides its own API platform), I recommend setting this to 'High' (vendor independent).
> 
> Preview:
> - Row 3, Column 23: 'of%20speech%20and%2020%20million' → 'High'
> 
> Proceed with correction?"

---

## Best Practices for Fast Agent

### 1. Always Dry-Run First
```typescript
// ✅ GOOD: Preview before committing
const preview = await bulkUpdateSpreadsheet({...args, dryRun: true});
// Show preview to user
// Get confirmation
const result = await bulkUpdateSpreadsheet({...args, dryRun: false, confirm: true});

// ❌ BAD: Direct commit without preview
const result = await bulkUpdateSpreadsheet({...args, dryRun: false, confirm: true});
```

### 2. Provide Context in Responses
```typescript
// ✅ GOOD: Explain what will change
"I'll update the 'AlreadyTalkingTier' column to 'High' for all 13 companies. 
This would change 10 cells (3 are already 'High'). Preview:..."

// ❌ BAD: Vague response
"I'll update the spreadsheet."
```

### 3. Handle Errors Gracefully
```typescript
// ✅ GOOD: Suggest alternatives
"Column 'Status' not found. Did you mean 'AlreadyTalkingTier'? 
Available columns: Company, Domain, ..."

// ❌ BAD: Just report error
"Error: Column not found"
```

### 4. Validate Data Before Updates
```typescript
// ✅ GOOD: Check data makes sense
if (values.length !== rowCount) {
  return "Error: Provided 5 values but spreadsheet has 13 rows. 
  Please provide exactly 13 values.";
}

// ❌ BAD: Let backend error
await bulkUpdateSpreadsheet({...}); // Will fail with VectorLengthMismatch
```

### 5. Use Descriptive Operation Names
```typescript
// ✅ GOOD: Clear operation description
operations: [{
  type: "updateColumn",
  columnName: "AlreadyTalkingTier",  // Use name when possible
  value: "High"
}]

// ❌ BAD: Unclear operation
operations: [{
  type: "updateColumn",
  columnIndex: 29,  // What column is this?
  value: "High"
}]
```

---

## Integration with Fast Agent Workflow

The Fast Agent automatically:
1. **Detects spreadsheet operations** from user intent
2. **Reads spreadsheet data** to understand structure
3. **Formulates operations** based on user request
4. **Previews changes** in dry-run mode
5. **Requests confirmation** from user
6. **Executes commit** if approved
7. **Reports results** with clear success/failure messages

This tool enables the Fast Agent to be a powerful spreadsheet assistant while maintaining safety and auditability.

