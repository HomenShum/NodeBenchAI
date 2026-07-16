// src/components/FastAgentPanel/RichMediaSection.tsx
// Read-only presentation of media returned by canonical source/tool parts.

import React from 'react';
import { VideoCarousel } from './VideoCard';
import { SourceGrid, secDocumentToSource } from './SourceCard';
import { ProfileGrid } from './ProfileCard';
import type { ExtractedMedia } from './utils/mediaExtractor';

interface RichMediaSectionProps {
  media: ExtractedMedia;
}

/**
 * Displays consulted media and sources returned by structured runtime parts.
 * It deliberately has no citation-numbering mode: retrieving a source does
 * not bind that source to a claim in the assistant's answer.
 */
export function RichMediaSection({ media }: RichMediaSectionProps) {
  const {
    youtubeVideos = [],
    secDocuments = [],
    webSources = [],
    profiles = [],
    images = [],
  } = media;
  const hasMedia =
    youtubeVideos.length > 0 ||
    secDocuments.length > 0 ||
    webSources.length > 0 ||
    profiles.length > 0 ||
    images.length > 0;

  if (!hasMedia) return null;

  const sources = [...secDocuments.map(secDocumentToSource), ...webSources];

  return (
    <div className="space-y-4 mb-4" data-source-semantics="consulted">
      {youtubeVideos.length > 0 && (
        <VideoCarousel videos={youtubeVideos} />
      )}

      {sources.length > 0 && (
        <SourceGrid
          sources={sources}
          title="Consulted sources & documents"
        />
      )}

      {profiles.length > 0 && (
        <ProfileGrid profiles={profiles} title="People found" />
      )}

      {images.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-content">
              Images
              <span className="text-xs font-normal text-content-secondary ml-2">
                ({images.length})
              </span>
            </h3>
          </div>

          <div className="relative">
            <div
              className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-thin scrollbar-thumb-edge scrollbar-track-[var(--bg-hover)]"
              style={{ scrollbarWidth: 'thin' }}
            >
              {images.map((image, index) => (
                <a
                  key={`${image.url}-${index}`}
                  href={image.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 snap-start group relative rounded-lg overflow-hidden border border-edge hover:border-blue-400 transition-all"
                  title={image.alt}
                >
                  <img
                    src={image.url}
                    alt={image.alt}
                    className="h-48 w-auto object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                    <p className="text-white text-xs line-clamp-2">{image.alt}</p>
                  </div>
                </a>
              ))}
            </div>
            {images.length > 3 && (
              <div className="text-xs text-content-muted text-center mt-1">
                Scroll to see all {images.length} images
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
