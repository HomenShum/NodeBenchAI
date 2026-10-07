import React from "react";
import type { FileType } from "../lib/fileTypes";
// Icons inherit color from the current CSS color via `currentColor`.

function BaseSvg({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function FileTypeIcon({ type, className }: { type: FileType; className?: string }) {
  switch (type) {
    case "nbdoc":
    case "document":
      return (
        <BaseSvg className={className}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M8 13h8" />
          <path d="M8 17h8" />
        </BaseSvg>
      );

    case "csv":
    case "excel":
      return (
        <BaseSvg className={className}>
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
        </BaseSvg>
      );

    case "pdf":
      return (
        <BaseSvg className={className}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M8 14h3" />
          <path d="M8 17h8" />
        </BaseSvg>
      );

    case "video":
      // Distinct video camera silhouette (purple is applied by theme via currentColor)
      return (
        <BaseSvg className={className}>
          {/* Camera body */}
          <rect x="3" y="7" width="11" height="10" rx="2" />
          {/* Lens/prism */}
          <polygon points="16,9 21,7 21,17 16,15" />
        </BaseSvg>
      );

    case "audio":
      return (
        <BaseSvg className={className}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <line x1="8" y1="10" x2="8" y2="14" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="16" y1="11" x2="16" y2="13" />
        </BaseSvg>
      );

    case "image":
      return (
        <BaseSvg className={className}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8" cy="10" r="1.5" />
          <path d="M4 17l5-5 3 3 4-4 4 5" />
        </BaseSvg>
      );

    case "text":
      return (
        <BaseSvg className={className}>
          <path d="M4 6h16" />
          <path d="M4 10h16" />
          <path d="M4 14h10" />
          <path d="M4 18h8" />
        </BaseSvg>
      );

    case "code":
      return (
        <BaseSvg className={className}>
          <polyline points="8 8,4 12,8 16" />
          <polyline points="16 8,20 12,16 16" />
          <line x1="12" y1="6" x2="12" y2="18" />
        </BaseSvg>
      );

    case "json":
      return (
        <BaseSvg className={className}>
          <path d="M7 8c-2 0-3 1-3 4s1 4 3 4" />
          <path d="M17 8c2 0 3 1 3 4s-1 4-3 4" />
        </BaseSvg>
      );

    case "web":
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.5 3 2.5 15 0 18" />
          <path d="M12 3c-2.5 3-2.5 15 0 18" />
        </BaseSvg>
      );

    case "dossier":
      // Stack of documents with chat bubble overlay
      return (
        <BaseSvg className={className}>
          {/* Stack of documents */}
          <rect x="5" y="6" width="10" height="12" rx="1" />
          <rect x="7" y="4" width="10" height="12" rx="1" opacity="0.5" />
          <rect x="9" y="2" width="10" height="12" rx="1" opacity="0.3" />
          {/* Chat bubble overlay */}
          <path d="M14 10h6v4l-2 2v-2h-4z" fill="currentColor" />
        </BaseSvg>
      );

    case "unknown":
    default:
      return (
        <BaseSvg className={className}>
          <path d="M4 4h16v16H4z" />
          <path d="M9 9h6v6H9z" />
        </BaseSvg>
      );
  }
}
