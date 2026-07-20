import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("residual control primitive migration", () => {
  it.each([
    "src/features/controlPlane/views/LegalPage.tsx",
    "src/features/deepSim/views/DecisionMemoView.tsx",
    "src/features/research/views/ReportDetailWorkspace.tsx",
    "src/features/research/views/ResearchHub.tsx",
    "src/features/strategy/views/ExecutionTraceView.tsx",
    "src/features/strategy/views/ProductDirectionMemoView.tsx",
  ])("uses the shared Radix tabs contract in %s", (path) => {
    const source = read(path);
    expect(source).toContain("@/components/ai-ui/tabs");
    expect(source).toContain("<TabsList");
    expect(source).toContain("<TabsTrigger");
    expect(source).toContain("<TabsContent");
    expect(source).not.toMatch(/role=["'](?:tab|tablist|tabpanel)["']/);
  });

  it("delegates document filter and density keyboard behavior to ToggleGroup", () => {
    const toolbar = read("src/features/documents/components/FiltersToolsBar.tsx");
    const dataHook = read("src/features/documents/hooks/useDocumentData.ts");

    expect(toolbar).toContain("@/components/ai-ui/toggle-group");
    expect(toolbar.match(/<ToggleGroup(?:\s|\n)/g)).toHaveLength(2);
    expect(toolbar).not.toMatch(/role=["']tab/);
    expect(dataHook).not.toContain("onFilterKeyDown");
    expect(dataHook).not.toContain("filterButtonRefs");
  });

  it("models execution disclosure as a single-select toggle group", () => {
    const source = read("src/features/strategy/views/ExecutionTraceView.tsx");
    expect(source).toContain("<ToggleGroup");
    expect(source).toContain('aria-label="Execution trace disclosure levels"');
    expect(source).not.toContain('role="tablist"');
  });

  it("models composer modes, research lanes, and lenses as toggle groups", () => {
    const source = read("src/features/product/components/ProductIntakeComposer.tsx");
    expect(source).toContain("@/components/ai-ui/toggle-group");
    expect(source.match(/<ToggleGroup(?:\s|\n)/g)).toHaveLength(3);
    expect(source).not.toMatch(/role=["'](?:tab|tablist)["']/);
  });

  it("uses runtime report identity and ToggleGroup in the reports rail", () => {
    const source = read("src/features/redesign/surfaces/HomeV2PrototypeSurface.tsx");
    expect(source).toContain("@/components/ai-ui/toggle-group");
    expect(source).toContain("id: report.id");
    expect(source.match(/item\.id \?\? item\.name/g)).toHaveLength(2);
    expect(source).not.toContain('role="tablist" aria-label="Filter reports by status"');
  });
});
