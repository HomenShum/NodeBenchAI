/**
 * MessageHandlersContext
 * Provides stable callback references for message handlers to prevent re-renders
 *
 * Problem: Passing callback props like onCompanySelect creates new function refs on every render,
 * breaking React.memo optimization on child components.
 *
 * Solution: Use context with memoized callbacks to provide stable references.
 */

import React, { createContext, useContext, useMemo, useRef } from 'react';
import type { CompanyOption } from './CompanySelectionCard';
import type { PersonOption } from './PeopleSelectionCard';
import type { EventOption } from './EventSelectionCard';
import type { NewsArticleOption } from './NewsSelectionCard';

export interface MessageHandlers {
  onCompanySelect?: (company: CompanyOption) => void;
  onPersonSelect?: (person: PersonOption) => void;
  onEventSelect?: (event: EventOption) => void;
  onNewsSelect?: (article: NewsArticleOption) => void;
  onDocumentSelect?: (documentId: string) => void;
  onRegenerateMessage?: (messageKey: string) => void;
  onDeleteMessage?: (messageId: string) => void;
}

// Missing handlers mean the corresponding action is unavailable. Supplying
// truthy no-ops here would falsely grant UI controls permission to render.
const defaultHandlers: MessageHandlers = {};

const MessageHandlersContext = createContext<MessageHandlers>(defaultHandlers);

export function useMessageHandlers(): MessageHandlers {
  return useContext(MessageHandlersContext);
}

interface MessageHandlersProviderProps {
  children: React.ReactNode;
  handlers: {
    onCompanySelect?: (company: CompanyOption) => void;
    onPersonSelect?: (person: PersonOption) => void;
    onEventSelect?: (event: EventOption) => void;
    onNewsSelect?: (article: NewsArticleOption) => void;
    onDocumentSelect?: (documentId: string) => void;
    onRegenerateMessage?: (messageKey: string) => void;
    onDeleteMessage?: (messageId: string) => void;
  };
}

/**
 * Provider component that creates stable callback references using refs
 * Handlers can change without causing re-renders of consumers
 */
export function MessageHandlersProvider({ children, handlers }: MessageHandlersProviderProps) {
  // Store latest handlers in refs to avoid dependency changes
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Create stable callbacks that use refs internally
  const hasCompanySelect = Boolean(handlers.onCompanySelect);
  const hasPersonSelect = Boolean(handlers.onPersonSelect);
  const hasEventSelect = Boolean(handlers.onEventSelect);
  const hasNewsSelect = Boolean(handlers.onNewsSelect);
  const hasDocumentSelect = Boolean(handlers.onDocumentSelect);
  const hasRegenerateMessage = Boolean(handlers.onRegenerateMessage);
  const hasDeleteMessage = Boolean(handlers.onDeleteMessage);

  const stableHandlers = useMemo<MessageHandlers>(() => ({
    ...(hasCompanySelect
      ? { onCompanySelect: (company: CompanyOption) => handlersRef.current.onCompanySelect?.(company) }
      : {}),
    ...(hasPersonSelect
      ? { onPersonSelect: (person: PersonOption) => handlersRef.current.onPersonSelect?.(person) }
      : {}),
    ...(hasEventSelect
      ? { onEventSelect: (event: EventOption) => handlersRef.current.onEventSelect?.(event) }
      : {}),
    ...(hasNewsSelect
      ? { onNewsSelect: (article: NewsArticleOption) => handlersRef.current.onNewsSelect?.(article) }
      : {}),
    ...(hasDocumentSelect
      ? { onDocumentSelect: (documentId: string) => handlersRef.current.onDocumentSelect?.(documentId) }
      : {}),
    ...(hasRegenerateMessage
      ? { onRegenerateMessage: (messageKey: string) => handlersRef.current.onRegenerateMessage?.(messageKey) }
      : {}),
    ...(hasDeleteMessage
      ? { onDeleteMessage: (messageId: string) => handlersRef.current.onDeleteMessage?.(messageId) }
      : {}),
  }), [
    hasCompanySelect,
    hasDeleteMessage,
    hasDocumentSelect,
    hasEventSelect,
    hasNewsSelect,
    hasPersonSelect,
    hasRegenerateMessage,
  ]);

  return (
    <MessageHandlersContext.Provider value={stableHandlers}>
      {children}
    </MessageHandlersContext.Provider>
  );
}

export default MessageHandlersContext;
