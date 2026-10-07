# Spreadsheet Bulk Update Tool - Test Scenarios

## Test Data

**File**: companies.csv  
**Document ID**: `jx73n3c3ea8j5r3sa01zy5xq697n17j8`  
**User ID**: `k17f4ess745re511ckkcfqce697n16es`  
**Rows**: 13 companies  
**Columns**: 35 fields (Company, Domain, Description, various Tier fields, etc.)

## Test Scenario 1: Dry-Run Column Update (Scalar)

### Objective
Verify that dry-run mode previews changes without committing to storage.

### Test Input
```json
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "userId": "k17f4ess745re511ckkcfqce697n16es",
  "operations": [{
    "type": "updateColumn",
    "columnName": "AlreadyTalkingTier",
    "value": "High"
  }],
  "dryRun": true
}
```

### Expected Output
```json
{
  "dryRun": true,
  "affectedRows": 13,
  "changedCells": 10,
  "preview": [
    {"row": 0, "col": 29, "old": "Medium", "new": "High"},
    {"row": 1, "col": 29, "old": "...", "new": "High"}
  ],
  "message": "DRY RUN: Would update 10 cells across 13 rows. Set dryRun=false and confirm=true to commit."
}
```

### Pass Criteria (Boolean)
- ✅ `result.dryRun === true`
- ✅ `result.committed === undefined`
- ✅ `result.affectedRows > 0`
- ✅ `result.changedCells > 0`
- ✅ `result.preview !== undefined`
- ✅ `result.preview.length > 0`
- ✅ `result.newStorageId === undefined`
- ✅ `result.message.includes("DRY RUN")`

### Fail Criteria (Boolean)
- ❌ `result.committed === true` (should not commit in dry-run)
- ❌ `result.newStorageId !== undefined` (should not create new file)
- ❌ `result.preview === undefined` (must show preview)

---

## Test Scenario 2: Commit Column Update

### Objective
Verify that explicit confirmation commits changes to storage.

### Test Input
```json
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "userId": "k17f4ess745re511ckkcfqce697n16es",
  "operations": [{
    "type": "updateColumn",
    "columnName": "AlreadyTalkingTier",
    "value": "Very High"
  }],
  "dryRun": false,
  "confirm": true
}
```

### Expected Output
```json
{
  "dryRun": false,
  "committed": true,
  "affectedRows": 13,
  "changedCells": 10,
  "newStorageId": "kg22z6a9eywfx7z5zyafbmn58n7n0h96",
  "message": "Successfully updated 10 cells across 13 rows."
}
```

### Pass Criteria (Boolean)
- ✅ `result.dryRun === false`
- ✅ `result.committed === true`
- ✅ `result.affectedRows > 0`
- ✅ `result.changedCells > 0`
- ✅ `result.newStorageId !== undefined`
- ✅ `result.newStorageId.length > 0`
- ✅ `result.message.includes("Successfully")`
- ✅ `result.preview === undefined` (no preview in commit mode)

### Fail Criteria (Boolean)
- ❌ `result.committed === false` (should commit when confirmed)
- ❌ `result.newStorageId === undefined` (must create new file)
- ❌ `result.message.includes("DRY RUN")` (should not be dry-run)

---

## Test Scenario 3: Safety Gate - Missing Confirmation

### Objective
Verify that attempting to commit without explicit confirmation fails.

### Test Input
```json
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "userId": "k17f4ess745re511ckkcfqce697n16es",
  "operations": [{
    "type": "updateColumn",
    "columnName": "AlreadyTalkingTier",
    "value": "High"
  }],
  "dryRun": false,
  "confirm": false
}
```

### Expected Output
```
Error: CommitNotConfirmed: Set both dryRun=false AND confirm=true to commit changes
```

### Pass Criteria (Boolean)
- ✅ `error !== undefined`
- ✅ `error.message.includes("CommitNotConfirmed")`
- ✅ `error.message.includes("dryRun=false AND confirm=true")`

### Fail Criteria (Boolean)
- ❌ `error === undefined` (should throw error)
- ❌ `result.committed === true` (should not commit)

---

## Test Scenario 4: Column Not Found Error

### Objective
Verify that invalid column names are caught and reported.

### Test Input
```json
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "userId": "k17f4ess745re511ckkcfqce697n16es",
  "operations": [{
    "type": "updateColumn",
    "columnName": "NonExistentColumn",
    "value": "Test"
  }],
  "dryRun": true
}
```

### Expected Output
```
Error: Column "NonExistentColumn" not found in headers
```

### Pass Criteria (Boolean)
- ✅ `error !== undefined`
- ✅ `error.message.includes("not found in headers")`
- ✅ `error.message.includes("NonExistentColumn")`

### Fail Criteria (Boolean)
- ❌ `error === undefined` (should throw error)
- ❌ `result.affectedRows > 0` (should not affect any rows)

---

## Test Scenario 5: Update Row Operation

### Objective
Verify that entire rows can be updated.

### Test Input
```json
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "userId": "k17f4ess745re511ckkcfqce697n16es",
  "operations": [{
    "type": "updateRow",
    "rowIndex": 0,
    "values": ["Test Company", "test.com", "Test Description", ...]
  }],
  "dryRun": true
}
```

### Expected Output
```json
{
  "dryRun": true,
  "affectedRows": 1,
  "changedCells": 35,
  "preview": [
    {"row": 0, "col": 0, "old": "Anthropic", "new": "Test Company"},
    {"row": 0, "col": 1, "old": "anthropic.com", "new": "test.com"}
  ],
  "message": "DRY RUN: Would update 35 cells across 1 rows..."
}
```

### Pass Criteria (Boolean)
- ✅ `result.dryRun === true`
- ✅ `result.affectedRows === 1`
- ✅ `result.changedCells > 0`
- ✅ `result.preview !== undefined`
- ✅ `result.preview.every(p => p.row === 0)` (all changes in row 0)

### Fail Criteria (Boolean)
- ❌ `result.affectedRows !== 1` (should only affect one row)
- ❌ `result.preview.some(p => p.row !== 0)` (should not affect other rows)

---

## Test Scenario 6: Multiple Operations

### Objective
Verify that multiple operations can be applied in sequence.

### Test Input
```json
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "userId": "k17f4ess745re511ckkcfqce697n16es",
  "operations": [
    {
      "type": "updateColumn",
      "columnName": "AlreadyTalkingTier",
      "value": "High"
    },
    {
      "type": "updateColumn",
      "columnName": "BurnOutTier",
      "value": "Low"
    }
  ],
  "dryRun": true
}
```

### Expected Output
```json
{
  "dryRun": true,
  "affectedRows": 13,
  "changedCells": 20,
  "preview": [...]
}
```

### Pass Criteria (Boolean)
- ✅ `result.dryRun === true`
- ✅ `result.affectedRows === 13`
- ✅ `result.changedCells > 10` (changes from both operations)
- ✅ `result.preview !== undefined`

### Fail Criteria (Boolean)
- ❌ `result.changedCells <= 10` (should have changes from both operations)

---

## Test Scenario 7: Vector Update (Column with Array)

### Objective
Verify that vector updates apply different values to each row.

### Test Input
```json
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "userId": "k17f4ess745re511ckkcfqce697n16es",
  "operations": [{
    "type": "updateColumn",
    "columnName": "TotalScore",
    "values": [50, 45, 40, 48, 35, 30, 42, 44, 38, 40, 36, 34, 32]
  }],
  "dryRun": true
}
```

### Expected Output
```json
{
  "dryRun": true,
  "affectedRows": 13,
  "changedCells": 13,
  "preview": [
    {"row": 0, "col": 31, "old": "42", "new": "50"},
    {"row": 1, "col": 31, "old": "39", "new": "45"}
  ]
}
```

### Pass Criteria (Boolean)
- ✅ `result.dryRun === true`
- ✅ `result.affectedRows === 13`
- ✅ `result.changedCells === 13`
- ✅ `result.preview !== undefined`
- ✅ `result.preview.every(p => p.col === 31)` (all in TotalScore column)

### Fail Criteria (Boolean)
- ❌ `result.changedCells !== 13` (should update all 13 rows)
- ❌ `result.preview.some(p => p.col !== 31)` (should only affect TotalScore)

---

## Test Scenario 8: Vector Length Mismatch Error

### Objective
Verify that vector updates with wrong length are rejected.

### Test Input
```json
{
  "documentId": "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  "userId": "k17f4ess745re511ckkcfqce697n16es",
  "operations": [{
    "type": "updateColumn",
    "columnName": "TotalScore",
    "values": [50, 45, 40]
  }],
  "dryRun": true
}
```

### Expected Output
```
Error: VectorLengthMismatch: Provided 3 values but sheet has 13 rows
```

### Pass Criteria (Boolean)
- ✅ `error !== undefined`
- ✅ `error.message.includes("VectorLengthMismatch")`
- ✅ `error.message.includes("3 values")`
- ✅ `error.message.includes("13 rows")`

### Fail Criteria (Boolean)
- ❌ `error === undefined` (should throw error)
- ❌ `result.committed === true` (should not commit)

---

## Automated Test Execution

### Test Runner Template

```typescript
async function runTest(scenario: TestScenario): Promise<TestResult> {
  try {
    const result = await ctx.runAction(
      internal.actions.spreadsheetActions.testBulkUpdateSpreadsheet,
      scenario.input
    );
    
    return {
      scenarioName: scenario.name,
      passed: evaluatePassCriteria(result, scenario.passCriteria),
      failed: evaluateFailCriteria(result, scenario.failCriteria),
      result
    };
  } catch (error) {
    return {
      scenarioName: scenario.name,
      passed: evaluatePassCriteria(error, scenario.passCriteria),
      failed: evaluateFailCriteria(error, scenario.failCriteria),
      error
    };
  }
}
```

### Pass/Fail Evaluation

```typescript
function evaluatePassCriteria(result: any, criteria: string[]): boolean {
  return criteria.every(criterion => {
    // Parse criterion like "result.dryRun === true"
    return eval(criterion);
  });
}

function evaluateFailCriteria(result: any, criteria: string[]): boolean {
  return criteria.every(criterion => {
    // Parse criterion like "result.committed === true"
    // Should return false (i.e., the fail condition did NOT occur)
    return !eval(criterion);
  });
}
```

## Summary

All test scenarios use **boolean pass/fail criteria** without arbitrary numbers:
- ✅ Equality checks (`===`, `!==`)
- ✅ Existence checks (`!== undefined`, `=== undefined`)
- ✅ String inclusion (`includes()`)
- ✅ Array operations (`every()`, `some()`)
- ✅ Comparison operators for counts (`> 0`, `=== 1`)

No floating-point or arbitrary integer thresholds are used.

