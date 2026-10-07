/**
 * Narrative Thread View
 *
 * Displays a narrative thread timeline with:
 * - Thesis evolution history
 * - Posts as cards with "what changed" highlights
 * - Evidence drawer for citations
 * - Dispute indicators for conflicts
 *
 * Part of the Narrative Operating System (Phase E)
 */

import React, { useState, useMemo } from 'react';
import {
  Clock,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  GitBranch,
  Lightbulb,
  HelpCircle,
  X,
  ExternalLink,
  Shield,
  Eye,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type PostType =
  | 'delta_update'
  | 'thesis_revision'
  | 'evidence_addition'
  | 'counterpoint'
  | 'question'
  | 'correction';

export type AuthorType = 'agent' | 'human';

export interface Citation {
  citationKey: string;
  artifactId: string;
  chunkId?: string;
  quote?: string;
  publishedAt?: number;
  sourceTitle?: string;
  sourceUrl?: string;
}

export interface NarrativePost {
  id: string;
  postId: string;
  postType: PostType;
  title?: string;
  content: string;
  changeSummary?: string[];
  citations: Citation[];
  authorType: AuthorType;
  authorId: string;
  authorConfidence?: number;
  isVerified: boolean;
  hasContradictions: boolean;
  requiresAdjudication: boolean;
  createdAt: number;
  supersedes?: string;
  supersededBy?: string;
  replies?: NarrativePost[];
}

export interface NarrativeThread {
  id: string;
  title: string;
  thesis: string;
  counterThesis?: string;
  phase: string;
  entityKeys: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ThreadDispute {
  id: string;
  disputeType: 'factual_error' | 'outdated' | 'missing_context' | 'alternative_interpretation';
  originalClaim: string;
  challengeClaim: string;
  status: 'open' | 'under_review' | 'resolved_original' | 'resolved_challenge' | 'merged';
  raisedAt: number;
}

interface NarrativeThreadViewProps {
  thread: NarrativeThread;
  posts: NarrativePost[];
  thesisRevisions?: NarrativePost[];
  openDisputes?: ThreadDispute[];
  onPostClick?: (post: NarrativePost) => void;
  onCitationClick?: (citation: Citation) => void;
  onDisputeClick?: (dispute: ThreadDispute) => void;
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getPostTypeConfig(type: PostType) {
  const configs: Record<PostType, { icon: React.ReactNode; label: string; color: string }> = {
    delta_update: { icon: <GitBranch className="w-3.5 h-3.5" />, label: 'Update', color: 'bg-blue-50 text-blue-700 border-blue-200' },
    thesis_revision: { icon: <Lightbulb className="w-3.5 h-3.5" />, label: 'Thesis Revision', color: 'bg-purple-50 text-purple-700 border-purple-200' },
    evidence_addition: { icon: <FileText className="w-3.5 h-3.5" />, label: 'Evidence', color: 'bg-indigo-50 text-content-secondary border-indigo-200' },
    counterpoint: { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: 'Counterpoint', color: 'bg-amber-50 text-amber-700 border-amber-200' },
    question: { icon: <HelpCircle className="w-3.5 h-3.5" />, label: 'Question', color: 'bg-surface-secondary text-content border-edge' },
    correction: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'Correction', color: 'bg-red-50 text-red-700 border-red-200' },
  };
  return configs[type];
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function ThesisEvolutionTimeline({
  revisions,
  currentThesis,
}: {
  revisions: NarrativePost[];
  currentThesis: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (revisions.length === 0) {
    return (
      <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-semibold text-purple-900">Current Thesis</span>
        </div>
        <p className="text-sm text-purple-800">{currentThesis}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg border border-edge overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-semibold text-content">Thesis Evolution</span>
          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded font-medium">
            {revisions.length} revision{revisions.length !== 1 ? 's' : ''}
          </span>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-content-secondary" /> : <ChevronRight className="w-4 h-4 text-content-secondary" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-edge">
          {/* Current thesis */}
          <div className="mt-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-purple-600">Current</span>
            </div>
            <p className="text-sm text-purple-800">{currentThesis}</p>
          </div>

          {/* Previous revisions */}
          <div className="mt-3 space-y-2 relative">
            <div className="absolute left-3 top-0 bottom-0 w-px bg-[color:var(--border-color)]" />
            {revisions.slice().reverse().map((rev, i) => (
              <div key={rev.id} className="pl-8 relative">
                <div className="absolute left-2 top-2 w-2 h-2 rounded-full bg-[color:var(--border-color)]" />
                <div className="p-2 bg-surface-secondary rounded-lg border border-edge">
                  <div className="flex items-center gap-2 text-xs text-content-secondary mb-1">
                    <Clock className="w-3 h-3" />
                    <span>{formatDate(rev.createdAt)}</span>
                    <span className="text-content-secondary">by {rev.authorId}</span>
                  </div>
                  <p className="text-xs text-content line-clamp-2">{rev.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  onClick,
  onCitationClick,
}: {
  post: NarrativePost;
  onClick?: () => void;
  onCitationClick?: (c: Citation) => void;
}) {
  const [showCitations, setShowCitations] = useState(false);
  const config = getPostTypeConfig(post.postType);

  return (
    <div
      className={`bg-surface rounded-lg border transition-all ${
        post.hasContradictions
          ? 'border-red-300'
          : post.requiresAdjudication
          ? 'border-amber-300'
          : 'border-edge'
      }`}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${config.color}`}>
              {config.icon}
              {config.label}
            </span>
            {post.authorType === 'agent' && (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium">
                AI
              </span>
            )}
            {post.isVerified && (
              <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />
            )}
            {post.hasContradictions && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border bg-red-50 text-red-700 border-red-200">
                <AlertTriangle className="w-3 h-3" /> Conflict
              </span>
            )}
            {post.requiresAdjudication && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200">
                <Eye className="w-3 h-3" /> Review
              </span>
            )}
          </div>
          <span className="text-xs text-content-secondary">{formatDate(post.createdAt)}</span>
        </div>

        {/* Title */}
        {post.title && (
          <h4
            className="text-base font-semibold text-content mb-2 cursor-pointer hover:text-blue-600"
            onClick={onClick}
          >
            {post.title}
          </h4>
        )}

        {/* Change Summary */}
        {post.changeSummary && post.changeSummary.length > 0 && (
          <div className="mb-3 p-2 bg-blue-50 rounded-lg border border-blue-200">
            <span className="text-xs font-semibold text-blue-600 mb-1 block">What Changed</span>
            <ul className="space-y-0.5">
              {post.changeSummary.map((change, i) => (
                <li key={i} className="text-xs text-blue-800 flex items-start gap-1">
                  <span className="text-blue-500 mt-0.5">•</span>
                  {change}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Content */}
        <p className="text-sm text-content line-clamp-4">{post.content}</p>

        {/* Citations Toggle */}
        {post.citations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-dashed border-edge">
            <button
              onClick={() => setShowCitations(!showCitations)}
              className="flex items-center gap-1 text-xs text-content-secondary hover:text-content"
            >
              <Shield className="w-3 h-3" />
              {post.citations.length} source{post.citations.length !== 1 ? 's' : ''}
              {showCitations ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>

            {showCitations && (
              <div className="mt-2 space-y-1">
                {post.citations.map((c, i) => (
                  <div
                    key={i}
                    onClick={() => onCitationClick?.(c)}
                    className="p-2 bg-surface-secondary rounded-lg border border-edge cursor-pointer hover:border-blue-300 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-blue-600">{c.citationKey}</span>
                      <ExternalLink className="w-3 h-3 text-content-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    {c.sourceTitle && (
                      <p className="text-xs text-content truncate mt-0.5">{c.sourceTitle}</p>
                    )}
                    {c.quote && (
                      <p className="text-xs text-content-secondary line-clamp-2 mt-1 italic">"{c.quote}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-edge flex items-center justify-between bg-surface-secondary">
        <div className="flex items-center gap-2 text-xs text-content-secondary">
          <span>{post.authorType === 'agent' ? 'Agent' : 'Human'}: {post.authorId}</span>
          {post.authorConfidence !== undefined && (
            <span className="px-1 py-0.5 bg-surface rounded text-content-secondary">
              {Math.round(post.authorConfidence * 100)}% conf
            </span>
          )}
        </div>
        {post.replies && post.replies.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-content-secondary">
            <MessageSquare className="w-3 h-3" />
            {post.replies.length}
          </span>
        )}
      </div>
    </div>
  );
}

function DisputePanel({
  disputes,
  onDisputeClick,
}: {
  disputes: ThreadDispute[];
  onDisputeClick?: (d: ThreadDispute) => void;
}) {
  if (disputes.length === 0) return null;

  const statusColors: Record<ThreadDispute['status'], string> = {
    open: 'bg-red-50 text-red-700 border-red-200',
    under_review: 'bg-amber-50 text-amber-700 border-amber-200',
    resolved_original: 'bg-indigo-50 text-content-secondary border-indigo-200',
    resolved_challenge: 'bg-blue-50 text-blue-700 border-blue-200',
    merged: 'bg-purple-50 text-purple-700 border-purple-200',
  };

  return (
    <div className="bg-red-50 rounded-lg border border-red-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <span className="text-sm font-semibold text-red-900">Open Disputes</span>
        <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded font-medium">
          {disputes.length}
        </span>
      </div>

      <div className="space-y-2">
        {disputes.map((d) => (
          <div
            key={d.id}
            onClick={() => onDisputeClick?.(d)}
            className="p-3 bg-surface rounded-lg border border-red-200 cursor-pointer hover:border-red-300 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${statusColors[d.status]}`}>
                {d.status.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-content-secondary">{formatDate(d.raisedAt)}</span>
            </div>
            <div className="text-xs text-content">
              <div className="mb-1">
                <span className="text-content-secondary">Original:</span> {d.originalClaim.slice(0, 100)}...
              </div>
              <div>
                <span className="text-content-secondary">Challenge:</span> {d.challengeClaim.slice(0, 100)}...
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function NarrativeThreadView({
  thread,
  posts,
  thesisRevisions = [],
  openDisputes = [],
  onPostClick,
  onCitationClick,
  onDisputeClick,
  className = '',
}: NarrativeThreadViewProps) {
  const [filterType, setFilterType] = useState<PostType | null>(null);

  const filteredPosts = useMemo(() => {
    if (!filterType) return posts;
    return posts.filter((p) => p.postType === filterType);
  }, [posts, filterType]);

  const postTypeCounts = useMemo(() => {
    const counts: Record<PostType, number> = {
      delta_update: 0,
      thesis_revision: 0,
      evidence_addition: 0,
      counterpoint: 0,
      question: 0,
      correction: 0,
    };
    posts.forEach((p) => {
      counts[p.postType]++;
    });
    return counts;
  }, [posts]);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Thread Header */}
      <div className="bg-surface rounded-lg border border-edge p-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2 py-1 bg-surface-secondary text-content text-xs font-medium rounded">
            {thread.phase}
          </span>
          <span className="text-xs text-content-secondary">{formatDate(thread.updatedAt)}</span>
        </div>
        <h1 className="text-2xl font-bold text-content mb-3">{thread.title}</h1>
        <div className="flex flex-wrap gap-1.5">
          {thread.entityKeys.map((key) => (
            <span key={key} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full font-medium">
              {key}
            </span>
          ))}
        </div>
      </div>

      {/* Thesis Evolution */}
      <ThesisEvolutionTimeline revisions={thesisRevisions} currentThesis={thread.thesis} />

      {/* Counter-thesis if exists */}
      {thread.counterThesis && (
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-semibold text-amber-900">Counter-Thesis</span>
          </div>
          <p className="text-sm text-amber-800">{thread.counterThesis}</p>
        </div>
      )}

      {/* Open Disputes */}
      <DisputePanel disputes={openDisputes} onDisputeClick={onDisputeClick} />

      {/* Post Type Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterType(null)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            !filterType
              ? 'bg-content text-surface border-[color:var(--text-primary)]'
              : 'bg-surface text-content border-edge hover:border-content-secondary'
          }`}
        >
          All ({posts.length})
        </button>
        {(Object.keys(postTypeCounts) as PostType[]).map((type) => {
          if (postTypeCounts[type] === 0) return null;
          const config = getPostTypeConfig(type);
          return (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                filterType === type
                  ? 'bg-content text-surface border-[color:var(--text-primary)]'
                  : 'bg-surface text-content border-edge hover:border-content-secondary'
              }`}
            >
              {config.label} ({postTypeCounts[type]})
            </button>
          );
        })}
      </div>

      {/* Posts Timeline */}
      <div className="space-y-4">
        {filteredPosts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-content-secondary">No posts match this filter</p>
          </div>
        ) : (
          filteredPosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onClick={() => onPostClick?.(post)}
              onCitationClick={onCitationClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default NarrativeThreadView;
