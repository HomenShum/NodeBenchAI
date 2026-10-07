// src/components/FastAgentPanel/FileViewer.tsx
// File viewer component for PDFs, HTML, and text documents (especially SEC filings)

import React, { useState } from 'react';
import { FileText, Download, ExternalLink, Maximize2, X, AlertCircle, Loader2 } from 'lucide-react';
import DOMPurify from 'dompurify';

// ============================================================================
// Types
// ============================================================================

export interface FileViewerFile {
  url: string;
  fileType: 'pdf' | 'html' | 'txt';
  title: string;
  metadata?: {
    size?: string;
    date?: string;
    source?: string;
    formType?: string;
    accessionNumber?: string;
  };
}

interface FileViewerProps {
  files: FileViewerFile[];
}

// ============================================================================
// Individual File Card Component
// ============================================================================

function FileCard({ file, onClick }: { file: FileViewerFile; onClick: () => void }) {
  const getFileIcon = () => {
    switch (file.fileType) {
      case 'pdf':
        return '📄';
      case 'html':
        return '🌐';
      case 'txt':
        return '📝';
      default:
        return '📁';
    }
  };

  const getFileTypeLabel = () => {
    return file.fileType.toUpperCase();
  };

  return (
    <div className="file-card" onClick={onClick}>
      {/* File Type Badge */}
      <div className="file-type-badge">{getFileTypeLabel()}</div>

      {/* File Icon */}
      <div className="file-icon">{getFileIcon()}</div>

      {/* File Info */}
      <div className="file-info">
        <h3 className="file-title">{file.title}</h3>
        {file.metadata?.formType && (
          <p className="file-meta">Form: {file.metadata.formType}</p>
        )}
        {file.metadata?.date && (
          <p className="file-meta">Date: {file.metadata.date}</p>
        )}
        {file.metadata?.source && (
          <p className="file-source">{file.metadata.source}</p>
        )}
      </div>

      {/* Actions */}
      <div className="file-actions">
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.open(file.url, '_blank');
          }}
          className="action-btn"
          title="Open in new tab"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const link = document.createElement('a');
            link.href = file.url;
            link.download = file.title;
            link.click();
          }}
          className="action-btn"
          title="Download file"
        >
          <Download className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// File Viewer Modal Component
// ============================================================================

function FileViewerModal({ file, onClose }: { file: FileViewerFile; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const renderFileContent = () => {
    if (error) {
      return (
        <div className="file-error">
          <AlertCircle className="h-12 w-12 text-red-500" />
          <h3 className="error-title">Failed to load file</h3>
          <p className="error-message">{error}</p>
          <div className="error-actions">
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
              }}
              className="error-btn"
            >
              Retry
            </button>
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="error-link"
            >
              Open in new tab <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      );
    }

    switch (file.fileType) {
      case 'pdf':
        return (
          <div className="pdf-viewer">
            {loading && (
              <div className="file-loading">
                <Loader2 className="h-8 w-8 motion-safe:animate-spin text-content-muted" />
                <p>Loading PDF...</p>
              </div>
            )}
            <iframe
              src={file.url}
              title={file.title}
              className="file-iframe"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError('Failed to load PDF. The file may be unavailable or require authentication.');
              }}
            />
          </div>
        );

      case 'html':
        return (
          <div className="html-viewer">
            {loading && (
              <div className="file-loading">
                <Loader2 className="h-8 w-8 motion-safe:animate-spin text-content-muted" />
                <p>Loading HTML...</p>
              </div>
            )}
            <iframe
              src={file.url}
              title={file.title}
              className="file-iframe"
              sandbox="allow-same-origin allow-scripts"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError('Failed to load HTML. The file may be unavailable or require authentication.');
              }}
            />
          </div>
        );

      case 'txt':
        return (
          <div className="txt-viewer">
            <iframe
              src={file.url}
              title={file.title}
              className="file-iframe"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError('Failed to load text file. The file may be unavailable.');
              }}
            />
          </div>
        );

      default:
        return (
          <div className="file-error">
            <AlertCircle className="h-12 w-12 text-yellow-500" />
            <h3 className="error-title">Unsupported file type</h3>
            <p className="error-message">This file type cannot be previewed inline.</p>
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="error-link"
            >
              Open in new tab <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        );
    }
  };

  return (
    <div className={`file-modal ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{file.title}</h3>
            <p className="modal-subtitle">
              {file.fileType.toUpperCase()}
              {file.metadata?.formType && ` • ${file.metadata.formType}`}
              {file.metadata?.date && ` • ${file.metadata.date}`}
            </p>
          </div>
          <div className="modal-actions">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="modal-btn"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="modal-btn" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* File Content */}
        {renderFileContent()}

        {/* Footer with metadata */}
        <div className="modal-footer">
          {file.metadata?.accessionNumber && (
            <div className="footer-row">
              <span className="footer-label">Accession Number:</span>
              <span className="footer-value">{file.metadata.accessionNumber}</span>
            </div>
          )}
          {file.metadata?.size && (
            <div className="footer-row">
              <span className="footer-label">Size:</span>
              <span className="footer-value">{file.metadata.size}</span>
            </div>
          )}
          <div className="footer-actions">
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
            >
              Open in new tab <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={() => {
                const link = document.createElement('a');
                link.href = file.url;
                link.download = file.title;
                link.click();
              }}
              className="footer-link"
            >
              Download <Download className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main FileViewer Component
// ============================================================================

export function FileViewer({ files }: FileViewerProps) {
  const [selectedFile, setSelectedFile] = useState<FileViewerFile | null>(null);

  if (files.length === 0) return null;

  return (
    <>
      <div className="file-viewer">
        <h2 className="viewer-title">
          <FileText className="h-4 w-4" />
          Documents
          <span className="viewer-count">({files.length})</span>
        </h2>

        <div className="file-grid">
          {files.map((file, idx) => (
            <FileCard
              key={idx}
              file={file}
              onClick={() => setSelectedFile(file)}
            />
          ))}
        </div>
      </div>

      {/* File Viewer Modal */}
      {selectedFile && (
        <FileViewerModal
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}

      <style>{fileViewerStyles}</style>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const fileViewerStyles = `
  .file-viewer {
    margin: 1rem 0;
  }

  .viewer-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.75rem;
  }

  .viewer-count {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .file-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 0.75rem;
  }

  .file-card {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .file-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
  }

  .file-type-badge {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: #10b981;
    color: white;
    font-size: 0.6875rem;
    font-weight: 600;
    border-radius: 0.25rem;
  }

  .file-icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  .file-info {
    margin-bottom: 0.75rem;
  }

  .file-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    margin-bottom: 0.5rem;
    padding-right: 3rem;
  }

  .file-meta {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-bottom: 0.125rem;
  }

  .file-source {
    font-size: 0.6875rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }

  .file-actions {
    display: flex;
    gap: 0.25rem;
  }

  .action-btn {
    padding: 0.375rem;
    background: var(--bg-hover);
    border: none;
    border-radius: 0.25rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: var(--border-color);
    color: var(--text-primary);
  }

  .file-modal {
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

  .file-modal.fullscreen .modal-content {
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
    background: var(--bg-primary);
    border-radius: 0.75rem;
    max-width: 1200px;
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
    border-bottom: 1px solid var(--border-color);
  }

  .modal-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .modal-subtitle {
    font-size: 0.875rem;
    color: var(--text-secondary);
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
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 0.25rem;
    transition: all 0.15s;
  }

  .modal-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pdf-viewer,
  .html-viewer,
  .txt-viewer {
    flex: 1;
    min-height: 600px;
    background: var(--bg-secondary);
    position: relative;
  }

  .file-iframe {
    width: 100%;
    height: 100%;
    border: none;
  }

  .file-loading {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    background: var(--bg-secondary);
    color: var(--text-secondary);
  }

  .file-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem;
    text-align: center;
  }

  .error-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .error-message {
    font-size: 0.875rem;
    color: var(--text-secondary);
    max-width: 400px;
  }

  .error-actions {
    display: flex;
    gap: 1rem;
    margin-top: 0.5rem;
  }

  .error-btn {
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .error-btn:hover {
    background: #2563eb;
  }

  .error-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 1rem;
    color: #3b82f6;
    text-decoration: none;
    border: 1px solid #3b82f6;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.15s;
  }

  .error-link:hover {
    background: #eff6ff;
  }

  .modal-footer {
    padding: 1rem;
    border-top: 1px solid var(--border-color);
  }

  .footer-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .footer-label {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .footer-value {
    font-size: 0.8125rem;
    color: var(--text-primary);
    font-family: monospace;
  }

  .footer-actions {
    display: flex;
    gap: 1rem;
    margin-top: 0.75rem;
  }

  .footer-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8125rem;
    color: #3b82f6;
    text-decoration: none;
    background: none;
    border: none;
    cursor: pointer;
    transition: color 0.15s;
  }

  .footer-link:hover {
    color: #2563eb;
    text-decoration: underline;
  }
`;

