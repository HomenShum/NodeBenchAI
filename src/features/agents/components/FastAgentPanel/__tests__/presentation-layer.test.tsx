// src/components/FastAgentPanel/__tests__/presentation-layer.test.tsx
// Tests for the presentation layer components (VideoCard, SourceCard, RichMediaSection, CollapsibleAgentProgress)

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoCard, VideoCarousel } from '../VideoCard';
import { SourceCard, SourceGrid } from '../SourceCard';
import { RichMediaSection } from '../RichMediaSection';
import { CollapsibleAgentProgress } from '../CollapsibleAgentProgress';
import type { YouTubeVideo, SECDocument } from '../MediaGallery';
import type { ExtractedMedia } from '../utils/mediaExtractor';

describe('VideoCard', () => {
  const mockVideo: YouTubeVideo = {
    title: 'Test Video',
    channel: 'Test Channel',
    description: 'Test description',
    url: 'https://youtube.com/watch?v=test',
    videoId: 'test',
    thumbnail: 'https://img.youtube.com/vi/test/mqdefault.jpg',
  };

  it('renders video card with thumbnail and metadata', () => {
    render(<VideoCard video={mockVideo} />);
    
    expect(screen.getByText('Test Video')).toBeInTheDocument();
    expect(screen.getByText('Test Channel')).toBeInTheDocument();
    expect(screen.getByAltText('Test Video')).toBeInTheDocument();
  });

  it('renders video card as clickable link', () => {
    render(<VideoCard video={mockVideo} />);
    
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://youtube.com/watch?v=test');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('VideoCarousel', () => {
  const mockVideos: YouTubeVideo[] = [
    {
      title: 'Video 1',
      channel: 'Channel 1',
      description: 'Description 1',
      url: 'https://youtube.com/watch?v=1',
      videoId: '1',
    },
    {
      title: 'Video 2',
      channel: 'Channel 2',
      description: 'Description 2',
      url: 'https://youtube.com/watch?v=2',
      videoId: '2',
    },
  ];

  it('renders carousel with multiple videos', () => {
    render(<VideoCarousel videos={mockVideos} />);
    
    expect(screen.getByText('Video 1')).toBeInTheDocument();
    expect(screen.getByText('Video 2')).toBeInTheDocument();
    expect(screen.getByText('Related Videos')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('does not render when videos array is empty', () => {
    const { container } = render(<VideoCarousel videos={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('SourceCard', () => {
  const mockSECDocument: SECDocument = {
    title: 'Test SEC Filing',
    formType: '10-K',
    filingDate: '2024-01-15',
    accessionNumber: '0001234567-24-000001',
    documentUrl: 'https://sec.gov/test',
    company: 'Test Company',
  };

  it('renders SEC document as source card', () => {
    render(<SourceCard source={mockSECDocument} />);
    
    expect(screen.getByText('Test SEC Filing')).toBeInTheDocument();
    expect(screen.getByText('sec.gov')).toBeInTheDocument();
    expect(screen.getByText('SEC Filing')).toBeInTheDocument();
    expect(screen.getByText(/10-K • Filed 2024-01-15/)).toBeInTheDocument();
  });

  it('renders as clickable link', () => {
    render(<SourceCard source={mockSECDocument} />);
    
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://sec.gov/test');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('SourceGrid', () => {
  const mockSources = [
    {
      title: 'Source 1',
      url: 'https://example.com/1',
      domain: 'example.com',
    },
    {
      title: 'Source 2',
      url: 'https://example.com/2',
      domain: 'example.com',
    },
  ];

  it('renders grid with multiple sources', () => {
    render(<SourceGrid sources={mockSources} />);
    
    expect(screen.getByText('Source 1')).toBeInTheDocument();
    expect(screen.getByText('Source 2')).toBeInTheDocument();
    expect(screen.getByText('Consulted sources')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('does not render when sources array is empty', () => {
    const { container } = render(<SourceGrid sources={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('RichMediaSection', () => {
  const mockMedia: ExtractedMedia = {
    youtubeVideos: [
      {
        title: 'Test Video',
        channel: 'Test Channel',
        description: 'Test description',
        url: 'https://youtube.com/watch?v=test',
        videoId: 'test',
      },
    ],
    secDocuments: [
      {
        title: 'Test SEC Filing',
        formType: '10-K',
        filingDate: '2024-01-15',
        accessionNumber: '0001234567-24-000001',
        documentUrl: 'https://sec.gov/test',
      },
    ],
    webSources: [],
    profiles: [],
    images: [
      { url: 'https://example.com/image.jpg', alt: 'Test Image' },
    ],
  };

  it('renders all media types', () => {
    render(<RichMediaSection media={mockMedia} />);
    
    expect(screen.getByText('Test Video')).toBeInTheDocument();
    expect(screen.getByText('Test SEC Filing')).toBeInTheDocument();
    expect(screen.getByText('Images')).toBeInTheDocument();
  });

  it('does not render when no media exists', () => {
    const emptyMedia: ExtractedMedia = {
      youtubeVideos: [],
      secDocuments: [],
      webSources: [],
      profiles: [],
      images: [],
    };
    
    const { container } = render(<RichMediaSection media={emptyMedia} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('CollapsibleAgentProgress', () => {
  const mockToolParts: any[] = [
    {
      type: 'tool-webSearch',
      args: { query: 'test query' },
    },
    {
      type: 'tool-result-webSearch',
      result: 'test result',
    },
  ];

  it('renders collapsed by default', () => {
    render(<CollapsibleAgentProgress toolParts={mockToolParts} />);
    
    expect(screen.getByText('Agent Progress')).toBeInTheDocument();
    expect(screen.getByText('2 steps')).toBeInTheDocument();
    expect(screen.getByText(/Click to view detailed agent actions/)).toBeInTheDocument();
  });

  it('shows reasoning when provided', () => {
    render(
      <CollapsibleAgentProgress
        toolParts={mockToolParts}
        reasoning="Test reasoning"
        defaultExpanded={true}
      />
    );
    
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Test reasoning')).toBeInTheDocument();
  });

  it('shows streaming indicator when streaming', () => {
    render(
      <CollapsibleAgentProgress
        toolParts={mockToolParts}
        isStreaming={true}
      />
    );
    
    expect(screen.getByText('Agent Working...')).toBeInTheDocument();
  });

  it('does not render when no content', () => {
    const { container } = render(<CollapsibleAgentProgress toolParts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('expands by default when streaming to show agent progress in real-time', () => {
    render(
      <CollapsibleAgentProgress
        toolParts={mockToolParts}
        isStreaming={true}
        defaultExpanded={true}
      />
    );

    // When streaming and expanded, the timeline should be visible
    expect(screen.getByText('Agent Working...')).toBeInTheDocument();
    // The expandable content should be visible (not collapsed)
    const timelineItems = screen.getAllByText(/web search/i);
    expect(timelineItems.length).toBeGreaterThan(0);
  });

  it('collapses by default when not streaming to show media prominently', () => {
    const { container } = render(
      <CollapsibleAgentProgress
        toolParts={mockToolParts}
        isStreaming={false}
        defaultExpanded={false}
      />
    );

    // When not streaming and collapsed, the toggle button should be visible
    expect(screen.getByText('Agent Progress')).toBeInTheDocument();
    // But the expandable content should NOT be visible
    const expandedContent = container.querySelector('.animate-in');
    expect(expandedContent).not.toBeInTheDocument();
  });
});
