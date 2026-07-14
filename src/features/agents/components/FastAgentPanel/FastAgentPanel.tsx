// src/components/FastAgentPanel/FastAgentPanel.tsx
// Main container component for the new ChatGPT-like AI chat sidebar

import React, { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, usePaginatedQuery, useQuery, useMutation, useAction, useConvexAuth } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { Id } from '../../../../../convex/_generated/dataModel';
import { X, Loader2, ChevronDown, ArrowDown, MessageSquare, Activity, LogIn, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useUIMessages } from '@convex-dev/agent/react';

import './FastAgentPanel.animations.css';
import { FastAgentThreadList } from './FastAgentPanel.ThreadList';
import { FastAgentInputBar } from './FastAgentPanel.InputBar';
import { FileUpload } from './FastAgentPanel.FileUpload';
import { ExportMenu } from './FastAgentPanel.ExportMenu';
// Core chat components — always needed on panel open
import { HumanRequestList } from './HumanRequestCard';
import { FastAgentUIMessageBubble } from './FastAgentPanel.UIMessageBubble';
import { MessageHandlersProvider } from './MessageHandlersContext';
import { VirtualizedMessageList, useMessageVirtualization } from './VirtualizedMessageList';
import { useSwarmByThread, useSwarmActions, parseSpawnCommand, isSpawnCommand } from '@/hooks/useSwarm';
import { MemoryStatusHeader, type PlanItem } from './MemoryStatusHeader';
import { ContextBar, type ContextConstraint } from './ContextBar';
import { SwarmQuickActions } from './SwarmQuickActions';
import { QuickCommandChips } from './QuickCommandChips';
import { QuotePopover } from '@/features/chat/components/QuotePopover';

// Tab-gated / conditional components — lazy-loaded on first use
import type { DisclosureEvent } from './FastAgentPanel.DisclosureTrace';
const SettingsPanel = React.lazy(() => import('./FastAgentPanel.Settings').then(m => ({ default: m.Settings })));
const AgentHierarchy = React.lazy(() => import('./FastAgentPanel.AgentHierarchy').then(m => ({ default: m.AgentHierarchy })));
const SkillsPanel = React.lazy(() => import('./FastAgentPanel.SkillsPanel').then(m => ({ default: m.SkillsPanel })));
const DisclosureTrace = React.lazy(() => import('./FastAgentPanel.DisclosureTrace').then(m => ({ default: m.DisclosureTrace })));
const AgentTasksTab = React.lazy(() => import('./FastAgentPanel.AgentTasksTab').then(m => ({ default: m.AgentTasksTab })));
const TraceAuditPanel = React.lazy(() => import('./FastAgentPanel.TraceAuditPanel').then(m => ({ default: m.TraceAuditPanel })));
const ParallelTaskTimeline = React.lazy(() => import('./FastAgentPanel.ParallelTaskTimeline').then(m => ({ default: m.ParallelTaskTimeline })));
const EditsTab = React.lazy(() => import('./FastAgentPanel.EditsTab').then(m => ({ default: m.EditsTab })));
const BriefTab = React.lazy(() => import('./FastAgentPanel.BriefTab').then(m => ({ default: m.BriefTab })));
const TaskManagerView = React.lazy(() => import('../TaskManager').then(m => ({ default: m.TaskManagerView })));
const SwarmLanesView = React.lazy(() => import('./SwarmLanesView').then(m => ({ default: m.SwarmLanesView })));
const LiveAgentLanes = React.lazy(() => import('@/features/agents/views/LiveAgentLanes').then(m => ({ default: m.LiveAgentLanes })));
import type { LiveEvent } from './LiveEventCard';
import { RichMediaSection } from './RichMediaSection';
import { DocumentActionGrid, extractDocumentActions, type DocumentAction } from './DocumentActionCard';
import { extractMediaFromText, type ExtractedMedia } from './utils/mediaExtractor';
import type { SpawnedAgent } from './types/agent';
import type { AgentOpenOptions, DossierContext } from '@/features/agents/context/FastAgentContext';
import { useFastAgent } from '@/features/agents/context/FastAgentContext';
import { SaveToNotebookButton } from '@/features/agents/components/SaveToNotebookButton';
import { trackEvent } from '@/lib/analytics';
import { buildDossierContextPrefix } from '@/features/agents/context/FastAgentContext';
import { findDemoConversation, GUEST_FALLBACK_RESPONSE, type DemoConversation } from './demoConversation';
import { MinimizedStrip } from './FastAgentPanel.MinimizedStrip';
import { PanelHeader } from './FastAgentPanel.PanelHeader';
import { PanelOverlays } from './FastAgentPanel.PanelOverlays';
import { PanelDialogs } from './FastAgentPanel.PanelDialogs';
import { DossierModeIndicator } from '@/features/agents/components/DossierModeIndicator';
import { DEFAULT_MODEL, MODEL_UI_INFO, type ApprovedModel } from '@shared/llm/approvedModels';
import { cn } from '@/lib/utils';
import { buildCockpitPath } from '@/lib/registry/viewRegistry';
import { useAnonymousSession } from '../../hooks/useAnonymousSession';
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
  prepareFastAgentSubmission,
} from './FastAgentPanel.sendContract';

import type {
  Message,
  Thread,
  ThinkingStep,
  ToolCall,
  Source
} from './types';

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

type PanelTab = 'chat' | 'scratchpad' | 'flow' | 'sources' | 'telemetry' | 'trace';

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

/** R6: Mobile Command Chips — shown above the input bar on mobile (max-width: 1024px). */
function MobileCommandChips({ onSelect }: { onSelect: (message: string) => void }) {
  const chips = [
    { label: "Daily Brief", message: "Generate my daily brief \u2014 what changed, main contradiction, next moves" },
    { label: "Run Diligence", message: "Run diligence analysis on this company" },
    { label: "Compare", message: "Compare this company against its top 3 competitors" },
    { label: "Market Scan", message: "Scan the market for recent changes affecting this company" },
  ];
  return (
    <div className="flex flex-wrap gap-2 px-3 py-2 lg:hidden" role="group" aria-label="Quick command suggestions">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => onSelect(c.message)}
          aria-label={`Send command: ${c.label}`}
          className="rounded-full border border-edge bg-surface px-3 py-1.5 text-[11px] font-medium text-content-secondary transition-all duration-fast ease-out hover:bg-surface-hover hover:text-content active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 motion-reduce:transform-none motion-reduce:transition-none"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

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
  const { signIn } = useAuthActions();
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

  // ========== ORACLE SESSION (auto-track agent threads as Oracle sessions) ==========
  const oracleSession = useOracleSessionContext();
  const isCompactSidebar = variant === 'sidebar';

  // ========== DEMO CONVERSATION STATE (guest mode) ==========
  interface DemoMessage {
    role: 'user' | 'assistant';
    text: string;
    key: string;
    status: 'complete' | 'typing';
    sources?: DemoConversation['sources'];
    keyInsight?: string;
  }
  const [demoMessages, setDemoMessages] = useState<DemoMessage[]>(() => {
    try {
      const raw = localStorage.getItem('nodebench-agent-chat');
      if (raw) {
        const parsed = JSON.parse(raw) as DemoMessage[];
        // Only restore completed messages (skip any that were mid-typing)
        return parsed.filter((m) => m.status === 'complete');
      }
    } catch { /* ignore parse errors */ }
    return [];
  });
  const [isDemoThinking, setIsDemoThinking] = useState(false);
  const demoTypingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist demo messages to localStorage whenever they change
  useEffect(() => {
    const completed = demoMessages.filter((m) => m.status === 'complete');
    if (completed.length > 0) {
      localStorage.setItem('nodebench-agent-chat', JSON.stringify(completed));
    } else {
      localStorage.removeItem('nodebench-agent-chat');
    }
  }, [demoMessages]);

  /** Play a pre-scripted demo conversation (guest mode only). */
  const playDemoConversation = useCallback((demo: DemoConversation, questionOverride?: string) => {
    const question = questionOverride ?? demo.question;
    const userMsg: DemoMessage = {
      role: 'user',
      text: question,
      key: `demo-user-${Date.now()}`,
      status: 'complete',
    };
    setDemoMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsDemoThinking(true);

    // Simulate thinking delay, then progressively reveal the response
    setTimeout(() => {
      setIsDemoThinking(false);
      const fullText = demo.response;
      const assistantKey = `demo-assistant-${Date.now()}`;

      // Start with empty typing message
      const assistantMsg: DemoMessage = {
        role: 'assistant',
        text: '',
        key: assistantKey,
        status: 'typing',
        sources: demo.sources,
        keyInsight: demo.keyInsight,
      };
      setDemoMessages((prev) => [...prev, assistantMsg]);

      // Progressive character reveal with 3-phase speed:
      // Phase 1 (0-50 chars): 15ms/char — fast burst to show content immediately
      // Phase 2 (50-200 chars): 8ms/char — reading speed
      // Phase 3 (200+ chars): instant dump — total reveal < 2s regardless of length
      let revealed = 0;
      const totalChars = fullText.length;

      const tick = () => {
        if (revealed < 50) {
          // Phase 1: reveal 1 char every 15ms (fast burst)
          revealed = Math.min(revealed + 1, totalChars);
        } else if (revealed < 200) {
          // Phase 2: reveal 2 chars every 8ms (reading speed)
          revealed = Math.min(revealed + 2, totalChars);
        } else {
          // Phase 3: dump remaining instantly
          revealed = totalChars;
        }
        const partialText = fullText.slice(0, revealed);
        setDemoMessages((prev) =>
          prev.map((m) =>
            m.key === assistantKey
              ? { ...m, text: partialText, status: revealed >= totalChars ? 'complete' : 'typing' }
              : m
          )
        );
        if (revealed < totalChars) {
          const delayMs = revealed <= 50 ? 15 : 8;
          demoTypingRef.current = setTimeout(tick, delayMs);
        }
      };
      demoTypingRef.current = setTimeout(tick, 30);
    }, demo.thinkingDuration);
  }, []);

  // Cleanup demo typing interval on unmount
  useEffect(() => {
    return () => {
      if (demoTypingRef.current) clearTimeout(demoTypingRef.current);
    };
  }, []);

  // ========== STATE ==========
  // Agent component uses string threadIds, not Id<"chatThreads">
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId || null);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [exportingThreadId, setExportingThreadId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Multi-document selection
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(
    _selectedDocumentIds ? new Set(_selectedDocumentIds.map(id => String(id))) : new Set()
  );
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

  // Chat mode: 'agent' (non-streaming) or 'agent-streaming' (with streaming output)
  // Note: Anonymous users MUST use agent-streaming mode (agent mode requires authentication)
  const [chatMode, setChatMode] = useState<'agent' | 'agent-streaming'>(() => {
    // Load from localStorage
    const saved = localStorage.getItem('fastAgentPanel.chatMode');
    return (saved === 'agent-streaming' || saved === 'agent') ? saved : 'agent-streaming';
  });

  // Force anonymous users to agent-streaming mode (agent mode requires auth)
  useEffect(() => {
    if (!isAuthenticated && chatMode === 'agent') {
      setChatMode('agent-streaming');
    }
  }, [isAuthenticated, chatMode]);

  // Settings
  const [fastMode, setFastMode] = useState(true);
  // Use approved model aliases only (9 approved models) - uses DEFAULT_MODEL from shared/llm/approvedModels.ts
  const [selectedModel, setSelectedModel] = useState<ApprovedModel>(DEFAULT_MODEL);
  const [arbitrageEnabled, setArbitrageEnabled] = useState(false);

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
  const [responseLength, setResponseLength] = useState<'brief' | 'detailed' | 'exhaustive'>('detailed');

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

  // Command palette (Ctrl+K)
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const commandInputRef = useRef<HTMLInputElement>(null);

  // Focus mode
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Auto-scroll pause
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const lastScrollTopRef = useRef(0);

  // Scroll progress
  const [scrollProgress, setScrollProgress] = useState(0);

  // Typing speed indicator
  const typingStartRef = useRef<number>(0);
  const typingWordCountRef = useRef<number>(0);
  const [typingWpm, setTypingWpm] = useState(0);

  // Context window meter — derived from actual MODEL_UI_INFO
  const contextLimit = useMemo(() => {
    const info = MODEL_UI_INFO[selectedModel as ApprovedModel];
    if (!info) return 32000;
    const cw = info.contextWindow;
    if (cw.endsWith('M')) return parseFloat(cw) * 1_000_000;
    if (cw.endsWith('K')) return parseFloat(cw) * 1_000;
    return parseInt(cw, 10) || 32000;
  }, [selectedModel]);

  // Conversation timeline toggle
  const [showTimeline, setShowTimeline] = useState(false);

  // Context pruning UI
  const [showContextPruning, setShowContextPruning] = useState(false);

  // Artifacts/Canvas panel
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifactContent, setArtifactContent] = useState<{ type: 'html' | 'svg' | 'code'; content: string; language?: string } | null>(null);

  // Focus/mode presets
  const FOCUS_MODES = [
    { id: 'default', label: 'Default', icon: '💬', prompt: '' },
    { id: 'academic', label: 'Academic', icon: '🎓', prompt: 'Respond in an academic style with citations, formal language, and structured analysis.' },
    { id: 'creative', label: 'Creative', icon: '🎨', prompt: 'Respond creatively with vivid language, metaphors, and engaging narrative.' },
    { id: 'precise', label: 'Precise', icon: '🎯', prompt: 'Be extremely precise and concise. Use bullet points. No fluff. Facts only.' },
    { id: 'code', label: 'Code', icon: '💻', prompt: 'Focus on code. Provide working examples with comments. Use best practices.' },
  ] as const;
  const [focusMode, setFocusMode] = useState('default');
  const [showFocusPicker, setShowFocusPicker] = useState(false);

  // Tone/style presets
  const TONE_PRESETS = [
    { id: 'neutral', label: 'Neutral', icon: '⚖️' },
    { id: 'formal', label: 'Formal', icon: '🏛️' },
    { id: 'casual', label: 'Casual', icon: '😊' },
    { id: 'technical', label: 'Technical', icon: '⚙️' },
  ] as const;
  const [tonePreset, setTonePreset] = useState('neutral');

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

  // Message pinning (localStorage-backed)
  const [pinnedMsgIds, setPinnedMsgIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('fa_pinned_msgs');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const togglePinMsg = useCallback((msgId: string) => {
    setPinnedMsgIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      localStorage.setItem('fa_pinned_msgs', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Message bookmarks (localStorage-backed)
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('fa_bookmarks');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const toggleBookmark = useCallback((msgId: string) => {
    setBookmarkedIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      localStorage.setItem('fa_bookmarks', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Overflow menu state (for secondary actions)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  // Custom system prompt per thread (localStorage-backed)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  useEffect(() => {
    if (activeThreadId) {
      const saved = localStorage.getItem(`fa_sysprompt_${activeThreadId}`);
      setSystemPrompt(saved || '');
    } else {
      setSystemPrompt('');
    }
  }, [activeThreadId]);
  const saveSystemPrompt = useCallback(() => {
    if (activeThreadId) {
      if (systemPrompt.trim()) {
        localStorage.setItem(`fa_sysprompt_${activeThreadId}`, systemPrompt);
      } else {
        localStorage.removeItem(`fa_sysprompt_${activeThreadId}`);
      }
    }
    setShowSystemPrompt(false);
    toast.success('System prompt saved');
  }, [activeThreadId, systemPrompt]);

  // Quick reply templates (localStorage-backed)
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('fa_quick_replies');
      return saved ? JSON.parse(saved) as string[] : [
        'Summarize this in bullet points',
        'What are the key risks?',
        'Compare pros and cons',
        'Give me actionable next steps',
      ];
    } catch { return []; }
  });

  // File attachment state
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  // Context documents from drag-and-drop
  const [contextDocuments, setContextDocuments] = useState<Array<{
    id: string;
    title: string;
    type?: 'document' | 'dossier' | 'note';
    analyzing?: boolean;
  }>>([]);

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

  const handleRemoveFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddContextDocument = (doc: { id: string; title: string; type?: 'document' | 'dossier' | 'note'; analyzing?: boolean }) => {
    setContextDocuments(prev => {
      // Update existing or add new
      const existing = prev.find(d => d.id === doc.id);
      if (existing) {
        return prev.map(d => d.id === doc.id ? doc : d);
      }
      return [...prev, doc];
    });
  };

  const handleRemoveContextDocument = (docId: string) => {
    setContextDocuments(prev => prev.filter(d => d.id !== docId));
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

  // Voice input (Web Speech API)
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const startVoiceInput = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error('Speech recognition not supported in this browser'); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((r: any) => r[0].transcript).join('');
      setInput(prev => prev + transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => { setIsRecording(false); toast.error('Voice input failed'); };
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [setInput]);
  const stopVoiceInput = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  // RLHF feedback per message
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({});
  const [showFeedbackComment, setShowFeedbackComment] = useState<string | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const handleFeedback = useCallback((msgId: string, vote: 'up' | 'down') => {
    setFeedbackMap(prev => ({ ...prev, [msgId]: vote }));
  }, []);

  // Font size / density
  const [fontSize, setFontSize] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('fa_font_size') || '14', 10); } catch { return 14; }
  });
  useEffect(() => { localStorage.setItem('fa_font_size', String(fontSize)); }, [fontSize]);

  // Conversation analytics overlay
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Side-by-side model comparison
  const [showModelComparison, setShowModelComparison] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<{ modelA: string; modelB: string; responseA: string; responseB: string } | null>(null);

  // Drag-and-drop overlay
  const [isDragOver, setIsDragOver] = useState(false);

  // Thread branch tree
  const [showBranchTree, setShowBranchTree] = useState(false);

  // Auto-title (moved after messagesToRender definition)
  // Message edit diff tracking
  const [editDiffs, setEditDiffs] = useState<Record<string, { oldText: string; newText: string }>>({});

  // contextWindowMsgs (moved after messagesToRender definition)

  // ========== TIER 14 STATE ==========

  // Streaming speed indicator (state only; useEffect moved after messagesToRender)
  const [streamingStats, setStreamingStats] = useState<{ startTime: number; firstTokenTime: number | null; tokenCount: number; tokensPerSec: number }>({ startTime: 0, firstTokenTime: null, tokenCount: 0, tokensPerSec: 0 });
  const prevStreamingTextRef = useRef('');

  // Message threading (reply-to)
  const [replyToMsgId, setReplyToMsgId] = useState<string | null>(null);
  // replyToMsg (moved after messagesToRender definition)

  // Persistent cross-thread memory
  const [memories, setMemories] = useState<Array<{ id: string; text: string; createdAt: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('fa_memories') || '[]'); } catch { return []; }
  });
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const addMemory = useCallback((text: string) => {
    const mem = { id: `mem_${Date.now()}`, text, createdAt: Date.now() };
    setMemories(prev => {
      const updated = [mem, ...prev].slice(0, 50);
      localStorage.setItem('fa_memories', JSON.stringify(updated));
      return updated;
    });
    toast.success('Saved to memory');
  }, []);
  const removeMemory = useCallback((id: string) => {
    setMemories(prev => {
      const updated = prev.filter(m => m.id !== id);
      localStorage.setItem('fa_memories', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Conversation starters — founder-relevant for Ask NodeBench
  const conversationStarters = useMemo(() => [
    { icon: '🎯', label: 'Pitch readiness', prompt: 'What gaps do I have before pitching investors?' },
    { icon: '🏗️', label: 'Build vs buy', prompt: 'Should I build this feature or find a partner?' },
    { icon: '📋', label: 'Weekly reset', prompt: 'Give me my founder weekly reset — what changed, contradictions, next 3 moves' },
    { icon: '🔍', label: 'Competitor check', prompt: 'What have my competitors shipped recently?' },
  ], []);

  // Image paste preview
  const [imagePreview, setImagePreview] = useState<Array<{ file: File; url: string }>>([]);
  useEffect(() => {
    return () => { imagePreview.forEach(img => URL.revokeObjectURL(img.url)); };
  }, [imagePreview]);

  // Keyboard message navigation
  const [focusedMsgIdx, setFocusedMsgIdx] = useState<number | null>(null);

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msgId: string; role: string } | null>(null);

  // Message annotations
  const [annotations, setAnnotations] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('fa_annotations') || '{}'); } catch { return {}; }
  });
  const addAnnotation = useCallback((msgId: string, note: string) => {
    setAnnotations(prev => {
      const updated = { ...prev, [msgId]: [...(prev[msgId] || []), note] };
      localStorage.setItem('fa_annotations', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // High contrast / accessibility mode
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem('fa_high_contrast') === 'true');
  useEffect(() => { localStorage.setItem('fa_high_contrast', String(highContrast)); }, [highContrast]);

  // Smart paste detection
  const detectPasteType = useCallback((text: string): 'url' | 'json' | 'code' | 'text' => {
    if (/^https?:\/\//.test(text.trim())) return 'url';
    try { JSON.parse(text); return 'json'; } catch { /* not json */ }
    if (/^(import |export |const |let |var |function |class |def |public |private )/.test(text.trim())) return 'code';
    return 'text';
  }, []);

  // Conversation import
  const [showImport, setShowImport] = useState(false);

  // Message scheduling
  const [scheduledMessages, setScheduledMessages] = useState<Array<{ id: string; text: string; scheduledAt: number }>>([]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setScheduledMessages(prev => {
        const ready = prev.filter(m => m.scheduledAt <= now);
        const remaining = prev.filter(m => m.scheduledAt > now);
        ready.forEach(m => { void stableSendMessageRef.current?.(m.text); });
        return remaining;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Conversation snapshots
  const [snapshots, setSnapshots] = useState<Array<{ id: string; name: string; messageCount: number; createdAt: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('fa_snapshots') || '[]'); } catch { return []; }
  });
  // saveSnapshot (moved after messagesToRender definition)

  // detectedLanguage (moved after messagesToRender definition)

  // Performance metrics (state only; useEffect moved after isBusy)
  const [perfMetrics, setPerfMetrics] = useState<{ responseTimes: number[]; avgLatency: number; p95Latency: number }>({ responseTimes: [], avgLatency: 0, p95Latency: 0 });
  const responseStartRef = useRef<number>(0);

  // ========== TIER 15: AGENT + PERF + A11Y + POLISH ==========

  // Tool approval UI (review needed)
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: string; toolName: string; args: any; riskLevel: 'low' | 'medium' | 'high'; createdAt: number }>>([]);
  const approveToolCall = useCallback((id: string) => {
    setPendingApprovals(prev => prev.filter(a => a.id !== id));
    toast.success('Action approved');
  }, []);
  const rejectToolCall = useCallback((id: string) => {
    setPendingApprovals(prev => prev.filter(a => a.id !== id));
    toast.info('Action rejected');
  }, []);

  // Multi-agent handoff visualization
  const [agentHandoffs, setAgentHandoffs] = useState<Array<{ id: string; fromAgent: string; toAgent: string; reason: string; status: 'active' | 'completed'; timestamp: number }>>([]);

  // Persona switching
  const personas = useMemo(() => [
    { id: 'default', name: 'Assistant', icon: '🤖', systemPrompt: 'You are a helpful assistant.' },
    { id: 'coder', name: 'Code Expert', icon: '💻', systemPrompt: 'You are an expert programmer. Focus on clean, efficient code with best practices.' },
    { id: 'writer', name: 'Writer', icon: '✍️', systemPrompt: 'You are a professional writer. Focus on clarity, engagement, and proper structure.' },
    { id: 'analyst', name: 'Data Analyst', icon: '📊', systemPrompt: 'You are a data analyst. Focus on insights, patterns, and data-driven recommendations.' },
    { id: 'researcher', name: 'Researcher', icon: '🔬', systemPrompt: 'You are a thorough researcher. Provide well-sourced, balanced analysis.' },
  ], []);
  const [activePersona, setActivePersona] = useState('default');
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const currentPersona = useMemo(() => personas.find(p => p.id === activePersona) || personas[0], [personas, activePersona]);

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
        const inputEl = document.querySelector<HTMLTextAreaElement>('[placeholder="Message..."]');
        inputEl?.focus();
        return;
      }

      // Ctrl/Cmd+Shift+N — New thread
      if (isModKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        setActiveThreadId(null);
        setInput('');
        const inputEl = document.querySelector<HTMLTextAreaElement>('[placeholder="Message..."]');
        inputEl?.focus();
        return;
      }

      // Ctrl/Cmd+K — Open command palette
      if (isModKey && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        setCommandQuery('');
        setTimeout(() => commandInputRef.current?.focus(), 50);
        return;
      }

      // Ctrl/Cmd+T — Toggle conversation timeline
      if (isModKey && e.key === 't') {
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
        if (!messagesToRender || messagesToRender.length === 0) return;
        setFocusedMsgIdx(prev => {
          const max = messagesToRender.length - 1;
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

      // Escape — Close command palette, search, overlay, blur input, or close panel
      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
        } else if (showMemoryPanel) {
          setShowMemoryPanel(false);
        } else if (showImport) {
          setShowImport(false);
        } else if (showAnalytics) {
          setShowAnalytics(false);
        } else if (showBranchTree) {
          setShowBranchTree(false);
        } else if (showArtifacts) {
          setShowArtifacts(false);
        } else if (showCommandPalette) {
          setShowCommandPalette(false);
          setCommandQuery('');
        } else if (showTimeline) {
          setShowTimeline(false);
        } else if (showContextPruning) {
          setShowContextPruning(false);
        } else if (showPersonaPicker) {
          setShowPersonaPicker(false);
        } else if (showFocusPicker) {
          setShowFocusPicker(false);
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
  }, [isOpen, onClose, showShortcutsOverlay, showSearch]);

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

  // Live streaming state
  const [liveThinking, setLiveThinking] = useState<ThinkingStep[]>([]);
  const [liveTokens, setLiveTokens] = useState<string>("");
  const [liveAgents, setLiveAgents] = useState<SpawnedAgent[]>([]);

  const [liveToolCalls, setLiveToolCalls] = useState<ToolCall[]>([]);
  const [liveSources, setLiveSources] = useState<Source[]>([]);

  // Progressive Disclosure state
  const [disclosureEvents, setDisclosureEvents] = useState<DisclosureEvent[]>([]);
  const [showDisclosureTrace, setShowDisclosureTrace] = useState(false);

  // Tab state - default agent tabs plus entity-workspace tabs when the
  // drawer is opened from the notebook surface.
  const [activeTab, setActiveTab] = useState<PanelTab>('chat');
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

      // Auto-scroll pause detection
      if (scrollTop < lastScrollTopRef.current - 20) {
        setIsAutoScrollPaused(true);
      }
      if (distanceFromBottom < 30) {
        setIsAutoScrollPaused(false);
      }
      lastScrollTopRef.current = scrollTop;

      // Scroll progress bar
      const maxScroll = scrollHeight - clientHeight;
      setScrollProgress(maxScroll > 0 ? scrollTop / maxScroll : 0);
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

  // Query for agent planning data (ambient memory - plan progress)
  const agentPlans = useQuery(
    api.domains.agents.agentPlanning.listPlans,
    isAuthenticated ? { limit: 5 } : 'skip'
  );

  // Query for agent memory (context constraints / scratchpad)
  const agentMemory = useQuery(
    api.domains.agents.agentMemory.listMemory,
    isAuthenticated ? { limit: 10 } : 'skip'
  );

  // Transform plans into PlanItem format for MemoryStatusHeader
  const planItems = useMemo((): PlanItem[] => {
    if (!agentPlans || agentPlans.length === 0) return [];

    // Get the most recent plan
    const latestPlan = agentPlans[0];
    if (!latestPlan?.steps) return [];

    return latestPlan.steps.map((step: any, idx: number) => ({
      id: `${latestPlan._id}-${idx}`,
      name: step.name,
      status: step.status === 'completed' ? 'done'
        : step.status === 'in_progress' ? 'active'
          : 'queued',
    }));
  }, [agentPlans]);

  // Transform memory into constraints for ContextBar
  const contextConstraints = useMemo((): ContextConstraint[] => {
    if (!agentMemory) return [];

    // Filter for constraint-type memory entries (e.g., keys like 'constraint:*' or 'context:*')
    return agentMemory
      .filter((m: any) => m.key.startsWith('constraint:') || m.key.startsWith('context:') || m.key === 'scratchpad')
      .map((m: any) => ({
        id: m._id,
        label: m.key.replace(/^(constraint:|context:)/, ''),
        value: m.content.length > 30 ? m.content.slice(0, 30) + '...' : m.content,
        type: m.key.startsWith('constraint:') ? 'rule' as const : 'custom' as const,
      }));
  }, [agentMemory]);

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
        : (["chat", "sources", "telemetry", "trace"] as const);
      if (allowed.includes(requestedTab as any)) {
        setActiveTab(requestedTab as PanelTab);
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
    chatMode === "agent-streaming" && !isProductConversationMode ? {} : "skip",
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
    if (runStatus && runStatus !== "running" && runStatus !== "scheduled") {
      return false;
    }
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
    if (runStatus === "completed" || runStatus === "failed" || runStatus === "cancelled") {
      setIsStreaming(false);
    }
  }, [isProductConversationMode, productConversation.streaming.isStreaming, streamingThread?.runStatus]);

  const isBusy = isStreaming || isGenerating || isDemoThinking;

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
    // In guest mode with demo messages, render those instead of (empty) backend messages
    if (!isAuthenticated && demoMessages.length > 0) {
      return demoMessages.map((m) => ({
        role: m.role,
        text: m.text,
        content: m.text,
        status: m.status,
        key: m.key,
        parts: [{ type: 'text' as const, text: m.text }],
        _demoSources: m.sources,
        _demoKeyInsight: m.keyInsight,
      }));
    }
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
  }, [chatMode, streamingMessages, agentMessages, isAuthenticated, demoMessages, isProductConversationMode, productMessagesToRender]);

  // Auto-title from first exchange (must be after messagesToRender)
  const autoTitle = useMemo(() => {
    if (!messagesToRender || messagesToRender.length === 0) return null;
    const firstUser = messagesToRender.find((m: any) => m.role === 'user');
    const firstAI = messagesToRender.find((m: any) => m.role === 'assistant');
    if (!firstUser) return null;
    const userText = (firstUser.text || firstUser.content || '').slice(0, 40);
    const aiText = firstAI ? (firstAI.text || firstAI.content || '').slice(0, 30) : '';
    const topic = userText.split(/[.?!]/)[0].trim();
    return topic || null;
  }, [messagesToRender]);

  // Multi-turn context indicator
  const contextWindowMsgs = useMemo(() => {
    if (!messagesToRender || messagesToRender.length === 0) return { inContext: 0, total: 0 };
    const totalTokens = messagesToRender.reduce((s: number, m: any) => s + Math.ceil((m.text || m.content || '').length / 4), 0);
    const maxTokens = 128000;
    let runningTokens = 0;
    let inContext = 0;
    for (let i = messagesToRender.length - 1; i >= 0; i--) {
      const t = Math.ceil((messagesToRender[i].text || messagesToRender[i].content || '').length / 4);
      if (runningTokens + t > maxTokens) break;
      runningTokens += t;
      inContext++;
    }
    return { inContext, total: messagesToRender.length };
  }, [messagesToRender]);

  // Reply-to message lookup
  const replyToMsg = useMemo(() => {
    if (!replyToMsgId || !messagesToRender) return null;
    return messagesToRender.find((m: any) => (m._id || m.id || m.key) === replyToMsgId) || null;
  }, [replyToMsgId, messagesToRender]);

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

  // Streaming stats useEffect (must be after messagesToRender)
  useEffect(() => {
    if (isBusy && messagesToRender && messagesToRender.length > 0) {
      const lastMsg = messagesToRender[messagesToRender.length - 1] as any;
      if (lastMsg?.role === 'assistant' && lastMsg?.status === 'streaming') {
        const text = lastMsg.text || lastMsg.content || '';
        if (streamingStats.startTime === 0) {
          setStreamingStats(prev => ({ ...prev, startTime: Date.now() }));
        }
        if (text.length > 0 && !streamingStats.firstTokenTime) {
          setStreamingStats(prev => ({ ...prev, firstTokenTime: Date.now() }));
        }
        const tokens = Math.ceil(text.length / 4);
        const elapsed = (Date.now() - (streamingStats.firstTokenTime || Date.now())) / 1000;
        const tps = elapsed > 0.5 ? Math.round(tokens / elapsed) : 0;
        setStreamingStats(prev => ({ ...prev, tokenCount: tokens, tokensPerSec: tps }));
        prevStreamingTextRef.current = text;
      }
    } else if (!isBusy && streamingStats.startTime > 0) {
      setTimeout(() => setStreamingStats({ startTime: 0, firstTokenTime: null, tokenCount: 0, tokensPerSec: 0 }), 3000);
    }
  }, [isBusy, messagesToRender, streamingStats.startTime, streamingStats.firstTokenTime]);

  // Conversation snapshot save (must be after messagesToRender + autoTitle)
  const saveSnapshot = useCallback(() => {
    if (!messagesToRender || messagesToRender.length === 0) { toast.error('No messages to snapshot'); return; }
    const snap = { id: `snap_${Date.now()}`, name: autoTitle || 'Snapshot', messageCount: messagesToRender.length, createdAt: Date.now() };
    const snapsData = JSON.parse(localStorage.getItem('fa_snap_data') || '{}');
    snapsData[snap.id] = messagesToRender.map((m: any) => ({ role: m.role, text: m.text || m.content || '' }));
    localStorage.setItem('fa_snap_data', JSON.stringify(snapsData));
    setSnapshots(prev => {
      const updated = [snap, ...prev].slice(0, 20);
      localStorage.setItem('fa_snapshots', JSON.stringify(updated));
      return updated;
    });
    toast.success('Snapshot saved');
  }, [messagesToRender, autoTitle]);

  // Performance metrics useEffect (must be after isBusy)
  useEffect(() => {
    if (isBusy && responseStartRef.current === 0) {
      responseStartRef.current = Date.now();
    } else if (!isBusy && responseStartRef.current > 0) {
      const elapsed = Date.now() - responseStartRef.current;
      responseStartRef.current = 0;
      setPerfMetrics(prev => {
        const times = [...prev.responseTimes, elapsed].slice(-50);
        const sorted = [...times].sort((a, b) => a - b);
        const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || avg;
        return { responseTimes: times, avgLatency: avg, p95Latency: p95 };
      });
    }
  }, [isBusy]);

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
    if (!isAuthenticated) {
      toast.info("Sign in to cancel generation.");
      return;
    }

    try {
      await requestStreamCancel({ threadId: activeThreadId as Id<"chatThreadsStream"> });
    } catch (err) {
      console.error("[FastAgentPanel] Failed to cancel stream:", err);
      toast.error("Failed to cancel");
    } finally {
      setIsStreaming(false);
    }
  }, [activeThreadId, chatMode, isAuthenticated, isProductConversationMode, productConversation.streaming, requestStreamCancel]);

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

    const events: LiveEvent[] = [];
    let eventCounter = 0;

    const toToolName = (part: any): string => {
      if (typeof part?.toolName === "string" && part.toolName.trim()) return part.toolName.trim();
      if (typeof part?.name === "string" && part.name.trim()) return part.name.trim();

      const type = typeof part?.type === "string" ? part.type : "";
      const typed = type.match(/^tool-(?:call|result|error)-(.+)$/);
      if (typed?.[1]) return typed[1];

      const generic = type.match(/^tool-(.+)$/);
      if (generic?.[1]) return generic[1];
      return "unknown";
    };

    for (const raw of streamingMessages as any[]) {
      const msg = raw?.message ?? raw;
      const role = msg?.role ?? raw?.role;
      const parts = Array.isArray(msg?.parts) ? msg.parts : Array.isArray(raw?.parts) ? raw.parts : [];
      if (role !== "assistant" || parts.length === 0) continue;

      const baseTimestamp =
        typeof raw?._creationTime === "number"
          ? raw._creationTime
          : typeof msg?._creationTime === "number"
            ? msg._creationTime
            : Date.now();

      for (const part of parts) {
        const partType = typeof part?.type === "string" ? part.type : "";
        const isResult = partType === "tool-result" || partType.startsWith("tool-result");
        const isError = partType === "tool-error" || partType.startsWith("tool-error");
        const isCall =
          !isResult &&
          !isError &&
          (partType === "tool-call" || partType.startsWith("tool-"));
        if (!isCall && !isResult && !isError) continue;

        const toolName = toToolName(part);
        const title = toolName;
        const toolCallId =
          typeof part?.toolCallId === "string" && part.toolCallId.trim() ? part.toolCallId.trim() : null;
        const idBase = toolCallId ?? raw?._id ?? raw?.id ?? msg?._id ?? msg?.id ?? "msg";
        const timestamp = baseTimestamp + eventCounter;
        eventCounter += 1;

        const resultText = part?.output ?? part?.result;
        const errorText = part?.error ?? part?.output ?? part?.result;

        events.push({
          id: `${idBase}-${eventCounter}`,
          type: isError ? "tool_error" : isResult ? "tool_end" : "tool_start",
          status: isError ? "error" : isResult ? "success" : "running",
          title,
          toolName,
          details:
            isResult && resultText
              ? typeof resultText === "string"
                ? String(resultText).slice(0, 160)
                : "Completed"
              : isError && errorText
                ? String(errorText).slice(0, 160)
                : isCall
                  ? "Executing..."
                  : undefined,
          timestamp,
        });
      }
    }

    return events;
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

  // For agent mode, use the regular messages
  // For streaming mode, we use streamingMessages directly (UIMessage format)
  const messages = agentMessages;

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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveThinking, liveToolCalls]);

  // Persist chat mode to localStorage
  useEffect(() => {
    localStorage.setItem('fastAgentPanel.chatMode', chatMode);
  }, [chatMode]);

  // Persist minimize mode to localStorage
  useEffect(() => {
    localStorage.setItem('fastAgentPanel.isMinimized', String(isMinimized));
  }, [isMinimized]);

  // Reset active thread when switching chat modes
  useEffect(() => {
    setActiveThreadId(null);
    toast.info(`Switched to ${chatMode === 'agent' ? 'Agent' : 'Agent Streaming'} mode`);
  }, [chatMode]);

  // Live events are derived from streaming messages (no state updates; avoids render loops).

  // Client no longer triggers workflows directly; coordinator handles routing via useCoordinator: true

  // ========== HANDLERS ==========

  const handleCreateThread = useCallback(async () => {
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
          model: selectedModel,
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
  }, [anonymousSession.sessionId, chatMode, createStreamingThread, isProductConversationMode, productConversation, selectedModel]);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    if (isProductConversationMode) {
      toast.info('Product chat sessions can be revisited from Reports. Delete is not enabled here yet.');
      return;
    }
    try {
      if (chatMode === 'agent') {
        await deleteAgentThread({ threadId });
      } else {
        await deleteStreamingThread({ threadId: threadId as Id<"chatThreadsStream"> });
      }

      // If deleted thread was active, select another
      if (activeThreadId === threadId) {
        const remainingThreads = (threads ?? []).filter((t) => t._id !== threadId);
        setActiveThreadId(remainingThreads[0]?._id ?? null);
      }

      toast.success('Conversation deleted');
    } catch (error) {
      console.error('Failed to delete thread:', error);
      toast.error('Failed to delete conversation');
    }
  }, [activeThreadId, threads, chatMode, deleteAgentThread, deleteStreamingThread, isProductConversationMode]);

  const handleExportThread = useCallback((threadId: string) => {
    setExportingThreadId(threadId);
  }, []);

  const handleSendMessage = useCallback(async (content?: string) => {
    if (isBusy) return;

    const preparedSubmission = prepareFastAgentSubmission({
      allowAttachments: isProductConversationMode && isAuthenticated,
      attachedFiles,
      content,
      contextDocuments,
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

    const {
      consumedContextDocumentIds,
      messageContent,
      text,
    } = preparedSubmission;

    // Guest/demo mode intercept: play scripted or fallback response
    if (!isAuthenticated) {
      const demo = findDemoConversation(text);
      trackEvent("demo_conversation_start", { prompt: text.slice(0, 100) });
      playDemoConversation(demo ?? GUEST_FALLBACK_RESPONSE, text);
      return;
    }

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
          <div className="text-xs">Sign in for unlimited access!</div>
        </div>
      );
      return;
    }

    // Check if this is a document creation request
    const docCreationMatch = text.match(/^(?:make|create)\s+(?:new\s+)?document\s+(?:about|on|for)\s+(.+)$/i);

    if (docCreationMatch && chatMode === 'agent-streaming' && !isProductConversationMode) {
      const topic = docCreationMatch[1];

      setInput('');
      setIsStreaming(true);

      try {
        // Get or create thread
        let threadId = activeThreadId;
        if (!threadId) {
          const streamingThread = await createStreamingThread({
            title: `Create document about ${topic}`,
            model: selectedModel,
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
    setLiveTokens("");
    setLiveAgents([]);
    setIsStreaming(true);

    // Clear only document context that was actually included. Documents still being
    // analyzed remain visible and cannot be silently dropped by an unrelated send.
    if (consumedContextDocumentIds.length > 0) {
      const consumedDocumentIds = new Set(consumedContextDocumentIds);
      setContextDocuments((current) =>
        current.filter((document) => !consumedDocumentIds.has(document.id)),
      );
    }
    setContextCalendarEvents([]);

    // Clear live state
    setLiveThinking([]);
    setLiveToolCalls([]);
    setLiveSources([]);

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
          selectedModel,
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
            model: selectedModel,
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
          arbitrageEnabled,
          chatMode,
          clientContext,
          continueThreadAction,
          createThreadWithMessage,
          entitySlug: productEntitySlug ?? undefined,
          messageContent,
          selectedModel,
          sendStreamingMessage,
          streamThreadId: threadId as Id<"chatThreadsStream">,
        });

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
    fastMode,
    selectedModel,
    arbitrageEnabled,
    attachedFiles,
    chatMode,
    isProductConversationMode,
    productConversation,
    productLens,
    selectedDocumentIds,
    contextDocuments,
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
    playDemoConversation,
    anonymousSession,
    oracleSession,
    productEntitySlug,
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
          <div className="text-xs">Sign in for unlimited access!</div>
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
      });
      toast.success('Message deleted');
    } catch (err) {
      console.error('[FastAgentPanel] Failed to delete message:', err);
      toast.error('Failed to delete message');
    }
  }, [activeThreadId, chatMode, deleteMessage, isProductConversationMode]);

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
        model: selectedModel,
        useCoordinator: true,
        clientContext,
        entitySlug: productEntitySlug ?? undefined,
      });
      toast.success('Regenerating response...');
    } catch (err) {
      console.error('[FastAgentPanel] Failed to regenerate:', err);
      toast.error('Failed to regenerate response');
    }
  }, [activeThreadId, chatMode, isProductConversationMode, messagesToRender, productConversation, productLens, selectedModel, sendStreamingMessage, streamingMessages, productEntitySlug]);

  // Handle manual Mermaid diagram retry
  const handleMermaidRetry = useCallback(async (error: string, code: string) => {
    // ... (existing implementation)
  }, [chatMode, activeThreadId, sendStreamingMessage, selectedModel]);

  // Handle company/person/event/news selection
  const handleCompanySelect = useCallback(async (company: any) => {
    // ... (existing implementation)
  }, [chatMode, activeThreadId, sendStreamingMessage, selectedModel]);

  const handlePersonSelect = useCallback(async (person: any) => {
    // ... (existing implementation)
  }, [chatMode, activeThreadId, sendStreamingMessage, selectedModel]);

  const handleEventSelect = useCallback(async (event: any) => {
    // ... (existing implementation)
  }, [chatMode, activeThreadId, sendStreamingMessage, selectedModel]);

  const handleNewsSelect = useCallback(async (article: any) => {
    // ... (existing implementation)
  }, [chatMode, activeThreadId, sendStreamingMessage, selectedModel]);

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
  // R4: Inline action button handlers
  const handleSendFollowUp = useCallback((text: string) => {
    setInput(text);
    void stableSendMessage(text);
  }, [stableSendMessage]);

  const handleSaveAsMemo = useCallback((messageText: string) => {
    // Navigate to shareable memo with the message content
    const encoded = encodeURIComponent(messageText.slice(0, 2000));
    navigate(`/memo/demo?content=${encoded}`);
  }, [navigate]);

  const handleShareMessage = useCallback((messageText: string) => {
    const shareUrl = `${window.location.origin}/memo/demo?content=${encodeURIComponent(messageText.slice(0, 2000))}`;
    navigator.clipboard.writeText(shareUrl);
  }, []);

  const messageHandlers = useMemo(() => ({
    onCompanySelect: handleCompanySelect,
    onPersonSelect: handlePersonSelect,
    onEventSelect: handleEventSelect,
    onNewsSelect: handleNewsSelect,
    onDocumentSelect: handleDocumentSelect,
    onRegenerateMessage: handleRegenerateMessage,
    onDeleteMessage: handleDeleteMessage,
    onSendFollowUp: handleSendFollowUp,
    onSaveAsMemo: handleSaveAsMemo,
    onShareMessage: handleShareMessage,
  }), [handleCompanySelect, handlePersonSelect, handleEventSelect, handleNewsSelect, handleDocumentSelect, handleRegenerateMessage, handleDeleteMessage, handleSendFollowUp, handleSaveAsMemo, handleShareMessage]);

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

  // Shared conversation link
  const shareConversation = useCallback(() => {
    const md = conversationToMarkdown?.();
    if (md) {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      navigator.clipboard.writeText(url);
      toast.success('Conversation link copied to clipboard');
    } else {
      toast.error('No conversation to share');
    }
  }, [conversationToMarkdown]);

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

  // Artifact extraction helpers
  const assistantTexts = useMemo(() => {
    if (!messagesToRender) return [] as string[];

    return messagesToRender
      .filter((msg: any) => (msg.role ?? msg?.message?.role) === 'assistant')
      .map((msg: any) => {
        return extractAssistantMessageText(msg) || '';
      })
      .filter(Boolean);
  }, [messagesToRender]);

  const aggregatedMedia = useMemo<ExtractedMedia>(() => {
    const base: ExtractedMedia = { youtubeVideos: [], secDocuments: [], webSources: [], profiles: [], images: [] };

    const dedupe = <T,>(items: T[], getKey: (item: T) => string | undefined) => {
      const map = new Map<string, T>();
      items.forEach((item) => {
        const key = getKey(item);
        if (!key) return;
        if (!map.has(key)) map.set(key, item);
      });
      return Array.from(map.values());
    };

    const collected = assistantTexts.reduce((acc: typeof base, text: string) => {
      const media = extractMediaFromText(text);
      acc.youtubeVideos.push(...media.youtubeVideos);
      acc.secDocuments.push(...media.secDocuments);
      acc.webSources.push(...media.webSources);
      acc.profiles.push(...media.profiles);
      acc.images.push(...media.images);
      return acc;
    }, base);

    return {
      youtubeVideos: dedupe(collected.youtubeVideos, (v: any) => v.url || v.videoId),
      secDocuments: dedupe(collected.secDocuments, (doc: any) => doc.accessionNumber || doc.documentUrl),
      webSources: dedupe(collected.webSources, (source: any) => source.url || source.title),
      profiles: dedupe(collected.profiles, (profile: any) => profile.url || profile.name),
      images: dedupe(collected.images, (img: any) => img.url),
    };
  }, [assistantTexts]);

  const aggregatedDocumentActions = useMemo<DocumentAction[]>(() => {
    const dedupe = (docs: DocumentAction[]) => {
      const map = new Map<string, DocumentAction>();
      docs.forEach((doc) => {
        if (!map.has(doc.documentId)) map.set(doc.documentId, doc);
      });
      return Array.from(map.values());
    };

    const docs = assistantTexts.flatMap((text: string) => extractDocumentActions(text));
    return dedupe(docs);
  }, [assistantTexts]);

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
        model: msg.model || selectedModel,
      };
    });
  }, [messagesToRender, activeThreadId, selectedModel]);

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
          isStreaming={isStreaming}
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={(id) => { setActiveThreadId(id); setIsMinimized(false); }}
          onNewChat={() => { setActiveThreadId(null); setDemoMessages([]); localStorage.removeItem('nodebench-agent-chat'); setIsMinimized(false); }}
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
          highContrast && 'high-contrast',
          isCompactSidebar
            ? "border-0 bg-white shadow-none dark:bg-[#11161c]"
            : "border-l border-gray-200 bg-white shadow-[0_20px_70px_-50px_rgba(15,23,42,0.34)] dark:border-white/[0.08] dark:bg-[#11161c] dark:shadow-[0_26px_90px_-58px_rgba(0,0,0,0.82)]",
        )}
        style={{ fontSize: `${fontSize}px` }}
        role="complementary"
        aria-label="AI Chat Panel"
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setIsDragOver(false); }}
      >
        {/* Skip to content link (a11y) */}
        <a href="#fa-chat-input" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:bg-indigo-600 focus:text-white focus:px-3 focus:py-1.5 focus:rounded focus:text-xs">
          Skip to chat input
        </a>

        {/* Simplified Header */}
        <PanelHeader
          isCompactSidebar={isCompactSidebar}
          isStreaming={isStreaming}
          isSwarmActive={isSwarmActive}
          swarmTasks={swarmTasks}
          isAuthenticated={isAuthenticated}
          activeThreadId={activeThreadId}
          messagesToRender={messagesToRender}
          threads={threads}
          selectedModel={selectedModel}
          systemPrompt={systemPrompt}
          isFocusMode={isFocusMode}
          isWideMode={isWideMode}
          liveEvents={liveEvents}
          personas={personas}
          activePersona={activePersona}
          anonymousSession={anonymousSession}
          setActiveThreadId={setActiveThreadId}
          setInput={setInput}
          setAttachedFiles={setAttachedFiles}
          setShowOverflowMenu={setShowOverflowMenu}
          setShowEventsPanel={setShowEventsPanel}
          setShowSkillsPanel={setShowSkillsPanel}
          setShowSystemPrompt={setShowSystemPrompt}
          setShowAnalytics={setShowAnalytics}
          setShowTimeline={setShowTimeline}
          setIsFocusMode={setIsFocusMode}
          setIsWideMode={setIsWideMode}
          setIsMinimized={setIsMinimized}
          setActivePersona={setActivePersona}
          setShowPersonaPicker={setShowPersonaPicker}
          showOverflowMenu={showOverflowMenu}
          showPersonaPicker={showPersonaPicker}
          onClose={onClose}
          onClearChat={() => {
            setDemoMessages([]);
            localStorage.removeItem('nodebench-agent-chat');
          }}
          handleCopyAsMarkdown={handleCopyAsMarkdown}
          handleDownloadMarkdown={handleDownloadMarkdown}
          appendToSignalsLog={appendToSignalsLog}
          showOpenInChat={isProductConversationMode}
          onOpenInChat={openCurrentConversationInChat}
        />

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
        <div className={cn(
          "flex items-center border-b border-edge/50",
          isCompactSidebar
            ? "mx-4 mt-3 rounded-full border border-gray-200 bg-gray-50/90 p-1 dark:border-white/[0.08] dark:bg-white/[0.03]"
            : "px-3",
          isFocusMode && "hidden"
        )}>
          {(showsNotebookWorkspaceTabs
            ? ([
                { id: 'chat', label: 'Chat' },
                { id: 'scratchpad', label: 'Scratchpad' },
                { id: 'flow', label: 'Flow' },
              ] as const)
            : ([
                { id: 'chat', label: 'Answer' },
                { id: 'sources', label: 'Sources' },
              ] as const)
          ).map((tab) => (
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
          {/* Overflow menu for power-user tabs */}
          {!showsNotebookWorkspaceTabs && !isCompactSidebar && <div className="relative ml-auto group">
            <button
              type="button"
              className="px-2 py-2 text-xs text-content-secondary hover:text-content transition-colors"
              aria-label="More views"
            >
              ···
            </button>
            <div className="absolute right-0 top-full mt-1 bg-surface border border-edge rounded-lg shadow-lg py-1 min-w-[120px] hidden group-hover:block z-50">
              {([
                { id: 'trace', label: 'Activity' },
                { id: 'telemetry', label: 'Performance' },
              ] as const).map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${activeTab === tab.id
                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-600/5'
                    : 'text-content-secondary hover:text-content hover:bg-surface-secondary'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>}
        </div>

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
                onSelectThread={setActiveThreadId}
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
            ) : activeTab === 'telemetry' ? (
              <TaskManagerView isPublic={false} className="h-full" />
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
                        {liveEvents.slice(-5).map((event) => (
                          <div key={event.id} className="flex items-center gap-2 py-1 text-xs">
                            {event.status === 'running' ? (
                              <Loader2 className="w-3 h-3 motion-safe:animate-spin text-violet-500" />
                            ) : event.status === 'success' ? (
                              <div className="w-3 h-3 rounded-full bg-indigo-100 flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                              </div>
                            ) : (
                              <div className="w-3 h-3 rounded-full bg-amber-100 flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              </div>
                            )}
                            <span className="text-content-secondary truncate flex-1">
                              {event.title || event.toolName || event.type.replace(/_/g, ' ')}
                            </span>
                            {event.duration && (
                              <span className="text-xs text-content-muted">{event.duration}ms</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Scroll progress bar */}
                {scrollProgress > 0.01 && scrollProgress < 0.99 && (
                  <div className="h-[2px] bg-surface-secondary flex-shrink-0">
                    <div className="h-full bg-indigo-600 transition-all duration-100" style={{ width: `${scrollProgress * 100}%` }} />
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

                  {/* Conversation Memory Chips */}
                  {activeThreadId && messagesToRender && messagesToRender.length > 2 && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      <span className="text-xs font-medium text-content-muted mr-1">Context:</span>
                      {(() => {
                        const topics = new Set<string>();
                        messagesToRender.slice(0, 6).forEach((m: any) => {
                          const t = (m.text || m.content || '').slice(0, 200);
                          const words = t.split(/\s+/).filter((w: string) => w.length > 5 && /^[A-Z]/.test(w));
                          words.slice(0, 2).forEach((w: string) => topics.add(w.replace(/[^a-zA-Z]/g, '')));
                        });
                        return Array.from(topics).slice(0, 4).map(topic => (
                          <span key={topic} className="px-2 py-0.5 text-xs font-medium bg-surface-secondary border border-edge rounded-full text-content-secondary">
                            {topic}
                          </span>
                        ));
                      })()}
                      <span className="px-2 py-0.5 text-xs font-medium bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-full text-violet-600 dark:text-violet-400">
                        {selectedModel}
                      </span>
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

                  {/* Empty State - Branding + Quick Actions */}
                  {!activeThreadId && (!messagesToRender || messagesToRender.length === 0) && (
                    <div className="flex-1 flex flex-col overflow-y-auto">
                      <div className="mx-auto flex w-full max-w-[440px] flex-col items-center justify-center px-4 pb-8 pt-10 text-center">
                        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300">
                          <MessageSquare className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          Workspace chat
                        </div>
                        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-content">
                          Ask directly or pick a starting point
                        </h2>
                        <p className="mt-2 max-w-[360px] text-[13px] leading-6 text-content-muted">
                          Same conversation feel as the chat page, with recent threads and workspace context close at hand.
                        </p>

                       <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                         {[
                           { label: 'What gaps do I have before pitching?', icon: '🎯' },
                           { label: 'Should I build or find a partner?', icon: '🏗️' },
                           { label: 'Give me my weekly founder reset', icon: '📋' },
                           { label: 'What have competitors shipped?', icon: '🔍' },
                         ].map((chip) => (
                           <button
                             key={chip.label}
                             type="button"
                             onClick={() => {
                               if (!isAuthenticated) {
                                 const demo = findDemoConversation(chip.label);
                                 if (demo) {
                                   playDemoConversation(demo, chip.label);
                                   return;
                                 }
                               }
                               setInput(chip.label);
                             }}
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

                      {/* Swarm Quick Actions — hidden for clean panel */}
                      {false && <SwarmQuickActions
                        onSpawn={async (query, agents) => {
                          try {
                            toast.info(`Starting team with ${agents.length} agents...`);
                            const result = await spawnSwarm({
                              query,
                              agents,
                              model: selectedModel,
                            });
                            setActiveThreadId(result.threadId);
                            toast.success(`Team started with ${result.taskCount} agents`);
                          } catch (error: any) {
                            console.error('[FastAgentPanel] Swarm spawn failed:', error);
                            toast.error(error.message || 'Failed to spawn swarm');
                          }
                        }}
                        className="flex-1"
                      />}
                    </div>
                  )}

                  {/* Waiting for Approval */}
                  {pendingApprovals.length > 0 && (
                    <div className="mx-2 mb-2 space-y-1.5" role="alert" aria-label="Actions waiting for your approval">
                      {pendingApprovals.map(approval => (
                        <div key={approval.id} className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${
                          approval.riskLevel === 'high' ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' :
                          approval.riskLevel === 'medium' ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' :
                          'bg-violet-50 dark:bg-violet-900/10 border-violet-200 dark:border-violet-800'
                        }`}>
                          <span className="text-base">{approval.riskLevel === 'high' ? '🔴' : approval.riskLevel === 'medium' ? '🟡' : '🟢'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-content">Tool: {approval.toolName}</div>
                            <div className="text-content-muted truncate">{JSON.stringify(approval.args).slice(0, 60)}</div>
                          </div>
                          <button type="button" onClick={() => approveToolCall(approval.id)} className="px-2 py-1 rounded bg-green-500 text-white text-xs font-medium hover:bg-green-600 transition-colors">Approve</button>
                          <button type="button" onClick={() => rejectToolCall(approval.id)} className="px-2 py-1 rounded bg-surface-secondary text-content-muted text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors">Reject</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Multi-Agent Handoff Cards */}
                  {agentHandoffs.length > 0 && (
                    <div className="mx-2 mb-2 flex gap-1.5 overflow-x-auto pb-1" role="status" aria-label="Agent handoffs">
                      {agentHandoffs.map(h => (
                        <div key={h.id} className={`flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs ${h.status === 'active' ? 'bg-violet-50 dark:bg-violet-900/10 border-violet-200 dark:border-violet-800' : 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${h.status === 'active' ? 'bg-violet-500 motion-safe:animate-pulse' : 'bg-green-500'}`} />
                          <span className="font-medium text-content">{h.fromAgent}</span>
                          <span className="text-content-muted">→</span>
                          <span className="font-medium text-content">{h.toAgent}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <MessageHandlersProvider handlers={messageHandlers}>
                    <VirtualizedMessageList
                      messages={messagesToRender ?? []}
                      getMessageKey={(msg: any) => msg._id || msg.id || `msg-${msg.key}`}
                      renderMessage={(message: any) => (
                        <div onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, msgId: message._id || message.id || message.key, role: message.role }); }}>
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
                            onEditMessage={(newText: string) => {
                              void stableSendMessage(newText);
                            }}
                            searchHighlight={searchQuery || undefined}
                            isBookmarked={bookmarkedIds.has(message._id || message.id || message.key)}
                            onToggleBookmark={() => toggleBookmark(message._id || message.id || message.key)}
                            isMessagePinned={pinnedMsgIds.has(message._id || message.id || message.key)}
                            onTogglePin={() => togglePinMsg(message._id || message.id || message.key)}
                            feedbackVote={feedbackMap[message._id || message.id || message.key] || null}
                            onFeedback={(vote) => handleFeedback(message._id || message.id || message.key, vote)}
                            fontSize={fontSize}
                            editDiff={editDiffs[message._id || message.id || message.key] || null}
                            compact={isCompactSidebar}
                            isInContext={(() => {
                              if (!messagesToRender) return true;
                              const idx = messagesToRender.indexOf(message);
                              const startIdx = messagesToRender.length - contextWindowMsgs.inContext;
                              return idx >= startIdx;
                            })()}
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
                          {/* Demo source badges + key insight */}
                          {message._demoSources && message._demoSources.length > 0 && message.role === 'assistant' && message.status === 'complete' && (
                            <div className="ml-10 mt-1.5 mb-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
                              <div className="flex flex-wrap gap-1.5 mb-1.5">
                                {message._demoSources.map((src: { label: string; type: string }, i: number) => (
                                  <span
                                    key={i}
                                    className={cn(
                                      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium",
                                      src.type === 'code' && "bg-blue-500/10 text-blue-400 border border-blue-500/20",
                                      src.type === 'docs' && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                                      src.type === 'data' && "bg-amber-500/10 text-amber-400 border border-amber-500/20",
                                    )}
                                  >
                                    {src.type === 'code' ? '{ }' : src.type === 'docs' ? '\u{1F4D6}' : '\u{1F4CA}'} {src.label}
                                  </span>
                                ))}
                              </div>
                              {message._demoKeyInsight && (
                                <p className="text-[11px] text-content-muted italic leading-relaxed">
                                  Key insight: {message._demoKeyInsight}
                                </p>
                              )}
                            </div>
                          )}
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
                        const el = document.querySelector<HTMLTextAreaElement>('[placeholder="Message..."]');
                        el?.focus();
                      }, 20);
                    }}
                    onAskAbout={(text) => {
                      setInput(`What about this: "${text}"?`);
                      setTimeout(() => {
                        const el = document.querySelector<HTMLTextAreaElement>('[placeholder="Message..."]');
                        el?.focus();
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
                      <div className="text-xs text-violet-500 pl-5">
                        Position in queue: 1 (Estimated wait: &lt; 5s)
                      </div>
                    </div>
                  )}

                  {/* Demo thinking indicator (guest mode) */}
                  {isDemoThinking && (
                    <div className="flex items-center gap-2 px-4 mb-4 animate-in fade-in duration-normal">
                      <div className="typing-dots">
                        <span className="dot" />
                        <span className="dot" />
                        <span className="dot" />
                      </div>
                    </div>
                  )}

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

                  {/* Follow-up suggestion chips (shown after last assistant message, not while streaming) */}
                  {!isCompactSidebar && !isBusy && messagesToRender && messagesToRender.length > 0 && (() => {
                    const lastMsg = messagesToRender[messagesToRender.length - 1];
                    if (lastMsg?.role !== 'assistant') return null;
                    const txt = (lastMsg.text || lastMsg.content || '').slice(0, 600);
                    if (!txt || txt.length < 30) return null;
                    // Extract key noun phrases for follow-up suggestions
                    const sentences = txt.split(/[.!?\n]+/).filter((s: string) => s.trim().length > 10);
                    const suggestions: string[] = [];
                    if (sentences.length > 0) suggestions.push(`Tell me more about ${sentences[0].trim().split(/\s+/).slice(0, 5).join(' ')}...`);
                    if (sentences.length > 1) suggestions.push(`How does this compare to alternatives?`);
                    if (txt.length > 200) suggestions.push(`Summarize the key takeaways`);
                    if (suggestions.length === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-2 px-4 pb-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {suggestions.slice(0, 3).map((s, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => { setInput(s); void stableSendMessage(s); }}
                            className="text-xs px-3 py-1.5 rounded-full border border-edge bg-surface-secondary text-content-secondary hover:bg-surface-secondary hover:text-content hover:border-indigo-500/30 transition-all"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  <div ref={messagesEndRef} />
                </div>

                {/* Auto-scroll paused "New messages" pill */}
                {isAutoScrollPaused && isBusy && (
                  <button
                    type="button"
                    onClick={() => {
                      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                      setIsAutoScrollPaused(false);
                    }}
                    className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-full shadow-lg hover:bg-violet-700 transition-colors animate-in fade-in slide-in-from-bottom-2"
                  >
                    ↓ New messages
                  </button>
                )}

                {/* Conversation Minimap (right edge) */}
                {messagesToRender && messagesToRender.length > 4 && (
                  <div className="absolute right-1 top-2 bottom-2 w-[6px] z-20 opacity-0 hover:opacity-100 transition-opacity duration-300">
                    {messagesToRender.map((msg: any, idx: number) => {
                      const isUser = msg.role === 'user';
                      const charLen = (msg.text || msg.content || '').length;
                      const totalChars = messagesToRender.reduce((s: number, m: any) => s + (m.text || m.content || '').length, 0);
                      const heightPct = Math.max(2, (charLen / Math.max(1, totalChars)) * 100);
                      return (
                        <div
                          key={idx}
                          className="w-full rounded-sm cursor-pointer hover:brightness-125 transition-all"
                          style={{
                            height: `${heightPct}%`,
                            background: isUser ? '#3b82f6' : '#22c55e',
                            opacity: 0.5,
                            marginBottom: '1px',
                          }}
                          title={`${isUser ? 'You' : 'AI'}: ${(msg.text || msg.content || '').slice(0, 50)}`}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Scroll-to-bottom FAB (Claude/ChatGPT pattern) */}
                {showScrollFab && (
                  <button
                    type="button"
                    onClick={() => {
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

            {/* Anonymous User Banner — minimized for clean panel */}
            {false && anonymousSession.isAnonymous && !anonymousSession.isLoading && (
              <div className={`mx-3 mt-2 px-3 py-2.5 rounded-lg border ${anonymousSession.canSendMessage
                ? 'bg-gradient-to-r from-violet-50/80 to-indigo-50/80 border-violet-200/50'
                : 'bg-gradient-to-r from-amber-50/80 to-orange-50/80 border-amber-200/50'
                }`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2.5">
                    {anonymousSession.canSendMessage ? (
                      <>
                        <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center">
                          <MessageSquare className="w-3.5 h-3.5 text-violet-600" />
                        </div>
                        <span className="text-[12px] text-content-secondary">
                          <span className="font-semibold text-content">{anonymousSession.remaining}</span>
                          {' '}of {anonymousSession.limit} free messages remaining today
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                          <LogIn className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <span className="text-[12px] text-content-secondary">
                          Daily limit reached. Sign in for unlimited access!
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void signIn("google", {
                        redirectTo: typeof window !== "undefined" ? window.location.href : "/",
                      })
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)] transition-colors shadow-sm"
                  >
                    <LogIn className="w-3 h-3" />
                    Sign in
                  </button>
                </div>
              </div>
            )}

            {/* Quick Actions Toolbar */}
            {!isCompactSidebar && messagesToRender && messagesToRender.length > 0 && !isBusy && (
              <div className="flex items-center gap-1 px-3 pt-1.5">
                <span className="text-[8px] text-content-muted mr-1">Quick:</span>
                {[
                  { label: 'Summarize', action: 'Summarize the conversation so far in 3 bullet points' },
                  { label: 'Simplify', action: 'Explain your last response in simpler terms' },
                  { label: 'Expand', action: 'Expand on your last point with more detail and examples' },
                  { label: 'Translate', action: 'Translate your last response to Spanish' },
                ].map((qa, i) => (
                  <button
                    key={i}
                    type="button"
                    className="text-xs px-2 py-0.5 rounded-md bg-surface-secondary border border-edge text-content-muted hover:text-content hover:bg-surface-hover transition-colors"
                    onClick={() => { setInput(qa.action); }}
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            )}

            {/* Focus Mode + Tone Picker Chips */}
            {!isCompactSidebar && <div className="flex items-center gap-1.5 px-3 pt-1">
              {/* Focus Mode Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowFocusPicker(p => !p)}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-surface-secondary border border-edge text-content-muted hover:text-content transition-colors"
                  aria-label="Focus mode"
                >
                  {FOCUS_MODES.find(m => m.id === focusMode)?.icon} {FOCUS_MODES.find(m => m.id === focusMode)?.label}
                </button>
                {showFocusPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowFocusPicker(false)} />
                    <div className="absolute bottom-full left-0 mb-1 z-50 bg-surface border border-edge rounded-lg shadow-xl overflow-hidden">
                      {FOCUS_MODES.map(mode => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => { setFocusMode(mode.id); setShowFocusPicker(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface-secondary text-left transition-colors ${focusMode === mode.id ? 'bg-surface-secondary font-semibold' : ''}`}
                        >
                          <span>{mode.icon}</span>
                          <span>{mode.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Tone Preset Chips */}
              {TONE_PRESETS.map(tone => (
                <button
                  key={tone.id}
                  type="button"
                  onClick={() => setTonePreset(tone.id)}
                  className={`text-xs px-1.5 py-0.5 rounded-md border transition-colors ${tonePreset === tone.id ? 'bg-indigo-600/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'bg-transparent border-transparent text-content-muted hover:text-content'}`}
                  title={`Tone: ${tone.label}`}
                >
                  {tone.icon}
                </button>
              ))}
            </div>}

            {/* Follow-up Suggestion Chips */}
            {!isCompactSidebar && messagesToRender && messagesToRender.length > 0 && !isBusy && (() => {
              const lastMsg = messagesToRender[messagesToRender.length - 1] as any;
              if (!lastMsg || lastMsg.role === 'user') return null;
              const text = (lastMsg.text || lastMsg.content || '').slice(0, 300).toLowerCase();
              const suggestions: string[] = [];
              if (text.includes('financ') || text.includes('revenue') || text.includes('earning')) {
                suggestions.push('Compare to competitors', 'Show quarterly trends', 'Break down by segment');
              } else if (text.includes('research') || text.includes('study') || text.includes('paper')) {
                suggestions.push('Find related papers', 'Summarize key findings', 'What are the limitations?');
              } else if (text.includes('code') || text.includes('function') || text.includes('implement')) {
                suggestions.push('Add error handling', 'Write tests', 'Optimize performance');
              } else {
                suggestions.push('Tell me more', 'Give me examples', 'What are the alternatives?');
              }
              return (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="smart-action-chip text-xs"
                      onClick={() => { setInput(s); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Reply-To Indicator */}
            {replyToMsg && (
              <div className="mx-3 mt-1 px-3 py-1.5 rounded-t-lg border border-b-0 border-edge bg-surface-secondary flex items-center gap-2">
                <div className="w-0.5 h-6 rounded-full bg-indigo-600" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-content-muted">Replying to {(replyToMsg as any).role === 'user' ? 'yourself' : 'AI'}</span>
                  <p className="text-xs text-content-secondary truncate">{((replyToMsg as any).text || (replyToMsg as any).content || '').slice(0, 80)}</p>
                </div>
                <button type="button" onClick={() => setReplyToMsgId(null)} className="text-content-muted hover:text-content text-xs">&times;</button>
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

            {/* Image Paste Preview Thumbnails */}
            {imagePreview.length > 0 && (
              <div className="mx-3 mt-1 flex items-center gap-2 flex-wrap">
                {imagePreview.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img.url} alt="" className="w-12 h-12 rounded-lg object-cover border border-edge" width={48} height={48} />
                    <button
                      type="button"
                      onClick={() => setImagePreview(prev => { URL.revokeObjectURL(prev[i].url); return prev.filter((_, j) => j !== i); })}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Remove image ${i + 1}`}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Scheduled Messages Indicator */}
            {scheduledMessages.length > 0 && (
              <div className="mx-3 mt-1 text-xs text-content-muted flex items-center gap-1">
                <span>🕐</span>
                {scheduledMessages.length} scheduled message{scheduledMessages.length > 1 ? 's' : ''} pending
              </div>
            )}

            {/* Voice Input + Input Area */}
            <div className="p-3 border-t border-edge">
              {/* Voice Input Button */}
              {!isCompactSidebar && <div className="flex items-center gap-2 mb-1.5">
                <button
                  type="button"
                  onClick={isRecording ? stopVoiceInput : startVoiceInput}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-all ${isRecording
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-300 text-red-600 motion-safe:animate-pulse'
                    : 'bg-surface-secondary border-edge text-content-muted hover:text-content'
                  }`}
                  aria-label={isRecording ? 'Stop recording' : 'Voice input'}
                >
                  {isRecording ? '⏹ Stop' : '🎙 Voice'}
                </button>
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
              {/* R6: Mobile Command Chips — always visible above input on mobile */}
              <MobileCommandChips
                onSelect={(msg) => { setInput(msg); void stableSendMessage(msg); }}
              />
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
                  onStop={handleStopStreaming}
                  selectedModel={selectedModel}
                  onSelectModel={setSelectedModel as (model: string) => void}
                  attachedFiles={attachedFiles}
                  onAttachFiles={handleAttachFiles}
                  onRemoveFile={handleRemoveFile}
                  selectedDocumentIds={selectedDocumentIds}
                  contextDocuments={contextDocuments}
                  onAddContextDocument={handleAddContextDocument}
                  onRemoveContextDocument={handleRemoveContextDocument}
                  contextCalendarEvents={contextCalendarEvents}
                  onAddCalendarEvent={handleAddCalendarEvent}
                  onRemoveCalendarEvent={handleRemoveCalendarEvent}
                  responseLength={responseLength}
                  onResponseLengthChange={setResponseLength}
                  onVoiceIntent={onVoiceIntent}
                  compact={isCompactSidebar}
                  onSpawn={async (query, agents) => {
                    try {
                      toast.info(`Starting team with ${agents.length} agents...`);
                      const result = await spawnSwarm({
                        query,
                        agents,
                        model: selectedModel,
                      });
                      // Switch to the new team thread
                      setActiveThreadId(result.threadId);
                      toast.success(`Team started with ${result.taskCount} agents`);
                    } catch (error: any) {
                      console.error('[FastAgentPanel] Swarm spawn failed:', error);
                      toast.error(error.message || 'Failed to start team');
                    }
                  }}
                />
              )}
            </div>

            {/* Simplified Status Bar */}
            {!isCompactSidebar && <div className="status-bar">
              <div className={`status-dot ${isAuthenticated ? 'connected' : 'disconnected'}`} />
              {isBusy ? (
                <span className="text-violet-500 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-violet-500 rounded-full motion-safe:animate-pulse" />
                  Working...
                </span>
              ) : (
                <span className="text-content-muted">{isAuthenticated ? 'Ready' : 'Offline'}</span>
              )}
              <span className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setShowAnalytics(true)}
                  className="opacity-40 hover:opacity-80 text-xs transition-opacity"
                  title="Analytics"
                >
                  📊
                </button>
                <button
                  type="button"
                  onClick={() => setShowTimeline(p => !p)}
                  className="opacity-40 hover:opacity-80 text-xs transition-opacity"
                  title="Conversation timeline"
                >
                  Timeline
                </button>
              </span>
            </div>}
          </div>

        </div>

        {/* Export Menu */}
        {exportingThreadId && (() => {
          const thread = threads?.find((t) => t._id === exportingThreadId);
          if (!thread) return null;

          // Convert to Thread type for ExportMenu
          const exportThread: Thread = {
            _id: thread._id,
            userId: thread.userId,
            title: thread.title,
            pinned: Boolean((thread as any).pinned),
            createdAt: (thread as any).createdAt ?? thread._creationTime,
            updatedAt: (thread as any).updatedAt ?? thread._creationTime,
            _creationTime: thread._creationTime,
            messageCount: (thread as any).messageCount,
            lastMessage: (thread as any).lastMessage,
            lastMessageAt: (thread as any).lastMessageAt,
            toolsUsed: (thread as any).toolsUsed,
            modelsUsed: (thread as any).modelsUsed,
          };

          return (
            <ExportMenu
              thread={exportThread}
              messages={uiMessages}
              onClose={() => setExportingThreadId(null)}
            />
          );
        })()}

        <PanelOverlays
          showShortcutsOverlay={showShortcutsOverlay}
          setShowShortcutsOverlay={setShowShortcutsOverlay}
          showSystemPrompt={showSystemPrompt}
          setShowSystemPrompt={setShowSystemPrompt}
          systemPrompt={systemPrompt}
          setSystemPrompt={setSystemPrompt}
          saveSystemPrompt={saveSystemPrompt}
          activeThreadId={activeThreadId}
          showQuickReplies={showQuickReplies}
          setShowQuickReplies={setShowQuickReplies}
          quickReplies={quickReplies}
          setQuickReplies={setQuickReplies}
          setInput={setInput}
          showCommandPalette={showCommandPalette}
          setShowCommandPalette={setShowCommandPalette}
          commandQuery={commandQuery}
          setCommandQuery={setCommandQuery}
          commandInputRef={commandInputRef}
          threads={threads}
          setActiveThreadId={setActiveThreadId}
          setShowSearch={setShowSearch}
          searchInputRef={searchInputRef}
          setIsFocusMode={setIsFocusMode}
          setIsWideMode={setIsWideMode}
          setShowTimeline={setShowTimeline}
          setShowContextPruning={setShowContextPruning}
          setShowAnalytics={setShowAnalytics}
          setShowBranchTree={setShowBranchTree}
          setShowMemoryPanel={setShowMemoryPanel}
          setShowImport={setShowImport}
          setHighContrast={setHighContrast}
          shareConversation={shareConversation}
          saveSnapshot={saveSnapshot}
          showTimeline={showTimeline}
          setShowTimelineState={setShowTimeline}
          messagesToRender={messagesToRender}
          scrollContainerRef={scrollContainerRef}
          showContextPruning={showContextPruning}
          setShowContextPruningState={setShowContextPruning}
          contextLimit={contextLimit}
          selectedModel={selectedModel}
        />

        <PanelDialogs
          showArtifacts={showArtifacts}
          setShowArtifacts={setShowArtifacts}
          artifactContent={artifactContent}
          isDragOver={isDragOver}
          setIsDragOver={setIsDragOver}
          setAttachedFiles={setAttachedFiles}
          showAnalytics={showAnalytics}
          setShowAnalytics={setShowAnalytics}
          messagesToRender={messagesToRender}
          selectedModel={selectedModel}
          contextLimit={contextLimit}
          contextWindowMsgs={contextWindowMsgs}
          showBranchTree={showBranchTree}
          setShowBranchTree={setShowBranchTree}
          threads={threads}
          activeThreadId={activeThreadId}
          setActiveThreadId={setActiveThreadId}
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          togglePinMsg={togglePinMsg}
          toggleBookmark={toggleBookmark}
          addMemory={addMemory}
          handleDeleteMessage={handleDeleteMessage}
          setReplyToMsgId={setReplyToMsgId}
          showMemoryPanel={showMemoryPanel}
          setShowMemoryPanel={setShowMemoryPanel}
          memories={memories}
          removeMemory={removeMemory}
          showImport={showImport}
          setShowImport={setShowImport}
          variant={variant}
          showSettings={showSettings}
        />

        {/* Settings Panel */}
        {showSettings && (
          <SettingsPanel
            fastMode={fastMode}
            onFastModeChange={setFastMode}
            model={selectedModel}
            onModelChange={setSelectedModel as (model: string) => void}
            arbitrageMode={arbitrageEnabled}
            onArbitrageModeChange={setArbitrageEnabled}
            onClose={() => setShowSettings(false)}
          />
        )}

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
            <p className="text-xs text-content-muted">Evidence the agent discovered, with links and media.</p>
          </div>
        </div>

        <div className="space-y-4">
          <RichMediaSection media={media} showCitations={true} />

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
