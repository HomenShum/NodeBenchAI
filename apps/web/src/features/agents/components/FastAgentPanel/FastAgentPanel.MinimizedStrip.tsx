import React, { memo } from 'react';
import { X, Plus, Maximize2, MessageSquare } from 'lucide-react';

export interface MinimizedStripProps {
  isStreaming: boolean;
  threads: any[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewChat: () => void;
  onExpand: () => void;
  onClose: () => void;
}

export const MinimizedStrip = memo(function MinimizedStrip({
  isStreaming,
  threads,
  activeThreadId,
  onSelectThread,
  onNewChat,
  onExpand,
  onClose,
}: MinimizedStripProps) {
  return (
    <div className="fixed right-0 top-1/2 -translate-y-1/2 z-[1000] flex flex-col items-center gap-2 p-2 bg-surface border border-edge rounded-l-xl shadow-lg">
      {/* Expand button */}
      <button
        type="button"
        onClick={onExpand}
        className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
        title="Expand panel"
        aria-label="Expand panel"
      >
        <Maximize2 className="w-5 h-5 text-content" aria-hidden="true" />
      </button>

      {/* Status indicator */}
      <div
        role="status"
        aria-label={isStreaming ? 'Agent is active' : 'Agent is ready'}
        className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-violet-500 motion-safe:animate-pulse' : 'bg-green-500'}`}
      />

      {/* Recent threads icons */}
      {threads?.slice(0, 3).map((thread) => (
        <button
          key={thread._id}
          type="button"
          onClick={() => onSelectThread(thread._id)}
          className={`p-2 rounded-lg transition-colors ${activeThreadId === thread._id
            ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600'
            : 'hover:bg-surface-hover text-content-muted'
            }`}
          title={thread.title || 'Untitled Thread'}
          aria-label={thread.title || 'Untitled Thread'}
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
        </button>
      ))}

      {/* New chat button */}
      <button
        type="button"
        onClick={onNewChat}
        className="p-2 rounded-lg hover:bg-surface-hover text-content-muted transition-colors"
        title="New chat"
        aria-label="New chat"
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
      </button>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-content-muted hover:text-red-600 transition-colors mt-2"
        title="Close panel"
        aria-label="Close panel"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
});
