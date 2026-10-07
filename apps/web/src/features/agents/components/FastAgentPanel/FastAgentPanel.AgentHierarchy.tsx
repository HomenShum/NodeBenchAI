// src/components/FastAgentPanel/FastAgentPanel.AgentHierarchy.tsx
// Compact visualization of dynamically spawned sub-agents during a run

import { CheckCircle, AlertCircle, Loader2, Users, ChevronDown } from 'lucide-react';
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import type { SpawnedAgent } from './types/agent';

interface AgentHierarchyProps {
  agents: SpawnedAgent[];
  isStreaming?: boolean;
}

export function AgentHierarchy({ agents, isStreaming = false }: AgentHierarchyProps) {
  if (!isStreaming && agents.length === 0) return null;

  return (
    <Task defaultOpen className="agent-hierarchy">
      <TaskTrigger title="Agents">
        <button type="button" className="header">
          <Users className="h-4 w-4" />
          <span className="title">Agents</span>
          <span className="count">{agents.length}</span>
          <ChevronDown className="chevron" />
        </button>
      </TaskTrigger>
      <TaskContent className="content">
        {agents.map((a) => {
          const Icon = a.status === 'running' ? Loader2 : a.status === 'complete' ? CheckCircle : AlertCircle;
          const cls = a.status === 'running' ? 'running' : a.status === 'complete' ? 'complete' : 'error';
          const elapsed = a.completedAt ? Math.max(0, a.completedAt - a.startedAt) : Math.max(0, Date.now() - a.startedAt);
          return (
            <TaskItem className={`agent-row ${cls}`} key={a.id} title={a.errorMessage || ''}>
              <Icon className={`icon ${a.status === 'running' ? 'spin' : ''}`} />
              <div className="name">{a.name || a.id}</div>
              <div className="meta">{(elapsed / 1000).toFixed(1)}s</div>
            </TaskItem>
          );
        })}
        {isStreaming && agents.length === 0 && (
          <TaskItem className="agent-row running" key="pending">
            <Loader2 className="icon spin" />
            <div className="name">Starting…</div>
          </TaskItem>
        )}
      </TaskContent>
      <style>{`
        .agent-hierarchy {
          border-bottom: 1px solid var(--border-color);
          background: var(--bg-primary);
        }
        .agent-hierarchy .header {
          display: flex; align-items: center; gap: 0.5rem; width: 100%;
          padding: 0.5rem 1rem; color: var(--text-secondary);
          background: transparent; border: none; cursor: pointer; text-align: left; font: inherit;
        }
        .agent-hierarchy .header:hover { color: var(--text-primary); }
        .agent-hierarchy .title { font-weight: 600; color: var(--text-primary); }
        .agent-hierarchy .count { font-size: 0.75rem; opacity: 0.8; }
        .agent-hierarchy .header .chevron {
          width: 14px; height: 14px; margin-left: auto;
          transition: transform 0.2s ease;
        }
        .agent-hierarchy .header[data-state="open"] .chevron { transform: rotate(180deg); }
        .agent-hierarchy .content { padding: 0 0.5rem 0.5rem 0.5rem; }
        .agent-hierarchy .content > div { margin-top: 0.5rem; }
        .agent-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.5rem; border-radius: 0.5rem; }
        .agent-row .icon { width: 14px; height: 14px; }
        .agent-row .icon.spin { animation: spin 1s linear infinite; }
        .agent-row .name { flex: 1; min-width: 0; color: var(--text-primary); font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; }
        .agent-row .meta { font-size: 0.75rem; color: var(--text-secondary); }
        .agent-row.running { background: var(--bg-tertiary); }
        .agent-row.complete { background: rgba(34,197,94,0.08); }
        .agent-row.error { background: rgba(239,68,68,0.08); }
        @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        @media (prefers-reduced-motion: reduce) {
          .agent-row .icon.spin { animation: none; }
          .agent-hierarchy .header .chevron { transition: none; }
        }
      `}</style>
    </Task>
  );
}
