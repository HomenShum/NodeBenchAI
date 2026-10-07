/**
 * LightPreviews — Tiny pure-JSX preview components that need no async loading.
 *
 * These are all lightweight, stateless components safe to eagerly import
 * on the default documents route without bloating the bundle.
 */

import { AlertTriangle, ImageOff, FileQuestion } from "lucide-react";

// ============================================================================
// HTML/Code Preview - Looks like a VS Code mini editor
// ============================================================================
export function CodePreview() {
  return (
    <div className="w-full h-full bg-[#1e1e1e] p-2 flex flex-col gap-1 font-mono overflow-hidden">
      {/* macOS Window Controls */}
      <div className="flex gap-1 mb-1 opacity-60">
        <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
        <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
      </div>
      {/* Simulated Code Lines */}
      <div className="flex gap-1.5 items-center">
        <span className="text-purple-400 text-[6px]">&lt;html&gt;</span>
      </div>
      <div className="flex gap-1.5 pl-2 items-center">
        <div className="w-8 h-1 bg-blue-400/50 rounded-[1px]" />
        <div className="w-5 h-1 bg-orange-300/50 rounded-[1px]" />
      </div>
      <div className="flex gap-1.5 pl-3 items-center">
        <div className="w-12 h-1 bg-green-400/40 rounded-[1px]" />
      </div>
      <div className="flex gap-1.5 pl-3 items-center">
        <div className="w-6 h-1 bg-yellow-300/40 rounded-[1px]" />
        <div className="w-10 h-1 bg-cyan-400/40 rounded-[1px]" />
      </div>
      <div className="flex gap-1.5 pl-2 items-center">
        <div className="w-14 h-1 bg-pink-400/40 rounded-[1px]" />
      </div>
      <div className="flex gap-1.5 items-center">
        <span className="text-purple-400 text-[6px]">&lt;/html&gt;</span>
      </div>
    </div>
  );
}

// ============================================================================
// Markdown/Document Preview - Looks like a page with typography
// ============================================================================
export function MarkdownPreview({ hasContent = false }: { hasContent?: boolean }) {
  return (
    <div className="w-full h-full overflow-hidden rounded-lg border border-edge/70 bg-gradient-to-br from-surface to-surface-secondary p-2">
      <div className="flex h-full flex-col rounded-md border border-edge/60 bg-white/[0.04] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="mb-2 flex items-center justify-between">
          <div className="h-1.5 w-16 rounded-full bg-content/90" />
          <div className="h-4 w-4 rounded-sm border border-edge/60 bg-surface-secondary/80" />
        </div>
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-content-secondary/35" />
          <div className="h-1.5 w-5/6 rounded-full bg-content-secondary/30" />
          <div className="h-1.5 w-full rounded-full bg-content-secondary/28" />
          <div className="h-1.5 w-2/3 rounded-full bg-content-secondary/28" />
        </div>
        <div className="mt-auto">
          <div className="rounded-md border border-edge/60 bg-surface-secondary/80 px-2 py-1.5">
            <div className={`h-1.5 rounded-full ${hasContent ? "w-3/4 bg-primary/35" : "w-1/2 bg-content-secondary/20"}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Note Preview - "Sticky Note" / Paper Pad look for Quick Notes
// ============================================================================
export function NotePreview() {
  return (
    <div className="w-full h-full bg-gradient-to-br from-amber-50 via-yellow-50/80 to-orange-50/30 p-2 overflow-hidden relative">
      {/* Subtle "tape" at top */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1.5 bg-amber-200/60 rounded-b-sm" />

      {/* Red margin line (like legal pad) */}
      <div className="absolute top-0 bottom-0 left-4 w-[1px] bg-red-200/40" />

      {/* Content with lines */}
      <div className="ml-5 mt-2 flex flex-col gap-1.5">
        <div className="w-4/5 h-1.5 bg-content-secondary/20 rounded-[1px]" />
        <div className="w-full h-1 bg-content-secondary/10 rounded-[1px]" />
        <div className="w-3/4 h-1 bg-content-secondary/10 rounded-[1px]" />
        <div className="w-5/6 h-1 bg-content-secondary/10 rounded-[1px]" />
        <div className="w-1/2 h-1 bg-content-secondary/10 rounded-[1px]" />
      </div>

      {/* Ruled lines across the paper */}
      <div className="absolute inset-x-0 top-6 bottom-0 flex flex-col gap-2.5 px-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="w-full h-[0.5px] bg-blue-200/30" />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Empty State Overlay - Shows warning for empty/broken files
// ============================================================================
export function EmptyStateOverlay({ variant = "empty" }: { variant?: "empty" | "broken" | "unknown" }) {
  const config = {
    empty: {
      icon: AlertTriangle,
      label: "Empty File",
      color: "text-amber-500",
      bg: "bg-amber-50/90",
    },
    broken: {
      icon: ImageOff,
      label: "Broken",
      color: "text-red-400",
      bg: "bg-red-50/90",
    },
    unknown: {
      icon: FileQuestion,
      label: "Unknown",
      color: "text-content-muted",
      bg: "bg-surface-secondary/90",
    },
  };
  const { icon: Icon, label, color, bg } = config[variant];

  return (
    <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center ${bg} backdrop-blur-[1px]`}>
      <Icon className={`w-5 h-5 ${color} mb-1`} />
      <span className="text-xs font-medium text-content-secondary tracking-wide">{label}</span>
    </div>
  );
}

// ============================================================================
// Image Fallback - Shows when image fails to load
// ============================================================================
export function ImageFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-surface-hover rounded-lg">
      <div className="flex flex-col items-center gap-1">
        <ImageOff className="w-6 h-6 text-content-muted" />
        <span className="text-[8px] text-content-muted">Image unavailable</span>
      </div>
    </div>
  );
}
