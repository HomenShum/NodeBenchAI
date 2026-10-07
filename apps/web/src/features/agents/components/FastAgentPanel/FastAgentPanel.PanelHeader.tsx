import React, { memo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthActions } from "@convex-dev/auth/react";
import {
  X, Plus, Radio, MessageSquare,
  Activity, Minimize2, Maximize2, BookOpen, LogIn,
  Share2, MoreHorizontal, Download, ClipboardCopy, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { DossierModeIndicator } from '@/features/agents/components/DossierModeIndicator';
import { cn } from '@/lib/utils';

function getMessageText(message: any): string {
  if (typeof message?.text === 'string') return message.text;
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.parts)) {
    return message.parts
      .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
      .map((part: any) => part.text)
      .join('\n');
  }
  return '';
}

export interface PanelHeaderProps {
  isCompactSidebar: boolean;
  isStreaming: boolean;
  isSwarmActive: boolean;
  runtimeOwnerReady: boolean;
  swarmTasks: any[];
  isAuthenticated: boolean;
  activeThreadId: string | null;
  messagesToRender: any[] | null;
  threads: any[];
  isFocusMode: boolean;
  isWideMode: boolean;
  liveEvents: any[];
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
  showSidebar: boolean;
  setShowSidebar: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsFocusMode: (value: (prev: boolean) => boolean) => void;
  setIsWideMode: (value: (prev: boolean) => boolean) => void;
  setIsMinimized: (value: boolean) => void;
  showOverflowMenu: boolean;

  // Callbacks
  onClose: () => void;
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
  runtimeOwnerReady,
  swarmTasks,
  isAuthenticated,
  activeThreadId,
  messagesToRender,
  threads,
  isFocusMode,
  isWideMode,
  liveEvents,
  anonymousSession,
  setActiveThreadId,
  setInput,
  setAttachedFiles,
  setShowOverflowMenu,
  setShowEventsPanel,
  setShowSkillsPanel,
  showSidebar,
  setShowSidebar,
  setIsFocusMode,
  setIsWideMode,
  setIsMinimized,
  showOverflowMenu,
  onClose,
  handleCopyAsMarkdown,
  handleDownloadMarkdown,
  appendToSignalsLog,
  showOpenInChat = false,
  onOpenInChat,
}: PanelHeaderProps) {
  const navigate = useNavigate();
  const { signIn } = useAuthActions();
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const assistantShareText = (messagesToRender ?? [])
    .filter((message) => message?.role === 'assistant')
    .map(getMessageText)
    .filter((text) => text.trim().length > 0)
    .slice(-3)
    .join('\n\n---\n\n');

  return (
    <div className={cn(
      "flex items-center gap-2 border-b border-edge bg-surface px-3 py-2.5",
      isCompactSidebar && "px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+28px)] sm:py-3"
    )}>
      {/* Status dot + Title */}
      <div className={cn("min-w-0", isCompactSidebar ? "flex-1" : "flex items-center gap-2")}>
        {isCompactSidebar ? (
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div
                aria-label={isStreaming || isSwarmActive ? 'Agent running' : runtimeOwnerReady ? 'Session available' : 'Session preparing'}
                className={`w-2 h-2 rounded-full flex-shrink-0 ${isStreaming || isSwarmActive ? 'bg-violet-500 motion-safe:animate-pulse' : 'bg-content-muted'}`}
              />
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
          </div>
        ) : (
          <>
            <div
              aria-label={isStreaming || isSwarmActive ? 'Agent running' : runtimeOwnerReady ? 'Session available' : 'Session preparing'}
              className={`w-2 h-2 rounded-full flex-shrink-0 ${isStreaming || isSwarmActive ? 'bg-violet-500 motion-safe:animate-pulse' : 'bg-content-muted'}`}
            />
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

        {!isFocusMode && (
          <button
            type="button"
            onClick={() => setShowSidebar(previous => !previous)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md hover:bg-surface-secondary text-content-secondary hover:text-content transition-colors"
            aria-label={showSidebar ? 'Hide conversations' : 'Show conversations'}
            aria-expanded={showSidebar}
            title="Conversations"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Conversations</span>
          </button>
        )}

        {/* New Chat */}
        <button
          type="button"
          onClick={() => {
            setActiveThreadId(null);
            setShowSidebar(false);
            setInput('');
            setAttachedFiles([]);
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md hover:bg-surface-secondary text-content-secondary hover:text-content transition-colors"
          title="New chat (Ctrl/Cmd+Shift+N)"
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
                {liveEvents.length > 0 && (
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
                )}

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
                {isAuthenticated && activeThreadId && assistantShareText.trim() && (
                  <button
                    type="button"
                    onClick={async () => {
                      setShowOverflowMenu(false);
                      try {
                        const threadTitle = threads.find((t) => t._id === activeThreadId)?.title || 'Agent Thread Summary';
                        await appendToSignalsLog({
                          kind: 'note',
                          title: threadTitle,
                          markdown: assistantShareText.slice(0, 10000),
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
