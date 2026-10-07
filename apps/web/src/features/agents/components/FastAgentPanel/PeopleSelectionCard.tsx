// src/components/FastAgentPanel/PeopleSelectionCard.tsx
// People selection UI for person profile disambiguation

import React, { useState } from 'react';
import { User, Check, Briefcase, Building2, MapPin } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface PersonOption {
  id: string;
  name: string;
  profession?: string;
  organization?: string;
  location?: string;
  description: string;
  validationResult: 'PASS' | 'FAIL';
}

interface PeopleSelectionCardProps {
  prompt: string;
  people: PersonOption[];
  onSelect: (person: PersonOption) => void;
}

// ============================================================================
// Individual Person Card Component
// ============================================================================

function PersonCard({ 
  person, 
  isSelected, 
  onClick 
}: { 
  person: PersonOption; 
  isSelected: boolean; 
  onClick: () => void;
}) {
  return (
    <div 
      className={`person-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      {/* Validation Badge */}
      {person.validationResult === 'PASS' && (
        <div className="validation-badge">
          <Check className="h-3 w-3" />
          <span>Validated</span>
        </div>
      )}

      {/* Person Icon */}
      <div className="person-icon">
        <User className="h-8 w-8" />
      </div>

      {/* Person Info */}
      <div className="person-info">
        <h3 className="person-name">{person.name}</h3>
        
        {person.profession && (
          <p className="person-meta">
            <Briefcase className="h-3 w-3" />
            {person.profession}
          </p>
        )}
        
        {person.organization && (
          <p className="person-meta">
            <Building2 className="h-3 w-3" />
            {person.organization}
          </p>
        )}
        
        {person.location && (
          <p className="person-meta">
            <MapPin className="h-3 w-3" />
            {person.location}
          </p>
        )}
        
        {person.description && (
          <p className="person-description">{person.description}</p>
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
          'Select This Person'
        )}
      </button>
    </div>
  );
}

// ============================================================================
// Main PeopleSelectionCard Component
// ============================================================================

export function PeopleSelectionCard({ prompt, people, onSelect }: PeopleSelectionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (person: PersonOption) => {
    setSelectedId(person.id);
    onSelect(person);
  };

  // Only show people that passed validation
  const validPeople = people.filter(p => p.validationResult === 'PASS');

  if (validPeople.length === 0) {
    return null;
  }

  return (
    <>
      <div className="people-selection">
        {/* Prompt */}
        <div className="selection-prompt">
          <User className="h-5 w-5" />
          <p>{prompt}</p>
        </div>

        {/* People Grid */}
        <div className="people-grid">
          {validPeople.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              isSelected={selectedId === person.id}
              onClick={() => handleSelect(person)}
            />
          ))}
        </div>
      </div>

      <style>{peopleSelectionStyles}</style>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const peopleSelectionStyles = `
  .people-selection {
    margin: 1rem 0;
    padding: 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
  }

  .people-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
  }

  .person-card {
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1.25rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .person-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
    border-color: #8b5cf6;
  }

  .person-card.selected {
    border-color: #10b981;
    background: #f0fdf4;
  }

  .person-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    margin-bottom: 0.75rem;
    background: #f3e8ff;
    border-radius: 0.5rem;
    color: #8b5cf6;
  }

  .person-info {
    margin-bottom: 1rem;
  }

  .person-name {
    font-size: 1rem;
    font-weight: 600;
    color: #111827;
    line-height: 1.3;
    margin-bottom: 0.5rem;
  }

  .person-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.25rem;
  }

  .person-description {
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
    .people-grid {
      grid-template-columns: 1fr;
    }
  }
`;

