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

  it("derives the CRM record type from the saved report kind", () => {
    const csv = createReportCrmCsv({
      id: "person-ada",
      kind: "Person Profile",
      title: "Ada Lovelace",
      summary: "Saved profile",
      state: "verified",
      sources: 3,
      updated: "today",
      watched: false,
    });

    expect(csv.split("\n")[1]).toContain('"person_profile"');
    expect(csv.split("\n")[1]).not.toContain('"company"');
  });
});
