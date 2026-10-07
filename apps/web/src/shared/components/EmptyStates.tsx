/**
 * Empty State Components
 * Polished empty states for various sections of the app
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  CheckSquare,
  Calendar,
  Search,
  Inbox,
  FolderOpen,
  Plus,
  Sparkles,
  AlertCircle,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { scaleFadeVariants } from '@/utils/animations';
import { useMotionConfig } from '@/lib/motion';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: typeof FileText;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ title, description, icon: Icon = Inbox, action, className = '' }: EmptyStateProps) {
  const { instant } = useMotionConfig();
  return (
    <motion.div
      className={`flex flex-col items-center justify-center py-8 sm:py-16 px-4 sm:px-6 text-center ${className}`}
      variants={instant ? undefined : scaleFadeVariants}
      initial={instant ? undefined : "hidden"}
      animate={instant ? undefined : "visible"}
    >
      {/* Premium gradient icon container with glow */}
      <div className="relative mb-6">
        {/* Glow effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/20 to-accent-secondary/20 rounded-2xl blur-xl scale-150" />
        {/* Icon container */}
        <div className="relative w-20 h-20 bg-gradient-to-br from-surface-elevated to-surface-card rounded-2xl flex items-center justify-center border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
          <Icon className="h-10 w-10 text-accent-primary" strokeWidth={1.5} />
        </div>
      </div>
      
      {/* Typography with better hierarchy */}
      <h3 className="text-xl font-semibold text-content mb-3 tracking-tight">{title}</h3>
      <p className="text-sm text-content-secondary max-w-[min(100%-2rem,24rem)] break-words mb-8 leading-relaxed">{description}</p>
      
      {action && (
        <motion.button
          onClick={action.onClick}
          className="group flex items-center gap-2.5 px-5 py-2.5 bg-accent-primary text-white rounded-xl text-sm font-medium shadow-[0_4px_14px_rgba(139,92,246,0.25)] hover:shadow-[0_6px_20px_rgba(139,92,246,0.35)] transition-all duration-200"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus className="h-4 w-4 transition-transform group-hover:rotate-90 duration-200" />
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}

// Pre-configured empty states for common scenarios
export function EmptyDocuments({ onCreate }: { onCreate?: () => void }) {
  return (
    <EmptyState
      icon={FileText}
      title="No documents yet"
      description="Create your first document to start organizing your thoughts, notes, and research."
      action={onCreate ? { label: 'Create Document', onClick: onCreate } : undefined}
    />
  );
}

export function EmptyTasks({ onCreate }: { onCreate?: () => void }) {
  return (
    <EmptyState
      icon={CheckSquare}
      title="All caught up!"
      description="You have no pending tasks. Create a new task to stay organized."
      action={onCreate ? { label: 'Add Task', onClick: onCreate } : undefined}
    />
  );
}

export function EmptyCalendar({ onCreate }: { onCreate?: () => void }) {
  return (
    <EmptyState
      icon={Calendar}
      title="No events scheduled"
      description="Your calendar is clear. Add an event to start planning your schedule."
      action={onCreate ? { label: 'Add Event', onClick: onCreate } : undefined}
    />
  );
}

export function EmptySearch({ query }: { query: string }) {
  return (
    <EmptyState
      icon={Search}
      title="No results found"
      description={`We couldn't find anything matching "${query}". Try a different search term.`}
    />
  );
}

export function EmptyFolder() {
  return (
    <EmptyState
      icon={FolderOpen}
      title="This folder is empty"
      description="Add documents or subfolders to organize your content."
    />
  );
}

export function EmptyRecommendations() {
  return (
    <EmptyState
      icon={Sparkles}
      title="No recommendations yet"
      description="Recommendations appear as you work with documents — open, edit, or save a few to see suggestions here."
    />
  );
}

// Error states
interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title = 'Something went wrong', message = 'An unexpected error occurred. Please try again.', onRetry, className = '' }: ErrorStateProps) {
  const { instant } = useMotionConfig();
  return (
    <motion.div
      className={`flex flex-col items-center justify-center py-8 sm:py-16 px-4 sm:px-6 text-center ${className}`}
      variants={instant ? undefined : scaleFadeVariants}
      initial={instant ? undefined : "hidden"}
      animate={instant ? undefined : "visible"}
    >
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/20 to-orange-500/20 rounded-2xl blur-xl scale-150" />
        <div className="relative w-20 h-20 bg-gradient-to-br from-red-500/10 to-orange-500/10 rounded-2xl flex items-center justify-center border border-red-500/20 shadow-[0_8px_32px_rgba(239,68,68,0.12)]">
          <AlertCircle className="h-10 w-10 text-red-400" strokeWidth={1.5} />
        </div>
      </div>
      <h3 className="text-xl font-semibold text-content mb-3 tracking-tight">{title}</h3>
      <p className="text-sm text-content-secondary max-w-[min(100%-2rem,24rem)] break-words mb-8 leading-relaxed">{message}</p>
      {onRetry && (
        <motion.button 
          onClick={onRetry} 
          className="group flex items-center gap-2.5 px-5 py-2.5 bg-surface-elevated text-content rounded-xl text-sm font-medium border border-white/[0.08] shadow-[0_4px_14px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] transition-all duration-200"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <RefreshCw className="h-4 w-4 transition-transform group-hover:rotate-180 duration-300" />
          Try Again
        </motion.button>
      )}
    </motion.div>
  );
}

export function OfflineState() {
  const { instant } = useMotionConfig();
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-8 sm:py-16 px-4 sm:px-6 text-center"
      variants={instant ? undefined : scaleFadeVariants}
      initial={instant ? undefined : "hidden"}
      animate={instant ? undefined : "visible"}
    >
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-yellow-500/20 rounded-2xl blur-xl scale-150" />
        <div className="relative w-20 h-20 bg-gradient-to-br from-amber-500/10 to-yellow-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20 shadow-[0_8px_32px_rgba(245,158,11,0.12)]">
          <WifiOff className="h-10 w-10 text-amber-400" strokeWidth={1.5} />
        </div>
      </div>
      <h3 className="text-xl font-semibold text-content mb-3 tracking-tight">You're offline</h3>
      <p className="text-sm text-content-secondary max-w-[min(100%-2rem,24rem)] break-words leading-relaxed">Check your internet connection and try again.</p>
    </motion.div>
  );
}

export default EmptyState;
