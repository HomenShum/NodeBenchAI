import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useMotionConfig } from '@/lib/motion';
import {
  FileText,
  CheckSquare,
  Calendar,
  Sparkles,
  Plus,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { sanitizeDocumentTitle } from '@/lib/displayText';

interface WorkspaceGridProps {
  className?: string;
  onNavigate?: (path: string) => void;
  onDocumentSelect?: (id: string) => void;
  onCreateDocument?: () => void;
}

interface QuickAccessCardProps {
  title: string;
  description: string;
  icon: typeof FileText;
  color: string;
  count?: number;
  onClick?: () => void;
}

const QuickAccessCard = React.memo(function QuickAccessCard({ title, description, icon: Icon, color, count, onClick }: QuickAccessCardProps) {
  const { instant } = useMotionConfig();
  return (
    <motion.button
      onClick={onClick}
      className={`p-5 rounded-lg border ${color} text-left transition-all group`}
      whileHover={!instant ? { scale: 1.02, y: -2 } : undefined}
      whileTap={!instant ? { scale: 0.98 } : undefined}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-lg bg-surface/50">
          <Icon className="h-5 w-5" />
        </div>
        {count !== undefined && (
          <span className="text-2xl font-bold opacity-80">{count}</span>
        )}
      </div>
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      <p className="text-xs opacity-70">{description}</p>
      <div className="mt-3 flex items-center gap-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
        Open <ArrowRight className="h-3 w-3" />
      </div>
    </motion.button>
  );
});

export const WorkspaceGrid = memo(function WorkspaceGrid({
  className = '',
  onNavigate,
  onDocumentSelect,
  onCreateDocument,
}: WorkspaceGridProps) {
  const { instant } = useMotionConfig();
  // Fetch only what we need - 4 recent docs for display, counts come from separate queries if needed
  const documents = useQuery(api.domains.documents.documents.listDocuments, { limit: 10 });
  const tasks = useQuery(api.domains.tasks.tasks.listTasks, { limit: 20 });
  const events = useQuery(api.domains.calendar.events.listEvents, { limit: 10 });

  const docCount = documents?.length ?? 0;
  const pendingTaskCount = useMemo(() => tasks?.filter((t) => t.status === 'pending').length ?? 0, [tasks]);
  const eventCount = events?.length ?? 0;

  // Recent documents for quick access
  const recentDocs = documents?.slice(0, 4) ?? [];

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Quick Access Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-content">Quick Access</h2>
          <button
            onClick={onCreateDocument}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Document
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickAccessCard
            title="Documents"
            description="Your notes and files"
            icon={FileText}
            color="bg-blue-50 border-blue-200 text-blue-800"
            count={docCount}
            onClick={() => onNavigate?.('/documents')}
          />
          <QuickAccessCard
            title="Tasks"
            description="Pending items"
            icon={CheckSquare}
            color="bg-green-50 border-green-200 text-green-800"
            count={pendingTaskCount}
            onClick={() => onNavigate?.('/tasks')}
          />
          <QuickAccessCard
            title="Calendar"
            description="Upcoming events"
            icon={Calendar}
            color="bg-purple-50 border-purple-200 text-purple-800"
            count={eventCount}
            onClick={() => onNavigate?.('/calendar')}
          />
          <QuickAccessCard
            title="AI Research"
            description="Explore with AI"
            icon={Sparkles}
            color="bg-amber-50 border-amber-200 text-amber-800"
            onClick={() => onNavigate?.('/research')}
          />
        </div>
      </div>

      {/* Recent Documents */}
      {recentDocs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-content">Recent Documents</h2>
            <button
              onClick={() => onNavigate?.('/documents')}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" style={{ contain: 'layout paint' }}>
            {recentDocs.map((doc) => (
              <motion.button
                key={doc._id}
                onClick={() => onDocumentSelect?.(doc._id)}
                className="p-4 bg-surface rounded-lg border border-edge text-left hover:border-blue-300 transition-all group"
                whileHover={!instant ? { y: -2 } : undefined}
              >
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-content-muted group-hover:text-blue-500 transition-colors" />
                  <span className="text-xs text-content-muted">
                    {doc._creationTime
                      ? new Date(doc._creationTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : 'Recently'}
                  </span>
                </div>
                <h3 className="font-medium text-sm text-content truncate">
                  {sanitizeDocumentTitle(doc.title)}
                </h3>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default WorkspaceGrid;
