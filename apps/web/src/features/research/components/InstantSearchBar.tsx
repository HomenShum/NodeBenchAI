/**
 * InstantSearchBar.tsx
 * Search-as-you-type component for Welcome Landing
 * 
 * Features:
 * - Instant results from cached dossiers as user types
 * - Debounced search to reduce API calls
 * - Click existing result → navigate to document
 * - Press Enter → start fresh research with agent
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Search, ArrowRight, FileText, Sparkles, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

// Default suggested queries based on common research topics
const DEFAULT_SUGGESTIONS = [
  { label: 'AI Funding', query: 'Latest AI startup funding rounds this week' },
  { label: 'SEC Filings', query: 'Recent SEC 10-K filings for tech companies' },
  { label: 'Market Trends', query: 'Emerging market trends in healthcare technology' },
];

interface InstantSearchBarProps {
  onStartNewResearch: (query: string, options?: { mode?: 'quick' | 'deep' }) => void;
  onDocumentSelect?: (documentId: string) => void;
  defaultValue?: string;
  mode?: 'quick' | 'deep';
  autoFocus?: boolean;
  /** Called when search input gains focus */
  onFocus?: () => void;
  /** Called when search input loses focus */
  onBlur?: () => void;
  /** Dynamic suggested queries based on pulse grid content */
  suggestedQueries?: Array<{ label: string; query: string }>;
  /** Enable floating "command bar" style with stronger shadow */
  floating?: boolean;
}

// Simple debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function InstantSearchBar({
  onStartNewResearch,
  onDocumentSelect,
  defaultValue = '',
  mode = 'quick',
  autoFocus = false,
  onFocus,
  onBlur,
  suggestedQueries,
  floating = true,
}: InstantSearchBarProps) {
  const [inputValue, setInputValue] = useState(defaultValue);
  const [showResults, setShowResults] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedValue = useDebounce(inputValue, 300);

  // Merge custom suggestions with defaults
  const suggestions = suggestedQueries?.length ? suggestedQueries : DEFAULT_SUGGESTIONS;

  // Instant Search Query
  const results = useQuery(
    api.domains.documents.search.instantSearch,
    { query: debouncedValue, limit: 5 }
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const researchMode = e.metaKey || e.ctrlKey ? 'deep' : mode;
      onStartNewResearch(inputValue, { mode: researchMode });
      setShowResults(false);
    } else if (e.key === 'Escape') {
      setShowResults(false);
    }
  }, [inputValue, mode, onStartNewResearch]);

  const handleResultClick = useCallback((docId: string) => {
    setShowResults(false);
    if (onDocumentSelect) {
      onDocumentSelect(docId);
    }
  }, [onDocumentSelect]);

  const handleStartFresh = useCallback(() => {
    setShowResults(false);
    onStartNewResearch(inputValue, { mode });
  }, [inputValue, mode, onStartNewResearch]);

  const handleFocus = useCallback(() => {
    setShowResults(true);
    setIsFocused(true);
    onFocus?.();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onBlur?.();
  }, [onBlur]);

  const handleSuggestionClick = useCallback((query: string) => {
    setInputValue(query);
    inputRef.current?.focus();
    setShowResults(true);
  }, []);

  const hasResults = results && results.length > 0;
  const showDropdown = showResults && hasResults && inputValue.length >= 1;

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl mx-auto z-50">
      {/* Subtle glow effect behind - diffuse and calm */}
      <div className={cn(
        "absolute -inset-2 bg-gradient-to-r from-[color:var(--bg-tertiary)]/40 via-[color:var(--bg-secondary)]/30 to-[color:var(--bg-tertiary)]/40 rounded-lg blur-xl transition duration-500",
        floating ? "opacity-50" : "opacity-30",
        isFocused && "opacity-70 scale-[1.02]"
      )} />

      {/* Main Input Container - refined floating command bar */}
      <div className={cn(
        "relative flex items-center bg-surface transition-all duration-200",
        floating
          ? "shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-edge hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-edge"
          : "shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-edge",
        showDropdown ? "rounded-t-2xl rounded-b-none border-b-transparent shadow-lg ring-1 ring-[color:var(--border-color)]" : "rounded-lg",
        isFocused && !showDropdown && "ring-1 ring-[color:var(--border-color)] shadow-[0_8px_30px_rgb(0,0,0,0.06)]"
      )}>
        <div className="absolute left-4 text-content-secondary pointer-events-none">
          <Search className="w-5 h-5" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowResults(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="w-full h-14 bg-transparent text-base text-content placeholder:text-content-secondary pl-12 pr-14 outline-none border-none"
          placeholder="Search companies, people, or research topics..."
          autoFocus={autoFocus}
        />

        <button
          type="button"
          onClick={handleStartFresh}
          className="absolute right-2 p-2.5 bg-content text-surface rounded-lg hover:bg-content/90 transition-colors shadow-sm"
          title="Start research (Enter for Quick, Cmd/Ctrl+Enter for Deep)"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Instant Results Dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 bg-surface border border-edge border-t-0 rounded-b-2xl shadow-[0_20px_40px_rgb(0,0,0,0.08)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2 text-xs font-semibold text-content-secondary bg-surface-secondary/80 flex items-center gap-1.5">
            <Zap className="w-3 h-3" />
            Instant Knowledge (Cached)
          </div>

          <div className="max-h-80 overflow-y-auto">
            {results?.map((doc) => (
              <ResultItem
                key={doc._id}
                doc={doc}
                onClick={() => handleResultClick(doc._id)}
              />
            ))}
          </div>

          {/* Footer: Start Fresh Research */}
          {inputValue.trim() && (
            <button
              type="button"
              onClick={handleStartFresh}
              className="w-full p-3 bg-surface-secondary hover:bg-surface-hover cursor-pointer flex items-center justify-center gap-2 text-sm font-medium text-content border-t border-edge transition-colors"
            >
              <Sparkles className="w-4 h-4 text-purple-500" />
              <span>Start fresh research on "{inputValue}"</span>
            </button>
          )}
        </div>
      )}

      {/* Suggested Query Pills - Show when input is empty or very short */}
      {!showDropdown && inputValue.length < 3 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSuggestionClick(suggestion.query)}
              className="px-3 py-1.5 text-xs font-medium text-content bg-surface/80 border border-edge rounded-full hover:bg-surface-hover hover:border-edge hover:text-content transition-all duration-200 shadow-sm"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ResultItem Component
// ═══════════════════════════════════════════════════════════════════════════

interface SearchResult {
  _id: string;
  title: string;
  documentType?: string;
  snippet: string;
  matchType: 'recent' | 'search';
  _creationTime: number;
  updatedAt: number;
}

function ResultItem({ doc, onClick }: { doc: SearchResult; onClick: () => void }) {
  const timeAgo = formatTimeAgo(doc.updatedAt);
  const isDossier = doc.documentType === 'dossier';

  return (
    <div
      onClick={onClick}
      className="group flex items-start gap-3 p-4 hover:bg-blue-50/50 cursor-pointer border-b border-[color:var(--bg-secondary)] last:border-0 transition-colors"
    >
      <div className={cn(
        "p-2 rounded-lg transition-colors shrink-0",
        isDossier
          ? "bg-blue-100 text-blue-600 group-hover:bg-blue-200 group-hover:text-blue-700"
          : "bg-surface-secondary text-content group-hover:bg-surface-secondary group-hover:text-content"
      )}>
        <FileText className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-semibold text-content group-hover:text-blue-700 truncate">
            {doc.title}
          </h4>
          <span className="text-xs text-content-secondary flex items-center gap-1 shrink-0">
            <Clock className="w-3 h-3" />
            {timeAgo}
          </span>
        </div>
        <p className="text-sm text-content-secondary line-clamp-2 mt-1">
          {doc.snippet}
        </p>
        {isDossier && (
          <span className="inline-flex items-center mt-2 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
            Report
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default InstantSearchBar;

