// src/components/FastAgentPanel/__tests__/VideoCard.test.tsx
// Tests for VideoCard and VideoCarousel components

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoCarousel } from '../VideoCard';
import type { YouTubeVideo } from '../MediaGallery';

describe('VideoCarousel', () => {
  const mockVideos: YouTubeVideo[] = [
    {
      title: 'Video 1',
      channel: 'Channel 1',
      description: 'Description 1',
      url: 'https://youtube.com/watch?v=vid1',
      videoId: 'vid1',
      thumbnail: 'https://img.youtube.com/vi/vid1/mqdefault.jpg',
    },
    {
      title: 'Video 2',
      channel: 'Channel 2',
      description: 'Description 2',
      url: 'https://youtube.com/watch?v=vid2',
      videoId: 'vid2',
      thumbnail: 'https://img.youtube.com/vi/vid2/mqdefault.jpg',
    },
    {
      title: 'Video 3',
      channel: 'Channel 3',
      description: 'Description 3',
      url: 'https://youtube.com/watch?v=vid3',
      videoId: 'vid3',
      thumbnail: 'https://img.youtube.com/vi/vid3/mqdefault.jpg',
    },
    {
      title: 'Video 4',
      channel: 'Channel 4',
      description: 'Description 4',
      url: 'https://youtube.com/watch?v=vid4',
      videoId: 'vid4',
      thumbnail: 'https://img.youtube.com/vi/vid4/mqdefault.jpg',
    },
    {
      title: 'Video 5',
      channel: 'Channel 5',
      description: 'Description 5',
      url: 'https://youtube.com/watch?v=vid5',
      videoId: 'vid5',
      thumbnail: 'https://img.youtube.com/vi/vid5/mqdefault.jpg',
    },
    {
      title: 'Video 6',
      channel: 'Channel 6',
      description: 'Description 6',
      url: 'https://youtube.com/watch?v=vid6',
      videoId: 'vid6',
      thumbnail: 'https://img.youtube.com/vi/vid6/mqdefault.jpg',
    },
    {
      title: 'Video 7',
      channel: 'Channel 7',
      description: 'Description 7',
      url: 'https://youtube.com/watch?v=vid7',
      videoId: 'vid7',
      thumbnail: 'https://img.youtube.com/vi/vid7/mqdefault.jpg',
    },
  ];

  it('should render nothing if no videos', () => {
    const { container } = render(<VideoCarousel videos={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should display initial videos (up to 6)', () => {
    render(<VideoCarousel videos={mockVideos} />);
    
    // Should show first 6 videos
    expect(screen.getByText('Video 1')).toBeInTheDocument();
    expect(screen.getByText('Video 6')).toBeInTheDocument();
    
    // Should not show 7th video initially
    expect(screen.queryByText('Video 7')).not.toBeInTheDocument();
  });

  it('should show "Show More" button when videos exceed 6', () => {
    render(<VideoCarousel videos={mockVideos} />);
    
    const showMoreButton = screen.getByRole('button', { name: /Show 1 More/i });
    expect(showMoreButton).toBeInTheDocument();
  });

  it('should show all videos when "Show More" is clicked', () => {
    render(<VideoCarousel videos={mockVideos} />);
    
    const showMoreButton = screen.getByRole('button', { name: /Show 1 More/i });
    fireEvent.click(showMoreButton);
    
    // All videos should now be visible
    expect(screen.getByText('Video 7')).toBeInTheDocument();
  });

  it('should show "Show Less" button after expanding', () => {
    render(<VideoCarousel videos={mockVideos} />);
    
    const showMoreButton = screen.getByRole('button', { name: /Show 1 More/i });
    fireEvent.click(showMoreButton);
    
    const showLessButton = screen.getByRole('button', { name: /Show Less/i });
    expect(showLessButton).toBeInTheDocument();
  });

  it('should hide extra videos when "Show Less" is clicked', () => {
    render(<VideoCarousel videos={mockVideos} />);
    
    const showMoreButton = screen.getByRole('button', { name: /Show 1 More/i });
    fireEvent.click(showMoreButton);
    
    const showLessButton = screen.getByRole('button', { name: /Show Less/i });
    fireEvent.click(showLessButton);
    
    // 7th video should be hidden again
    expect(screen.queryByText('Video 7')).not.toBeInTheDocument();
  });

  it('should display correct video count in header', () => {
    render(<VideoCarousel videos={mockVideos} />);
    
    // Should show "6/7" initially
    expect(screen.getByText(/6\/7/)).toBeInTheDocument();
  });

  it('should display full count after expanding', () => {
    render(<VideoCarousel videos={mockVideos} />);
    
    const showMoreButton = screen.getByRole('button', { name: /Show 1 More/i });
    fireEvent.click(showMoreButton);
    
    // Should show "7" without slash
    expect(screen.getByText(/\(7\)/)).toBeInTheDocument();
  });
});

