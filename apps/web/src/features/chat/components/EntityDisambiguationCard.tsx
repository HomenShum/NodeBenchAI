// EntityDisambiguationCard.tsx
// UI for handling ambiguous entity resolution across all entity types
// Shows candidates when the system cannot resolve to a single entity

import React, { useState } from 'react';
import { HelpCircle, Check, Building2, User, Calendar, MapPin, Package } from 'lucide-react';
import type { ProductResolutionCandidate } from '../../../../shared/productAnswerControl';

// ============================================================================
// Types
// ============================================================================

interface EntityDisambiguationCardProps {
  query: string;
  candidates: ProductResolutionCandidate[];
  onSelect: (candidate: ProductResolutionCandidate) => void;
  onClarify?: (clarification: string) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getEntityIcon(reason: string) {
  if (reason.toLowerCase().includes('person')) return User;
  if (reason.toLowerCase().includes('event')) return Calendar;
  if (reason.toLowerCase().includes('location')) return MapPin;
  if (reason.toLowerCase().includes('product')) return Package;
  return Building2;
}

function formatConfidence(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct >= 90) return 'Very likely';
  if (pct >= 70) return 'Likely';
  if (pct >= 50) return 'Possible';
  return 'Uncertain';
}

// ============================================================================
// Individual Candidate Card
// ============================================================================

function CandidateCard({
  candidate,
  isSelected,
  onClick,
}: {
  candidate: ProductResolutionCandidate;
  isSelected: boolean;
  onClick: () => void;
}) {
  const Icon = getEntityIcon(candidate.reason);
  const confidenceLabel = formatConfidence(candidate.confidence);

  return (
    <div
      className={`candidate-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Confidence Badge */}
      <div className={`confidence-badge ${confidenceLabel.toLowerCase().replace(' ', '-')}`}>
        {confidenceLabel}
      </div>

      {/* Icon */}
      <div className="candidate-icon">
        <Icon className="h-6 w-6" />
      </div>

      {/* Info */}
      <div className="candidate-info">
        <h3 className="candidate-label">{candidate.label}</h3>
        <p className="candidate-slug">{candidate.slug}</p>
        <p className="candidate-reason">{candidate.reason}</p>
      </div>

      {/* Select Button */}
      <button
        className={`select-btn ${isSelected ? 'selected' : ''}`}
        disabled={isSelected}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        aria-label={isSelected ? 'Selected' : `Select ${candidate.label}`}
      >
        {isSelected ? (
          <>
            <Check className="h-4 w-4" aria-hidden="true" />
            <span>Selected</span>
          </>
        ) : (
          <span>Select</span>
        )}
      </button>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EntityDisambiguationCard({
  query,
  candidates,
  onSelect,
  onClarify,
}: EntityDisambiguationCardProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [clarification, setClarification] = useState('');

  const handleSelect = (candidate: ProductResolutionCandidate) => {
    setSelectedKey(candidate.candidateKey);
    onSelect(candidate);
  };

  const handleClarify = () => {
    if (clarification.trim() && onClarify) {
      onClarify(clarification.trim());
      setClarification('');
    }
  };

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="disambiguation-card" role="region" aria-label="Entity disambiguation">
      {/* Header */}
      <div className="disambiguation-header">
        <HelpCircle className="h-5 w-5" aria-hidden="true" />
        <div>
          <h2 className="disambiguation-title">Which one did you mean?</h2>
          <p className="disambiguation-query">"{query}"</p>
        </div>
      </div>

      {/* Explanation */}
      <p className="disambiguation-explanation">
        Multiple entities match your request. Select the correct one, or provide
        more details to help narrow it down.
      </p>

      {/* Candidates Grid */}
      <div className="candidates-grid" role="listbox" aria-label="Entity candidates">
        {candidates.map((candidate) => (
          <CandidateCard
            key={candidate.candidateKey}
            candidate={candidate}
            isSelected={selectedKey === candidate.candidateKey}
            onClick={() => handleSelect(candidate)}
          />
        ))}
      </div>

      {/* Clarification Input */}
      {onClarify && (
        <div className="clarification-section">
          <label htmlFor="clarification-input" className="clarification-label">
            Or provide more details:
          </label>
          <div className="clarification-input-row">
            <input
              id="clarification-input"
              type="text"
              value={clarification}
              onChange={(e) => setClarification(e.target.value)}
              placeholder="e.g., 'the one based in San Francisco' or 'the AI company, not the bank'"
              className="clarification-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleClarify();
                }
              }}
            />
            <button
              onClick={handleClarify}
              disabled={!clarification.trim()}
              className="clarify-btn"
            >
              Clarify
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="disambiguation-actions">
        <p className="trust-note">
          No report will be saved until the target is clarified.
        </p>
      </div>

      <style>{disambiguationStyles}</style>
    </div>
  );
}

// ============================================================================
// Styles
// ============================================================================

const disambiguationStyles = `
  .disambiguation-card {
    margin: 1rem 0;
    padding: 1.25rem;
    background: var(--nb-surface-elevated, #1a1a2e);
    border: 1px solid var(--nb-border-default, #2a2a3a);
    border-radius: 0.75rem;
    color: var(--nb-text-primary, #e4e4e7);
  }

  .disambiguation-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--nb-border-default, #2a2a3a);
  }

  .disambiguation-header svg {
    color: var(--nb-accent-warning, #f59e0b);
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .disambiguation-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--nb-text-primary, #e4e4e7);
  }

  .disambiguation-query {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: var(--nb-text-secondary, #a1a1aa);
    font-style: italic;
  }

  .disambiguation-explanation {
    margin: 0 0 1rem;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--nb-text-secondary, #a1a1aa);
  }

  .candidates-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .candidate-card {
    position: relative;
    background: var(--nb-surface-card, #16161f);
    border: 2px solid var(--nb-border-default, #2a2a3a);
    border-radius: 0.5rem;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .candidate-card:hover {
    border-color: var(--nb-accent-primary, #8b5cf6);
    transform: translateY(-1px);
  }

  .candidate-card.selected {
    border-color: var(--nb-accent-success, #10b981);
    background: rgba(16, 185, 129, 0.05);
  }

  .candidate-card:focus {
    outline: 2px solid var(--nb-accent-primary, #8b5cf6);
    outline-offset: 2px;
  }

  .confidence-badge {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    border-radius: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .confidence-badge.very-likely {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .confidence-badge.likely {
    background: rgba(59, 130, 246, 0.2);
    color: #3b82f6;
  }

  .confidence-badge.possible {
    background: rgba(245, 158, 11, 0.2);
    color: #f59e0b;
  }

  .confidence-badge.uncertain {
    background: rgba(107, 114, 128, 0.2);
    color: #9ca3af;
  }

  .candidate-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    margin-bottom: 0.75rem;
    background: var(--nb-surface-elevated, #1a1a2e);
    border-radius: 0.375rem;
    color: var(--nb-accent-primary, #8b5cf6);
  }

  .candidate-info {
    margin-bottom: 0.75rem;
  }

  .candidate-label {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--nb-text-primary, #e4e4e7);
  }

  .candidate-slug {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    color: var(--nb-text-muted, #71717a);
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  .candidate-reason {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--nb-text-secondary, #a1a1aa);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .select-btn {
    width: 100%;
    padding: 0.5rem 1rem;
    background: var(--nb-accent-primary, #8b5cf6);
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .select-btn:hover:not(:disabled) {
    background: var(--nb-accent-primary-hover, #7c3aed);
  }

  .select-btn.selected {
    background: var(--nb-accent-success, #10b981);
    cursor: not-allowed;
  }

  .select-btn:disabled {
    opacity: 0.7;
  }

  .clarification-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--nb-border-default, #2a2a3a);
  }

  .clarification-label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--nb-text-secondary, #a1a1aa);
  }

  .clarification-input-row {
    display: flex;
    gap: 0.5rem;
  }

  .clarification-input {
    flex: 1;
    padding: 0.625rem 0.875rem;
    background: var(--nb-surface-card, #16161f);
    border: 1px solid var(--nb-border-default, #2a2a3a);
    border-radius: 0.375rem;
    color: var(--nb-text-primary, #e4e4e7);
    font-size: 0.9375rem;
    transition: border-color 0.15s ease;
  }

  .clarification-input:focus {
    outline: none;
    border-color: var(--nb-accent-primary, #8b5cf6);
  }

  .clarification-input::placeholder {
    color: var(--nb-text-muted, #71717a);
  }

  .clarify-btn {
    padding: 0.625rem 1rem;
    background: var(--nb-surface-elevated, #1a1a2e);
    border: 1px solid var(--nb-border-default, #2a2a3a);
    border-radius: 0.375rem;
    color: var(--nb-text-primary, #e4e4e7);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .clarify-btn:hover:not(:disabled) {
    background: var(--nb-accent-primary, #8b5cf6);
    border-color: var(--nb-accent-primary, #8b5cf6);
  }

  .clarify-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .disambiguation-actions {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--nb-border-default, #2a2a3a);
  }

  .trust-note {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--nb-text-muted, #71717a);
    text-align: center;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .candidates-grid {
      grid-template-columns: 1fr;
    }

    .clarification-input-row {
      flex-direction: column;
    }

    .clarify-btn {
      width: 100%;
    }
  }
`;
