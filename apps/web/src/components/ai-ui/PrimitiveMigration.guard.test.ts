import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "apps", "web", "src");

const migratedSurfaces = [
  "apps/web/src/shared/components/DialogOverlay.tsx",
  "apps/web/src/features/chat/components/ChatShareSheet.tsx",
  "apps/web/src/features/chat/components/ThreadActionsSheet.tsx",
  "apps/web/src/features/reports/components/ReportShareSheet.tsx",
  "apps/web/src/features/research/ProofDrawer.tsx",
  "apps/web/src/features/research/components/FeedReaderModal.tsx",
  "apps/web/src/features/research/components/newsletter/EvidenceDrawer.tsx",
  "apps/web/src/features/controlPlane/components/DelegationModal.tsx",
  "apps/web/src/features/onboarding/components/OnboardingWizard.tsx",
  "apps/web/src/features/redesign/components/ShortcutsOverlay.tsx",
  "apps/web/src/features/redesign/components/MobileShell.tsx",
  "apps/web/src/shared/components/MiniEditorPopover.tsx",
  "apps/web/src/features/calendar/components/agenda/AgendaEditorPopover.tsx",
  "apps/web/src/features/calendar/components/agenda/AgendaMiniRow.tsx",
  "apps/web/src/layouts/chrome/HashtagQuickNotePopover.tsx",
  "apps/web/src/features/founder/components/FeedbackWidget.tsx",
  "apps/web/src/features/notebook/components/NotebookBlockFinder.tsx",
  "apps/web/src/features/redesign/components/CommandPalette.tsx",
  "apps/web/src/layouts/chrome/CommandPalette.tsx",
  "apps/web/src/features/redesign/components/MessageActions.tsx",
  "apps/web/src/shared/ui/SurfacePrimitives.tsx",
  "apps/web/src/features/redesign/surfaces/ReportsSurface.tsx",
  "apps/web/src/layouts/settings/SettingsModal.tsx",
  "apps/web/src/features/research/components/DeepDiveAccordion.tsx",
  "apps/web/src/features/documents/components/documentsHub/planner/PlannerModeToggle.tsx",
  "apps/web/src/features/redesign/surfaces/ChatSurface.tsx",
  "apps/web/src/layouts/CockpitLayout.tsx",
  "apps/web/src/features/product/components/ProductFileAssetPicker.tsx",
  "apps/web/src/features/documents/components/DocumentsPlannerOverlays.tsx",
  "apps/web/src/features/entities/views/EntityPage.tsx",
].map((path) => join(ROOT, path));

const migratedOverlaySurfaces = [
  "apps/web/src/shared/components/DialogOverlay.tsx",
  "apps/web/src/features/chat/components/ChatShareSheet.tsx",
  "apps/web/src/features/chat/components/ThreadActionsSheet.tsx",
  "apps/web/src/features/reports/components/ReportShareSheet.tsx",
  "apps/web/src/features/research/ProofDrawer.tsx",
  "apps/web/src/features/research/components/FeedReaderModal.tsx",
  "apps/web/src/features/research/components/newsletter/EvidenceDrawer.tsx",
  "apps/web/src/features/controlPlane/components/DelegationModal.tsx",
  "apps/web/src/features/onboarding/components/OnboardingWizard.tsx",
  "apps/web/src/features/redesign/components/MobileShell.tsx",
  "apps/web/src/shared/components/MiniEditorPopover.tsx",
  "apps/web/src/features/calendar/components/agenda/AgendaEditorPopover.tsx",
  "apps/web/src/features/calendar/components/agenda/AgendaMiniRow.tsx",
  "apps/web/src/layouts/chrome/HashtagQuickNotePopover.tsx",
  "apps/web/src/features/founder/components/FeedbackWidget.tsx",
  "apps/web/src/features/notebook/components/NotebookBlockFinder.tsx",
  "apps/web/src/features/product/components/ProductFileAssetPicker.tsx",
  "apps/web/src/features/documents/components/DocumentsPlannerOverlays.tsx",
  "apps/web/src/features/entities/views/EntityPage.tsx",
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
      "apps/web/src/features/editor/components/UnifiedEditor/PendingEditHighlights.tsx",
      "apps/web/src/features/editor/components/UnifiedEditor/ProposalInlineDecorations.tsx",
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
