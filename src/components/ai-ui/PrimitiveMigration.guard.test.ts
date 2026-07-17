import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const migratedSurfaces = [
  "src/shared/components/DialogOverlay.tsx",
  "src/features/chat/components/ChatShareSheet.tsx",
  "src/features/chat/components/ThreadActionsSheet.tsx",
  "src/features/reports/components/ReportShareSheet.tsx",
  "src/features/research/ProofDrawer.tsx",
  "src/features/research/components/FeedReaderModal.tsx",
  "src/features/research/components/newsletter/EvidenceDrawer.tsx",
  "src/features/controlPlane/components/DelegationModal.tsx",
  "src/features/onboarding/components/OnboardingWizard.tsx",
  "src/features/redesign/components/ShortcutsOverlay.tsx",
  "src/features/redesign/components/MobileShell.tsx",
  "src/shared/components/MiniEditorPopover.tsx",
  "src/features/calendar/components/agenda/AgendaEditorPopover.tsx",
  "src/features/calendar/components/agenda/AgendaMiniRow.tsx",
  "src/layouts/chrome/HashtagQuickNotePopover.tsx",
  "src/features/founder/components/FeedbackWidget.tsx",
  "src/features/notebook/components/NotebookBlockFinder.tsx",
  "src/features/redesign/components/CommandPalette.tsx",
  "src/layouts/chrome/CommandPalette.tsx",
  "src/features/redesign/components/MessageActions.tsx",
  "src/shared/ui/SurfacePrimitives.tsx",
  "src/features/redesign/surfaces/ReportsSurface.tsx",
  "src/layouts/settings/SettingsModal.tsx",
  "src/features/research/components/DeepDiveAccordion.tsx",
  "src/features/documents/components/documentsHub/planner/PlannerModeToggle.tsx",
  "src/features/redesign/surfaces/ChatSurface.tsx",
  "src/layouts/CockpitLayout.tsx",
  "src/features/product/components/ProductFileAssetPicker.tsx",
  "src/features/documents/components/DocumentsPlannerOverlays.tsx",
  "src/features/entities/views/EntityPage.tsx",
].map((path) => join(ROOT, path));

const migratedOverlaySurfaces = [
  "src/shared/components/DialogOverlay.tsx",
  "src/features/chat/components/ChatShareSheet.tsx",
  "src/features/chat/components/ThreadActionsSheet.tsx",
  "src/features/reports/components/ReportShareSheet.tsx",
  "src/features/research/ProofDrawer.tsx",
  "src/features/research/components/FeedReaderModal.tsx",
  "src/features/research/components/newsletter/EvidenceDrawer.tsx",
  "src/features/controlPlane/components/DelegationModal.tsx",
  "src/features/onboarding/components/OnboardingWizard.tsx",
  "src/features/redesign/components/MobileShell.tsx",
  "src/shared/components/MiniEditorPopover.tsx",
  "src/features/calendar/components/agenda/AgendaEditorPopover.tsx",
  "src/features/calendar/components/agenda/AgendaMiniRow.tsx",
  "src/layouts/chrome/HashtagQuickNotePopover.tsx",
  "src/features/founder/components/FeedbackWidget.tsx",
  "src/features/notebook/components/NotebookBlockFinder.tsx",
  "src/features/product/components/ProductFileAssetPicker.tsx",
  "src/features/documents/components/DocumentsPlannerOverlays.tsx",
  "src/features/entities/views/EntityPage.tsx",
].map((path) => join(ROOT, path));

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function rel(path: string) {
  return relative(ROOT, path).replaceAll("\\", "/");
}

function implementation(path: string) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("shadcn/Radix primitive adoption", () => {
  it("keeps migrated dialog semantics on shared primitives", () => {
    const offenders = migratedOverlaySurfaces.flatMap((path) => {
      const source = implementation(path);
      if (!/aria-modal=|role=["']dialog["']/.test(source)) return [];
      if (/components\/ai-ui\/(?:command|dialog|popover|sheet)/.test(source)) return [];
      return [rel(path)];
    });

    expect(offenders).toEqual([]);
  });

  it("does not reintroduce handwritten tab, listbox, or menu roles on migrated surfaces", () => {
    const offenders = migratedSurfaces.flatMap((path) =>
      /role=["'](?:listbox|menu|menuitem|option|tab|tablist)["']/.test(implementation(path))
        ? [rel(path)]
        : [],
    );

    expect(offenders).toEqual([]);
  });

  it("leaves portals only in editor decoration infrastructure", () => {
    const portalFiles = sourceFiles()
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => implementation(path).includes("createPortal("))
      .map(rel)
      .sort();

    expect(portalFiles).toEqual([
      "src/features/editor/components/UnifiedEditor/PendingEditHighlights.tsx",
      "src/features/editor/components/UnifiedEditor/ProposalInlineDecorations.tsx",
    ]);
  });

  it("delegates global keyboard dismissal to primitives on migrated surfaces", () => {
    const offenders = migratedOverlaySurfaces.flatMap((path) =>
      /addEventListener\(["']keydown["']/.test(implementation(path)) ? [rel(path)] : [],
    );

    expect(offenders).toEqual([]);
  });

  it("removes retired handwritten focus and bottom-sheet hooks", () => {
    expect(existsSync(join(SRC, "hooks/useFocusTrap.ts"))).toBe(false);
    expect(existsSync(join(SRC, "hooks/useKeyboardNavigation.tsx"))).toBe(false);
    expect(
      existsSync(
        join(SRC, "features/agents/components/FastAgentPanel/useBottomSheet.ts"),
      ),
    ).toBe(false);
  });

  it("keeps the report action item primitive imported at runtime", () => {
    const source = readFileSync(
      join(SRC, "features/redesign/surfaces/ReportsSurface.tsx"),
      "utf8",
    );
    expect(source).toMatch(/DropdownMenuContent,\s+DropdownMenuItem,/);
    expect(source).toContain("<DropdownMenuItem");
  });
});
