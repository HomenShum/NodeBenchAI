import React, { memo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthActions } from "@convex-dev/auth/react";
import {
  X, Plus, Radio, Bot, ChevronDown, MessageSquare,
  Activity, Minimize2, Maximize2, BookOpen, LogIn,
  Share2, MoreHorizontal, Download, ClipboardCopy, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { DossierModeIndicator } from '@/features/agents/components/DossierModeIndicator';
import { cn } from '@/lib/utils';

interface Persona {
  id: string;
  name: string;
  icon: string;
}

export interface PanelHeaderProps {
  isCompactSidebar: boolean;
  isStreaming: boolean;
  isSwarmActive: boolean;
  swarmTasks: any[];
  isAuthenticated: boolean;
  activeThreadId: string | null;
  messagesToRender: any[] | null;
  threads: any[];
  selectedModel: string;
  systemPrompt: string;
  isFocusMode: boolean;
  isWideMode: boolean;
  liveEvents: any[];
  personas: Persona[];
  activePersona: string;
  anonymousSession: {
    isAnonymous: boolean;
    isLoading: boolean;
    canSendMessage: boolean;
    remaining: number;
    limit: number;
  };

  // State setters
  setActiveThreadId: (id: string | null) => void;
  setInput: (value: string | ((prev: string) => string)) => void;
  setAttachedFiles: (value: any) => void;
  setShowOverflowMenu: (value: boolean | ((prev: boolean) => boolean)) => void;
  setShowEventsPanel: (value: boolean | ((prev: boolean) => boolean)) => void;
  setShowSkillsPanel: (value: boolean) => void;
  setShowSystemPrompt: (value: boolean) => void;
  setShowAnalytics: (value: boolean) => void;
  setShowTimeline: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsFocusMode: (value: (prev: boolean) => boolean) => void;
  setIsWideMode: (value: (prev: boolean) => boolean) => void;
  setIsMinimized: (value: boolean) => void;
  setActivePersona: (value: string) => void;
  setShowPersonaPicker: (value: boolean | ((prev: boolean) => boolean)) => void;
  showOverflowMenu: boolean;
  showPersonaPicker: boolean;

  // Callbacks
  onClose: () => void;
  onClearChat?: () => void;
  handleCopyAsMarkdown: () => Promise<void>;
  handleDownloadMarkdown: () => void;
  appendToSignalsLog: (payload: any) => Promise<void>;
  showOpenInChat?: boolean;
  onOpenInChat?: () => void;
}

export const PanelHeader = memo(function PanelHeader({
  isCompactSidebar,
  isStreaming,
  isSwarmActive,
  swarmTasks,
  isAuthenticated,
  activeThreadId,
  messagesToRender,
  threads,
  selectedModel,
  systemPrompt,
  isFocusMode,
  isWideMode,
  liveEvents,
  personas,
  activePersona,
  anonymousSession,
  setActiveThreadId,
  setInput,
  setAttachedFiles,
  setShowOverflowMenu,
  setShowEventsPanel,
  setShowSkillsPanel,
  setShowSystemPrompt,
  setShowAnalytics,
  setShowTimeline,
  setIsFocusMode,
  setIsWideMode,
  setIsMinimized,
  setActivePersona,
  setShowPersonaPicker,
  showOverflowMenu,
  showPersonaPicker,
  onClose,
  onClearChat,
  handleCopyAsMarkdown,
  handleDownloadMarkdown,
  appendToSignalsLog,
  showOpenInChat = false,
  onOpenInChat,
}: PanelHeaderProps) {
  const navigate = useNavigate();
  const { signIn } = useAuthActions();
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const currentPersona = personas.find(p => p.id === activePersona) || personas[0];

  return (
    <div className={cn(
      "flex items-center gap-2 border-b border-edge bg-surface px-3 py-2.5",
      isCompactSidebar && "px-4 py-3"
    )}>
      {/* Status dot + Title */}
      <div className={cn("min-w-0", isCompactSidebar ? "flex-1" : "flex items-center gap-2")}>
        {isCompactSidebar ? (
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isStreaming || isSwarmActive ? 'bg-violet-500 motion-safe:animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-sm font-semibold text-content truncate tracking-[-0.02em]">
                {isSwarmActive
                  ? `Team ${swarmTasks.filter(t => t.status === 'completed').length}/${swarmTasks.length}`
                  : isStreaming
                    ? 'Thinking...'
                    : 'Ask NodeBench'}
              </span>
              {anonymousSession.isAnonymous && !anonymousSession.isLoading && (
                anonymousSession.canSendMessage ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-edge bg-surface-secondary/80 px-2 py-0.5 text-[10px] font-medium text-content-muted">
                    <MessageSquare className="w-3 h-3 text-violet-500" />
                    {anonymousSession.remaining}/{anonymousSession.limit}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      void signIn("google", {
                        redirectTo: typeof window !== "undefined" ? window.location.href : "/",
                      })
                    }
                    className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-100"
                  >
                    <LogIn className="w-3 h-3" />
                    Sign in
                  </button>
                )
              )}
            </div>
            <p className="mt-1 truncate text-[11px] leading-5 text-content-muted">
              Same chat surface, with files, notebook context, and workspace tools.
            </p>
          </div>
        ) : (
          <>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isStreaming || isSwarmActive ? 'bg-violet-500 motion-safe:animate-pulse' : 'bg-green-500'}`} />
            <span className="text-sm font-semibold text-content truncate tracking-[-0.02em]">
              {isSwarmActive ? `Team ${swarmTasks.filter(t => t.status === 'completed').length}/${swarmTasks.length}` :
               isStreaming ? 'Thinking...' : 'Ask NodeBench'}
            </span>
            {!isStreaming && activeThreadId && messagesToRender && messagesToRender.length > 0 && (() => {
              const firstUserMsg = messagesToRender.find((m: any) => m.role === 'user');
              if (!firstUserMsg) return null;
              const topic = (firstUserMsg.text || firstUserMsg.content || '').slice(0, 40);
              if (!topic) return null;
              return (
                <span className="text-xs text-content-muted truncate max-w-[120px] hidden sm:inline" title={firstUserMsg.text || firstUserMsg.content || ''}>
                  {topic}{(firstUserMsg.text || firstUserMsg.content || '').length > 40 ? '...' : ''}
                </span>
              );
            })()}
          </>
        )}
      </div>

      {!isCompactSidebar && <div className="flex-1" />}

      {/* Primary Actions */}
      <div className="flex items-center gap-1">
        {isCompactSidebar && liveEvents.length > 0 && (() => {
          const runningCount = liveEvents.filter(
            (event) => event.status === 'running'
          ).length;
          return (
            <button
              type="button"
              onClick={() => setShowEventsPanel(previous => !previous)}
              className="inline-flex items-center gap-1 rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-secondary hover:text-content"
              aria-label={`Open live events (${runningCount} running)`}
              title="Live Events"
            >
              <Activity
                aria-hidden="true"
                className={cn(
                  'h-4 w-4',
                  runningCount > 0 && 'text-violet-500'
                )}
              />
              {runningCount > 0 && (
                <span
                  aria-hidden="true"
                  className="min-w-4 rounded-full bg-violet-500 px-1 text-center text-[10px] font-semibold leading-4 text-white"
                >
                  {runningCount}
                </span>
              )}
            </button>
          );
        })()}

        {/* Persona Switcher */}
        {!isCompactSidebar && <div className="relative">
          <button
            type="button"
            onClick={() => setShowPersonaPicker(p => !p)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-surface-secondary text-content-secondary transition-colors"
            title={`Persona: ${currentPersona.name}`}
            aria-haspopup="listbox"
            aria-expanded={showPersonaPicker}
          >
            <span>{currentPersona.icon}</span>
            <span className="hidden sm:inline text-xs">{currentPersona.name}</span>
            <ChevronDown className="w-3 h-3 opacity-50" />
          </button>
          {showPersonaPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPersonaPicker(false)} />
              <div className="absolute right-0 top-full mt-1 w-44 bg-surface rounded-lg border border-edge shadow-lg z-50 py-1" role="listbox" aria-label="Select persona">
                {personas.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === activePersona}
                    onClick={() => { setActivePersona(p.id); setShowPersonaPicker(false); toast.success(`Switched to ${p.name}`); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${p.id === activePersona ? 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-content-secondary hover:bg-surface-secondary'}`}
                  >
                    <span>{p.icon}</span>
                    <span>{p.name}</span>
                    {p.id === activePersona && <span className="ml-auto text-xs">{'\u2713'}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>}

        {/* New Chat */}
        <button
          type="button"
          onClick={() => {
            setActiveThreadId(null);
            setInput('');
            setAttachedFiles([]);
            onClearChat?.();
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md hover:bg-surface-secondary text-content-secondary hover:text-content transition-colors"
          title="New chat (\u2318 1)"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New</span>
        </button>

        {/* Overflow Menu */}
        {!isCompactSidebar && <div className="relative" ref={overflowMenuRef}>
          <button
            type="button"
            onClick={() => setShowOverflowMenu(!showOverflowMenu)}
            className={`p-1.5 rounded-md transition-colors ${showOverflowMenu ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
            aria-label="More options"
            aria-expanded={showOverflowMenu}
          >
            <MoreHorizontal className="w-4 h-4 text-content-muted" aria-hidden="true" />
          </button>

          {/* Overflow Dropdown */}
          {showOverflowMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 bg-surface rounded-lg border border-edge shadow-lg z-50 py-1">
                {/* Live Events */}
                <button
                  type="button"
                  onClick={() => { setShowEventsPanel(prev => !prev); setShowOverflowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                >
                  <Activity className={`w-3.5 h-3.5 ${isStreaming ? 'text-violet-500' : ''}`} />
                  <span>Live Events</span>
                  {liveEvents.filter(e => e.status === 'running').length > 0 && (
                    <span className="ml-auto px-1.5 py-0.5 text-xs bg-violet-500 text-white rounded-full">
                      {liveEvents.filter(e => e.status === 'running').length}
                    </span>
                  )}
                </button>

                {/* Skills */}
                <button
                  type="button"
                  onClick={() => { setShowSkillsPanel(true); setShowOverflowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Skills</span>
                </button>

                {/* Signals */}
                <button
                  type="button"
                  onClick={() => { navigate('/signals'); setShowOverflowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Signals</span>
                </button>

                {/* Share (only if authenticated and has thread) */}
                {isAuthenticated && activeThreadId && (
                  <button
                    type="button"
                    onClick={async () => {
                      setShowOverflowMenu(false);
                      try {
                        const threadTitle = threads.find((t) => t._id === activeThreadId)?.title || 'Agent Thread Summary';
                        const recentMsgs = (messagesToRender ?? [])
                          .filter((m) => m.role === 'assistant' && m.content)
                          .slice(-3)
                          .map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
                          .join('\n\n---\n\n');
                        if (!recentMsgs.trim()) {
                          toast.error('No assistant messages to share');
                          return;
                        }
                        await appendToSignalsLog({
                          kind: 'note',
                          title: threadTitle,
                          markdown: recentMsgs.slice(0, 10000),
                          agentThreadId: activeThreadId,
                          tags: ['agent', 'shared'],
                        });
                        toast.success('Shared to Signals');
                      } catch (err: any) {
                        toast.error(err?.message || 'Failed to share');
                      }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share to Signals</span>
                  </button>
                )}

                {showOpenInChat && onOpenInChat && activeThreadId && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverflowMenu(false);
                      onOpenInChat();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Open in Chat</span>
                  </button>
                )}

                {/* Export options (when thread has messages) */}
                {activeThreadId && messagesToRender && messagesToRender.length > 0 && (
                  <>
                    <div className="border-t border-edge my-1" />
                    <button
                      type="button"
                      onClick={() => { void handleCopyAsMarkdown(); setShowOverflowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                    >
                      <ClipboardCopy className="w-3.5 h-3.5" />
                      <span>Copy as Markdown</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { handleDownloadMarkdown(); setShowOverflowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download .md</span>
                    </button>
                  </>
                )}

                {/* System Prompt */}
                {activeThreadId && (
                  <button
                    type="button"
                    onClick={() => { setShowSystemPrompt(true); setShowOverflowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>System Prompt</span>
                    {systemPrompt && <span className="ml-auto text-xs text-green-500">{'\u25CF'}</span>}
                  </button>
                )}

                {/* Conversation Analytics */}
                {messagesToRender && messagesToRender.length > 0 && (
                  <>
                    <div className="border-t border-edge my-1" />
                    <div className="px-3 py-2 text-xs text-content-muted space-y-1">
                      <div className="font-medium text-content-secondary text-xs mb-1">Thread Stats</div>
                      <div className="flex justify-between">
                        <span>Messages</span>
                        <span className="tabular-nums">{messagesToRender.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Words</span>
                        <span className="tabular-nums">{messagesToRender.reduce((sum: number, m: any) => sum + ((m.text || m.content || '').split(/\s+/).filter(Boolean).length), 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Est. tokens</span>
                        <span className="tabular-nums">~{Math.ceil(messagesToRender.reduce((sum: number, m: any) => sum + (m.text || m.content || '').length, 0) / 4).toLocaleString()}</span>
                      </div>
                    </div>
                  </>
                )}

                <div className="border-t border-edge my-1" />

                {/* Focus Mode Toggle */}
                <button
                  type="button"
                  onClick={() => { setIsFocusMode(prev => !prev); setShowOverflowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isFocusMode ? 'Exit Focus Mode' : 'Focus Mode'}</span>
                </button>

                {/* Share Thread */}
                {activeThreadId && (
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/chat/${activeThreadId}`;
                      navigator.clipboard.writeText(url);
                      toast.success('Thread link copied to clipboard');
                      setShowOverflowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share Thread Link</span>
                  </button>
                )}

                {/* Wide Mode / Split View Toggle */}
                <button
                  type="button"
                  onClick={() => { setIsWideMode(prev => !prev); setShowOverflowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>{isWideMode ? 'Normal Width' : 'Wide Mode'}</span>
                </button>

                {/* Minimize */}
                <button
                  type="button"
                  onClick={() => { setIsMinimized(true); setShowOverflowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Minimize</span>
                </button>
              </div>
            </>
          )}
        </div>}

        {/* Dossier indicator (compact) */}
        {!isCompactSidebar && <DossierModeIndicator compact />}

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4 text-content-muted hover:text-red-600" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});
