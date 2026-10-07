import { describe, expect, it } from "vitest";

import { SPREADSHEET_EXECUTION_TRACE } from "../data/spreadsheetExecutionTrace";
import { EXECUTION_TRACE_JSON_SCHEMA, ExecutionTraceSchema } from "./executionTrace";

describe("ExecutionTraceSchema", () => {
  it("parses the seeded spreadsheet workflow trace", () => {
    expect(() => ExecutionTraceSchema.parse(SPREADSHEET_EXECUTION_TRACE)).not.toThrow();
  });

  it("exports a JSON schema contract", () => {
    expect(EXECUTION_TRACE_JSON_SCHEMA).toBeTruthy();
    const schema = EXECUTION_TRACE_JSON_SCHEMA as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };
    expect(schema.definitions?.NodeBenchExecutionTrace?.properties).toMatchObject({
      meta: expect.any(Object),
      run: expect.any(Object),
      steps: expect.any(Object),
      outputs: expect.any(Object),
    });
  });
});
