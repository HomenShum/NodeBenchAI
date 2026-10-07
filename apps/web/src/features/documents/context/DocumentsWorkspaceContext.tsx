/**
 * Route-local context provider for the documents workspace.
 *
 * Exposes separate context slices so consumers subscribe only to the
 * data they need. A change in document ordering does NOT rerender
 * planner subscribers, and vice versa.
 *
 * Usage:
 *   <DocumentsWorkspaceProvider {...hookValues}>
 *     <DocumentsWorkspaceSurface />
 *     <DocumentsPlannerOverlays />
 *   </DocumentsWorkspaceProvider>
 *
 * Consumer:
 *   const { filteredDocuments } = useDocumentDataCtx();
 *   const { goToNextWeek } = usePlannerDateNavCtx();
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  DocumentDataSlice,
  DocumentActionSlice,
  DocumentOrderSlice,
  DocumentUploadSlice,
  DocumentOverlaySlice,
  PlannerDateNavSlice,
  PlannerAgendaSlice,
  PlannerViewSlice,
  PlannerEditorSlice,
} from "./types";

// ─── Contexts ────────────────────────────────────────────────────────────────
// Exported so that DocumentsCoreProvider and DocumentsPlannerProvider can
// provide subsets of these contexts independently.
export const DocumentDataCtx = createContext<DocumentDataSlice | null>(null);
export const DocumentActionCtx = createContext<DocumentActionSlice | null>(null);
export const DocumentOrderCtx = createContext<DocumentOrderSlice | null>(null);
export const DocumentUploadCtx = createContext<DocumentUploadSlice | null>(null);
export const DocumentOverlayCtx = createContext<DocumentOverlaySlice | null>(null);
export const PlannerDateNavCtx = createContext<PlannerDateNavSlice | null>(null);
export const PlannerAgendaCtx = createContext<PlannerAgendaSlice | null>(null);
export const PlannerViewCtx = createContext<PlannerViewSlice | null>(null);
export const PlannerEditorCtx = createContext<PlannerEditorSlice | null>(null);

// ─── Hooks ───────────────────────────────────────────────────────────────────
function useSlice<T>(ctx: React.Context<T | null>, name: string): T {
  const value = useContext(ctx);
  if (!value) throw new Error(`${name} must be used inside <DocumentsWorkspaceProvider>`);
  return value;
}

export const useDocumentDataCtx = () => useSlice(DocumentDataCtx, "useDocumentDataCtx");
export const useDocumentActionCtx = () => useSlice(DocumentActionCtx, "useDocumentActionCtx");
export const useDocumentOrderCtx = () => useSlice(DocumentOrderCtx, "useDocumentOrderCtx");
export const useDocumentUploadCtx = () => useSlice(DocumentUploadCtx, "useDocumentUploadCtx");
export const useDocumentOverlayCtx = () => useSlice(DocumentOverlayCtx, "useDocumentOverlayCtx");
export const usePlannerDateNavCtx = () => useSlice(PlannerDateNavCtx, "usePlannerDateNavCtx");
export const usePlannerAgendaCtx = () => useSlice(PlannerAgendaCtx, "usePlannerAgendaCtx");
export const usePlannerViewCtx = () => useSlice(PlannerViewCtx, "usePlannerViewCtx");
export const usePlannerEditorCtx = () => useSlice(PlannerEditorCtx, "usePlannerEditorCtx");

// ─── Provider Props ──────────────────────────────────────────────────────────
export interface DocumentsWorkspaceProviderProps {
  documentData: DocumentDataSlice;
  documentActions: DocumentActionSlice;
  documentOrder: DocumentOrderSlice;
  documentUpload: DocumentUploadSlice;
  documentOverlays: DocumentOverlaySlice;
  plannerDateNav: PlannerDateNavSlice;
  plannerAgenda: PlannerAgendaSlice;
  plannerView: PlannerViewSlice;
  plannerEditor: PlannerEditorSlice;
  children: ReactNode;
}

// ─── Provider ────────────────────────────────────────────────────────────────
/**
 * Nested context provider tree. React batches context value propagation,
 * and each slice is memoized at the hook level, so this nesting is cheap.
 * The alternative (a single context with all slices) would cause full-tree
 * rerenders on any slice change.
 */
export function DocumentsWorkspaceProvider({
  documentData,
  documentActions,
  documentOrder,
  documentUpload,
  documentOverlays,
  plannerDateNav,
  plannerAgenda,
  plannerView,
  plannerEditor,
  children,
}: DocumentsWorkspaceProviderProps) {
  return (
    <DocumentDataCtx.Provider value={documentData}>
      <DocumentActionCtx.Provider value={documentActions}>
        <DocumentOrderCtx.Provider value={documentOrder}>
          <DocumentUploadCtx.Provider value={documentUpload}>
            <DocumentOverlayCtx.Provider value={documentOverlays}>
              <PlannerDateNavCtx.Provider value={plannerDateNav}>
                <PlannerAgendaCtx.Provider value={plannerAgenda}>
                  <PlannerViewCtx.Provider value={plannerView}>
                    <PlannerEditorCtx.Provider value={plannerEditor}>
                      {children}
                    </PlannerEditorCtx.Provider>
                  </PlannerViewCtx.Provider>
                </PlannerAgendaCtx.Provider>
              </PlannerDateNavCtx.Provider>
            </DocumentOverlayCtx.Provider>
          </DocumentUploadCtx.Provider>
        </DocumentOrderCtx.Provider>
      </DocumentActionCtx.Provider>
    </DocumentDataCtx.Provider>
  );
}
