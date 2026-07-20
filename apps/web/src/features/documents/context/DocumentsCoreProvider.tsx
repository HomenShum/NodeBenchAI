/**
 * DocumentsCoreProvider
 *
 * Wraps only the 5 document-related context slices (Data, Action, Order,
 * Upload, Overlay). This is the planner-free subset of
 * DocumentsWorkspaceProvider, allowing the main documents surface to render
 * without pulling in any planner runtime.
 */

import type { ReactNode } from "react";
import type {
  DocumentDataSlice,
  DocumentActionSlice,
  DocumentOrderSlice,
  DocumentUploadSlice,
  DocumentOverlaySlice,
} from "./types";
import {
  DocumentDataCtx,
  DocumentActionCtx,
  DocumentOrderCtx,
  DocumentUploadCtx,
  DocumentOverlayCtx,
} from "./DocumentsWorkspaceContext";

export interface DocumentsCoreProviderProps {
  documentData: DocumentDataSlice;
  documentActions: DocumentActionSlice;
  documentOrder: DocumentOrderSlice;
  documentUpload: DocumentUploadSlice;
  documentOverlays: DocumentOverlaySlice;
  children: ReactNode;
}

export function DocumentsCoreProvider({
  documentData,
  documentActions,
  documentOrder,
  documentUpload,
  documentOverlays,
  children,
}: DocumentsCoreProviderProps) {
  return (
    <DocumentDataCtx.Provider value={documentData}>
      <DocumentActionCtx.Provider value={documentActions}>
        <DocumentOrderCtx.Provider value={documentOrder}>
          <DocumentUploadCtx.Provider value={documentUpload}>
            <DocumentOverlayCtx.Provider value={documentOverlays}>
              {children}
            </DocumentOverlayCtx.Provider>
          </DocumentUploadCtx.Provider>
        </DocumentOrderCtx.Provider>
      </DocumentActionCtx.Provider>
    </DocumentDataCtx.Provider>
  );
}
