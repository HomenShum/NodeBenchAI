/**
 * VisualGlimpse — High-fidelity "Miniature Twin" previews for DocumentCard.
 *
 * Extracted from DocumentCard to enable React.lazy() code-splitting.
 * This is the heaviest rendering path (~190 lines of branching for each file type).
 *
 * Images: Actual thumbnails with zoom on hover + error fallback
 * Videos: Thumbnail/preview with play overlay, loops on hover
 * Spreadsheets: CSS Grid table with cells
 * Code/HTML: Mini-IDE with syntax coloring
 * Docs: Typography layout with headings
 * Empty files: Warning overlay
 */

import { FileTypeIcon } from "@/shared/components/FileTypeIcon";
import type { FileType } from "@/lib/fileTypes";
import { getThemeForFileType } from "@/lib/documentThemes";
import type { DocumentCardData } from "../utils/documentHelpers";
import {
  SpreadsheetPreview,
  CodePreview,
  MarkdownPreview,
  NotePreview,
  EmptyStateOverlay,
  ImageFallback,
} from "../../previews";
import { Play, Eye } from "lucide-react";
import { inferDocFileType } from "./cardFileTypeHelpers";

export default function VisualGlimpse({
  doc,
  typeGuess,
  isEmpty = false,
  onImageError,
  hasImageError = false,
}: {
  doc: DocumentCardData;
  typeGuess: FileType;
  isEmpty?: boolean;
  onImageError?: () => void;
  hasImageError?: boolean;
}) {
  const theme = getThemeForFileType(typeGuess);

  // Wrapper with empty state overlay
  const renderWithEmptyState = (content: React.ReactNode) => (
    <div className="w-full h-full relative">
      {content}
      {isEmpty && <EmptyStateOverlay variant="empty" />}
    </div>
  );

  // IMAGE: Show actual thumbnail with hover zoom effect
  if (typeGuess === 'image') {
    const imageUrl = doc.thumbnailUrl || doc.mediaUrl || doc.coverImage;
    if (hasImageError || !imageUrl) {
      return renderWithEmptyState(<ImageFallback />);
    }
    return renderWithEmptyState(
      <div className="w-full h-full bg-surface-hover rounded-lg overflow-hidden group/img">
        <img
          src={imageUrl}
          alt={doc.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-110"
          loading="lazy"
          onError={onImageError}
        />
      </div>
    );
  }

  // VIDEO: Show thumbnail with play overlay, loops on hover
  if (typeGuess === 'video') {
    const videoUrl = doc.mediaUrl;
    return renderWithEmptyState(
      <div className="w-full h-full bg-surface rounded-lg overflow-hidden relative group/vid">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent z-10 pointer-events-none" />

        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30 transition-all duration-300 group-hover/vid:scale-110 group-hover/vid:bg-white/30 shadow-lg">
            <Play className="w-5 h-5 text-white fill-white ml-0.5" />
          </div>
        </div>

        {videoUrl ? (
          <video
            src={videoUrl}
            className="w-full h-full object-cover opacity-80 group-hover/vid:opacity-100 transition-opacity duration-300"
            muted
            loop
            playsInline
            preload="metadata"
            onMouseOver={(e) => e.currentTarget.play().catch(() => {})}
            onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-900/40 to-purple-800/20 flex items-center justify-center">
            <Play className="w-10 h-10 text-purple-300/50" />
          </div>
        )}
      </div>
    );
  }

  // Cover image for non-media documents
  if (doc.coverImage && !hasImageError) {
    return renderWithEmptyState(
      <div className="w-full h-full bg-surface-hover rounded-lg overflow-hidden">
        <img
          src={doc.coverImage}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={onImageError}
        />
      </div>
    );
  }

  // CSV/Excel: Rich spreadsheet preview with REAL DATA when available
  // Only show spreadsheet preview if we have a csvUrl (actual file with storage)
  if ((typeGuess === 'csv' || typeGuess === 'excel') && doc.csvUrl) {
    return renderWithEmptyState(
      <div className="w-full h-full rounded-lg overflow-hidden border border-edge">
        <SpreadsheetPreview
          url={doc.csvUrl}
          content={doc.contentPreview}
          fileType={typeGuess}
        />
      </div>
    );
  }

  // CSV/Excel meta-documents (like "Analysis: file.csv") without actual file storage
  // Fall through to text document rendering to show their content with styled preview
  if ((typeGuess === 'csv' || typeGuess === 'excel') && !doc.csvUrl) {
    if (doc.contentPreview) {
      // Show actual content with sticky note style (like Quick Notes)
      return renderWithEmptyState(
        <div className="w-full h-full bg-gradient-to-br from-amber-50/80 via-yellow-50/60 to-orange-50/30 rounded-lg p-2.5 overflow-hidden relative">
          {/* Red margin line */}
          <div className="absolute top-0 bottom-0 left-3 w-[1px] bg-red-200/40" />
          <p className="ml-4 line-clamp-4 text-xs leading-relaxed text-content/90 italic">
            {doc.contentPreview}
          </p>
        </div>
      );
    }
    // If no content preview, show abstract document icon
    return renderWithEmptyState(
      <div className="w-full h-full rounded-lg overflow-hidden">
        <MarkdownPreview hasContent={false} />
      </div>
    );
  }

  // Quick Notes (nbdoc): Sticky note / paper pad look
  if (typeGuess === 'nbdoc') {
    if (doc.contentPreview) {
      // Show actual content with yellow tint
      return renderWithEmptyState(
        <div className="w-full h-full bg-gradient-to-br from-amber-50/80 via-yellow-50/60 to-orange-50/30 rounded-lg p-2.5 overflow-hidden relative">
          {/* Red margin line */}
          <div className="absolute top-0 bottom-0 left-3 w-[1px] bg-red-200/40" />
          <p className="ml-4 line-clamp-4 text-xs leading-relaxed text-content/90 italic">
            {doc.contentPreview}
          </p>
        </div>
      );
    }
    return renderWithEmptyState(
      <div className="w-full h-full rounded-lg overflow-hidden">
        <NotePreview />
      </div>
    );
  }

  // Text/PDF/Docs: Typography layout or actual snippet
  if (['pdf', 'text', 'document'].includes(typeGuess)) {
    if (doc.contentPreview) {
      return renderWithEmptyState(
        <div className="w-full h-full bg-gradient-to-br from-surface-secondary/95 to-surface rounded-lg p-2.5 overflow-hidden">
          <p className="line-clamp-4 text-xs leading-relaxed text-content/90">
            {doc.contentPreview}
          </p>
        </div>
      );
    }
    return renderWithEmptyState(
      <div className="w-full h-full rounded-lg overflow-hidden">
        <MarkdownPreview hasContent={!!doc.contentPreview} />
      </div>
    );
  }

  // Code/Web/HTML: Mini-IDE preview with dark theme
  if (['code', 'web'].includes(typeGuess)) {
    return renderWithEmptyState(
      <div className="w-full h-full rounded-lg overflow-hidden relative group/code">
        <CodePreview />
        {/* Hover: Preview Button */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover/code:opacity-100 transition-opacity backdrop-blur-[1px]">
          <div className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-full shadow-lg">
            <Eye className="w-3 h-3" />
            <span>Preview</span>
          </div>
        </div>
      </div>
    );
  }

  // Default: Soft gradient with faint icon
  return renderWithEmptyState(
    <div className={`w-full h-full rounded-lg flex items-center justify-center bg-gradient-to-br ${theme.gradient || 'from-surface-secondary to-surface-hover/50'}`}>
      <FileTypeIcon type={typeGuess} className="h-8 w-8 opacity-20" />
    </div>
  );
}
