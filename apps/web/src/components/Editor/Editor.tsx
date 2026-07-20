import React, { Suspense } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import type { EditorMode } from "@features/editor/components/UnifiedEditor";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import "./editor-blocks.css";

const UnifiedEditor = React.lazy(() => import("@features/editor/components/UnifiedEditor"));

interface EditorProps {
  documentId: Id<"documents">;
  isGridMode?: boolean;
  isFullscreen?: boolean;
  // Optional: editing mode for UnifiedEditor
  mode?: EditorMode;
  // Whether editing is allowed (owner or public-edit). Defaults to true.
  editable?: boolean;
}

/**
 * Editor component - wraps UnifiedEditor (BlockNote/ProseMirror) with error boundary.
 * This component provides a consistent API for document editing across the application.
 */
export function Editor({ documentId, isGridMode, isFullscreen, mode, editable }: EditorProps) {
  return (
    <ErrorBoundary title="Failed to load editor">
      <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
        <UnifiedEditor
          documentId={documentId as any}
          mode={mode}
          isGridMode={isGridMode}
          isFullscreen={isFullscreen}
          editable={editable}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
