// src/components/FastAgentPanel/MediaGallery.tsx
// Interactive gallery components for YouTube videos and SEC documents

import React, { useState } from 'react';
import { ExternalLink, FileText, Play, Maximize2, X } from 'lucide-react';

// ============================================================================
// YouTube Video Gallery
// ============================================================================

export interface YouTubeVideo {
  title: string;
  channel: string;
  description: string;
  url: string;
  videoId: string;
  thumbnail?: string;
}

interface YouTubeGalleryProps {
  videos: YouTubeVideo[];
}

export function YouTubeGallery({ videos }: YouTubeGalleryProps) {
  const [selectedVideo, setSelectedVideo] = useState<YouTubeVideo | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (videos.length === 0) return null;

  return (
    <>
      <div className="youtube-gallery">
        <h2 className="gallery-title">
          <Play className="h-4 w-4" />
          YouTube Videos
          <span className="gallery-count">({videos.length})</span>
        </h2>
        
        <div className="video-grid">
          {videos.map((video, idx) => (
            <div
              key={idx}
              className="video-card"
              onClick={() => setSelectedVideo(video)}
            >
              {/* Thumbnail - lazy loaded */}
              <div className="video-thumbnail">
                <img
                  src={video.thumbnail || `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`}
                  alt={video.title}
                  className="thumbnail-img"
                  loading="lazy"
                />
                <div className="play-overlay">
                  <Play className="play-icon" />
                </div>
              </div>
              
              {/* Info */}
              <div className="video-info">
                <h3 className="video-title">{video.title}</h3>
                <p className="video-channel">{video.channel}</p>
              </div>
              
              {/* Actions */}
              <div className="video-actions">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(video.url, '_blank');
                  }}
                  className="action-btn"
                  title="Open in YouTube"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedVideo(video);
                    setIsFullscreen(true);
                  }}
                  className="action-btn"
                  title="Watch fullscreen"
                >
                  <Maximize2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Video Player Modal */}
      {selectedVideo && (
        <div className={`video-modal ${isFullscreen ? 'fullscreen' : ''}`}>
          <div className="modal-overlay" onClick={() => setSelectedVideo(null)} />
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">{selectedVideo.title}</h3>
              <div className="modal-actions">
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="modal-btn"
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setSelectedVideo(null)}
                  className="modal-btn"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            
            <div className="video-player">
              <iframe
                src={`https://www.youtube.com/embed/${selectedVideo.videoId}?autoplay=1`}
                title={selectedVideo.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="video-iframe"
              />
            </div>
            
            <div className="video-details">
              <p className="detail-channel">{selectedVideo.channel}</p>
              <p className="detail-description">{selectedVideo.description}</p>
              <a
                href={selectedVideo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="detail-link"
              >
                Watch on YouTube <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      <style>{youtubeGalleryStyles}</style>
    </>
  );
}

// ============================================================================
// SEC Document Gallery
// ============================================================================

export interface SECDocument {
  title: string;
  formType: string;
  filingDate: string;
  accessionNumber: string;
  documentUrl: string;
  viewerUrl?: string;
  company?: string;
}

interface SECGalleryProps {
  documents: SECDocument[];
  onDownload?: (doc: SECDocument) => void;
}

export function SECDocumentGallery({ documents, onDownload }: SECGalleryProps) {
  const [selectedDoc, setSelectedDoc] = useState<SECDocument | null>(null);

  if (documents.length === 0) return null;

  return (
    <>
      <div className="sec-gallery">
        <h2 className="gallery-title">
          <FileText className="h-4 w-4" />
          SEC Filings
          <span className="gallery-count">({documents.length})</span>
        </h2>
        
        <div className="doc-grid">
          {documents.map((doc, idx) => (
            <div
              key={idx}
              className="doc-card"
              onClick={() => setSelectedDoc(doc)}
            >
              {/* Form Type Badge */}
              <div className="form-badge">{doc.formType}</div>
              
              {/* Info */}
              <div className="doc-info">
                <h3 className="doc-title">{doc.title}</h3>
                {doc.company && <p className="doc-company">{doc.company}</p>}
                <p className="doc-date">Filed: {doc.filingDate}</p>
                <p className="doc-accession">{doc.accessionNumber}</p>
              </div>
              
              {/* Actions */}
              <div className="doc-actions">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(doc.viewerUrl || doc.documentUrl, '_blank');
                  }}
                  className="action-btn"
                  title="View on SEC.gov"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
                {onDownload && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(doc);
                    }}
                    className="action-btn"
                    title="Download filing"
                  >
                    <FileText className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Document Viewer Modal */}
      {selectedDoc && (
        <div className="doc-modal">
          <div className="modal-overlay" onClick={() => setSelectedDoc(null)} />
          <div className="modal-content">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{selectedDoc.title}</h3>
                <p className="modal-subtitle">
                  {selectedDoc.formType} • Filed {selectedDoc.filingDate}
                </p>
              </div>
              <button
                onClick={() => setSelectedDoc(null)}
                className="modal-btn"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="doc-viewer">
              <iframe
                src={selectedDoc.viewerUrl || selectedDoc.documentUrl}
                title={selectedDoc.title}
                className="doc-iframe"
              />
            </div>
            
            <div className="doc-details">
              <div className="detail-row">
                <span className="detail-label">Accession Number:</span>
                <span className="detail-value">{selectedDoc.accessionNumber}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Filing Date:</span>
                <span className="detail-value">{selectedDoc.filingDate}</span>
              </div>
              <div className="detail-actions">
                <a
                  href={selectedDoc.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="detail-link"
                >
                  View on SEC.gov <ExternalLink className="h-3 w-3" />
                </a>
                {onDownload && (
                  <button
                    onClick={() => onDownload(selectedDoc)}
                    className="detail-link"
                  >
                    Download Filing <FileText className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{secGalleryStyles}</style>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const youtubeGalleryStyles = `
  .youtube-gallery {
    margin: 1rem 0;
  }
  
  .gallery-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #374151;
    margin-bottom: 0.75rem;
  }
  
  .gallery-count {
    font-size: 0.75rem;
    font-weight: 400;
    color: #6b7280;
  }
  
  .video-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.75rem;
  }
  
  .video-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .video-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
  }
  
  .video-thumbnail {
    position: relative;
    width: 100%;
    padding-top: 56.25%; /* 16:9 aspect ratio */
    background: #f3f4f6;
    overflow: hidden;
  }
  
  .thumbnail-img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .play-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.3);
    opacity: 0;
    transition: opacity 0.2s;
  }
  
  .video-card:hover .play-overlay {
    opacity: 1;
  }
  
  .play-icon {
    width: 3rem;
    height: 3rem;
    color: white;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  }
  
  .video-info {
    padding: 0.75rem;
  }
  
  .video-title {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #111827;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 0.25rem;
  }
  
  .video-channel {
    font-size: 0.75rem;
    color: #6b7280;
  }
  
  .video-actions {
    display: flex;
    gap: 0.25rem;
    padding: 0 0.75rem 0.75rem;
  }
  
  .action-btn {
    padding: 0.375rem;
    background: #f3f4f6;
    border: none;
    border-radius: 0.25rem;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.15s;
  }
  
  .action-btn:hover {
    background: #e5e7eb;
    color: #111827;
  }
  
  .video-modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .video-modal.fullscreen .modal-content {
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    border-radius: 0;
  }
  
  .modal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.75);
  }
  
  .modal-content {
    position: relative;
    background: white;
    border-radius: 0.75rem;
    max-width: 900px;
    max-height: 90vh;
    width: 90%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid #e5e7eb;
  }
  
  .modal-title {
    font-size: 1rem;
    font-weight: 600;
    color: #111827;
  }
  
  .modal-subtitle {
    font-size: 0.875rem;
    color: #6b7280;
    margin-top: 0.25rem;
  }
  
  .modal-actions {
    display: flex;
    gap: 0.5rem;
  }
  
  .modal-btn {
    padding: 0.5rem;
    background: transparent;
    border: none;
    color: #6b7280;
    cursor: pointer;
    border-radius: 0.25rem;
    transition: all 0.15s;
  }
  
  .modal-btn:hover {
    background: #f3f4f6;
    color: #111827;
  }
  
  .video-player {
    position: relative;
    width: 100%;
    padding-top: 56.25%;
    background: #000;
  }
  
  .video-iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
  }
  
  .video-details {
    padding: 1rem;
    overflow-y: auto;
  }
  
  .detail-channel {
    font-size: 0.875rem;
    font-weight: 500;
    color: #111827;
    margin-bottom: 0.5rem;
  }
  
  .detail-description {
    font-size: 0.8125rem;
    color: #6b7280;
    line-height: 1.5;
    margin-bottom: 0.75rem;
  }
  
  .detail-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8125rem;
    color: #3b82f6;
    text-decoration: none;
    transition: color 0.15s;
  }
  
  .detail-link:hover {
    color: #2563eb;
    text-decoration: underline;
  }
`;

const secGalleryStyles = `
  .sec-gallery {
    margin: 1rem 0;
  }
  
  .doc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 0.75rem;
  }
  
  .doc-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }
  
  .doc-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
  }
  
  .form-badge {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: #3b82f6;
    color: white;
    font-size: 0.6875rem;
    font-weight: 600;
    border-radius: 0.25rem;
  }
  
  .doc-info {
    margin-bottom: 0.75rem;
  }
  
  .doc-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #111827;
    line-height: 1.3;
    margin-bottom: 0.5rem;
    padding-right: 3rem;
  }
  
  .doc-company {
    font-size: 0.8125rem;
    color: #374151;
    margin-bottom: 0.25rem;
  }
  
  .doc-date {
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.125rem;
  }
  
  .doc-accession {
    font-size: 0.6875rem;
    color: #9ca3af;
    font-family: monospace;
  }
  
  .doc-actions {
    display: flex;
    gap: 0.25rem;
  }
  
  .doc-modal .modal-content {
    max-width: 1200px;
  }
  
  .doc-viewer {
    flex: 1;
    min-height: 500px;
    background: #f9fafb;
  }
  
  .doc-iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
  
  .doc-details {
    padding: 1rem;
    border-top: 1px solid #e5e7eb;
  }
  
  .detail-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  
  .detail-label {
    font-size: 0.8125rem;
    color: #6b7280;
  }
  
  .detail-value {
    font-size: 0.8125rem;
    color: #111827;
    font-family: monospace;
  }
  
  .detail-actions {
    display: flex;
    gap: 1rem;
    margin-top: 0.75rem;
  }
`;

