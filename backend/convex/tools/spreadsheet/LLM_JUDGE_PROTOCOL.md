# LLM Judge Protocol for Spreadsheet Tool Testing

## Overview

This document defines the protocol for an LLM to evaluate spreadsheet tool test results using **boolean pass/fail criteria only** (no arbitrary numbers or floats).

---

## Judge Input Format

```json
{
  "testScenario": {
    "name": "Test 1: Dry-Run Column Update",
    "input": {
      "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
      "userId": "k17f4ess745re511ckkcfqce697n16es",
      "operations": [{
        "type": "updateColumn",
        "columnName": "AlreadyTalkingTier",
        "value": "High"
      }],
      "dryRun": true
    },
    "expectedBehavior": "Should preview changes without committing to storage"
  },
  "actualResult": {
    "dryRun": true,
    "affectedRows": 13,
    "changedCells": 10,
    "executionTime": 762,
    "message": "DRY RUN: Would update 10 cells across 13 rows...",
    "preview": [
      {"row": 0, "col": 29, "old": "Medium", "new": "High"}
    ]
  },
  "passCriteria": [
    "result.dryRun === true",
    "result.committed === undefined",
    "result.affectedRows > 0",
    "result.changedCells > 0",
    "result.preview !== undefined",
    "result.preview.length > 0",
    "result.newStorageId === undefined",
    "result.message.includes('DRY RUN')"
  ],
  "failCriteria": [
    "result.committed === true",
    "result.newStorageId !== undefined",
    "result.preview === undefined"
  ]
}
```

---

## Judge Evaluation Process

### Step 1: Evaluate Pass Criteria

For each criterion in `passCriteria`, evaluate as boolean:

```typescript
function evaluatePassCriterion(result: any, criterion: string): boolean {
  // Parse and evaluate the criterion
  // Examples:
  // - "result.dryRun === true" → true/false
  // - "result.affectedRows > 0" → true/false
  // - "result.message.includes('DRY RUN')" → true/false
  
  return eval(criterion); // In practice, use safe evaluation
}
```

**Example Evaluation:**

```
Criterion: "result.dryRun === true"
Actual: result.dryRun = true
Evaluation: true === true → ✅ PASS

Criterion: "result.committed === undefined"
Actual: result.committed = undefined
Evaluation: undefined === undefined → ✅ PASS

Criterion: "result.affectedRows > 0"
Actual: result.affectedRows = 13
Evaluation: 13 > 0 → ✅ PASS

Criterion: "result.preview.length > 0"
Actual: result.preview.length = 10
Evaluation: 10 > 0 → ✅ PASS
```

### Step 2: Evaluate Fail Criteria

For each criterion in `failCriteria`, evaluate as boolean (should be FALSE):

```typescript
function evaluateFailCriterion(result: any, criterion: string): boolean {
  // Fail criteria should NOT be true
  // If criterion evaluates to true, the test FAILED
  
  const criterionMet = eval(criterion);
  return !criterionMet; // Invert: we want this to be false
}
```

**Example Evaluation:**

```
Criterion: "result.committed === true"
Actual: result.committed = undefined
Evaluation: undefined === true → false → ✅ PASS (fail condition NOT met)

Criterion: "result.newStorageId !== undefined"
Actual: result.newStorageId = undefined
Evaluation: undefined !== undefined → false → ✅ PASS (fail condition NOT met)

Criterion: "result.preview === undefined"
Actual: result.preview = [...]
Evaluation: [...] === undefined → false → ✅ PASS (fail condition NOT met)
```

### Step 3: Compute Final Verdict

```typescript
function computeVerdict(
  passCriteriaResults: boolean[],
  failCriteriaResults: boolean[]
): {
  verdict: "PASS" | "FAIL",
  passCount: number,
  failCount: number,
  totalCriteria: number
} {
  const allPassCriteriaMet = passCriteriaResults.every(r => r === true);
  const noFailCriteriaTriggered = failCriteriaResults.every(r => r === true);
  
  const verdict = (allPassCriteriaMet && noFailCriteriaTriggered) ? "PASS" : "FAIL";
  
  return {
    verdict,
    passCount: passCriteriaResults.filter(r => r).length,
    failCount: failCriteriaResults.filter(r => !r).length,
    totalCriteria: passCriteriaResults.length + failCriteriaResults.length
  };
}
```

---

## Judge Output Format

```json
{
  "testName": "Test 1: Dry-Run Column Update",
  "verdict": "PASS",
  "passCriteriaEvaluation": {
    "total": 8,
    "passed": 8,
    "failed": 0,
    "details": [
      {
        "criterion": "result.dryRun === true",
        "result": true,
        "explanation": "result.dryRun is true, criterion met"
      },
      {
        "criterion": "result.committed === undefined",
        "result": true,
        "explanation": "result.committed is undefined, criterion met"
      },
      {
        "criterion": "result.affectedRows > 0",
        "result": true,
        "explanation": "result.affectedRows is 13, which is > 0"
      },
      {
        "criterion": "result.changedCells > 0",
        "result": true,
        "explanation": "result.changedCells is 10, which is > 0"
      },
      {
        "criterion": "result.preview !== undefined",
        "result": true,
        "explanation": "result.preview is an array, not undefined"
      },
      {
        "criterion": "result.preview.length > 0",
        "result": true,
        "explanation": "result.preview has 10 items, which is > 0"
      },
      {
        "criterion": "result.newStorageId === undefined",
        "result": true,
        "explanation": "result.newStorageId is undefined, criterion met"
      },
      {
        "criterion": "result.message.includes('DRY RUN')",
        "result": true,
        "explanation": "result.message contains 'DRY RUN'"
      }
    ]
  },
  "failCriteriaEvaluation": {
    "total": 3,
    "triggered": 0,
    "avoided": 3,
    "details": [
      {
        "criterion": "result.committed === true",
        "triggered": false,
        "explanation": "result.committed is undefined, not true (good)"
      },
      {
        "criterion": "result.newStorageId !== undefined",
        "triggered": false,
        "explanation": "result.newStorageId is undefined (good)"
      },
      {
        "criterion": "result.preview === undefined",
        "triggered": false,
        "explanation": "result.preview is defined (good)"
      }
    ]
  },
  "summary": {
    "verdict": "PASS",
    "reason": "All 8 pass criteria met, 0 fail criteria triggered",
    "confidence": "HIGH",
    "recommendation": "Test passed successfully. Tool behavior matches expected specification."
  }
}
```

---

## Boolean Criteria Types

### 1. Equality Checks
```typescript
"result.dryRun === true"
"result.committed === undefined"
"result.message === 'Expected message'"
```

### 2. Inequality Checks
```typescript
"result.newStorageId !== undefined"
"result.error !== null"
```

### 3. Comparison Operators
```typescript
"result.affectedRows > 0"
"result.changedCells >= 1"
"result.executionTime < 5000"
```

### 4. String Operations
```typescript
"result.message.includes('DRY RUN')"
"result.message.startsWith('Error:')"
"result.error.message.includes('not found')"
```

### 5. Array Operations
```typescript
"result.preview.length > 0"
"result.preview.every(p => p.row >= 0)"
"result.preview.some(p => p.old !== p.new)"
```

### 6. Type Checks
```typescript
"typeof result.affectedRows === 'number'"
"Array.isArray(result.preview)"
"result.dryRun === true || result.dryRun === false"
```

### 7. Logical Operations
```typescript
"result.dryRun === true && result.committed === undefined"
"result.error !== undefined || result.result !== undefined"
```

---

## Example Judge Prompts

### Prompt 1: Simple Evaluation

```
You are an LLM judge evaluating a spreadsheet tool test result.

Test Input:
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "operations": [{"type": "updateColumn", "columnName": "Status", "value": "Active"}],
  "dryRun": true
}

Actual Result:
{
  "dryRun": true,
  "affectedRows": 13,
  "changedCells": 10,
  "preview": [{"row": 0, "col": 5, "old": "Inactive", "new": "Active"}],
  "message": "DRY RUN: Would update 10 cells across 13 rows..."
}

Pass Criteria (all must be true):
1. result.dryRun === true
2. result.committed === undefined
3. result.affectedRows > 0
4. result.preview !== undefined
5. result.message.includes("DRY RUN")

Fail Criteria (all must be false):
1. result.committed === true
2. result.newStorageId !== undefined

Evaluate each criterion and provide a PASS/FAIL verdict with explanation.
```

### Prompt 2: Error Case Evaluation

```
You are an LLM judge evaluating a spreadsheet tool error handling test.

Test Input:
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "operations": [{"type": "updateColumn", "columnName": "InvalidColumn", "value": "Test"}],
  "dryRun": true
}

Actual Result:
Error: Column "InvalidColumn" not found in headers

Pass Criteria (all must be true):
1. error !== undefined
2. error.message.includes("not found in headers")
3. error.message.includes("InvalidColumn")

Fail Criteria (all must be false):
1. result.affectedRows > 0
2. result.committed === true

Evaluate each criterion and provide a PASS/FAIL verdict with explanation.
```

---

## Judge Decision Tree

```
START
  ↓
Evaluate all pass criteria
  ↓
All pass criteria === true?
  ├─ NO → VERDICT: FAIL
  │       REASON: "X of Y pass criteria failed"
  │       OUTPUT: List failed criteria
  │
  └─ YES → Evaluate all fail criteria
            ↓
          Any fail criteria === true?
            ├─ YES → VERDICT: FAIL
            │        REASON: "X fail conditions triggered"
            │        OUTPUT: List triggered fail conditions
            │
            └─ NO → VERDICT: PASS
                    REASON: "All pass criteria met, no fail conditions triggered"
                    OUTPUT: Success summary
```

---

## Confidence Levels

The judge should assign confidence based on criterion clarity:

```typescript
function computeConfidence(criteria: Criterion[]): "HIGH" | "MEDIUM" | "LOW" {
  const ambiguousCriteria = criteria.filter(c => 
    c.includes("approximately") || 
    c.includes("around") ||
    c.includes("roughly")
  );
  
  if (ambiguousCriteria.length === 0) {
    return "HIGH"; // All criteria are deterministic
  } else if (ambiguousCriteria.length < criteria.length / 2) {
    return "MEDIUM"; // Some ambiguity
  } else {
    return "LOW"; // Too much ambiguity
  }
}
```

**For this spreadsheet tool**: All criteria are deterministic → **HIGH confidence**

---

## Summary

The LLM judge protocol ensures:

✅ **Deterministic evaluation** - Boolean criteria only  
✅ **No arbitrary numbers** - All thresholds are meaningful (e.g., `> 0` means "at least one")  
✅ **Clear pass/fail** - No subjective judgment required  
✅ **Explainable results** - Each criterion has a clear explanation  
✅ **High confidence** - All criteria are unambiguous  

This protocol enables automated, reliable test evaluation by any LLM without human intervention.

