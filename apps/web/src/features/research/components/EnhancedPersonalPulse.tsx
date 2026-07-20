import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  FileText,
  CheckSquare,
  Calendar,
  ChevronRight,
  ChevronDown,
  Clock,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useTimeContext } from '../../../hooks/useTimeContext';
import { sanitizeDocumentTitle } from '@/lib/displayText';
import { useMotionConfig } from '@/lib/motion';

interface EnhancedPersonalPulseProps {
  className?: string;
  onDocumentSelect?: (id: string) => void;
  onTaskSelect?: (id: string) => void;
  onNavigate?: (path: string) => void;
}

export function EnhancedPersonalPulse({
  className = '',
  onDocumentSelect,
  onTaskSelect,
  onNavigate,
}: EnhancedPersonalPulseProps) {
  const { instant, transition } = useMotionConfig();
  const [expandedSection, setExpandedSection] = useState<string | null>('tasks');
  const timeContext = useTimeContext();

  // Fetch data
  const tasks = useQuery(api.domains.tasks.tasks.listTasks, { limit: 10 });
  const documents = useQuery(api.domains.documents.documents.listDocuments, { limit: 10 });
  const recommendations = useQuery(api.domains.recommendations.recommendationEngine.getActiveRecommendations, { limit: 3 });

  const pendingTasks = (tasks as any[] | undefined)?.filter((t: any) => t.status === 'pending').slice(0, 5) ?? [];
  const recentDocs = documents?.slice(0, 5) ?? [];

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className={`bg-surface rounded-lg border border-edge overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-edge bg-surface-secondary">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-content-secondary" />
            <h2 className="text-lg font-semibold text-content">Personal Pulse</h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-content-secondary">
            <span className="w-2 h-2 rounded-full bg-green-500 motion-safe:animate-pulse" />
            <span>{timeContext.timeOfDay === 'morning' ? 'Morning Mode' : timeContext.timeOfDay === 'afternoon' ? 'Focus Mode' : 'Wind Down'}</span>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="divide-y divide-edge">
        {/* Tasks Section */}
        <CollapsibleSection
          title="Today's Tasks"
          icon={CheckSquare}
          count={pendingTasks.length}
          isExpanded={expandedSection === 'tasks'}
          onToggle={() => toggleSection('tasks')}
          color="text-green-600"
          instant={instant}
        >
          {pendingTasks.length > 0 ? (
            <div className="space-y-2">
              {pendingTasks.map((task: any) => (
                <button
                  key={task._id}
                  onClick={() => onTaskSelect?.(task._id)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-surface-hover dark:hover:bg-white/[0.03] transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <div className="w-4 h-4 rounded border-2 border-edge" />
                  <span className="text-sm text-content-secondary flex-1 truncate">{task.title}</span>
                  <ChevronRight className="h-4 w-4 text-content-muted" />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-content-secondary italic">No pending tasks</p>
          )}
        </CollapsibleSection>

        {/* Documents Section */}
        <CollapsibleSection
          title="Recent Documents"
          icon={FileText}
          count={recentDocs.length}
          isExpanded={expandedSection === 'documents'}
          onToggle={() => toggleSection('documents')}
          color="text-blue-600"
          instant={instant}
        >
          {recentDocs.length > 0 ? (
            <div className="space-y-2">
              {recentDocs.map((doc: any) => (
                <button
                  key={doc._id}
                  onClick={() => onDocumentSelect?.(doc._id)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-surface-hover dark:hover:bg-white/[0.03] transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <FileText className="h-4 w-4 text-content-muted" />
                  <span className="text-sm text-content-secondary flex-1 truncate">{sanitizeDocumentTitle(doc.title)}</span>
                  <ChevronRight className="h-4 w-4 text-content-muted" />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-content-secondary italic">No recent documents</p>
          )}
        </CollapsibleSection>

        {/* AI Suggestions Section */}
        <CollapsibleSection
          title="AI Suggestions"
          icon={Sparkles}
          count={recommendations?.length ?? 0}
          isExpanded={expandedSection === 'suggestions'}
          onToggle={() => toggleSection('suggestions')}
          color="text-purple-600"
          instant={instant}
        >
          {recommendations && recommendations.length > 0 ? (
            <div className="space-y-2">
              {recommendations.map((rec: any) => (
                <div key={rec._id} className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <p className="text-sm text-content-secondary">{rec.message}</p>
                  <button type="button" className="mt-2 text-xs text-purple-600 font-medium hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 rounded">
                    {rec.actionLabel} →
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-content-secondary italic">No suggestions right now</p>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  icon: typeof FileText;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  color: string;
  children: React.ReactNode;
  instant: boolean;
}

function CollapsibleSection({ title, icon: Icon, count, isExpanded, onToggle, color, children, instant }: CollapsibleSectionProps) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-6 py-3 hover:bg-surface-hover dark:hover:bg-white/[0.03] transition-colors">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className="text-sm font-medium text-content">{title}</span>
          {count > 0 && <span className="text-xs text-content-secondary bg-surface-secondary px-1.5 py-0.5 rounded-full">{count}</span>}
        </div>
        <ChevronDown className={`h-4 w-4 text-content-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div initial={{ height: instant ? 'auto' : 0, opacity: instant ? 1 : 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: instant ? 'auto' : 0, opacity: instant ? 1 : 0 }} className="overflow-hidden">
            <div className="px-6 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default EnhancedPersonalPulse;
