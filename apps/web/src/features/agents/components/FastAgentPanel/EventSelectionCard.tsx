// src/components/FastAgentPanel/EventSelectionCard.tsx
// Event selection UI for recent event disambiguation

import React, { useState } from 'react';
import { Calendar, Check, MapPin, ExternalLink } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface EventOption {
  id: string;
  name: string;
  date?: string;
  location?: string;
  description: string;
  source?: string;
  validationResult: 'PASS' | 'FAIL';
}

interface EventSelectionCardProps {
  prompt: string;
  events: EventOption[];
  onSelect: (event: EventOption) => void;
}

// ============================================================================
// Individual Event Card Component
// ============================================================================

function EventCard({ 
  event, 
  isSelected, 
  onClick 
}: { 
  event: EventOption; 
  isSelected: boolean; 
  onClick: () => void;
}) {
  return (
    <div 
      className={`event-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      {/* Validation Badge */}
      {event.validationResult === 'PASS' && (
        <div className="validation-badge">
          <Check className="h-3 w-3" />
          <span>Validated</span>
        </div>
      )}

      {/* Event Icon */}
      <div className="event-icon">
        <Calendar className="h-8 w-8" />
      </div>

      {/* Event Info */}
      <div className="event-info">
        <h3 className="event-name">{event.name}</h3>
        
        {event.date && (
          <p className="event-meta">
            <Calendar className="h-3 w-3" />
            {event.date}
          </p>
        )}
        
        {event.location && (
          <p className="event-meta">
            <MapPin className="h-3 w-3" />
            {event.location}
          </p>
        )}
        
        {event.source && (
          <p className="event-meta">
            <ExternalLink className="h-3 w-3" />
            {event.source}
          </p>
        )}
        
        {event.description && (
          <p className="event-description">{event.description}</p>
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
          'Select This Event'
        )}
      </button>
    </div>
  );
}

// ============================================================================
// Main EventSelectionCard Component
// ============================================================================

export function EventSelectionCard({ prompt, events, onSelect }: EventSelectionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (event: EventOption) => {
    setSelectedId(event.id);
    onSelect(event);
  };

  // Only show events that passed validation
  const validEvents = events.filter(e => e.validationResult === 'PASS');

  if (validEvents.length === 0) {
    return null;
  }

  return (
    <>
      <div className="event-selection">
        {/* Prompt */}
        <div className="selection-prompt">
          <Calendar className="h-5 w-5" />
          <p>{prompt}</p>
        </div>

        {/* Event Grid */}
        <div className="event-grid">
          {validEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSelected={selectedId === event.id}
              onClick={() => handleSelect(event)}
            />
          ))}
        </div>
      </div>

      <style>{eventSelectionStyles}</style>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const eventSelectionStyles = `
  .event-selection {
    margin: 1rem 0;
    padding: 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
  }

  .event-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
  }

  .event-card {
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1.25rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .event-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
    border-color: #f59e0b;
  }

  .event-card.selected {
    border-color: #10b981;
    background: #f0fdf4;
  }

  .event-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    margin-bottom: 0.75rem;
    background: #fef3c7;
    border-radius: 0.5rem;
    color: #f59e0b;
  }

  .event-info {
    margin-bottom: 1rem;
  }

  .event-name {
    font-size: 1rem;
    font-weight: 600;
    color: #111827;
    line-height: 1.3;
    margin-bottom: 0.5rem;
  }

  .event-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.25rem;
  }

  .event-description {
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
    .event-grid {
      grid-template-columns: 1fr;
    }
  }
`;

