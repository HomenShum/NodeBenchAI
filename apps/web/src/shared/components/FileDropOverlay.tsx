import React, { useEffect, useState, useRef } from "react";

export type FileDropOverlayProps = {
  containerRef?: React.RefObject<HTMLElement> | React.RefObject<HTMLDivElement> | React.RefObject<any>;
  onFilesDrop: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  hint?: string;
};

function hasFiles(e: DragEvent | React.DragEvent): boolean {
  // Firefox: e.dataTransfer?.types is a DOMStringList
  const dt: DataTransfer | null = (e as any).dataTransfer ?? null;
  if (!dt) return false;
  if (dt.items && dt.items.length > 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file") return true;
    }
  }
  const types = dt.types ? Array.from(dt.types) : [];
  return types.includes("Files");
}

export const FileDropOverlay: React.FC<FileDropOverlayProps> = ({
  containerRef,
  onFilesDrop,
  disabled,
  className,
  hint = "Drop files to upload",
}) => {
  const [isActive, setIsActive] = useState(false);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    if (disabled) return;

    const target: HTMLElement | Window = containerRef?.current ?? window;

    const onDragEnter = (e: Event) => {
      const de = e as DragEvent;
      if (!hasFiles(de)) return; // ignore non-file drags (dnd-kit, text, etc.)
      dragCounterRef.current += 1;
      setIsActive(true);
      // Only prevent default for file drags
      de.preventDefault();
      de.stopPropagation();
    };

    const onDragOver = (e: Event) => {
      const de = e as DragEvent;
      if (!hasFiles(de)) return; // let normal DnD flow
      de.preventDefault();
      de.stopPropagation();
    };

    const onDragLeave = (e: Event) => {
      const de = e as DragEvent;
      if (!hasFiles(de)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsActive(false);
      de.preventDefault();
      de.stopPropagation();
    };

    const onDrop = async (e: Event) => {
      const de = e as DragEvent;
      if (!hasFiles(de)) return;
      de.preventDefault();
      de.stopPropagation();
      dragCounterRef.current = 0;
      setIsActive(false);

      const files: File[] = [];
      if (de.dataTransfer?.files && de.dataTransfer.files.length > 0) {
        for (const f of Array.from(de.dataTransfer.files)) files.push(f);
      }
      if (files.length > 0) {
        try {
          await onFilesDrop(files);
        } catch (err) {
          // swallow; caller should toast on error
          console.error("File drop handler failed", err);
        }
      }
    };

    // Attach listeners
    const el: any = target as any;
    el.addEventListener("dragenter", onDragEnter, { passive: false } as any);
    el.addEventListener("dragover", onDragOver, { passive: false } as any);
    el.addEventListener("dragleave", onDragLeave, { passive: false } as any);
    el.addEventListener("drop", onDrop, { passive: false } as any);

    return () => {
      try {
        el.removeEventListener("dragenter", onDragEnter as any);
        el.removeEventListener("dragover", onDragOver as any);
        el.removeEventListener("dragleave", onDragLeave as any);
        el.removeEventListener("drop", onDrop as any);
      } catch {
        // Event listener cleanup failed
      }
    };
  }, [containerRef, disabled, onFilesDrop]);

  if (!isActive) return null;

  return (
    <div
      className={
        "pointer-events-none fixed inset-0 z-50 flex items-center justify-center " +
        "bg-[color-mix(in_oklab,canvas_70%,var(--accent-primary)_15%)] " +
        "backdrop-blur-sm border-2 border-dashed border-[var(--accent-primary)]/30 " +
        (className || "")
      }
    >
      <div className="pointer-events-none flex items-center gap-2 rounded-lg bg-surface/80 px-4 py-2 text-content shadow-md border border-edge">
        <span className="text-sm font-medium">{hint}</span>
      </div>
    </div>
  );
};

export default FileDropOverlay;
