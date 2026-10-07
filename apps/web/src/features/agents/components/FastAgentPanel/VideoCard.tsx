// src/components/FastAgentPanel/VideoCard.tsx
// Reusable video card component for displaying YouTube videos in a polished format

import React, { useState } from 'react';
import { Play, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { YouTubeVideo } from './MediaGallery';

interface VideoCardProps {
  video: YouTubeVideo;
  className?: string;
}

/**
 * VideoCard - Displays a single video with thumbnail, play button overlay, and metadata
 * Designed for use in carousels or grids
 */
export function VideoCard({ video, className }: VideoCardProps) {
  const thumbnailUrl = video.thumbnail || `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;

  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group block rounded-lg overflow-hidden border border-edge hover:shadow-md hover:border-primary/20",
        "transition-all duration-200 bg-surface",
        className
      )}
    >
      {/* Thumbnail with play button overlay */}
      <div className="relative aspect-video bg-surface-hover">
        <img
          src={thumbnailUrl}
          alt={video.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-surface-secondary group-hover:bg-black/30 transition-colors">
          <div className="w-12 h-12 rounded-full bg-red-600 group-hover:bg-red-700 flex items-center justify-center shadow-lg transition-colors">
            <Play className="h-6 w-6 text-white ml-0.5" fill="white" />
          </div>
        </div>
      </div>

      {/* Video metadata */}
      <div className="p-3">
        <h3 className="text-sm font-medium text-content line-clamp-2 mb-1 group-hover:text-blue-600 transition-colors">
          {video.title}
        </h3>
        <p className="text-xs text-content-secondary line-clamp-1">
          {video.channel}
        </p>
      </div>

      {/* External link indicator */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="rounded-full bg-surface p-1.5 shadow-sm">
          <ExternalLink className="h-3 w-3 text-content" />
        </div>
      </div>
    </a>
  );
}

/**
 * VideoCarousel - Horizontal scrollable carousel of video cards
 */
interface VideoCarouselProps {
  videos: YouTubeVideo[];
  title?: string;
}

export function VideoCarousel({ videos, title = "Related Videos" }: VideoCarouselProps) {
  const [showAll, setShowAll] = useState(false);
  const INITIAL_DISPLAY_COUNT = 6;

  if (videos.length === 0) return null;

  const displayedVideos = showAll ? videos : videos.slice(0, INITIAL_DISPLAY_COUNT);
  const hasMore = videos.length > INITIAL_DISPLAY_COUNT;

  return (
    <div className="mb-4">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-[var(--border-color)]"></div>
        <h3 className="text-sm font-semibold text-content flex items-center gap-2">
          <Play className="h-4 w-4 text-red-600" />
          {title}
          <span className="text-xs font-normal text-content-secondary">
            ({showAll ? videos.length : Math.min(videos.length, INITIAL_DISPLAY_COUNT)}{hasMore && !showAll ? `/${videos.length}` : ''})
          </span>
        </h3>
        <div className="h-px flex-1 bg-[var(--border-color)]"></div>
      </div>

      {/* Horizontal scrollable grid */}
      <div className="overflow-x-auto pb-2 -mx-1">
        <div className="flex gap-3 px-1" style={{ minWidth: 'min-content' }}>
          {displayedVideos.map((video, idx) => (
            <VideoCard
              key={idx}
              video={video}
              className="flex-shrink-0 w-64"
            />
          ))}
        </div>
      </div>

      {/* Show More/Less button */}
      {hasMore && (
        <div className="flex justify-center mt-3">
          <button
            onClick={() => setShowAll(!showAll)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-content bg-surface border border-edge rounded-lg hover:bg-surface-hover hover:border-edge transition-colors"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                Show {videos.length - INITIAL_DISPLAY_COUNT} More
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
