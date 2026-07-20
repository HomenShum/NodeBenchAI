/**
 * ViewModeToggle — one quiet mode switch for the entity artifact.
 *
 * The earlier segmented toggle added too much top-row pressure for the
 * notebook-first layout. We keep the same route-backed behavior, but the
 * chrome collapses to a single secondary action:
 *   - edit mode shows "Read mode"
 *   - read mode shows "Edit notebook"
 */

import { memo, useEffect } from "react";
import { Eye, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useViewMode } from "@/features/entities/lib/useViewMode";

export interface ViewModeToggleProps {
  /** Hide the toggle (e.g. public share view, where mode is forced). */
  hidden?: boolean;
  className?: string;
}

export const ViewModeToggle = memo(function ViewModeToggle({
  hidden,
  className,
}: ViewModeToggleProps) {
  const { viewMode, setViewMode } = useViewMode();

  // Keyboard shortcut: ⌘E / Ctrl+E toggles modes. Guarded against IME
  // composition and against firing when the user is typing in an
  // editable surface (matches the askShortcut guard pattern).
  useEffect(() => {
    if (hidden) return;
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;
      const isModE = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e";
      if (!isModE) return;
      if (e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      setViewMode(viewMode === "read" ? "edit" : "read");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hidden, viewMode, setViewMode]);

  if (hidden) return null;

  const nextMode = viewMode === "read" ? "edit" : "read";
  const isRead = viewMode === "read";

  return (
    <button
      type="button"
      onClick={() => setViewMode(nextMode)}
      aria-label={isRead ? "Edit notebook" : "Read mode"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white/70 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-black/12 hover:bg-white hover:text-gray-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-gray-100",
        className,
      )}
    >
      {isRead ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      <span>{isRead ? "Edit notebook" : "Read mode"}</span>
    </button>
  );
});

ViewModeToggle.displayName = "ViewModeToggle";
