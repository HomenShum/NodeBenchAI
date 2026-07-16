// src/components/FastAgentPanel/FastAgentPanel.tsx
// Main container component for the new ChatGPT-like AI chat sidebar

import React, { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConvex, usePaginatedQuery, useQuery, useMutation, useAction, useConvexAuth } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { Id } from '../../../../../convex/_generated/dataModel';
import { X, Loader2, ChevronDown, ArrowDown, MessageSquare, Activity, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';

import './FastAgentPanel.animations.css';
import { FastAgentThreadList } from './FastAgentPanel.ThreadList';
import { FastAgentInputBar } from './FastAgentPanel.InputBar';
// Core chat components — always needed on panel open
import { HumanRequestList } from './HumanRequestCard';
import { FastAgentUIMessageBubble } from './FastAgentPanel.UIMessageBubble';
import { MessageHandlersProvider } from './MessageHandlersContext';
import { VirtualizedMessageList, useMessageVirtualization } from './VirtualizedMessageList';
import { useSwarmByThread, useSwarmActions, parseSpawnCommand, isSpawnCommand } from '@/hooks/useSwarm';
import { QuickCommandChips } from './QuickCommandChips';
import { QuotePopover } from '@/features/chat/components/QuotePopover';

// Tab-gated / conditional components — lazy-loaded on first use
import type { DisclosureEvent } from './FastAgentPanel.DisclosureTrace';
const AgentHierarchy = React.lazy(() => import('./FastAgentPanel.AgentHierarchy').then(m => ({ default: m.AgentHierarchy })));
const SkillsPanel = React.lazy(() => import('./FastAgentPanel.SkillsPanel').then(m => ({ default: m.SkillsPanel })));
const DisclosureTrace = React.lazy(() => import('./FastAgentPanel.DisclosureTrace').then(m => ({ default: m.DisclosureTrace })));
const AgentTasksTab = React.lazy(() => import('./FastAgentPanel.AgentTasksTab').then(m => ({ default: m.AgentTasksTab })));
const TraceAuditPanel = React.lazy(() => import('./FastAgentPanel.TraceAuditPanel').then(m => ({ default: m.TraceAuditPanel })));
const EditsTab = React.lazy(() => import('./FastAgentPanel.EditsTab').then(m => ({ default: m.EditsTab })));
const BriefTab = React.lazy(() => import('./FastAgentPanel.BriefTab').then(m => ({ default: m.BriefTab })));
const SwarmLanesView = React.lazy(() => import('./SwarmLanesView').then(m => ({ default: m.SwarmLanesView })));
const LiveAgentLanes = React.lazy(() => import('@/features/agents/views/LiveAgentLanes').then(m => ({ default: m.LiveAgentLanes })));
import { LiveEventCard, type LiveEvent } from './LiveEventCard';
import { extractLiveEventsFromUIMessages } from './liveEvents';
import { RichMediaSection } from './RichMediaSection';
import { DocumentActionGrid, type DocumentAction } from './DocumentActionCard';
import type { ExtractedMedia } from './utils/mediaExtractor';
import { collectConsultedArtifacts } from './FastAgentPanel.provenance';
import type { AgentOpenOptions, DossierContext } from '@/features/agents/context/FastAgentContext';
import { useFastAgent } from '@/features/agents/context/FastAgentContext';
import { SaveToNotebookButton } from '@/features/agents/components/SaveToNotebookButton';
import { trackEvent } from '@/lib/analytics';
import { buildDossierContextPrefix } from '@/features/agents/context/FastAgentContext';
import { MinimizedStrip } from './FastAgentPanel.MinimizedStrip';
import { PanelHeader } from './FastAgentPanel.PanelHeader';
import { PanelOverlays } from './FastAgentPanel.PanelOverlays';
import { PanelDialogs } from './FastAgentPanel.PanelDialogs';
import { DossierModeIndicator } from '@/features/agents/components/DossierModeIndicator';
import { DEFAULT_MODEL, type ApprovedModel } from '@shared/llm/approvedModels';
import {
  ANONYMOUS_FAST_AGENT_MODEL_ID,
  FAST_AGENT_SIGN_IN_BENEFIT_COPY,
} from '../../../../../shared/llm/fastAgentRuntimeContract';
import { cn } from '@/lib/utils';
import { buildCockpitPath } from '@/lib/registry/viewRegistry';
import { useAnonymousSession } from '../../hooks/useAnonymousSession';
import {
  getFastAgentViewTabs,
  isFastAgentRuntimeOwnerReady,
  selectAnonymousRecoveryThreadId,
  type FastAgentPanelTab,
} from './FastAgentPanel.guestRuntime';
import { useAgentNavigation } from '../../hooks/useAgentNavigation';
import { useIntentTelemetry } from '@/lib/hooks/useIntentTelemetry';
import { useOracleSessionContext } from '@/contexts/OracleSessionContext';
import { EntityWorkspaceDrawerContent } from './EntityWorkspaceDrawerContent';
import { useConversationEngine } from '@/features/chat/hooks/useConversationEngine';
import type { LensId } from '@/features/controlPlane/components/searchTypes';
import { ProductIntakeComposer } from '@/features/product/components/ProductIntakeComposer';
import { uploadProductDraftFiles } from '@/features/product/lib/uploadDraftFiles';
import {
  dispatchFastAgentSubmission,
  getAuthenticatedDocumentCreationTopic,
  prepareFastAgentSubmission,
} from './FastAgentPanel.sendContract';
import {
  AgentRunErrorBanner,
  isActiveAgentRunStatus,
  isTerminalAgentRunStatus,
} from './FastAgentPanel.RunState';

import type { Message, Thread } from './types';

function focusFastAgentComposer() {
  document.querySelector<HTMLTextAreaElement>(
    '.fast-agent-panel #product-intake-query, .fast-agent-panel #fa-chat-input',
  )?.focus();
}

interface FastAgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDocumentId?: Id<"documents">;
  selectedDocumentIds?: Id<"documents">[];
  initialThreadId?: string | null; // Allow external components to set the active thread
  variant?: 'overlay' | 'sidebar';
  /** Contextual open options from FastAgentContext (prefill/autosend/context docs/urls). */
  openOptions?: AgentOpenOptions | null;
  /** Called after openOptions has been applied (prevents duplicate processing). */
  onOptionsConsumed?: () => void;
  /** Voice intent router — intercepts UI commands before agent send. Return true if handled. */
  onVoiceIntent?: (text: string, source?: 'voice' | 'text') => boolean;
}

/**
 * Extract plain text from an agent message regardless of which shape the
 * Convex agent SDK returned. Used by both the artifact aggregator and the
 * per-message "Save to notebook" CTA — keeping the logic single-sourced.
 */
function extractAssistantMessageText(msg: any): string {
  if (typeof msg?.text === "string" && msg.text.trim()) return msg.text;
  if (typeof msg?.content === "string" && msg.content.trim()) return msg.content;
  if (Array.isArray(msg?.content)) {
    const parts = msg.content
      .filter((c: any) => typeof c?.text === "string")
      .map((c: any) => c.text)
      .join("\n\n");
    if (parts.trim()) return parts;
  }
  if (typeof msg?.message?.text === "string" && msg.message.text.trim()) {
    return msg.message.text;
  }
  return "";
}

function DossierFocusSubscription({
  briefId,
  dossierContextRef,
  dossierPrefixRef,
}: {
  briefId: string;
  dossierContextRef: React.MutableRefObject<DossierContext | null>;
  dossierPrefixRef: React.MutableRefObject<string>;
}) {
  const focusState = useQuery(api.domains.dossier.focusState.getFocusState, { briefId });

  useEffect(() => {
    const base = dossierContextRef.current;
    if (!base?.briefId) {
      dossierPrefixRef.current = "";
      return;
    }

    const merged: DossierContext = {
      ...base,
      currentAct: (focusState as any)?.currentAct ?? base.currentAct,
      focusedDataIndex: (focusState as any)?.focusedDataIndex ?? base.focusedDataIndex,
      focusedSeriesId: (focusState as any)?.focusedSeriesId ?? base.focusedSeriesId,
      activeSectionId: (focusState as any)?.activeSectionId ?? base.activeSectionId,
    };

    dossierPrefixRef.current = buildDossierContextPrefix(merged);
  }, [focusState, dossierContextRef, dossierPrefixRef]);

  return null;
}

/**
 * FastAgentPanel - Next-gen AI chat sidebar with ChatGPT-like UX
 *
 * Dual-mode architecture:
 * - Agent Mode: @convex-dev/agent with automatic memory (non-streaming)
 * - Agent Streaming Mode: @convex-dev/agent + real-time streaming output
 *
 * Features:
 * - Thread-based conversations with automatic memory management
 * - Real-time streaming responses (agent streaming mode)
 * - Fast mode toggle
 * - Live thinking/tool visualization
 * - Clean, minimal interface
 */

export const FastAgentPanel = memo(function FastAgentPanel({
  isOpen,
  onClose,
  selectedDocumentId: _selectedDocumentId,
  selectedDocumentIds: _selectedDocumentIds,
  initialThreadId,
  variant = 'overlay',
  openOptions = null,
  onOptionsConsumed,
  onVoiceIntent,
}: FastAgentPanelProps) {
  // ========== AUTH ==========
  const { isAuthenticated } = useConvexAuth();
  const convex = useConvex();
  const navigate = useNavigate();
  const trackIntentEvent = useIntentTelemetry();

  // ========== ANALYTICS: track panel open ==========
  useEffect(() => {
    if (isOpen) {
      trackEvent("agent_panel_open", { variant });
    }
  }, [isOpen, variant]);

  // ========== ANONYMOUS SESSION (5 free messages/day for unauthenticated users) ==========
  const anonymousSession = useAnonymousSession();
  const runtimeOwnerReady = isFastAgentRuntimeOwnerReady({
    isAuthenticated,
    isLoading: anonymousSession.isLoading,
    sessionId: anonymousSession.sessionId,
  });

  // ========== ORACLE SESSION (auto-track agent threads as Oracle sessions) ==========
  const oracleSession = useOracleSessionContext();
  const isCompactSidebar = variant === 'sidebar';

  // ========== STATE ==========
  // Agent component uses string threadIds, not Id<"chatThreads">
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId || null);
  const recoveredAnonymousSessionRef = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Multi-document selection
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(
    _selectedDocumentIds ? new Set(_selectedDocumentIds.map(id => String(id))) : new Set()
  );
  const handleRemoveSelectedDocument = useCallback((documentId: string) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      next.delete(documentId);
      return next;
    });
  }, []);
  const [showDocumentSelector, setShowDocumentSelector] = useState(false);

  // Contextual-open handling (FastAgentContext.openWithContext)
  const lastHandledOpenRequestIdRef = useRef<string | null>(null);
  const [pendingAutoSend, setPendingAutoSend] = useState<null | { requestId: string; message: string }>(null);
  // Guard against duplicate auto-sends
  const lastAutoSentRequestIdRef = useRef<string | null>(null);
  // Guard against duplicate manual sends (rapid clicks)
  const lastSentMessageRef = useRef<{ text: string; timestamp: number } | null>(null);
  // Forward-ref for stableSendMessage (avoids TDZ in scheduled messages useEffect)
  const stableSendMessageRef = useRef<((content?: string) => void) | null>(null);

  // Dossier mode: persist dossier context after openOptions is consumed
  const dossierContextRef = useRef<DossierContext | null>(null);
  const dossierPrefixRef = useRef<string>("");
  const [dossierBriefId, setDossierBriefId] = useState<string | null>(null);

  // The reachable panel has one runtime: streaming. Ignore and overwrite the
  // removed legacy `agent` preference so returning users cannot enter a mode
  // whose message actions are unavailable.
  const [chatMode, setChatMode] = useState<'agent' | 'agent-streaming'>('agent-streaming');
  const lastAnnouncedChatModeRef = useRef(chatMode);

  // Use approved model aliases only (9 approved models) - uses DEFAULT_MODEL from shared/llm/approvedModels.ts
  const [selectedModel, setSelectedModel] = useState<ApprovedModel>(DEFAULT_MODEL);
  const runtimeSelectedModel: ApprovedModel = isAuthenticated
    ? selectedModel
    : ANONYMOUS_FAST_AGENT_MODEL_ID;

  // Thread list collapse state
  const [showSidebar, setShowSidebar] = useState(false);

  // Minimize mode state - persisted to localStorage
  const [isMinimized, setIsMinimized] = useState(() => {
    const saved = localStorage.getItem('fastAgentPanel.isMinimized');
    return saved === 'true';
  });

  // Wide / split-view mode
  const [isWideMode, setIsWideMode] = useState(false);

  // Live Events Panel state
  const [showEventsPanel, setShowEventsPanel] = useState(false);
  // Note: liveEvents useMemo is defined after streamingMessages to avoid reference before initialization

  // Skills Panel state
  const [showSkillsPanel, setShowSkillsPanel] = useState(false);

  // Keyboard shortcuts overlay state
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);

  // Conversation search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWasOpenRef = useRef(false);

  // Response length control

  useEffect(() => {
    if (showSearch && !searchWasOpenRef.current) {
      trackIntentEvent({
        source: 'search',
        intentKey: 'agent.searchMessages',
        action: 'openMessageSearch',
        status: 'handled',
        route: window.location.pathname,
        metadata: {
          threadId: activeThreadId,
          variant,
        },
      });
    }
    searchWasOpenRef.current = showSearch;
  }, [activeThreadId, showSearch, trackIntentEvent, variant]);

  // Focus mode
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Auto-scroll follows new output only while the reader remains near the bottom.
  const autoScrollEnabledRef = useRef(true);
  const renderedMessagesRef = useRef<any[]>([]);

  // Typing speed indicator
  const typingStartRef = useRef<number>(0);
  const typingWordCountRef = useRef<number>(0);
  const [typingWpm, setTypingWpm] = useState(0);

  // Conversation timeline toggle
  const [showTimeline, setShowTimeline] = useState(false);

  // Artifacts/Canvas panel
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifactContent, setArtifactContent] = useState<{ type: 'html' | 'svg' | 'code'; content: string; language?: string } | null>(null);

  // Auto-save drafts (localStorage)
  const draftKey = `fa_draft_${activeThreadId || 'new'}`;
  useEffect(() => {
    if (input.length > 0) {
      localStorage.setItem(draftKey, input);
    } else {
      localStorage.removeItem(draftKey);
    }
  }, [input, draftKey]);
  useEffect(() => {
    const saved = localStorage.getItem(draftKey);
    if (saved && !input) setInput(saved);
  }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Overflow menu state (for secondary actions)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  // File attachment state
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  // Context documents from drag-and-drop
  // Calendar events context from drag-and-drop
  const [contextCalendarEvents, setContextCalendarEvents] = useState<Array<{
    id: string;
    title: string;
    startTime: number;
    endTime?: number;
    allDay?: boolean;
    location?: string;
    description?: string;
  }>>([]);

  const handleAttachFiles = (files: File[]) => {
    setAttachedFiles(prev => [...prev, ...files]);
  };

  const handleAddCalendarEvent = (event: { id: string; title: string; startTime: number; endTime?: number; allDay?: boolean; location?: string; description?: string }) => {
    setContextCalendarEvents(prev => {
      // Avoid duplicates
      const existing = prev.find(e => e.id === event.id);
      if (existing) return prev;
      return [...prev, event];
    });
  };

  const handleRemoveCalendarEvent = (eventId: string) => {
    setContextCalendarEvents(prev => prev.filter(e => e.id !== eventId));
  };

  // ========== TIER 13 STATE ==========

  // Font size / density
  const [fontSize, setFontSize] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('fa_font_size') || '14', 10); } catch { return 14; }
  });
  useEffect(() => { localStorage.setItem('fa_font_size', String(fontSize)); }, [fontSize]);

  // Drag-and-drop overlay
  const [isDragOver, setIsDragOver] = useState(false);

  // Auto-title (moved after messagesToRender definition)

  // Conversation starters — founder-relevant for Ask NodeBench
  const conversationStarters = useMemo(() => [
    { icon: '🎯', label: 'Pitch readiness', prompt: 'What gaps do I have before pitching investors?' },
    { icon: '🏗️', label: 'Build vs buy', prompt: 'Should I build this feature or find a partner?' },
    { icon: '📋', label: 'Weekly reset', prompt: 'Give me my founder weekly reset — what changed, contradictions, next 3 moves' },
    { icon: '🔍', label: 'Competitor check', prompt: 'What have my competitors shipped recently?' },
  ], []);

  // Keyboard message navigation
  const [focusedMsgIdx, setFocusedMsgIdx] = useState<number | null>(null);

  // detectedLanguage (moved after messagesToRender definition)

  // ========== KEYBOARD SHORTCUTS ==========
  // "/" : focus input (GitHub/Slack pattern), Escape: close or blur, Ctrl+Shift+N: new thread
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isModKey = e.metaKey || e.ctrlKey;
      const active = document.activeElement as HTMLElement | null;
      const isTyping = active?.matches('textarea, input, [contenteditable]');

      // "/" — Focus input bar (only when not already typing)
      if (e.key === '/' && !isTyping && !isModKey) {
        e.preventDefault();
        focusFastAgentComposer();
        return;
      }

      // Ctrl/Cmd+Shift+N — New thread
      if (isModKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        setActiveThreadId(null);
        setInput('');
        focusFastAgentComposer();
        return;
      }

      // Ctrl/Cmd+T — Toggle conversation timeline
      if (isModKey && e.key === 't' && renderedMessagesRef.current.length > 0) {
        e.preventDefault();
        setShowTimeline(prev => !prev);
        return;
      }

      // Ctrl/Cmd+F — Open conversation search
      if (isModKey && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }

      // "?" — Show keyboard shortcuts overlay (only when not typing)
      if (e.key === '?' && !isTyping && !isModKey) {
        e.preventDefault();
        setShowShortcutsOverlay(prev => !prev);
        return;
      }

      // J/K — Navigate messages (Vim-style, only when not typing)
      if ((e.key === 'j' || e.key === 'k') && !isTyping && !isModKey) {
        e.preventDefault();
        const renderedMessages = renderedMessagesRef.current;
        if (renderedMessages.length === 0) return;
        setFocusedMsgIdx(prev => {
          const max = renderedMessages.length - 1;
          if (prev === null) return e.key === 'j' ? 0 : max;
          const next = e.key === 'j' ? Math.min(prev + 1, max) : Math.max(prev - 1, 0);
          const msgEls = scrollContainerRef.current?.querySelectorAll('.msg-entrance');
          if (msgEls && msgEls[next]) {
            msgEls[next].scrollIntoView({ behavior: 'smooth', block: 'center' });
            (msgEls[next] as HTMLElement).style.outline = '2px solid var(--accent-primary, #3b82f6)';
            setTimeout(() => { (msgEls[next] as HTMLElement).style.outline = ''; }, 1500);
          }
          return next;
        });
        return;
      }

      // Escape — Close search, overlay, blur input, or close panel
      if (e.key === 'Escape') {
        if (showArtifacts) {
          setShowArtifacts(false);
        } else if (showTimeline) {
          setShowTimeline(false);
        } else if (showSearch) {
          setShowSearch(false);
          setSearchQuery('');
          setSearchMatchIndex(0);
        } else if (showShortcutsOverlay) {
          setShowShortcutsOverlay(false);
        } else if (isTyping) {
          active?.blur();
        } else {
          onClose();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, showArtifacts, showShortcutsOverlay, showSearch, showTimeline]);

  // Artifacts panel event listener
  useEffect(() => {
    const handleArtifact = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.content) {
        setArtifactContent({ type: detail.type || 'code', content: detail.content, language: detail.language });
        setShowArtifacts(true);
      }
    };
    window.addEventListener('fa-open-artifact', handleArtifact);
    return () => window.removeEventListener('fa-open-artifact', handleArtifact);
  }, []);

  // Progressive Disclosure state
  const [disclosureEvents, setDisclosureEvents] = useState<DisclosureEvent[]>([]);
  const [showDisclosureTrace, setShowDisclosureTrace] = useState(false);

  // Tab state - default agent tabs plus entity-workspace tabs when the
  // drawer is opened from the notebook surface.
  const [activeTab, setActiveTab] = useState<FastAgentPanelTab>('chat');
  const [isThreadDropdownOpen, setIsThreadDropdownOpen] = useState(false);

  // ========== AGENT-DRIVEN NAVIGATION ==========
  // Allows agents to request UI view switches via Convex mutation
  const handleAgentNavigate = useCallback((targetView: string, _context?: any) => {
    const viewRoutes: Record<string, string> = {
      signals: '/signals',
      dossier: '/dossier',
      research: '/research',
      analytics: '/analytics',
      feed: '/feed',
      calendar: '/calendar',
      documents: '/documents',
      settings: '/settings',
    };
    const route = viewRoutes[targetView] || `/${targetView}`;
    navigate(route);
  }, [navigate]);

  useAgentNavigation({
    threadId: activeThreadId,
    onNavigate: handleAgentNavigate,
    enabled: isAuthenticated && isOpen,
  });

  // Swarm hooks - for parallel agent orchestration
  const { swarm, tasks: swarmTasks, isActive: isSwarmActive } = useSwarmByThread(activeThreadId || undefined);
  const { spawnSwarm } = useSwarmActions();

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll-to-bottom FAB state
  const [showScrollFab, setShowScrollFab] = useState(false);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setShowScrollFab(distanceFromBottom > 120);
      autoScrollEnabledRef.current = distanceFromBottom < 30;

    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [activeThreadId]);

  // Ref-based callback pattern for stable handleSendMessage reference
  // This prevents re-renders when callback dependencies change
  const handleSendMessageRef = useRef<(content?: string) => Promise<void>>(undefined);

  // Track auto-created documents to avoid duplicates (by agentThreadId) and processed message IDs
  const autoDocCreatedThreadIdsRef = useRef<Set<string>>(new Set());

  const humanRequests = useQuery(
    api.domains.agents.humanInTheLoop.getPendingHumanRequests,
    (isAuthenticated && activeThreadId) ? { threadId: activeThreadId } : 'skip'
  );

  const processedDocMessageIdsRef = useRef<Set<string>>(new Set());

  // Update active thread when initialThreadId changes (for external navigation)
  useEffect(() => {
    if (initialThreadId && initialThreadId !== activeThreadId) {
      setActiveThreadId(initialThreadId);
    }
  }, [initialThreadId, activeThreadId]);

  // In desktop layouts both sidebar and overlay variants can be mounted simultaneously
  // (one hidden via CSS). Only the viewport-active variant should consume contextual
  // openOptions to avoid duplicate autosend requests.
  const isViewportActiveVariant = useCallback(() => {
    if (typeof window === "undefined") return true;
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    return variant === "sidebar" ? isDesktop : !isDesktop;
  }, [variant]);

  // Cross-surface agent unification: when the user is on an entity page,
  // agent responses can be saved directly into that entity's notebook.
  // activeEntitySlug is tracked by FastAgentContext independently of
  // whether the panel is open. Hoisted above openOptions handler so it
  // can gate the allowed-tab set without hitting a TDZ.
  const { activeEntitySlug } = useFastAgent();
  const productEntitySlug = activeEntitySlug ?? openOptions?.contextEntitySlug ?? null;
  const showsNotebookWorkspaceTabs = Boolean(productEntitySlug);
  const isProductConversationMode = chatMode === 'agent-streaming' && Boolean(productEntitySlug);
  const productConversation = useConversationEngine({
    anonymousSessionId: anonymousSession.sessionId ?? "anonymous",
    entitySlugHint: productEntitySlug,
    contextHint: productEntitySlug
      ? `Primary entity for this run: ${productEntitySlug}. Keep the answer anchored on this entity unless the user explicitly changes subjects.`
      : null,
    contextLabel: productEntitySlug ? "Entity workspace" : null,
    includeSessionList: isProductConversationMode,
    activeSessionId: isProductConversationMode ? activeThreadId : undefined,
    onActiveSessionChange: isProductConversationMode ? setActiveThreadId : undefined,
  });
  const productLens: LensId = 'founder';
  const generateProductUploadUrl = useMutation(api.domains.product.me.generateUploadUrl);
  const saveProductFile = useMutation(api.domains.product.me.saveFile);
  const productAttachedFiles = useMemo(
    () =>
      attachedFiles.map((file) => ({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
      })),
    [attachedFiles],
  );
  const productEntityLabel = useMemo(() => {
    if (!productEntitySlug) return null;
    return productEntitySlug
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }, [productEntitySlug]);

  // Apply openOptions once per requestId, and optionally auto-send.
  useEffect(() => {
    if (!isViewportActiveVariant()) return;
    if (!isOpen) return;
    const requestId = openOptions?.requestId;
    if (!requestId) return;
    if (lastHandledOpenRequestIdRef.current === requestId) return;
    lastHandledOpenRequestIdRef.current = requestId;

    const contextDocIds = (openOptions?.contextDocumentIds ?? []).map(String).filter(Boolean);
    if (contextDocIds.length > 0) {
      setSelectedDocumentIds((prev) => {
        const next = new Set(prev);
        for (const id of contextDocIds) next.add(id);
        return next;
      });
    }

    const requestedTab = openOptions?.initialTab;
    if (requestedTab) {
      const allowed = showsNotebookWorkspaceTabs
        ? (["chat", "scratchpad", "flow"] as const)
        : (["chat", "sources", "trace"] as const);
      if (allowed.includes(requestedTab as any)) {
        setActiveTab(requestedTab as FastAgentPanelTab);
      } else {
        setActiveTab("chat");
      }
    }

    const initial = typeof openOptions?.initialMessage === "string" ? openOptions.initialMessage.trim() : "";
    const titleLine = typeof openOptions?.contextTitle === "string" && openOptions.contextTitle.trim()
      ? `Context: ${openOptions.contextTitle.trim()}`
      : "";

    const urlLines = (openOptions?.contextWebUrls ?? [])
      .map((u) => (typeof u === "string" ? u.trim() : ""))
      .filter(Boolean)
      .map((u) => `- ${u}`)
      .join("\n");

    // Build dossier context prefix if in dossier mode
    const dossierPrefix = buildDossierContextPrefix(openOptions?.dossierContext ?? null);

    const extraContext = [
      dossierPrefix, // Include dossier context first for agent awareness
      titleLine,
      urlLines ? `URLs:\n${urlLines}` : "",
    ].filter(Boolean).join("\n\n");

    const message = initial ? (extraContext ? `${initial}\n\n${extraContext}` : initial) : "";

    if (!message) {
      // Only context docs (no prompt) - mark consumed so it doesn't re-run.
      onOptionsConsumed?.();
      return;
    }

    // Start a new chat for contextual requests to avoid cross-thread leakage.
    setActiveThreadId(null);
    setAttachedFiles([]);
    setInput(message);
    lastAnnouncedChatModeRef.current = "agent-streaming";
    setChatMode("agent-streaming");
    setPendingAutoSend({ requestId, message });
  }, [isOpen, onOptionsConsumed, openOptions, isViewportActiveVariant, showsNotebookWorkspaceTabs]);

  useEffect(() => {
    if (showsNotebookWorkspaceTabs) {
      if (activeTab !== "chat" && activeTab !== "scratchpad" && activeTab !== "flow") {
        setActiveTab("chat");
      }
      return;
    }
    if (activeTab === "scratchpad" || activeTab === "flow") {
      setActiveTab("chat");
    }
  }, [activeTab, showsNotebookWorkspaceTabs]);

  // Persist dossier context so it remains available after openOptions is consumed/cleared.
  useEffect(() => {
    if (!isOpen) {
      dossierContextRef.current = null;
      dossierPrefixRef.current = "";
      setDossierBriefId(null);
      return;
    }

    const next = openOptions?.dossierContext ?? null;
    if (!next?.briefId) return;

    dossierContextRef.current = next;
    dossierPrefixRef.current = buildDossierContextPrefix(next);
    setDossierBriefId(next.briefId);
  }, [isOpen, openOptions?.dossierContext]);

  // ========== CONVEX QUERIES & MUTATIONS ==========
  // Agent mode: Using @convex-dev/agent component
  const agentThreadsPagination = usePaginatedQuery(
    api.domains.agents.agentChat.listUserThreads,
    isAuthenticated && chatMode === "agent" && !isProductConversationMode ? {} : "skip",
    { initialNumItems: 20 }
  );
  const agentMessagesResult = useQuery(
    api.domains.agents.agentChat.getThreadMessages,
    activeThreadId && chatMode === 'agent' && !isProductConversationMode ? {
      threadId: activeThreadId,
      paginationOpts: { numItems: 100, cursor: null }
    } : "skip"
  );
  const agentMessages = agentMessagesResult?.page;

  // Agent-based actions
  const createThreadWithMessage = useAction(api.domains.agents.agentChatActions.createThreadWithMessage);
  const continueThreadAction = useAction(api.domains.agents.agentChatActions.continueThread);
  const deleteAgentThread = useMutation(api.domains.agents.agentChat.deleteThread);

  // Agent Streaming mode: Using agent component's native streaming
  // Note: Anonymous users can also use streaming mode with their sessionId
  const streamingThreadsPagination = usePaginatedQuery(
    api.domains.agents.fastAgentPanelStreaming.listThreads,
    chatMode === "agent-streaming" && !isProductConversationMode && runtimeOwnerReady
      ? { anonymousSessionId: anonymousSession.sessionId ?? undefined }
      : "skip",
    { initialNumItems: 20 }
  );
  const requestStreamCancel = useMutation(api.domains.agents.fastAgentPanelStreaming.requestStreamCancel);

  // Get the agent thread ID for streaming mode
  // Pass anonymousSessionId for anonymous users to validate ownership
  const streamingThread = useQuery(
    api.domains.agents.fastAgentPanelStreaming.getThreadByStreamId,
    activeThreadId && chatMode === 'agent-streaming' && !isProductConversationMode
      ? {
        threadId: activeThreadId as Id<"chatThreadsStream">,
        anonymousSessionId: anonymousSession.sessionId ?? undefined,
      }
      : "skip"
  );

  // Use useUIMessages hook for streaming messages with delta support
  // This hook expects the threadId to be the Agent component's threadId (string), not our chatThreadsStream ID
  // Pass anonymousSessionId for anonymous users to validate access
  const { results: streamingMessages, status: _streamingStatus, error: streamError } = useUIMessages(
    api.domains.agents.fastAgentPanelStreaming.getThreadMessagesWithStreaming,
    streamingThread?.agentThreadId && chatMode === 'agent-streaming' && !isProductConversationMode
      ? {
        threadId: streamingThread.agentThreadId,
        anonymousSessionId: anonymousSession.sessionId ?? undefined,
      }
      : "skip",
    {
      initialNumItems: 100,
      stream: true,  // CRITICAL: Enable streaming deltas.
    }
  ) as { results: any; status: any; error?: unknown };

  // Handle stream errors
  useEffect(() => {
    if (streamError) {
      console.error('[FastAgentPanel] Stream error:', streamError);
      setIsStreaming(false);
      // Don't show toast for timeout errors - they're handled by SafeImage component
      const errMsg = (streamError as { message?: string })?.message ?? String(streamError);
      if (!errMsg.includes('Timeout while downloading')) {
        toast.error(`Stream error: ${errMsg}`);
      }
    }
  }, [streamError]);

  const isGenerating = useMemo(() => {
    if (isProductConversationMode) {
      return productConversation.streaming.isStreaming;
    }
    if (chatMode !== "agent-streaming") return false;
    const runStatus = streamingThread?.runStatus;
    if (isActiveAgentRunStatus(runStatus)) return true;
    if (isTerminalAgentRunStatus(runStatus)) return false;
    if (!streamingMessages || streamingMessages.length === 0) return false;
    return streamingMessages.some(
      (m: any) => m?.role === "assistant" && (m?.status === "streaming" || m?.status === "pending")
    );
  }, [chatMode, isProductConversationMode, productConversation.streaming.isStreaming, streamingMessages, streamingThread?.runStatus]);

  useEffect(() => {
    if (isProductConversationMode) {
      if (!productConversation.streaming.isStreaming) {
        setIsStreaming(false);
      }
      return;
    }
    const runStatus = streamingThread?.runStatus;
    if (!runStatus) return;
    if (isTerminalAgentRunStatus(runStatus)) {
      setIsStreaming(false);
    }
  }, [isProductConversationMode, productConversation.streaming.isStreaming, streamingThread?.runStatus]);

  const isBusy = isStreaming || isGenerating;

  const productMessagesToRender = useMemo(() => {
    if (!isProductConversationMode) return [] as any[];
    const baseMessages = (productConversation.sessionMessages ?? []).map((message) => ({
      _id: message.id,
      key: message.id,
      id: message.id,
      role: message.role,
      text: message.content,
      content: message.content,
      status: message.status === 'error' ? 'error' : 'complete',
      parts: [{ type: 'text' as const, text: message.content }],
      _creationTime: message.createdAt,
      label: message.label,
      reportId: message.reportId,
    }));
    if (!productConversation.streaming.isStreaming) {
      return baseMessages;
    }
    const liveText =
      productConversation.streaming.liveAnswerPreview?.trim() ||
      (productConversation.streaming.result && typeof productConversation.streaming.result.answer === 'string'
        ? productConversation.streaming.result.answer.trim()
        : '');
    const userPrompt = input.trim() || productConversation.startedQuery?.trim() || '';
    const pendingMessages = [...baseMessages];
    const lastRole = pendingMessages[pendingMessages.length - 1]?.role;
    if (userPrompt && lastRole !== 'user') {
      pendingMessages.push({
        _id: `pending-user:${productConversation.activeSessionId ?? 'draft'}`,
        key: `pending-user:${productConversation.activeSessionId ?? 'draft'}`,
        id: `pending-user:${productConversation.activeSessionId ?? 'draft'}`,
        role: 'user',
        text: userPrompt,
        content: userPrompt,
        status: 'complete',
        parts: [{ type: 'text' as const, text: userPrompt }],
        _creationTime: Date.now(),
        label: '',
        reportId: undefined,
      });
    }
    pendingMessages.push({
      _id: `streaming-assistant:${productConversation.activeSessionId ?? 'draft'}`,
      key: `streaming-assistant:${productConversation.activeSessionId ?? 'draft'}`,
      id: `streaming-assistant:${productConversation.activeSessionId ?? 'draft'}`,
      role: 'assistant',
      text: liveText,
      content: liveText,
      status: 'streaming',
      parts: [{ type: 'text' as const, text: liveText }],
      _creationTime: Date.now(),
      label: '',
      reportId: undefined,
    });
    return pendingMessages;
  }, [
    input,
    isProductConversationMode,
    productConversation.activeSessionId,
    productConversation.sessionMessages,
    productConversation.startedQuery,
    productConversation.streaming.isStreaming,
    productConversation.streaming.liveAnswerPreview,
    productConversation.streaming.result,
  ]);

  // Prepare messages for rendering - must be before any useMemo/useCallback/useEffect that references messagesToRender
  const messagesToRender = useMemo(() => {
    if (isProductConversationMode) {
      return productMessagesToRender;
    }
    if (chatMode === 'agent-streaming') {
      return streamingMessages;
    }
    return (agentMessages || []).map((msg: any) => ({
      role: msg.role || 'assistant',
      text: msg.text || msg.content || '',
      status: 'complete',
      parts: [{ type: 'text', text: msg.text || msg.content || '' }],
      _id: msg._id,
      _creationTime: msg._creationTime,
      model: msg.model,
    }));
  }, [chatMode, streamingMessages, agentMessages, isProductConversationMode, productMessagesToRender]);
  renderedMessagesRef.current = messagesToRender;

  const showPanelTabBar =
    showsNotebookWorkspaceTabs ||
    activeTab !== 'chat' ||
    messagesToRender.length > 0 ||
    isBusy;

  // Multi-language auto-detect
  const detectedLanguage = useMemo(() => {
    if (!messagesToRender || messagesToRender.length === 0) return null;
    const lastUser = [...messagesToRender].reverse().find((m: any) => m.role === 'user');
    if (!lastUser) return null;
    const text = (lastUser as any).text || (lastUser as any).content || '';
    if (/[\u4e00-\u9fff]/.test(text)) return 'Chinese';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'Japanese';
    if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
    if (/[\u0600-\u06ff]/.test(text)) return 'Arabic';
    if (/[\u0400-\u04ff]/.test(text)) return 'Russian';
    if (/[àáâãéêíóôõúüç]/i.test(text)) return 'Portuguese/Spanish';
    if (/[äöüß]/i.test(text)) return 'German';
    if (/[àâéèêëïîôùûüÿç]/i.test(text)) return 'French';
    return null;
  }, [messagesToRender]);

  const handleStopStreaming = useCallback(async () => {
    if (isProductConversationMode) {
      productConversation.streaming.stopStream();
      setIsStreaming(false);
      return;
    }
    if (chatMode !== "agent-streaming") {
      setIsStreaming(false);
      return;
    }
    if (!activeThreadId) {
      setIsStreaming(false);
      return;
    }
    if (!runtimeOwnerReady) {
      toast.info("Preparing secure session. Try again in a moment.");
      return;
    }

    try {
      await requestStreamCancel({
        threadId: activeThreadId as Id<"chatThreadsStream">,
        anonymousSessionId: anonymousSession.sessionId ?? undefined,
      });
    } catch (err) {
      console.error("[FastAgentPanel] Failed to cancel stream:", err);
      toast.error("Failed to cancel");
    } finally {
      setIsStreaming(false);
    }
  }, [activeThreadId, anonymousSession.sessionId, chatMode, isProductConversationMode, productConversation.streaming, requestStreamCancel, runtimeOwnerReady]);

  // Live Events - extracted from streaming messages (must be after streamingMessages definition)
  const liveEvents = useMemo<LiveEvent[]>(() => {
    if (isProductConversationMode) {
      return (productConversation.streaming.stages ?? []).map((stage, index) => ({
        id: `${stage.tool}-${stage.step}-${index}`,
        type: (stage.status === 'done' ? 'tool_end' : stage.status === 'error' ? 'tool_error' : 'tool_start') as LiveEvent['type'],
        status: (stage.status === 'done' ? 'success' : stage.status === 'error' ? 'error' : 'running') as LiveEvent['status'],
        title: stage.tool,
        toolName: stage.tool,
        details: stage.preview,
        timestamp: stage.startedAt,
        duration: stage.durationMs,
      })) as LiveEvent[];
    }
    if (chatMode !== "agent-streaming") return [];
    if (!streamingMessages || streamingMessages.length === 0) return [];

    return extractLiveEventsFromUIMessages(streamingMessages);
  }, [chatMode, isProductConversationMode, productConversation.streaming.stages, streamingMessages]);

  const createStreamingThread = useAction(api.domains.agents.fastAgentPanelStreaming.createThread);
  const sendStreamingMessage = useMutation(api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming);
  const deleteStreamingThread = useMutation(api.domains.agents.fastAgentPanelStreaming.deleteThread);
  const deleteMessage = useMutation(api.domains.agents.fastAgentPanelStreaming.deleteMessage);
  // Append to landing page signals log
  const appendToSignalsLog = useMutation((api as any).domains.landing.landingPageLog.appendFromUser);
  // NEW: Unified document generation and creation action
  const generateAndCreateDocument = useAction(api.domains.agents.fastAgentDocumentCreation.generateAndCreateDocument);
  // Auto-naming action for threads
  const autoNameThread = useAction(api.domains.agents.fastAgentPanelStreaming.autoNameThread);
  // Client does not trigger server workflows directly; coordinator handles routing via useCoordinator: true

  // Use the appropriate data based on mode
  const productThreads = useMemo<Thread[]>(
    () =>
      (productConversation.sessions ?? []).map((session) => ({
        _id: session._id,
        userId: '' as any,
        title: session.title,
        pinned: session.pinned,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        _creationTime: session._creationTime,
        lastMessage: session.lastMessage,
        lastMessageAt: session.lastMessageAt,
      })),
    [productConversation.sessions],
  );

  const threads = isProductConversationMode
    ? productThreads
    : chatMode === 'agent'
      ? agentThreadsPagination.results
      : streamingThreadsPagination.results;

  useEffect(() => {
    const sessionId = anonymousSession.sessionId;
    if (
      !anonymousSession.isAnonymous ||
      !runtimeOwnerReady ||
      !sessionId ||
      recoveredAnonymousSessionRef.current === sessionId ||
      streamingThreadsPagination.status === "LoadingFirstPage" ||
      pendingAutoSend ||
      initialThreadId
    ) {
      return;
    }

    recoveredAnonymousSessionRef.current = sessionId;
    const recoveredThreadId = selectAnonymousRecoveryThreadId({
      activeThreadId,
      isAnonymous: true,
      runtimeOwnerReady,
      sessionId,
      threads: streamingThreadsPagination.results,
    });
    if (recoveredThreadId) setActiveThreadId(recoveredThreadId);
  }, [
    activeThreadId,
    anonymousSession.isAnonymous,
    anonymousSession.sessionId,
    initialThreadId,
    pendingAutoSend,
    runtimeOwnerReady,
    streamingThreadsPagination.results,
    streamingThreadsPagination.status,
  ]);
  const threadsStatus = isProductConversationMode
    ? "Loaded"
    : chatMode === 'agent'
      ? agentThreadsPagination.status
      : streamingThreadsPagination.status;
  const loadMoreThreads = isProductConversationMode
    ? (() => undefined)
    : chatMode === 'agent'
      ? agentThreadsPagination.loadMore
      : streamingThreadsPagination.loadMore;
  const hasMoreThreads = isProductConversationMode ? false : threadsStatus === "CanLoadMore";
  const isLoadingMoreThreads = isProductConversationMode ? false : threadsStatus === "LoadingMore";

  useEffect(() => {
    const handleVoiceThreadSelect = (event: Event) => {
      const index = (event as CustomEvent<{ index?: number }>).detail?.index;
      if (!index || index < 1) return;
      const thread = threads?.[index - 1];
      if (thread?._id) {
        setActiveThreadId(thread._id);
      }
    };

    window.addEventListener("voice:select-thread", handleVoiceThreadSelect as EventListener);
    return () => {
      window.removeEventListener("voice:select-thread", handleVoiceThreadSelect as EventListener);
    };
  }, [threads]);

  useEffect(() => {
    const handleVoiceSearch = (event: Event) => {
      const query = (event as CustomEvent<{ query?: string }>).detail?.query?.trim();
      if (!query) return;
      setShowSearch(true);
      setSearchQuery(query);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    };

    window.addEventListener("voice:search", handleVoiceSearch as EventListener);
    return () => {
      window.removeEventListener("voice:search", handleVoiceSearch as EventListener);
    };
  }, []);

  const formatTimeAgo = useCallback((timestamp?: number | null): string => {
    if (!timestamp) return "";
    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }, []);

  // ========== EFFECTS ==========

  // Follow the rendered conversation, including live streaming previews, only
  // while the reader has stayed near the bottom.
  useEffect(() => {
    if (autoScrollEnabledRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isBusy, messagesToRender]);

  // Persist chat mode to localStorage
  useEffect(() => {
    localStorage.setItem('fastAgentPanel.chatMode', chatMode);
  }, [chatMode]);

  // Persist minimize mode to localStorage
  useEffect(() => {
    localStorage.setItem('fastAgentPanel.isMinimized', String(isMinimized));
  }, [isMinimized]);

  // Reset only after an actual mode change, never during initial mount hydration.
  useEffect(() => {
    if (lastAnnouncedChatModeRef.current === chatMode) return;
    lastAnnouncedChatModeRef.current = chatMode;
    setActiveThreadId(null);
    toast.info(`Switched to ${chatMode === 'agent' ? 'Agent' : 'Agent Streaming'} mode`);
  }, [chatMode]);

  // Live events are derived from streaming messages (no state updates; avoids render loops).

  // Client no longer triggers workflows directly; coordinator handles routing via useCoordinator: true

  // ========== HANDLERS ==========

  const handleCreateThread = useCallback(async () => {
    if (!runtimeOwnerReady) {
      toast.info("Preparing secure session. Try again in a moment.");
      return;
    }
    if (isProductConversationMode) {
      productConversation.clearSession();
      toast.success("Ready to start new product chat");
      return;
    }
    if (chatMode === 'agent') {
      // For Agent-based API, threads are created automatically when sending the first message
      setActiveThreadId(null);
      toast.success("Ready to start new chat");
    } else {
      // For agent streaming mode, create a new thread immediately
      try {
        const threadId = await createStreamingThread({
          title: "New Chat",
          model: runtimeSelectedModel,
          // Pass anonymous session ID for unauthenticated users
          anonymousSessionId: anonymousSession.sessionId ?? undefined,
        });
        setActiveThreadId(threadId);
        toast.success("New chat created");
      } catch (error) {
        console.error('Failed to create thread:', error);
        toast.error('Failed to create new chat');
      }
    }
  }, [anonymousSession.sessionId, chatMode, createStreamingThread, isProductConversationMode, productConversation, runtimeOwnerReady, runtimeSelectedModel]);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    if (isProductConversationMode) {
      toast.info('Product chat sessions can be revisited from Reports. Delete is not enabled here yet.');
      return;
    }
    try {
      let agentDeletionComplete = true;
      if (chatMode === 'agent') {
        await deleteAgentThread({ threadId });
      } else {
        const deletion = await deleteStreamingThread({
          threadId: threadId as Id<"chatThreadsStream">,
          anonymousSessionId: anonymousSession.sessionId ?? undefined,
        });
        agentDeletionComplete = deletion.agentDeletionComplete;
      }

      // If deleted thread was active, select another
      if (activeThreadId === threadId) {
        const remainingThreads = (threads ?? []).filter((t) => t._id !== threadId);
        setActiveThreadId(remainingThreads[0]?._id ?? null);
      }

      toast.success(agentDeletionComplete ? 'Conversation deleted' : 'Conversation deletion started');
    } catch (error) {
      console.error('Failed to delete thread:', error);
      toast.error('Failed to delete conversation');
    }
  }, [activeThreadId, anonymousSession.sessionId, threads, chatMode, deleteAgentThread, deleteStreamingThread, isProductConversationMode]);

  const handleSendMessage = useCallback(async (content?: string) => {
    if (isBusy) return;
    if (!runtimeOwnerReady) {
      toast.info("Preparing secure session. Try again in a moment.");
      return;
    }

    const preparedSubmission = prepareFastAgentSubmission({
      allowAttachments: isProductConversationMode && isAuthenticated,
      attachedFiles,
      content,
      contextDocuments: [],
      dossierPrefix: dossierPrefixRef.current,
      input,
      selectedDocumentIds,
    });

    if (!preparedSubmission.ok) {
      if (preparedSubmission.reason === 'attachments_unsupported') {
        toast.error('Attachments are held', {
          description: 'This chat cannot send files yet. Remove them to send your message; your files will stay attached until then.',
        });
      } else if (preparedSubmission.reason === 'documents_analyzing') {
        toast.info('Document analysis is still running', {
          description: 'Wait for at least one document to finish before sending.',
        });
      }
      return;
    }

    const { messageContent, text } = preparedSubmission;

    // ⚡ CRITICAL GUARD: Prevent duplicate sends of same message within 3 seconds
    const now = Date.now();
    const DEDUPE_WINDOW_MS = 3000;
    if (lastSentMessageRef.current &&
        lastSentMessageRef.current.text === text &&
        now - lastSentMessageRef.current.timestamp < DEDUPE_WINDOW_MS) {
      return;
    }
    lastSentMessageRef.current = { text, timestamp: now };

    // Check if anonymous user has exceeded their daily limit
    if (anonymousSession.isAnonymous && !anonymousSession.canSendMessage) {
      toast.error(
        <div className="flex flex-col gap-1">
          <div className="font-medium">Daily limit reached</div>
          <div className="text-xs">{FAST_AGENT_SIGN_IN_BENEFIT_COPY}</div>
        </div>
      );
      return;
    }

    const documentCreationTopic = getAuthenticatedDocumentCreationTopic({
      chatMode,
      isAuthenticated,
      isProductConversationMode,
      text,
    });

    if (documentCreationTopic) {
      const topic = documentCreationTopic;

      setInput('');
      setIsStreaming(true);

      try {
        // Get or create thread
        let threadId = activeThreadId;
        if (!threadId) {
          const streamingThread = await createStreamingThread({
            title: `Create document about ${topic}`,
            model: runtimeSelectedModel,
            anonymousSessionId: anonymousSession.sessionId ?? undefined,
          });
          threadId = streamingThread;
          setActiveThreadId(threadId);
        }

        // Get the agent thread ID (may not be immediately available in the subscription after create)
        let agentThreadId: string | undefined =
          activeThreadId === threadId ? streamingThread?.agentThreadId : undefined;

        if (!agentThreadId) {
          const fetched = await convex.query(api.domains.agents.fastAgentPanelStreaming.getThreadByStreamId, {
            threadId: threadId as Id<"chatThreadsStream">,
            anonymousSessionId: anonymousSession.sessionId ?? undefined,
          });
          agentThreadId = (fetched as any)?.agentThreadId;
        }

        if (!agentThreadId) {
          throw new Error("Agent thread ID not found");
        }

        toast.info("Generating and creating document...");

        // NEW: Use unified action for generation and creation
        const result = await generateAndCreateDocument({
          prompt: text,
          threadId: agentThreadId,
          isPublic: false,
        });

        // Mark this thread as having created a document to prevent duplicate auto-create
        autoDocCreatedThreadIdsRef.current.add(agentThreadId);

        toast.success(
          <div className="flex flex-col gap-1">
            <div className="font-medium">Document created!</div>
            <div className="text-xs text-content-secondary">
              {result.title}
            </div>
          </div>
        );

        setIsStreaming(false);
        return;
      } catch (error) {
        console.error("Failed to create document:", error);
        toast.error("Failed to create document");
        setIsStreaming(false);
        return;
      }
    }

    setInput('');
    setIsStreaming(true);

    setContextCalendarEvents([]);

    try {
      if (isProductConversationMode) {
        const uploadedFiles =
          attachedFiles.length > 0
            ? await uploadProductDraftFiles({
                files: attachedFiles,
                anonymousSessionId: anonymousSession.sessionId ?? "anonymous",
                generateUploadUrl: generateProductUploadUrl,
                saveFileMutation: saveProductFile,
              })
            : [];
        await productConversation.beginRun({
          query: messageContent,
          lens: productLens,
          files: uploadedFiles,
        });
        setAttachedFiles([]);
        setIsStreaming(false);
      } else if (chatMode === 'agent') {
        const result = await dispatchFastAgentSubmission({
          activeThreadId,
          chatMode,
          clientContext: undefined,
          continueThreadAction,
          createThreadWithMessage,
          messageContent,
          selectedModel: runtimeSelectedModel,
          sendStreamingMessage,
          streamThreadId: null,
        });
        if (result.createdThreadId) {
          setActiveThreadId(result.createdThreadId);
        }

        setIsStreaming(false);
      } else {
        // Agent streaming mode chat flow - uses agent component's native streaming
        let threadId = activeThreadId;
        const isNewThread = !threadId;

        // Create thread if needed
        if (!threadId) {
          threadId = await createStreamingThread({
            title: messageContent.substring(0, 50),
            model: runtimeSelectedModel,
            anonymousSessionId: anonymousSession.sessionId ?? undefined,
          });
          setActiveThreadId(threadId);

          // Auto-start Oracle session for new agent threads
          if (oracleSession && !oracleSession.hasActiveSession) {
            oracleSession.startSession({
              title: messageContent.substring(0, 80),
              type: "agent",
              goalId: threadId ?? undefined,
              visionSnapshot: messageContent.substring(0, 200),
            }).catch(() => { /* Oracle session is best-effort */ });
          }
        }

        // Send message with optimistic updates using the mutation
        if (!threadId) throw new Error("Thread ID is required");

        const clientContext =
          typeof window !== "undefined"
            ? {
              timezone: (() => {
                try {
                  return Intl.DateTimeFormat().resolvedOptions().timeZone;
                } catch {
                  return undefined;
                }
              })(),
              locale: typeof navigator !== "undefined" ? navigator.language : undefined,
              utcOffsetMinutes: new Date().getTimezoneOffset(),
            }
            : undefined;

        await dispatchFastAgentSubmission({
          activeThreadId,
          anonymousSessionId: anonymousSession.sessionId ?? undefined,
          chatMode,
          clientContext,
          continueThreadAction,
          createThreadWithMessage,
          entitySlug: productEntitySlug ?? undefined,
          messageContent,
          selectedModel: runtimeSelectedModel,
          sendStreamingMessage,
          streamThreadId: threadId as Id<"chatThreadsStream">,
        });

        // The backend run status now owns the durable busy state. Clear the
        // component-wide optimistic flag after enqueue so switching to another
        // thread cannot inherit a stale Stop/Working state.
        setIsStreaming(false);

        // Auto-name the thread if it's new (fire and forget)
        if (isNewThread && threadId && isAuthenticated) {
          autoNameThread({
            threadId: threadId as Id<"chatThreadsStream">,
            firstMessage: text,
          }).then((result: any) => {
            if (!result.skipped) {
            }
          }).catch((_err: unknown) => {
          });
        }
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      toast.error("Failed to send message");
      setIsStreaming(false);
    }
  }, [
    input,
    isBusy,
    activeThreadId,
    runtimeSelectedModel,
    attachedFiles,
    chatMode,
    isProductConversationMode,
    productConversation,
    productLens,
    selectedDocumentIds,
    createThreadWithMessage,
    continueThreadAction,
    createStreamingThread,
    sendStreamingMessage,
    generateAndCreateDocument,
    generateProductUploadUrl,
    saveProductFile,
    convex,
    streamingThread,
    autoNameThread,
    isAuthenticated,
    anonymousSession,
    oracleSession,
    productEntitySlug,
    runtimeOwnerReady,
  ]);

  // Update ref for stable callback reference
  handleSendMessageRef.current = handleSendMessage;

  // Stable callback wrapper - never changes reference, always calls latest implementation
  const stableSendMessage = useCallback((content?: string) => {
    return handleSendMessageRef.current?.(content);
  }, []);
  stableSendMessageRef.current = stableSendMessage;

  // Auto-send contextual open prompt once streaming mode is active.
  useEffect(() => {
    if (!isViewportActiveVariant()) return;
    if (!isOpen) return;
    if (!pendingAutoSend) return;
    if (chatMode !== "agent-streaming") return;
    if (isBusy) return;
    if (anonymousSession.isAnonymous && anonymousSession.isLoading) return;

    if (anonymousSession.isAnonymous && !anonymousSession.canSendMessage) {
      toast.error(
        <div className="flex flex-col gap-1">
          <div className="font-medium">Daily limit reached</div>
          <div className="text-xs">{FAST_AGENT_SIGN_IN_BENEFIT_COPY}</div>
        </div>
      );
      setPendingAutoSend(null);
      onOptionsConsumed?.();
      return;
    }

    const { message, requestId } = pendingAutoSend;
    if (openOptions?.requestId && openOptions.requestId !== requestId) return;

    // ⚡ CRITICAL GUARD: Prevent duplicate auto-sends
    if (lastAutoSentRequestIdRef.current === requestId) {
      return;
    }
    lastAutoSentRequestIdRef.current = requestId;

    stableSendMessage(message);
    setPendingAutoSend(null);
    onOptionsConsumed?.();
  }, [
    isOpen,
    pendingAutoSend,
    chatMode,
    isBusy,
    openOptions?.requestId,
    stableSendMessage,
    onOptionsConsumed,
    isViewportActiveVariant,
    anonymousSession.isAnonymous,
    anonymousSession.isLoading,
    anonymousSession.canSendMessage,
  ]);

  // No client heuristics; coordinator-only routing

  // Handle message deletion
  const handleDeleteMessage = useCallback(async (messageId: string) => {

    if (isProductConversationMode || chatMode !== 'agent-streaming' || !activeThreadId) {
      return;
    }

    try {
      await deleteMessage({
        threadId: activeThreadId as Id<"chatThreadsStream">,
        messageId,
        anonymousSessionId: anonymousSession.sessionId ?? undefined,
      });
      toast.success('Message deleted');
    } catch (err) {
      console.error('[FastAgentPanel] Failed to delete message:', err);
      toast.error('Failed to delete message');
    }
  }, [activeThreadId, anonymousSession.sessionId, chatMode, deleteMessage, isProductConversationMode]);

  // Handle general message regeneration
  const handleRegenerateMessage = useCallback(async (messageKey: string) => {

    if (isProductConversationMode) {
      const productMessageIndex = messagesToRender.findIndex((message: any) => (message.key || message.id || message._id) === messageKey);
      if (productMessageIndex === -1) {
        return;
      }
      let userPrompt = '';
      for (let i = productMessageIndex - 1; i >= 0; i--) {
        if (messagesToRender[i]?.role === 'user') {
          userPrompt = messagesToRender[i].text || messagesToRender[i].content || '';
          break;
        }
      }
      if (!userPrompt.trim()) {
        toast.error('Could not find the original prompt to regenerate');
        return;
      }
      await productConversation.beginRun({
        query: userPrompt,
        lens: productLens,
      });
      toast.success('Regenerating response...');
      return;
    }

    if (chatMode !== 'agent-streaming' || !activeThreadId || !streamingMessages) {
      return;
    }

    // Find the message being regenerated
    const messageIndex = streamingMessages.findIndex((m: any) => m.key === messageKey);
    if (messageIndex === -1) {
      return;
    }

    // Find the previous user message (the prompt that generated this response)
    let userPrompt = '';
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (streamingMessages[i].role === 'user') {
        userPrompt = streamingMessages[i].text || '';
        break;
      }
    }

    if (!userPrompt) {
      toast.error('Could not find the original prompt to regenerate');
      return;
    }


    try {
      const clientContext =
        typeof window !== "undefined"
          ? {
            timezone: (() => {
              try {
                return Intl.DateTimeFormat().resolvedOptions().timeZone;
              } catch {
                return undefined;
              }
            })(),
            locale: typeof navigator !== "undefined" ? navigator.language : undefined,
            utcOffsetMinutes: new Date().getTimezoneOffset(),
          }
          : undefined;

      await sendStreamingMessage({
        threadId: activeThreadId as Id<"chatThreadsStream">,
        prompt: userPrompt,
        model: runtimeSelectedModel,
        useCoordinator: true,
        clientContext,
        entitySlug: productEntitySlug ?? undefined,
      });
      toast.success('Regenerating response...');
    } catch (err) {
      console.error('[FastAgentPanel] Failed to regenerate:', err);
      toast.error('Failed to regenerate response');
    }
  }, [activeThreadId, chatMode, isProductConversationMode, messagesToRender, productConversation, productLens, runtimeSelectedModel, sendStreamingMessage, streamingMessages, productEntitySlug]);

  // Handle document selection from document action cards
  const handleDocumentSelect = useCallback((documentId: string) => {
    try {
      window.dispatchEvent(
        new CustomEvent('nodebench:openDocument', {
          detail: { documentId }
        })
      );
    } catch (err) {
      console.error('[FastAgentPanel] Failed to navigate to document:', err);
      toast.error('Failed to open document');
    }
  }, []);

  // Memoized message handlers for context provider (prevents callback prop drilling)
  const messageHandlers = useMemo(() => ({
    onDocumentSelect: handleDocumentSelect,
    onRegenerateMessage: handleRegenerateMessage,
    onDeleteMessage: handleDeleteMessage,
  }), [handleDocumentSelect, handleRegenerateMessage, handleDeleteMessage]);

  // ========== MEMOIZED VALUES (must be before early return) ==========

  // Enable virtualization for long conversations (50+ messages)
  const { shouldVirtualize } = useMessageVirtualization(messagesToRender?.length ?? 0, 50);

  // Conversation export callbacks (must be after messagesToRender)
  const conversationToMarkdown = useCallback(() => {
    const msgs = messagesToRender ?? [];
    if (msgs.length === 0) return '';
    const threadTitle = threads.find((t) => t._id === activeThreadId)?.title || 'Conversation';
    const lines: string[] = [`# ${threadTitle}\n`];
    for (const msg of msgs) {
      const role = msg.role === 'user' ? '**You**' : '**Assistant**';
      const text = typeof msg.content === 'string' ? msg.content : (msg.text ?? JSON.stringify(msg.content ?? ''));
      const ts = msg._creationTime ? new Date(msg._creationTime).toLocaleString() : '';
      lines.push(`### ${role}${ts ? ` — ${ts}` : ''}\n`);
      lines.push(text.trim());
      lines.push('');
    }
    return lines.join('\n');
  }, [messagesToRender, threads, activeThreadId]);

  const handleCopyAsMarkdown = useCallback(async () => {
    const md = conversationToMarkdown();
    if (!md) { toast.error('No messages to copy'); return; }
    await navigator.clipboard.writeText(md);
    toast.success('Conversation copied as Markdown');
  }, [conversationToMarkdown]);

  const handleDownloadMarkdown = useCallback(() => {
    const md = conversationToMarkdown();
    if (!md) { toast.error('No messages to download'); return; }
    const threadTitle = threads.find((t) => t._id === activeThreadId)?.title || 'conversation';
    const slug = threadTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Downloaded as Markdown');
  }, [conversationToMarkdown, threads, activeThreadId]);

  // Conversation search: compute match count from messages
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim() || !messagesToRender) return [] as number[];
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    messagesToRender.forEach((msg: any, i: number) => {
      const text = typeof msg.content === 'string' ? msg.content : (msg.text ?? '');
      if (text.toLowerCase().includes(q)) indices.push(i);
    });
    return indices;
  }, [searchQuery, messagesToRender]);

  // The sources/artifacts tab is a provenance surface. Populate it only from
  // canonical source parts and completed tool outputs, never assistant prose.
  const consultedArtifacts = useMemo(
    () => collectConsultedArtifacts((messagesToRender ?? []) as UIMessage[]),
    [messagesToRender],
  );
  const aggregatedMedia: ExtractedMedia = consultedArtifacts.media;
  const aggregatedDocumentActions: DocumentAction[] = consultedArtifacts.documents;

  // Convert messages to Message type based on chat mode
  const uiMessages: Message[] = useMemo(() => {
    return (messagesToRender ?? []).map((msg: any) => {
      const messageData = msg.message || msg;
      let content = '';
      if (typeof messageData.text === 'string') {
        content = messageData.text;
      } else if (typeof messageData.content === 'string') {
        content = messageData.content;
      } else if (typeof msg.text === 'string') {
        content = msg.text;
      } else if (typeof msg.content === 'string') {
        content = msg.content;
      } else {
        const textParts = messageData.parts?.filter((p: any) => p.type === 'text')?.map((p: any) => p.text) || [];
        content = textParts.join('');
      }

      return {
        id: msg._id || msg.id || msg.key,
        threadId: msg.threadId || activeThreadId || '',
        role: (messageData.role || msg.role || 'assistant') as 'user' | 'assistant' | 'system',
        content: String(content || ''),
        status: (msg.status || 'complete') as 'sending' | 'streaming' | 'complete' | 'error',
        timestamp: new Date(msg._creationTime || msg.createdAt || Date.now()),
        isStreaming: msg.status === 'streaming',
        model: msg.model || runtimeSelectedModel,
      };
    });
  }, [messagesToRender, activeThreadId, runtimeSelectedModel]);

  const openCurrentConversationInChat = useCallback(() => {
    if (!isProductConversationMode || !activeThreadId) {
      toast.error('This conversation does not have a canonical product session yet.');
      return;
    }
    navigate(
      buildCockpitPath({
        surfaceId: 'workspace',
        entity: productEntitySlug,
        extra: { session: activeThreadId },
      }),
    );
  }, [activeThreadId, isProductConversationMode, navigate, productEntitySlug]);

  // ========== RENDER ==========

  if (!isOpen) return null;

  const focusSubscription = dossierBriefId ? (
    <DossierFocusSubscription
      briefId={dossierBriefId}
      dossierContextRef={dossierContextRef}
      dossierPrefixRef={dossierPrefixRef}
    />
  ) : null;

  // Minimized mode - compact vertical strip
  if (isMinimized) {
    return (
      <>
        {focusSubscription}
        <MinimizedStrip
          isStreaming={isBusy}
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={(id) => { setActiveThreadId(id); setIsMinimized(false); }}
          onNewChat={() => { setActiveThreadId(null); setIsMinimized(false); }}
          onExpand={() => setIsMinimized(false)}
          onClose={onClose}
        />
      </>
    );
  }

  return (
    <>
      {focusSubscription}
      {/* Backdrop for tablet/intermediate — mobile uses bottom-sheet via CockpitLayout */}
      {isOpen && !isCompactSidebar && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/45 z-[999] hidden sm:block lg:hidden"
          onClick={onClose}
        />
      )}

      <div
        className={cn(
          "fast-agent-panel",
          variant === 'sidebar' && 'sidebar-mode',
          isWideMode && 'wide-mode',
          isFocusMode && 'focus-mode',
          isCompactSidebar
            ? "border-0 bg-white shadow-none dark:bg-[#11161c]"
            : "border-l border-gray-200 bg-white shadow-[0_20px_70px_-50px_rgba(15,23,42,0.34)] dark:border-white/[0.08] dark:bg-[#11161c] dark:shadow-[0_26px_90px_-58px_rgba(0,0,0,0.82)]",
        )}
        style={{ fontSize: `${fontSize}px` }}
        role="complementary"
        aria-label="AI Chat Panel"
        onDragOver={(e) => {
          if (!isProductConversationMode) return;
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setIsDragOver(false); }}
      >
        {/* Skip to content link (a11y) */}
        <a href={isProductConversationMode ? '#product-intake-query' : '#fa-chat-input'} className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:bg-indigo-600 focus:text-white focus:px-3 focus:py-1.5 focus:rounded focus:text-xs">
          Skip to chat input
        </a>

        {/* Simplified Header */}
        <PanelHeader
          isCompactSidebar={isCompactSidebar}
          isStreaming={isBusy}
          isSwarmActive={isSwarmActive}
          runtimeOwnerReady={runtimeOwnerReady}
          swarmTasks={swarmTasks}
          isAuthenticated={isAuthenticated}
          activeThreadId={activeThreadId}
          messagesToRender={messagesToRender}
          threads={threads}
          isFocusMode={isFocusMode}
          isWideMode={isWideMode}
          liveEvents={liveEvents}
          anonymousSession={anonymousSession}
          setActiveThreadId={setActiveThreadId}
          setInput={setInput}
          setAttachedFiles={setAttachedFiles}
          setShowOverflowMenu={setShowOverflowMenu}
          setShowEventsPanel={setShowEventsPanel}
          setShowSkillsPanel={setShowSkillsPanel}
          showSidebar={showSidebar}
          setShowSidebar={setShowSidebar}
          setIsFocusMode={setIsFocusMode}
          setIsWideMode={setIsWideMode}
          setIsMinimized={setIsMinimized}
          showOverflowMenu={showOverflowMenu}
          onClose={onClose}
          handleCopyAsMarkdown={handleCopyAsMarkdown}
          handleDownloadMarkdown={handleDownloadMarkdown}
          appendToSignalsLog={appendToSignalsLog}
          showOpenInChat={isProductConversationMode}
          onOpenInChat={openCurrentConversationInChat}
        />

        {isCompactSidebar && showSidebar && activeTab === 'chat' && !isFocusMode ? (
          <div className="max-h-[min(45dvh,420px)] overflow-y-auto border-b border-edge bg-surface-secondary">
            <FastAgentThreadList
              threads={threads}
              activeThreadId={activeThreadId}
              onSelectThread={(threadId) => {
                setActiveThreadId(threadId);
                setShowSidebar(false);
              }}
              onDeleteThread={isProductConversationMode ? undefined : handleDeleteThread}
              hasMore={hasMoreThreads}
              onLoadMore={() => loadMoreThreads(10)}
              isLoadingMore={isLoadingMoreThreads}
            />
          </div>
        ) : null}

        {/* Conversation Search Bar */}
        {showSearch && (
          <div
            data-nb-composer="agent-search"
            className="nb-composer-surface flex items-center gap-2 px-3 py-2 border-b border-edge bg-surface-secondary transition-colors"
            role="search"
          >
            <Search className="w-3.5 h-3.5 text-content-muted flex-shrink-0" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label="Search messages"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchMatchIndex(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (searchMatches.length > 0) {
                    const next = e.shiftKey
                      ? (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length
                      : (searchMatchIndex + 1) % searchMatches.length;
                    setSearchMatchIndex(next);
                    const msgIdx = searchMatches[next];
                    const el = scrollContainerRef.current?.querySelectorAll('[data-msg-index]')?.[msgIdx];
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }
                if (e.key === 'Escape') {
                  setShowSearch(false);
                  setSearchQuery('');
                  setSearchMatchIndex(0);
                }
              }}
              placeholder="Search messages..."
              className="flex-1 bg-transparent text-xs text-content placeholder:text-content-muted border-none focus:ring-0 focus:outline-none py-0"
            />
            {searchQuery && (
              <span className="text-xs text-content-muted tabular-nums flex-shrink-0">
                {searchMatches.length > 0 ? `${searchMatchIndex + 1}/${searchMatches.length}` : '0 results'}
              </span>
            )}
            <button
              type="button"
              onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchMatchIndex(0); }}
              className="p-1 hover:bg-surface-secondary rounded text-content-muted hover:text-content transition-colors flex-shrink-0"
              aria-label="Close search"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Tab Bar - Primary tabs visible, power-user tabs behind overflow (hidden in focus mode) */}
        {showPanelTabBar && (
        <div className={cn(
          "flex items-center border-b border-edge/50",
          isCompactSidebar
            ? "mx-4 mt-3 rounded-full border border-gray-200 bg-gray-50/90 p-1 dark:border-white/[0.08] dark:bg-white/[0.03]"
            : "px-3",
          isFocusMode && "hidden"
        )}>
          {getFastAgentViewTabs({
            isCompactSidebar,
            showsNotebookWorkspaceTabs,
          }).map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "text-xs font-medium transition-all",
                isCompactSidebar ? "flex-1 rounded-xl px-3.5 py-2" : "px-3 py-2 border-b-2 -mb-px",
                activeTab === tab.id
                  ? isCompactSidebar
                    ? "bg-white text-content shadow-sm dark:bg-[#171c22]"
                    : "border-indigo-500/30 text-indigo-600 dark:text-indigo-400"
                  : isCompactSidebar
                    ? "text-content-secondary hover:bg-white hover:text-content dark:hover:bg-white/[0.05]"
                    : "border-transparent text-content-secondary hover:text-content"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        )}

        {/* Swarm Lanes View - Shows when thread has active swarm */}
        {activeThreadId && isSwarmActive && (
          <SwarmLanesView
            threadId={activeThreadId}
            compact={true}
          />
        )}

        {/* Skills Popover */}
        {showSkillsPanel && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowSkillsPanel(false)} />
            <SkillsPanel
              onClose={() => setShowSkillsPanel(false)}
              onSelectSkill={(skillName, description) => {
                const skillPrompt = `Use the "${skillName}" skill: ${description}`;
                setInput((prev) => prev ? `${prev}\n\n${skillPrompt}` : skillPrompt);
                toast.success(`Skill "${skillName}" added to your message`);
              }}
            />
          </>
        )}

        {/* Content Area */}
        <div className="fast-agent-panel-content bg-surface">
          {/* Left Sidebar (Thread List) - Only show on chat tab when sidebar is toggled */}
          {!isCompactSidebar && (
            <div className={`panel-sidebar ${showSidebar && activeTab === 'chat' && !isFocusMode ? 'visible' : ''} border-r border-edge bg-surface-secondary`}>
              <FastAgentThreadList
                threads={threads}
                activeThreadId={activeThreadId}
                onSelectThread={(threadId) => {
                  setActiveThreadId(threadId);
                  setShowSidebar(false);
                }}
                onDeleteThread={isProductConversationMode ? undefined : handleDeleteThread}
                hasMore={hasMoreThreads}
                onLoadMore={() => loadMoreThreads(10)}
                isLoadingMore={isLoadingMoreThreads}
                className="h-full"
              />
            </div>
          )}

          {/* Main Content Area */}
          <div className={cn("flex-1 flex flex-col min-w-0 relative", isCompactSidebar ? "bg-transparent" : "bg-surface")}>
            {activeTab === 'scratchpad' && productEntitySlug ? (
              <EntityWorkspaceDrawerContent entitySlug={productEntitySlug} tab="scratchpad" />
            ) : activeTab === 'flow' && productEntitySlug ? (
              <EntityWorkspaceDrawerContent entitySlug={productEntitySlug} tab="flow" />
            ) : activeTab === 'trace' ? (
              <div className="flex-1 overflow-y-auto p-3">
                {/* Show TraceAuditPanel for: active swarm ID or active thread */}
                {isSwarmActive && activeThreadId ? (
                  <TraceAuditPanel
                    executionId={activeThreadId}
                    className="h-full"
                  />
                ) : activeThreadId ? (
                  <TraceAuditPanel
                    executionId={activeThreadId}
                    className="h-full"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <div className="w-10 h-10 rounded-full bg-surface-secondary flex items-center justify-center mb-3">
                      <svg className="w-5 h-5 text-content-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                    </div>
                    <p className="text-sm font-medium text-content mb-1">No Execution Trace</p>
                    <p className="text-xs text-content-muted max-w-xs">
                      Audit logs appear here when agent swarms execute. Each step is deterministically recorded.
                    </p>
                  </div>
                )}
              </div>
            ) : activeTab === 'sources' ? (
              <ArtifactsTab
                media={aggregatedMedia}
                documents={aggregatedDocumentActions}
                hasThread={Boolean(activeThreadId)}
                onDocumentSelect={handleDocumentSelect}
              />
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Live Events Section - Inline collapsible */}
                {showEventsPanel && liveEvents.length > 0 && (
                  <div className="flex-shrink-0 border-b border-edge max-h-48 overflow-y-auto">
                    <div className="px-3 py-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Activity className={`w-3.5 h-3.5 ${isStreaming ? 'text-violet-500 motion-safe:animate-pulse' : 'text-content-muted'}`} />
                          <span className="text-xs font-medium text-content">
                            Live Activity
                          </span>
                          {liveEvents.filter(e => e.status === 'running').length > 0 && (
                            <span className="px-1.5 py-0.5 text-xs bg-violet-500 text-white rounded-full">
                              {liveEvents.filter(e => e.status === 'running').length}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowEventsPanel(false)}
                          className="p-1 rounded text-content-muted hover:bg-surface-secondary"
                          aria-label="Collapse live activity"
                        >
                          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="space-y-1">
                        {liveEvents.slice(-5).map((event, index, visibleEvents) => (
                          <LiveEventCard
                            key={event.id}
                            event={event}
                            isLast={index === visibleEvents.length - 1}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Main scrollable chat area */}
                <div
                  ref={scrollContainerRef}
                  role="log"
                  aria-label="Chat messages"
                  aria-live="polite"
                  className={cn(
                    "flex-1 overflow-y-auto space-y-6 scroll-smooth relative scroll-fade",
                    isCompactSidebar ? "px-4 py-4" : "p-4",
                  )}
                >

                  {/* Conversation Starters (empty thread) */}
                  {activeThreadId && (!messagesToRender || messagesToRender.length === 0) && !isBusy && !isCompactSidebar && (
                    <div className="flex flex-col items-center justify-center h-full py-12 animate-in fade-in duration-300">
                      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300">
                        <MessageSquare className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                        New thread
                      </div>
                      <h3 className="mb-2 text-base font-semibold text-content">Start with a direct question</h3>
                      <p className="mb-6 max-w-[320px] text-center text-[13px] leading-6 text-content-muted">
                        The sidecar now follows the same calmer chat surface as the main chat page.
                      </p>

                      {/* Mobile: QuickCommandChips — surface-aware, one-tap dispatch */}
                      <div className="w-full max-w-[360px] lg:hidden">
                        <QuickCommandChips
                          onSelect={(query) => { setInput(query); void stableSendMessage(query); }}
                        />
                      </div>

                      {/* Desktop: Grid starters */}
                      <div className="hidden lg:grid grid-cols-2 gap-2 w-full max-w-[360px]">
                        {conversationStarters.map((starter, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setInput(starter.prompt)}
                            className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-left transition-all hover:border-[var(--accent-primary)]/20 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-[#171c22] dark:hover:bg-white/[0.04]"
                          >
                            <span className="text-lg">{starter.icon}</span>
                            <span className="text-xs font-medium text-content-secondary transition-colors">{starter.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Parallel Agent Lanes (Live Activity) */}
                  {chatMode === 'agent-streaming' && streamingThread?.agentThreadId && (
                    <div className="mb-4">
                      <LiveAgentLanes
                        runId={streamingThread.agentThreadId}
                        className="mb-4"
                      />
                    </div>
                  )}

                  {/* Progressive Disclosure Trace */}
                  {disclosureEvents.length > 0 && (
                    <DisclosureTrace
                      events={disclosureEvents}
                      isExpanded={showDisclosureTrace}
                      onToggle={() => setShowDisclosureTrace(!showDisclosureTrace)}
                      budgetLimit={10000}
                      className="mb-4"
                    />
                  )}

                  {/* Empty State - Quick Actions */}
                  {!activeThreadId && (!messagesToRender || messagesToRender.length === 0) && (
                    <div className="flex-1 flex flex-col overflow-y-auto">
                      <div className="mx-auto flex w-full max-w-[440px] flex-col items-center justify-center px-4 pb-8 pt-6 text-center">
                       <div className="grid w-full gap-2 sm:grid-cols-2">
                         {[
                           { label: 'What gaps do I have before pitching?', icon: '🎯' },
                           { label: 'Should I build or find a partner?', icon: '🏗️' },
                           { label: 'Give me my weekly founder reset', icon: '📋' },
                           { label: 'What have competitors shipped?', icon: '🔍' },
                         ].map((chip) => (
                           <button
                             key={chip.label}
                             type="button"
                             onClick={() => setInput(chip.label)}
                             className="chip-press flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3.5 py-3 text-left text-xs font-medium text-content-secondary transition-colors hover:border-[var(--accent-primary)]/20 hover:bg-gray-50 hover:text-content dark:border-white/[0.08] dark:bg-[#171c22] dark:hover:bg-white/[0.04]"
                           >
                             <span className="text-sm" aria-hidden="true">{chip.icon}</span>
                             <span>{chip.label}</span>
                           </button>
                         ))}
                       </div>
                     </div>

                      {/* Recent threads / last run */}
                      {threads.length > 0 && <div className="px-4 pb-5">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-xs font-bold text-content-secondary">
                            Recent conversations
                          </div>
                        </div>
                        <div className="space-y-2">
                          {threadsStatus === "LoadingFirstPage" ? (
                            <>
                              <div className="h-12 rounded-lg border border-edge bg-surface-secondary/50 motion-safe:animate-pulse" />
                              <div className="h-12 rounded-lg border border-edge bg-surface-secondary/50 motion-safe:animate-pulse" />
                            </>
                          ) : threads.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-edge bg-surface-secondary/30 px-4 py-3 text-center">
                              <div className="text-[12px] text-content-muted">
                                No conversations yet — ask a question above to get started.
                              </div>
                            </div>
                          ) : (
                            threads.slice(0, 3).map((thread: any) => {
                              const lastAt =
                                (thread?.lastMessageAt as number | undefined) ??
                                (thread?.updatedAt as number | undefined) ??
                                (thread?._creationTime as number | undefined);
                              const title = thread?.title || "New Chat";
                              const preview = (thread?.lastMessage as string | undefined) || "";
                              const ago = formatTimeAgo(lastAt);

                              return (
                                <button
                                  key={thread._id}
                                  type="button"
                                  onClick={() => setActiveThreadId(thread._id)}
                                  className="w-full text-left rounded-lg border border-edge bg-surface hover:bg-surface-hover transition-colors px-3 py-2"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-content truncate">
                                        {title}
                                      </div>
                                      {preview ? (
                                        <div className="text-xs text-content-muted truncate mt-0.5">
                                          {preview}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-content-muted mt-0.5">
                                          No messages yet
                                        </div>
                                      )}
                                    </div>
                                    {ago ? (
                                      <div className="text-xs text-content-muted whitespace-nowrap">
                                        {ago}
                                      </div>
                                    ) : null}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>}

                    </div>
                  )}

                  <MessageHandlersProvider handlers={messageHandlers}>
                    <VirtualizedMessageList
                      messages={messagesToRender ?? []}
                      getMessageKey={(msg: any) => msg._id || msg.id || `msg-${msg.key}`}
                      renderMessage={(message: any) => (
                        <div>
                          {/* Timestamp grouping: date divider */}
                          {(() => {
                            if (!message._creationTime) return null;
                            const msgDate = new Date(message._creationTime).toDateString();
                            const prevMsg = messagesToRender[Math.max(0, messagesToRender.indexOf(message) - 1)];
                            const prevDate = prevMsg?._creationTime ? new Date(prevMsg._creationTime).toDateString() : null;
                            if (prevDate === msgDate && prevMsg !== message) return null;
                            const today = new Date().toDateString();
                            const yesterday = new Date(Date.now() - 86400000).toDateString();
                            const label = msgDate === today ? 'Today' : msgDate === yesterday ? 'Yesterday' : msgDate;
                            return (
                              <div className="flex items-center gap-3 py-2 mb-2">
                                <div className="flex-1 h-px bg-[var(--border-color)]" />
                                <span className="text-xs font-medium text-content-muted">{label}</span>
                                <div className="flex-1 h-px bg-[var(--border-color)]" />
                              </div>
                            );
                          })()}
                          <FastAgentUIMessageBubble
                            message={message}
                            onRegenerateMessage={() => handleRegenerateMessage(message.key)}
                            onDeleteMessage={isProductConversationMode ? undefined : () => handleDeleteMessage(message._id)}
                            searchHighlight={searchQuery || undefined}
                            fontSize={fontSize}
                            compact={isCompactSidebar}
                          />
                          {/* Save to notebook — appears under completed assistant
                              responses when the user is on an entity page. Writes
                              the text as an agent-authored read-only block; user
                              reviews as a pending suggestion in the notebook. */}
                          {productEntitySlug && message.role === 'assistant' && message.status === 'complete' && (() => {
                            const text = extractAssistantMessageText(message);
                            if (!text.trim()) return null;
                            return (
                              <div className="ml-10 mt-1 mb-1.5">
                                <SaveToNotebookButton
                                  entitySlug={productEntitySlug}
                                  text={text}
                                  surface="panel"
                                  compact
                                />
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      containerRef={scrollContainerRef}
                      enabled={shouldVirtualize}
                      bufferSize={5}
                      estimatedItemHeight={150}
                    />
                  </MessageHandlersProvider>

                  {/* Quote popover — appears on text selection inside assistant messages.
                      Ports the nb-quote-pop behavior from docs/design/.../ChatThread.jsx:321-333. */}
                  <QuotePopover
                    containerRef={scrollContainerRef}
                    onQuote={(text) => {
                      const quoted = '> ' + text.replace(/\n/g, '\n> ') + '\n\n';
                      setInput((prev) => quoted + (prev ?? ''));
                      setTimeout(() => {
                        focusFastAgentComposer();
                      }, 20);
                    }}
                    onAskAbout={(text) => {
                      setInput(`What about this: "${text}"?`);
                      setTimeout(() => {
                        focusFastAgentComposer();
                      }, 20);
                    }}
                  />

                  {/* Queued Indicator */}
                  {(streamingThread as any)?.runStatus === 'queued' && (
                    <div className="flex flex-col gap-2 px-4 mb-4">
                      <div className="flex items-center gap-2 text-xs text-content-muted motion-safe:animate-pulse">
                        <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
                        <span>Waiting for available agent...</span>
                      </div>
                    </div>
                  )}

                  <AgentRunErrorBanner
                    errorMessage={(streamingThread as any)?.runErrorMessage}
                    status={(streamingThread as any)?.runStatus}
                  />

                  {/* Streaming Indicator */}
                  {isBusy && (
                    <div className="flex items-center gap-2 px-4">
                      <div className="typing-dots">
                        <span className="dot" />
                        <span className="dot" />
                        <span className="dot" />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* One scroll-to-bottom control when the reader has moved away. */}
                {showScrollFab && (
                  <button
                    type="button"
                    onClick={() => {
                      autoScrollEnabledRef.current = true;
                      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 w-8 h-8 rounded-full bg-surface-secondary border border-edge shadow-lg flex items-center justify-center text-content-muted hover:text-content hover:bg-surface-secondary transition-all duration-normal animate-in fade-in slide-in-from-bottom-2"
                    aria-label="Scroll to bottom"
                  >
                    <ArrowDown className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            {/* Language Detection Indicator */}
            {!isCompactSidebar && detectedLanguage && !isBusy && (
              <div className="mx-3 mt-1 flex items-center gap-1.5">
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-medium">
                  🌐 {detectedLanguage} detected
                </span>
                <button
                  type="button"
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  onClick={() => setInput(`Translate your last response to English`)}
                >
                  Translate to English
                </button>
              </div>
            )}

            {/* Input Area */}
            <div className="p-3 border-t border-edge">
              {!isCompactSidebar && <div className="flex items-center justify-end mb-1.5">
                {/* Font Size Slider */}
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-[8px] text-content-muted">A</span>
                  <input
                    type="range"
                    min={10}
                    max={18}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-[50px] h-1 accent-[rgb(79, 70, 229)]"
                    aria-label={`Font size: ${fontSize}px`}
                  />
                  <span className="text-xs text-content-muted">A</span>
                </div>
              </div>}
              {isProductConversationMode ? (
                <ProductIntakeComposer
                  value={input}
                  onChange={setInput}
                  onSubmit={() => stableSendMessage(input)}
                  onFilesSelected={async (files) => {
                    handleAttachFiles(files);
                  }}
                  files={productAttachedFiles}
                  lens={productLens}
                  onLensChange={() => undefined}
                  operatorContextLabel={productEntityLabel ? `Anchored on ${productEntityLabel}` : "Entity workspace"}
                  operatorContextHint="Replies stay attached to this entity conversation. Add notes or files here to keep the notebook thread grounded."
                  submitPending={isBusy}
                  placeholder="Ask about this entity, continue the notebook thread, or add more evidence."
                  helperText="Attach notes, screenshots, or files to ground the next run."
                  submitLabel="Continue"
                  variant="drawer"
                  showLensSelector={false}
                />
              ) : (
                <FastAgentInputBar
                  id="fa-chat-input"
                  input={input}
                  setInput={setInput}
                  onSend={stableSendMessage}
                  isStreaming={isBusy}
                  isSendDisabled={!runtimeOwnerReady}
                  onStop={handleStopStreaming}
                  selectedModel={runtimeSelectedModel}
                  onSelectModel={setSelectedModel as (model: string) => void}
                  modelSelectionEnabled={isAuthenticated}
                  selectedDocumentIds={selectedDocumentIds}
                  onRemoveSelectedDocument={handleRemoveSelectedDocument}
                  contextCalendarEvents={contextCalendarEvents}
                  onAddCalendarEvent={handleAddCalendarEvent}
                  onRemoveCalendarEvent={handleRemoveCalendarEvent}
                  onVoiceIntent={onVoiceIntent}
                  compact={isCompactSidebar}
                  onSpawn={isAuthenticated ? async (query, agents) => {
                    try {
                      toast.info(`Starting team with ${agents.length} agents...`);
                      const result = await spawnSwarm({
                        query,
                        agents,
                        model: runtimeSelectedModel,
                      });
                      // Switch to the new team thread
                      setActiveThreadId(result.threadId);
                      toast.success(`Team started with ${result.taskCount} agents`);
                    } catch (error: any) {
                      console.error('[FastAgentPanel] Swarm spawn failed:', error);
                      toast.error(error.message || 'Failed to start team');
                    }
                  } : undefined}
                />
              )}
            </div>

          </div>

        </div>

        <PanelOverlays
          showShortcutsOverlay={showShortcutsOverlay}
          setShowShortcutsOverlay={setShowShortcutsOverlay}
          showTimeline={showTimeline}
          setShowTimelineState={setShowTimeline}
          messagesToRender={messagesToRender}
          scrollContainerRef={scrollContainerRef}
        />

        <PanelDialogs
          showArtifacts={showArtifacts}
          setShowArtifacts={setShowArtifacts}
          artifactContent={artifactContent}
          isDragOver={isProductConversationMode && isDragOver}
          setIsDragOver={setIsDragOver}
          setAttachedFiles={setAttachedFiles}
          variant={variant}
        />

      </div>
    </>
  );
});

interface ArtifactsTabProps {
  media: ExtractedMedia;
  documents: DocumentAction[];
  hasThread: boolean;
  onDocumentSelect: (documentId: string) => void;
}

function ArtifactsTab({ media, documents, hasThread, onDocumentSelect }: ArtifactsTabProps) {
  const totalSources = media.webSources.length + media.secDocuments.length;
  const totalVideos = media.youtubeVideos.length;
  const totalProfiles = media.profiles.length;
  const totalImages = media.images.length;
  const totalDocs = documents.length;
  const totalArtifacts = totalSources + totalVideos + totalProfiles + totalImages + totalDocs;

  if (totalArtifacts === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center text-center bg-surface">
        <div className="space-y-2 max-w-md">
          <p className="text-sm font-semibold text-content">
            No artifacts yet.
          </p>
          <p className="text-xs text-content-muted">
            {hasThread
              ? 'Run a query or wait for the agent to finish to see collected sources, filings, media, and generated documents.'
              : 'Start a thread to collect sources, filings, media, and generated documents as the agent works.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[{ label: 'Sources & Filings', value: totalSources }, { label: 'Videos', value: totalVideos }, { label: 'People', value: totalProfiles }, { label: 'Images', value: totalImages }, { label: 'Doc actions', value: totalDocs }] // Keep compact summary
          .filter(card => card.value > 0)
          .map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-edge bg-surface-secondary px-3 py-2 flex items-center justify-between text-xs"
            >
              <span className="font-medium text-content">{card.label}</span>
              <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{card.value}</span>
            </div>
          ))}
      </div>

      <div className="rounded-lg border border-edge bg-surface-secondary p-3 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs font-semibold text-content">Artifacts</p>
            <p className="text-xs text-content-muted">Consulted sources and tool outputs, with links and media.</p>
          </div>
        </div>

        <div className="space-y-4">
          <RichMediaSection media={media} />

          {documents.length > 0 && (
            <div className="border-t border-edge pt-3">
              <DocumentActionGrid
                documents={documents}
                title="Generated Documents"
                onDocumentSelect={onDocumentSelect}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
