import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("first-class agent workspace honesty contract", () => {
  const chat = read("src/features/redesign/surfaces/ChatSurface.tsx");
  const inspector = read("src/features/redesign/components/RightInspector.tsx");
  const shell = read("src/features/redesign/RedesignShell.tsx");

  it("exposes one runtime-grounded read, write, and verification contract", () => {
    expect(chat).toContain("AgentWorkspaceHeader");
    expect(chat).toContain('writes: "Review mode · no automatic shared writes"');
    expect(chat).toContain("runtimeContextPacket.selectedContext.length");
    expect(chat).toContain("blockedClaimCount");
    expect(inspector).toContain('title="Scope"');
    expect(inspector).toContain("Open review workspace");
  });

  it("does not simulate execution or advertise toast-only work controls", () => {
    expect(chat).not.toContain("Tick the live batch counters so it feels alive");
    expect(chat).not.toContain("spentUsd + inc");
    expect(chat).not.toContain("batch_${target.universeId}");
    expect(chat).not.toContain("Scroll to bottom on mount");
    expect(chat).not.toContain('>Track updates<');
    expect(chat).not.toContain('>Export<');
    expect(inspector).not.toContain("traceBarWidth");
    expect(inspector).not.toContain("traceDuration");
    expect(inspector).not.toContain('title="Agents"');
    expect(shell).toContain('surface !== "chat"');
  });
});
