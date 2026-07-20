# Spreadsheet Bulk Update Tool

## Overview

The `bulkUpdateSpreadsheet` tool enables the Fast Agent to perform bulk updates on CSV and Excel spreadsheets with comprehensive safety controls and audit trails.

## Architecture

### File-Based Approach
- **Storage**: CSV/Excel files in Convex Storage
- **Processing**: In-memory manipulation using PapaParse
- **Persistence**: Full file re-upload (not incremental)
- **No Database Migration Required**: Works with existing file-based architecture

### Safety Features

1. **Dry-Run by Default**
   - All operations default to `dryRun: true`
   - Returns preview of changes without committing

2. **Dual Confirmation Gate**
   - Requires BOTH `dryRun: false` AND `confirm: true` to commit
   - Prevents accidental bulk writes

3. **Change Preview**
   - Shows first 10 cell changes before committing
   - Includes row/column indices, old values, and new values

4. **Authentication Required**
   - Only authenticated users can modify files
   - Uses Convex auth context

5. **Audit Trail**
   - Tracks affected rows and changed cells
   - Records execution time
   - Returns new storage ID for version tracking

## Tool Signature

```typescript
bulkUpdateSpreadsheet: {
  description: "Bulk update spreadsheet rows or columns with safety controls",
  args: {
    documentId: string,           // Convex document ID
    operations: Operation[],      // Array of update operations
    dryRun?: boolean,            // Default: true
    confirm?: boolean            // Default: false
  },
  returns: BulkUpdateResult
}
```

## Operation Types

### 1. Update Column (Scalar)
Set all rows in a column to the same value.

```typescript
{
  type: "updateColumn",
  columnName: "Status",        // OR columnIndex: 5
  value: "Active"
}
```

### 2. Update Column (Vector)
Set each row to different values.

```typescript
{
  type: "updateColumn",
  columnName: "Score",
  values: [100, 95, 88, 92]    // Must match row count
}
```

### 3. Update Row
Replace entire row with new values.

```typescript
{
  type: "updateRow",
  rowIndex: 3,
  values: ["Company", "domain.com", "Description", ...]
}
```

## Return Value

```typescript
{
  dryRun: boolean,              // Whether this was a dry run
  committed?: boolean,          // Whether changes were committed
  affectedRows: number,         // Number of rows modified
  changedCells: number,         // Number of cells changed
  preview?: Array<{             // First 10 changes (dry-run only)
    row: number,
    col: number,
    old: string,
    new: string
  }>,
  newStorageId?: string,        // New file storage ID (commit only)
  message: string,              // Human-readable result
  executionTime: number         // Milliseconds
}
```

## Usage Examples

### Example 1: Dry-Run Preview
```typescript
const result = await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [{
    type: "updateColumn",
    columnName: "AlreadyTalkingTier",
    value: "High"
  }],
  dryRun: true  // Default
});

// Result:
// {
//   dryRun: true,
//   affectedRows: 13,
//   changedCells: 10,
//   preview: [
//     { row: 0, col: 29, old: "Medium", new: "High" },
//     { row: 1, col: 29, old: "Low", new: "High" },
//     ...
//   ],
//   message: "DRY RUN: Would update 10 cells across 13 rows..."
// }
```

### Example 2: Commit Changes
```typescript
const result = await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [{
    type: "updateColumn",
    columnName: "AlreadyTalkingTier",
    value: "High"
  }],
  dryRun: false,
  confirm: true  // BOTH required to commit
});

// Result:
// {
//   dryRun: false,
//   committed: true,
//   affectedRows: 13,
//   changedCells: 10,
//   newStorageId: "kg22z6a9eywfx7z5zyafbmn58n7n0h96",
//   message: "Successfully updated 10 cells across 13 rows."
// }
```

### Example 3: Multiple Operations
```typescript
const result = await bulkUpdateSpreadsheet({
  documentId: "jx73n3c3ea8j5r3sa01zy5xq697n17j8",
  operations: [
    {
      type: "updateColumn",
      columnName: "Status",
      value: "Active"
    },
    {
      type: "updateRow",
      rowIndex: 0,
      values: ["Anthropic", "anthropic.com", "Updated description", ...]
    }
  ],
  dryRun: true
});
```

## Error Handling

### Common Errors

1. **CommitNotConfirmed**
   ```
   Error: CommitNotConfirmed: Set both dryRun=false AND confirm=true to commit changes
   ```
   Solution: Explicitly set both flags to commit.

2. **Column Not Found**
   ```
   Error: Column "InvalidName" not found in headers
   ```
   Solution: Check column name spelling or use columnIndex.

3. **VectorLengthMismatch**
   ```
   Error: VectorLengthMismatch: Provided 5 values but sheet has 13 rows
   ```
   Solution: Ensure values array length matches row count.

4. **Row Index Out of Bounds**
   ```
   Error: Row index 100 out of bounds (0-12)
   ```
   Solution: Use valid row index (0-based).

5. **Not Authenticated**
   ```
   Error: Not authenticated
   ```
   Solution: Ensure user is logged in.

## Fast Agent Integration

The tool is registered in `convex/aiAgents.ts` and available to the Fast Agent:

```typescript
bulkUpdateSpreadsheet: createTool({
  description: `Bulk update spreadsheet rows or columns with safety controls...`,
  args: z.object({
    documentId: z.string(),
    operations: z.array(...),
    dryRun: z.boolean().default(true).optional(),
    confirm: z.boolean().default(false).optional(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.runAction(
      api.actions.spreadsheetActions.bulkUpdateSpreadsheet,
      args
    );
    return formatResultForAI(result);
  }
})
```

## Testing

### Unit Tests
Located in `convex/actions/__tests__/spreadsheetActions.test.ts`

### Integration Test
Use the internal test action:

```typescript
await ctx.runAction(
  internal.actions.spreadsheetActions.testBulkUpdateSpreadsheet,
  {
    documentId: "jx73n3c3ea8j5r3sa01zy5xq697n16es",
    userId: "k17f4ess745re511ckkcfqce697n16es",
    operations: [...],
    dryRun: true
  }
);
```

## Performance Considerations

- **File Size**: Tested with 13-row CSV (35 columns)
- **Execution Time**: ~760ms for dry-run (includes download, parse, diff)
- **Memory**: In-memory processing (entire file loaded)
- **Scalability**: Suitable for files up to ~10,000 rows

## Future Enhancements

1. **Incremental Updates**: Use delta operations instead of full file re-upload
2. **Excel Support**: Implement multi-sheet Excel handling
3. **Filter Expressions**: Add row filtering before updates
4. **Batch Operations**: Support multiple files in one call
5. **Real-time Sync**: Add Convex subscriptions for multi-user editing
6. **Column Filtering**: Optimize column-based queries with indexes

