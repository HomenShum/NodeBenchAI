import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("compact chat response rendering", () => {
  it("does not re-inflate exact compact answers with empty memo sections", () => {
    const chat = read("src/features/redesign/surfaces/ChatSurface.tsx");
    const replay = read("src/features/redesign/pages/ReproducibleChatPage.tsx");

    expect(chat).toContain("packet.whyItMatters.trim() &&");
    expect(chat).toContain("!isCompactResponse && packet.evidence.length > 0 &&");
    expect(chat).toContain("packet.risks.length > 0 &&");
    expect(chat).toContain("packet.nextAction.trim() &&");
    expect(replay).toContain("packet.whyItMatters?.trim() &&");
    expect(replay).toContain("!isCompactResponse && evidenceWithCites.length > 0 &&");
  });
});
