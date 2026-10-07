import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/src/features/agents/components/FastAgentPanel/FastAgentPanel.TraceAuditPanel.tsx",
  ),
  "utf8",
);

describe("TRACE audit provenance labels", () => {
  it("does not brand mixed runtime steps as universally deterministic", () => {
    expect(source).toContain("AUDIT LOG");
    expect(source).toContain('entry.provenance === "ai_model"');
    expect(source).toContain('entry.provenance === "deterministic_code"');
    expect(source).toContain('"AI model"');
    expect(source).toContain('"Code"');
    expect(source).not.toContain("Steps executed by deterministic code");
    expect(source).not.toContain("DETERMINISTIC");
    expect(source).not.toContain("TraceContentLabeler");
  });
});
