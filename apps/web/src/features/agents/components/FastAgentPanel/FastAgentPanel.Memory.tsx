// src/components/FastAgentPanel/FastAgentPanel.Memory.tsx
// Collapsible memory preview for a single runId (episodic focus)

import React from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';

interface MemoryProps {
  runId?: string | null;
}

export function MemoryPreview({ runId }: MemoryProps) {
  const [open, setOpen] = React.useState(false);
  const shouldFetch = Boolean(runId);
  const episodic = useQuery(
    shouldFetch ? api.domains.agents.agentMemory.getEpisodicByRunId : 'skip',
    shouldFetch ? { runId: runId as string, limit: 50 } : 'skip'
  );

  if (!runId) return null;

  const items = shouldFetch && Array.isArray(episodic) ? episodic.slice(0, 3) : [];

  return (
    <div className="memory-preview">
      <button type="button" className="toggle" onClick={() => setOpen((v) => !v)} aria-label={open ? "Hide memory entries" : "Show memory entries"}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Archive className="h-3.5 w-3.5" />
        <span className="label">Memory</span>
        <span className="count">{items.length}</span>
      </button>
      {open && shouldFetch && items.length > 0 && (
        <div className="items">
          {items.map((e: any, idx: number) => (
            <div key={idx} className="item">
              <div className="ts">{new Date(e.ts || e._creationTime || Date.now()).toLocaleTimeString()}</div>
              <div className="tags">{Array.isArray(e.tags) ? e.tags.join(', ') : ''}</div>
              <div className="data">{typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}</div>
            </div>
          ))}
        </div>
      )}
      {open && shouldFetch && items.length === 0 && (
        <div className="items empty">No episodic entries for this run.</div>
      )}
      {open && !shouldFetch && (
        <div className="items empty">Episodic memory not available.</div>
      )}

      <style>{`
        .memory-preview { margin-top: 0.5rem; border-top: 1px dashed var(--border-color); padding-top: 0.5rem; }
        .memory-preview .toggle { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--text-secondary); }
        .memory-preview .label { font-weight: 600; color: var(--text-primary); }
        .memory-preview .count { font-size: 0.75rem; opacity: 0.8; }
        .memory-preview .items { margin-top: 0.5rem; display: grid; gap: 0.4rem; }
        .memory-preview .item { background: var(--bg-secondary); padding: 0.5rem; border-radius: 0.5rem; }
        .memory-preview .ts { font-size: 0.7rem; color: var(--text-secondary); }
        .memory-preview .tags { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.125rem; }
        .memory-preview .data { font-size: 0.8rem; color: var(--text-primary); margin-top: 0.25rem; }
        .memory-preview .empty { color: var(--text-secondary); font-size: 0.8rem; }
      `}</style>
    </div>
  );
}
