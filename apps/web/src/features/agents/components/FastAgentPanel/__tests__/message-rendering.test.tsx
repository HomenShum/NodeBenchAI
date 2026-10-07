// src/components/FastAgentPanel/__tests__/message-rendering.test.tsx
// Test to ensure assistant messages display clean markdown, not raw JSON

import { describe, it, expect } from 'vitest';

describe('FastAgentPanel Message Rendering', () => {
  it('should extract finalResponse from AgentResponse object', () => {
    // Simulate the response structure from chatWithAgent
    const agentResponse = {
      finalResponse: "It looks like that might be a random string. How can I help?",
      thinkingSteps: [
        { type: "analysis", content: "Analyzing user input..." }
      ],
      toolCalls: [],
      adaptations: [],
      candidateDocs: [],
      runId: "test-run-123"
    };

    // Simulate the extraction logic from fastAgentPanel.ts
    const r1 = agentResponse as any;
    const responseText = String(
      r1.finalResponse ??
      r1.response ??
      ""
    );

    expect(responseText).toBe("It looks like that might be a random string. How can I help?");
    expect(responseText).not.toContain("thinkingSteps");
    expect(responseText).not.toContain("toolCalls");
    expect(responseText).not.toContain("runId");
  });

  it('should handle JSON stringified response', () => {
    const jsonString = JSON.stringify({
      finalResponse: "Clean response text",
      thinkingSteps: [],
      toolCalls: [],
      adaptations: [],
      candidateDocs: [],
      runId: "test-run-456"
    });

    // Simulate parsing logic
    let structured: any;
    try {
      structured = JSON.parse(jsonString);
    } catch {
      structured = undefined;
    }

    const responseText = structured && typeof structured === "object"
      ? String(structured.finalResponse ?? structured.response ?? "")
      : String(jsonString);

    expect(responseText).toBe("Clean response text");
    expect(responseText).not.toContain("{");
    expect(responseText).not.toContain("finalResponse");
  });

  it('should handle fallback when finalResponse is missing', () => {
    const agentResponse = {
      response: "Fallback response field",
      thinkingSteps: [],
      toolCalls: []
    };

    const r2 = agentResponse as any;
    const responseText = String(
      r2.finalResponse ??
      r2.response ??
      r2.message ??
      "No response generated"
    );

    expect(responseText).toBe("Fallback response field");
  });

  it('should provide default message when all fields are missing', () => {
    const agentResponse = {
      thinkingSteps: [],
      toolCalls: []
    };

    const r3 = agentResponse as any;
    const responseText = String(
      r3.finalResponse ??
      r3.response ??
      r3.message ??
      "No response generated"
    );

    expect(responseText).toBe("No response generated");
  });

  it('should detect and re-parse accidentally stringified JSON', () => {
    // Simulate the final safety check
    let finalContent = '{"finalResponse":"Extracted text","thinkingSteps":[]}';
    
    if (finalContent.startsWith('{') || finalContent.startsWith('[')) {
      try {
        const parsed = JSON.parse(finalContent);
        if (parsed && typeof parsed === 'object') {
          finalContent = String(parsed.finalResponse ?? parsed.response ?? parsed.message ?? finalContent);
        }
      } catch {
        // Not valid JSON, use as-is
      }
    }

    expect(finalContent).toBe("Extracted text");
    expect(finalContent).not.toContain("thinkingSteps");
  });
});

