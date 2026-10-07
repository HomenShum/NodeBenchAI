// src/components/FastAgentPanel/CompanySelectionCard.tsx
// Company selection UI for SEC filing disambiguation

import React, { useState } from 'react';
import { Building2, Check } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface CompanyOption {
  cik: string;
  name: string;
  ticker?: string;
  description: string;
  validationResult: 'PASS' | 'FAIL';
}

interface CompanySelectionCardProps {
  prompt: string;
  companies: CompanyOption[];
  onSelect: (company: CompanyOption) => void;
}

// ============================================================================
// Individual Company Card Component
// ============================================================================

function CompanyCard({ 
  company, 
  isSelected, 
  onClick 
}: { 
  company: CompanyOption; 
  isSelected: boolean; 
  onClick: () => void;
}) {
  return (
    <div 
      className={`company-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      {/* Validation Badge */}
      {company.validationResult === 'PASS' && (
        <div className="validation-badge">
          <Check className="h-3 w-3" />
          <span>Validated</span>
        </div>
      )}

      {/* Company Icon */}
      <div className="company-icon">
        <Building2 className="h-8 w-8" />
      </div>

      {/* Company Info */}
      <div className="company-info">
        <h3 className="company-name">{company.name}</h3>
        <p className="company-meta">
          CIK: {company.cik}
          {company.ticker && ` | Ticker: ${company.ticker}`}
        </p>
        {company.description && (
          <p className="company-description">{company.description}</p>
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
          'Select This Company'
        )}
      </button>
    </div>
  );
}

// ============================================================================
// Main CompanySelectionCard Component
// ============================================================================

export function CompanySelectionCard({ prompt, companies, onSelect }: CompanySelectionCardProps) {
  const [selectedCik, setSelectedCik] = useState<string | null>(null);

  const handleSelect = (company: CompanyOption) => {
    setSelectedCik(company.cik);
    onSelect(company);
  };

  // Only show companies that passed validation
  const validCompanies = companies.filter(c => c.validationResult === 'PASS');

  if (validCompanies.length === 0) {
    return null;
  }

  return (
    <>
      <div className="company-selection">
        {/* Prompt */}
        <div className="selection-prompt">
          <Building2 className="h-5 w-5" />
          <p>{prompt}</p>
        </div>

        {/* Company Grid */}
        <div className="company-grid">
          {validCompanies.map((company) => (
            <CompanyCard
              key={company.cik}
              company={company}
              isSelected={selectedCik === company.cik}
              onClick={() => handleSelect(company)}
            />
          ))}
        </div>
      </div>

      <style>{companySelectionStyles}</style>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const companySelectionStyles = `
  .company-selection {
    margin: 1rem 0;
    padding: 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
  }

  .selection-prompt {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
  }

  .selection-prompt p {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    color: #111827;
  }

  .company-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
  }

  .company-card {
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1.25rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .company-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
    border-color: #3b82f6;
  }

  .company-card.selected {
    border-color: #10b981;
    background: #f0fdf4;
  }

  .validation-badge {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: #10b981;
    color: white;
    font-size: 0.6875rem;
    font-weight: 600;
    border-radius: 0.25rem;
  }

  .company-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    margin-bottom: 0.75rem;
    background: #eff6ff;
    border-radius: 0.5rem;
    color: #3b82f6;
  }

  .company-info {
    margin-bottom: 1rem;
  }

  .company-name {
    font-size: 1rem;
    font-weight: 600;
    color: #111827;
    line-height: 1.3;
    margin-bottom: 0.5rem;
  }

  .company-meta {
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.5rem;
    font-family: monospace;
  }

  .company-description {
    font-size: 0.8125rem;
    color: #4b5563;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .select-btn {
    width: 100%;
    padding: 0.625rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .select-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .select-btn.selected {
    background: #10b981;
    cursor: not-allowed;
  }

  .select-btn:disabled {
    opacity: 0.8;
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .company-grid {
      grid-template-columns: 1fr;
    }
  }
`;

