import { describe, expect, it } from "vitest";

import { createReportCrmCsv } from "./reportActions";

describe("createReportCrmCsv", () => {
  it("exports report identity and CRM-ready fields with escaped values", () => {
    const csv = createReportCrmCsv({
      id: "orbital",
      kind: "Company",
      title: 'Orbital "Labs"',
      summary: "Voice-agent eval infra",
      state: "verified",
      sources: 14,
      updated: "2h ago",
      watched: true,
    });

    expect(csv).toContain('"record_type","name","category","status"');
    expect(csv).toContain('"Orbital ""Labs"""');
    expect(csv).toContain('"14"');
    expect(csv).toContain('"true"');
  });
});
