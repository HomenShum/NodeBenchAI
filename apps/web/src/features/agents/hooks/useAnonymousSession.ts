/**
 * useAnonymousSession - Manages anonymous user session IDs for Fast Agent
 * 
 * Generates a persistent session ID stored in localStorage for anonymous users.
 * This ID is used to:
 * - Track daily usage limits (5 free messages/day)
 * - Associate anonymous threads with the same browser session
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from 'convex/react';
import { useConvexAuth } from 'convex/react';
import { api } from '../../../../convex/_generated/api';

const STORAGE_KEY = 'nodebench:anonymous:sessionId';

/**
 * Generate a random session ID using crypto API
 */
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `anon_${hex}`;
}

/**
 * Get or create a persistent session ID from localStorage
 */
function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') {
    return generateSessionId();
  }

  try {
    let sessionId = localStorage.getItem(STORAGE_KEY);
    if (!sessionId) {
      sessionId = generateSessionId();
      localStorage.setItem(STORAGE_KEY, sessionId);
    }
    return sessionId;
  } catch {
    // If localStorage fails, generate a new session ID each time
    return generateSessionId();
  }
}

export interface AnonymousSessionInfo {
  /** Whether the current user is anonymous (not authenticated) */
  isAnonymous: boolean;
  /** The session ID for anonymous users (null if authenticated) */
  sessionId: string | null;
  /** Number of messages used today */
  used: number;
  /** Daily message limit */
  limit: number;
  /** Remaining messages for today */
  remaining: number;
  /** Whether the user can send more messages */
  canSendMessage: boolean;
  /** Whether the usage data is still loading */
  isLoading: boolean;
}

/**
 * Hook to manage anonymous user sessions and track usage
 * 
 * @returns AnonymousSessionInfo with session state and usage limits
 */
export function useAnonymousSession(): AnonymousSessionInfo {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Initialize session ID on mount (client-side only)
  useEffect(() => {
    if (!isAuthenticated) {
      setSessionId(getOrCreateSessionId());
    } else {
      setSessionId(null);
    }
  }, [isAuthenticated]);

  // Query anonymous usage from backend
  const anonymousUsage = useQuery(
    api.domains.agents.fastAgentPanelStreaming.getAnonymousUsage,
    !isAuthenticated && sessionId ? { sessionId } : 'skip'
  );

  const isAnonymous = !authLoading && !isAuthenticated;
  const isLoading = authLoading || (isAnonymous && anonymousUsage === undefined);

  return {
    isAnonymous,
    sessionId: isAnonymous ? sessionId : null,
    used: anonymousUsage?.used ?? 0,
    limit: anonymousUsage?.limit ?? 5,
    remaining: anonymousUsage?.remaining ?? 5,
    canSendMessage: isAuthenticated || (anonymousUsage?.canSendMessage ?? true),
    isLoading,
  };
}

/**
 * Clear the anonymous session (e.g., when signing out or for testing)
 */
export function clearAnonymousSession(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore errors
    }
  }
}

