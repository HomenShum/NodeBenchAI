import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("canonical runtime surface deduplication", () => {
  it("reuses the owner-scoped Inbox and Me trees in the redesign shell", () => {
    const inbox = read("src/features/redesign/surfaces/InboxSurface.tsx");
    const me = read("src/features/redesign/surfaces/MeSurface.tsx");

    expect(inbox).toContain("<ExactInboxSurface />");
    expect(me).toContain("<ExactMeSurface />");

    for (const source of [inbox, me]) {
      expect(source).not.toContain("useState");
      expect(source).not.toContain("showToast");
      expect(source).not.toContain("Local draft");
      expect(source).not.toContain("Founder · $49/mo");
      expect(source.match(/return\s*</g)).toHaveLength(1);
    }
  });
});
