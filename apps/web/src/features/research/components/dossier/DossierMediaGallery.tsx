// src/components/views/dossier/DossierMediaGallery.tsx
// Right panel media gallery with collapsible sections for videos, images, and documents

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Video, Image as ImageIcon, FileText, Play, ExternalLink, X, Download } from 'lucide-react';
import type { VideoAsset, ImageAsset, DocumentAsset } from './mediaExtractor';
import MiniEditorPopover from '@/shared/components/MiniEditorPopover';
import type { Id } from '../../../../../convex/_generated/dataModel';

interface DossierMediaGalleryProps {
  videos: VideoAsset[];
  images: ImageAsset[];
  documents: DocumentAsset[];
  highlightedSection?: 'videos' | 'images' | 'documents' | null;
}

/**
 * DossierMediaGallery - Right panel with collapsible media sections
 */
export function DossierMediaGallery({
  videos,
  images,
  documents,
  highlightedSection,
}: DossierMediaGalleryProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['videos', 'images', 'documents'])
  );

  // State for document popover
  const [openDocumentId, setOpenDocumentId] = useState<Id<"documents"> | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<VideoAsset | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ asset: ImageAsset; index: number } | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const handleDocumentClick = (documentId: Id<"documents">, anchorEl: HTMLElement) => {
    setOpenDocumentId(documentId);
    setPopoverAnchor(anchorEl);
  };

  const closeDocumentPopover = () => {
    setOpenDocumentId(null);
    setPopoverAnchor(null);
  };

  const hasMedia = videos.length > 0 || images.length > 0 || documents.length > 0;

  if (!hasMedia) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center text-[var(--text-tertiary)]">
          <FileText className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No media assets</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Videos Section */}
      {videos.length > 0 && (
        <MediaSection
          title="Videos"
          icon={Video}
          count={videos.length}
          isExpanded={expandedSections.has('videos')}
          onToggle={() => toggleSection('videos')}
          isHighlighted={highlightedSection === 'videos'}
        >
          <div className="grid grid-cols-2 gap-3 p-3">
            {videos.map((video, idx) => (
              <VideoCard
                key={idx}
                video={video}
                onClick={() => setSelectedVideo(video)}
              />
            ))}
          </div>
        </MediaSection>
      )}

      {/* Images Section */}
      {images.length > 0 && (
        <MediaSection
          title="Images"
          icon={ImageIcon}
          count={images.length}
          isExpanded={expandedSections.has('images')}
          onToggle={() => toggleSection('images')}
          isHighlighted={highlightedSection === 'images'}
        >
          <div className="grid grid-cols-3 gap-2 p-3">
            {images.map((image, idx) => (
              <ImageThumbnail
                key={idx}
                image={image}
                onClick={() => setSelectedImage({ asset: image, index: idx })}
              />
            ))}
          </div>
        </MediaSection>
      )}

      {/* Documents Section */}
      {documents.length > 0 && (
        <MediaSection
          title="Referenced Documents"
          icon={FileText}
          count={documents.length}
          isExpanded={expandedSections.has('documents')}
          onToggle={() => toggleSection('documents')}
          isHighlighted={highlightedSection === 'documents'}
        >
          <div className="space-y-2 p-3">
            {documents.map((doc, idx) => (
              <DocumentCard key={idx} document={doc} onDocumentClick={handleDocumentClick} />
            ))}
          </div>
        </MediaSection>
      )}

      {/* Video Player Modal */}
      {selectedVideo && (
        <VideoPlayerModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
        />
      )}

      {/* Image Lightbox */}
      {selectedImage && (
        <ImageLightbox
          images={images}
          currentIndex={selectedImage.index}
          onClose={() => setSelectedImage(null)}
          onNavigate={(newIndex) => setSelectedImage({ asset: images[newIndex], index: newIndex })}
        />
      )}

      {/* Document Popover */}
      {openDocumentId && popoverAnchor && (
        <MiniEditorPopover
          isOpen={true}
          documentId={openDocumentId}
          anchorEl={popoverAnchor}
          onClose={closeDocumentPopover}
        />
      )}
    </div>
  );
}

/**
 * Collapsible section wrapper
 */
interface MediaSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  isHighlighted?: boolean;
  children: React.ReactNode;
}

function MediaSection({
  title,
  icon: Icon,
  count,
  isExpanded,
  onToggle,
  isHighlighted,
  children,
}: MediaSectionProps) {
  return (
    <div
      className={`
        border-b border-edge
        ${isHighlighted ? 'bg-indigo-500/10 ring-2 ring-ring ring-inset' : ''}
        transition-all duration-200
      `}
    >
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-content-secondary" />
          <span className="font-medium text-sm text-content">{title}</span>
          <span className="text-xs text-[var(--text-tertiary)] bg-surface-secondary px-2 py-0.5 rounded-full">
            {count}
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-content-secondary" />
        ) : (
          <ChevronRight className="h-4 w-4 text-content-secondary" />
        )}
      </button>
      {isExpanded && <div>{children}</div>}
    </div>
  );
}

/**
 * Video card component
 */
interface VideoCardProps {
  video: VideoAsset;
  onClick: () => void;
}

function VideoCard({ video, onClick }: VideoCardProps) {
  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-lg overflow-hidden border border-edge hover:border-indigo-500/30 transition-all duration-200"
      style={{ willChange: 'transform, box-shadow' }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-surface-secondary">
        <img
          src={video.thumbnail}
          alt={video.caption || 'Video'}
          className="w-full h-full object-cover transition-transform duration-300"
          loading="lazy"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors duration-200">
          <div className="w-12 h-12 rounded-full bg-red-600 group-hover:bg-red-700 flex items-center justify-center shadow-lg transition-all duration-200">
            <Play className="h-6 w-6 text-white ml-0.5" fill="white" />
          </div>
        </div>
        {/* Hover overlay with metadata */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="flex items-center gap-2 text-white text-xs">
            <Video className="h-3 w-3" />
            <span>YouTube Video</span>
          </div>
        </div>
      </div>
      {/* Caption */}
      {video.caption && (
        <div className="p-2 bg-surface">
          <p className="text-xs text-content-secondary line-clamp-2 group-hover:text-content transition-colors">{video.caption}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Image thumbnail component
 */
interface ImageThumbnailProps {
  image: ImageAsset;
  onClick: () => void;
}

function ImageThumbnail({ image, onClick }: ImageThumbnailProps) {
  return (
    <div
      onClick={onClick}
      className="aspect-square cursor-pointer rounded-lg overflow-hidden border border-edge hover:border-indigo-500/30 transition-all duration-200 group relative"
    >
      <img
        src={image.url}
        alt={image.alt || 'Image'}
        className="w-full h-full object-cover transition-transform duration-300"
        loading="lazy"
      />
      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200 flex items-center justify-center">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center shadow-lg">
            <ImageIcon className="h-5 w-5 text-content" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Document card component
 */
interface DocumentCardProps {
  document: DocumentAsset;
  onDocumentClick?: (documentId: Id<"documents">, anchorEl: HTMLElement) => void;
}

function DocumentCard({ document, onDocumentClick }: DocumentCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clickCountRef = useRef(0);

  // Check if this is a local document (internal app URL)
  const isLocalDocument = document.url.startsWith('/documents/');

  const handleClick = (e: React.MouseEvent) => {
    if (!isLocalDocument) {
      // For external URLs, let the default <a> behavior handle it
      return;
    }

    e.preventDefault();

    // Extract document ID from URL: /documents/{id}
    const docId = document.url.split('/documents/')[1] as Id<"documents">;
    if (!docId) return;

    clickCountRef.current += 1;

    // Clear existing timer
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }

    // Set new timer to distinguish single vs double click
    clickTimerRef.current = setTimeout(() => {
      if (clickCountRef.current === 1) {
        // Single click - open popover
        if (onDocumentClick && cardRef.current) {
          onDocumentClick(docId, cardRef.current);
        }
      } else if (clickCountRef.current >= 2) {
        // Double click - navigate to full document
        try {
          window.dispatchEvent(
            new CustomEvent('nodebench:openDocument', {
              detail: { documentId: docId }
            })
          );
        } catch (err) {
          console.error('[DocumentCard] Failed to navigate to document:', err);
        }
      }
      clickCountRef.current = 0;
    }, 250); // 250ms delay to detect double click
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  return (
    <div ref={cardRef}>
      <a
        href={document.url}
        target={isLocalDocument ? undefined : "_blank"}
        rel={isLocalDocument ? undefined : "noopener noreferrer"}
        onClick={handleClick}
        className="block p-3 rounded-lg border border-edge hover:border-indigo-500/30 transition-all duration-200 group cursor-pointer bg-surface"
      >
      <div className="flex gap-3">
        {document.thumbnail && (
          <img
            src={document.thumbnail}
            alt={document.title}
            className="w-16 h-16 object-cover rounded flex-shrink-0 transition-transform duration-200"
            loading="lazy"
          />
        )}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-content line-clamp-2 group-hover:text-indigo-600 dark:text-indigo-400 transition-colors duration-200">
            {document.title}
          </h4>
          {document.description && (
            <p className="text-xs text-content-secondary line-clamp-1 mt-1">
              {document.description}
            </p>
          )}
          {document.domain && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1 flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              {document.domain}
            </p>
          )}
        </div>
      </div>
    </a>
    </div>
  );
}

/**
 * Video Player Modal
 */
interface VideoPlayerModalProps {
  video: VideoAsset;
  onClose: () => void;
}

function VideoPlayerModal({ video, onClose }: VideoPlayerModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="relative bg-surface rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-edge">
          <h3 className="font-semibold text-content">
            {video.caption || 'Video'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-hover rounded-lg transition-colors"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Video Player */}
        <div className="relative w-full bg-black" style={{ paddingBottom: '56.25%' }}>
          <iframe
            src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1`}
            className="absolute top-0 left-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={video.caption || 'Video'}
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-edge">
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Watch on YouTube <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Image Lightbox
 */
interface ImageLightboxProps {
  images: ImageAsset[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

function ImageLightbox({ images, currentIndex, onClose, onNavigate }: ImageLightboxProps) {
  const currentImage = images[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  const handlePrev = () => {
    if (hasPrev) onNavigate(currentIndex - 1);
  };

  const handleNext = () => {
    if (hasNext) onNavigate(currentIndex + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') handlePrev();
    if (e.key === 'ArrowRight') handleNext();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="absolute inset-0 bg-black/90" onClick={onClose} />

      <div className="relative max-w-6xl max-h-[90vh] w-full h-full flex flex-col p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 z-10">
          <div className="text-white">
            <p className="text-sm opacity-75">
              {currentIndex + 1} / {images.length}
            </p>
            {currentImage.caption && (
              <p className="text-lg font-medium mt-1">{currentImage.caption}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
            title="Close"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Image */}
        <div className="flex-1 flex items-center justify-center relative">
          <img
            src={currentImage.url}
            alt={currentImage.alt || 'Image'}
            className="max-w-full max-h-full object-contain"
          />

          {/* Navigation Arrows */}
          {hasPrev && (
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              title="Previous image"
            >
              <ChevronRight className="h-6 w-6 rotate-180" />
            </button>
          )}
          {hasNext && (
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              title="Next image"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>

        {/* Thumbnail strip */}
        {images.length > 1 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => onNavigate(idx)}
                className={`
                  flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all
                  ${idx === currentIndex ? 'border-white scale-110' : 'border-transparent opacity-50 hover:opacity-100'}
                `}
              >
                <img
                  src={img.url}
                  alt={img.alt || `Image ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

