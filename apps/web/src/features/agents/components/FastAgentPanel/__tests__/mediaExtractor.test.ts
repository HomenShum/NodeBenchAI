// src/components/FastAgentPanel/__tests__/mediaExtractor.test.ts
// Tests for media extraction from tool results

import { describe, it, expect } from 'vitest';
import {
  extractMediaFromText,
  removeMediaMarkersFromText,
  hasMedia,
} from '../utils/mediaExtractor';

describe('mediaExtractor', () => {
  describe('extractMediaFromText', () => {
    it('should extract YouTube videos from HTML comment markers', () => {
      const text = `
        Some text here
        <!-- YOUTUBE_GALLERY_DATA
        [
          {
            "title": "Tesla 10-K Analysis",
            "channel": "Investor Channel",
            "description": "Deep dive into Tesla's 10-K",
            "url": "https://www.youtube.com/watch?v=abc123",
            "videoId": "abc123",
            "thumbnail": "https://img.youtube.com/vi/abc123/mqdefault.jpg"
          }
        ]
        -->
        More text
      `;

      const media = extractMediaFromText(text);
      expect(media.youtubeVideos).toHaveLength(1);
      expect(media.youtubeVideos[0].title).toBe('Tesla 10-K Analysis');
      expect(media.youtubeVideos[0].videoId).toBe('abc123');
    });

    it('should extract web sources from HTML comment markers', () => {
      const text = `
        <!-- SOURCE_GALLERY_DATA
        [
          {
            "title": "Tesla News Article",
            "url": "https://example.com/tesla-news",
            "domain": "example.com",
            "description": "Latest Tesla news"
          }
        ]
        -->
      `;

      const media = extractMediaFromText(text);
      expect(media.webSources).toHaveLength(1);
      expect(media.webSources[0].title).toBe('Tesla News Article');
      expect(media.webSources[0].domain).toBe('example.com');
    });

    it('should extract profiles from HTML comment markers', () => {
      const text = `
        <!-- PROFILE_GALLERY_DATA
        [
          {
            "name": "Elon Musk",
            "profession": "CEO",
            "organization": "Tesla",
            "location": "Austin, TX",
            "description": "Founder and CEO of Tesla"
          }
        ]
        -->
      `;

      const media = extractMediaFromText(text);
      expect(media.profiles).toHaveLength(1);
      expect(media.profiles[0].name).toBe('Elon Musk');
      expect(media.profiles[0].profession).toBe('CEO');
    });

    it('should extract images from markdown syntax', () => {
      const text = `
        ![Tesla Image](https://example.com/tesla.jpg)
        ![Another Image](https://example.com/another.png)
      `;

      const media = extractMediaFromText(text);
      expect(media.images).toHaveLength(2);
      expect(media.images[0].url).toBe('https://example.com/tesla.jpg');
      expect(media.images[0].alt).toBe('Tesla Image');
    });

    it('should extract multiple media types together', () => {
      const text = `
        <!-- YOUTUBE_GALLERY_DATA
        [{"title": "Video", "videoId": "vid1", "url": "https://youtube.com/watch?v=vid1"}]
        -->
        <!-- SOURCE_GALLERY_DATA
        [{"title": "Source", "url": "https://example.com"}]
        -->
        <!-- PROFILE_GALLERY_DATA
        [{"name": "Person", "profession": "CEO"}]
        -->
        ![Image](https://example.com/img.jpg)
      `;

      const media = extractMediaFromText(text);
      expect(media.youtubeVideos).toHaveLength(1);
      expect(media.webSources).toHaveLength(1);
      expect(media.profiles).toHaveLength(1);
      expect(media.images).toHaveLength(1);
    });
  });

  describe('removeMediaMarkersFromText', () => {
    it('should remove YouTube gallery markers', () => {
      const text = `
        Text before
        <!-- YOUTUBE_GALLERY_DATA
        [{"title": "Video"}]
        -->
        Text after
      `;

      const cleaned = removeMediaMarkersFromText(text);
      expect(cleaned).not.toContain('YOUTUBE_GALLERY_DATA');
      expect(cleaned).toContain('Text before');
      expect(cleaned).toContain('Text after');
    });

    it('should remove all media markers', () => {
      const text = `
        <!-- YOUTUBE_GALLERY_DATA
        [{"title": "Video"}]
        -->
        <!-- SOURCE_GALLERY_DATA
        [{"title": "Source"}]
        -->
        <!-- PROFILE_GALLERY_DATA
        [{"name": "Person"}]
        -->
        Text
      `;

      const cleaned = removeMediaMarkersFromText(text);
      expect(cleaned).not.toContain('GALLERY_DATA');
      expect(cleaned).toContain('Text');
    });

    it('should remove "## Images" headers', () => {
      const text = `
        ## Images

        ![Image](url)
      `;

      const cleaned = removeMediaMarkersFromText(text);
      expect(cleaned).not.toContain('## Images');
    });

    it('should remove "## Images" section header and images on same line', () => {
      const text = `
        Text before

        ## Images
![Image 1](https://example.com/img1.jpg) ![Image 2](https://example.com/img2.jpg)

        ## Other Section

        Text after
      `;

      const cleaned = removeMediaMarkersFromText(text);
      expect(cleaned).not.toContain('## Images');
      expect(cleaned).not.toContain('![Image 1]');
      expect(cleaned).not.toContain('![Image 2]');
      expect(cleaned).toContain('Text before');
      expect(cleaned).toContain('## Other Section');
      expect(cleaned).toContain('Text after');
    });
  });

  describe('hasMedia', () => {
    it('should return true if media has videos', () => {
      const media = {
        youtubeVideos: [{ title: 'Video', videoId: 'vid1', url: 'https://youtube.com' }],
        secDocuments: [],
        webSources: [],
        profiles: [],
        images: [],
      };

      expect(hasMedia(media as any)).toBe(true);
    });

    it('should return true if media has sources', () => {
      const media = {
        youtubeVideos: [],
        secDocuments: [],
        webSources: [{ title: 'Source', url: 'https://example.com' }],
        profiles: [],
        images: [],
      };

      expect(hasMedia(media)).toBe(true);
    });

    it('should return true if media has profiles', () => {
      const media = {
        youtubeVideos: [],
        secDocuments: [],
        webSources: [],
        profiles: [{ name: 'Person', profession: 'CEO' }],
        images: [],
      };

      expect(hasMedia(media)).toBe(true);
    });

    it('should return false if no media', () => {
      const media = {
        youtubeVideos: [],
        secDocuments: [],
        webSources: [],
        profiles: [],
        images: [],
      };

      expect(hasMedia(media)).toBe(false);
    });
  });
});

