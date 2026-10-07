// src/components/FastAgentPanel/NewsSelectionCard.tsx
// News article selection UI for recent news disambiguation

import React, { useState } from 'react';
import { Newspaper, Check, Calendar, ExternalLink, Shield } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface NewsArticleOption {
  id: string;
  headline: string;
  source?: string;
  date?: string;
  snippet: string;
  url?: string;
  credibility?: string;
  validationResult: 'PASS' | 'FAIL';
}

interface NewsSelectionCardProps {
  prompt: string;
  articles: NewsArticleOption[];
  onSelect: (article: NewsArticleOption) => void;
}

// ============================================================================
// Individual News Article Card Component
// ============================================================================

function NewsArticleCard({ 
  article, 
  isSelected, 
  onClick 
}: { 
  article: NewsArticleOption; 
  isSelected: boolean; 
  onClick: () => void;
}) {
  return (
    <div 
      className={`news-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      {/* Validation Badge */}
      {article.validationResult === 'PASS' && (
        <div className="validation-badge">
          <Check className="h-3 w-3" />
          <span>Validated</span>
        </div>
      )}

      {/* News Icon */}
      <div className="news-icon">
        <Newspaper className="h-8 w-8" />
      </div>

      {/* News Info */}
      <div className="news-info">
        <h3 className="news-headline">{article.headline}</h3>
        
        <div className="news-metadata">
          {article.source && (
            <p className="news-meta">
              <ExternalLink className="h-3 w-3" />
              {article.source}
            </p>
          )}
          
          {article.date && (
            <p className="news-meta">
              <Calendar className="h-3 w-3" />
              {article.date}
            </p>
          )}
          
          {article.credibility && (
            <p className="news-meta credibility">
              <Shield className="h-3 w-3" />
              {article.credibility}
            </p>
          )}
        </div>
        
        {article.snippet && (
          <p className="news-snippet">{article.snippet}</p>
        )}
      </div>

      {/* Select Button */}
      <button
        className={`select-btn ${isSelected ? 'selected' : ''}`}
        disabled={isSelected}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {isSelected ? (
          <>
            <Check className="h-4 w-4" />
            Selected
          </>
        ) : (
          'Select This Article'
        )}
      </button>
    </div>
  );
}

// ============================================================================
// Main NewsSelectionCard Component
// ============================================================================

export function NewsSelectionCard({ prompt, articles, onSelect }: NewsSelectionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (article: NewsArticleOption) => {
    setSelectedId(article.id);
    onSelect(article);
  };

  // Only show articles that passed validation
  const validArticles = articles.filter(a => a.validationResult === 'PASS');

  if (validArticles.length === 0) {
    return null;
  }

  return (
    <>
      <div className="news-selection">
        {/* Prompt */}
        <div className="selection-prompt">
          <Newspaper className="h-5 w-5" />
          <p>{prompt}</p>
        </div>

        {/* News Grid */}
        <div className="news-grid">
          {validArticles.map((article) => (
            <NewsArticleCard
              key={article.id}
              article={article}
              isSelected={selectedId === article.id}
              onClick={() => handleSelect(article)}
            />
          ))}
        </div>
      </div>

      <style>{newsSelectionStyles}</style>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const newsSelectionStyles = `
  .news-selection {
    margin: 1rem 0;
    padding: 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
  }

  .news-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  .news-card {
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1.25rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .news-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
    border-color: #06b6d4;
  }

  .news-card.selected {
    border-color: #10b981;
    background: #f0fdf4;
  }

  .news-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    margin-bottom: 0.75rem;
    background: #ecfeff;
    border-radius: 0.5rem;
    color: #06b6d4;
  }

  .news-info {
    margin-bottom: 1rem;
  }

  .news-headline {
    font-size: 1rem;
    font-weight: 600;
    color: #111827;
    line-height: 1.3;
    margin-bottom: 0.75rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .news-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .news-meta {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.6875rem;
    color: #6b7280;
    padding: 0.25rem 0.5rem;
    background: #f3f4f6;
    border-radius: 0.25rem;
  }

  .news-meta.credibility {
    background: #dbeafe;
    color: #1e40af;
  }

  .news-snippet {
    font-size: 0.8125rem;
    color: #4b5563;
    line-height: 1.4;
    margin-top: 0.5rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .news-grid {
      grid-template-columns: 1fr;
    }
  }
`;

