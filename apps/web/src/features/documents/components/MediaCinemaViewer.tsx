/**
 * MediaCinemaViewer Component
 * 
 * An immersive, cinema-style lightbox for viewing media files (images and videos).
 * Features:
 * - Dark glass-morphism backdrop for visual focus
 * - Smooth zoom-in entry animation
 * - Full HTML5 video player with controls
 * - High-res image viewing with navigation
 * - Download and close actions
 */

import { useEffect, useCallback } from 'react';
import { X, Download, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import type { DocumentCardData } from './documentsHub/utils/documentHelpers';
import { inferFileType, type FileType } from '@/lib/fileTypes';
import { sanitizeDocumentTitle } from '@/lib/displayText';

/** Infer FileType for media detection - mirrors DocumentCard logic */
function inferDocFileType(doc: DocumentCardData): FileType {
  if (doc.documentType === "file") {
    const ft = String(doc.fileType || "").toLowerCase();
    if (["video", "audio", "image", "csv", "pdf", "excel", "json", "text", "code", "web", "document"].includes(ft)) {
      return ft as FileType;
    }
    return inferFileType({ name: doc.fileName || doc.title });
  }
  const lower = String(doc.title || "").toLowerCase();
  const looksLikeFile = /\.(csv|xlsx|xls|pdf|mp4|mov|webm|avi|mkv|jpg|jpeg|png|webp|gif|json|txt|md|markdown|js|ts|tsx|jsx|py|rb|go|rs|html|css|scss|sh)$/.test(lower);
  return looksLikeFile ? inferFileType({ name: doc.title }) : inferFileType({ name: doc.title, isNodebenchDoc: true });
}

interface MediaCinemaViewerProps {
  doc: DocumentCardData | null;
  isOpen: boolean;
  onClose: () => void;
  /** Optional: navigate to previous media item */
  onPrev?: () => void;
  /** Optional: navigate to next media item */
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function MediaCinemaViewer({
  doc,
  isOpen,
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}: MediaCinemaViewerProps) {
  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft' && hasPrev) onPrev?.();
    if (e.key === 'ArrowRight' && hasNext) onNext?.();
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !doc) return null;

  const mediaUrl = doc.mediaUrl || doc.thumbnailUrl;
  const inferredType = inferDocFileType(doc);
  const isVideo = inferredType === 'video';
  const isImage = inferredType === 'image';

  const handleDownload = () => {
    if (mediaUrl) {
      const link = document.createElement('a');
      link.href = mediaUrl;
      link.download = doc.title || 'download';
      link.click();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center animate-in fade-in duration-200" role="dialog" aria-label={`Media viewer: ${doc.title}`}>
      {/* Dark Backdrop with Blur */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-md cursor-pointer"
        onClick={onClose}
      />

      {/* Main Content Container */}
      <div className="relative z-10 w-full max-w-6xl h-[90vh] flex flex-col items-center justify-center p-4 animate-in zoom-in-95 duration-300">
        
        {/* Top Toolbar */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
          {mediaUrl && (
            <button
              type="button"
              onClick={handleDownload}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all duration-200 backdrop-blur-sm border border-edge"
              title="Download"
              aria-label="Download media"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 rounded-full bg-white/10 hover:bg-red-500/30 text-white hover:text-red-300 transition-all duration-200 backdrop-blur-sm border border-edge"
            title="Close (Esc)"
            aria-label="Close media viewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Arrows */}
        {hasPrev && (
          <button
            type="button"
            onClick={onPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all duration-200 backdrop-blur-sm border border-edge z-20"
            title="Previous"
            aria-label="Previous media"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={onNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all duration-200 backdrop-blur-sm border border-edge z-20"
            title="Next"
            aria-label="Next media"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* Media Player */}
        <div className="w-full h-full flex items-center justify-center">
          {isVideo && mediaUrl ? (
            <video 
              src={mediaUrl} 
              controls 
              autoPlay 
              className="max-w-full max-h-full rounded-lg shadow-2xl outline-none bg-black"
              style={{ maxHeight: 'calc(90vh - 120px)' }}
            />
          ) : isImage && mediaUrl ? (
            <img 
              src={mediaUrl} 
              alt={doc.title} 
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              style={{ maxHeight: 'calc(90vh - 120px)' }}
            />
          ) : (
            <div className="flex flex-col items-center gap-4 text-white/60">
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                <Maximize2 className="w-8 h-8" />
              </div>
              <p>Media not available</p>
            </div>
          )}
        </div>

        {/* Caption / Title Bar */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/60 backdrop-blur-md rounded-full border border-edge text-white flex items-center gap-3 max-w-[80%]">
          <span className="font-medium truncate">{sanitizeDocumentTitle(doc.title)}</span>
          <span className="text-white/40">|</span>
          <span className="text-sm text-white/70 flex-shrink-0">
            {doc.fileType || 'media'}
          </span>
        </div>
      </div>
    </div>
  );
}
