/**
 * ArtifactHost — Right panel displaying the durable artifact.
 *
 * Shows reports, notebooks, entity views with business-oriented tabs.
 * This is the "main thing the user keeps" in the object-first design.
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Share2,
  Download,
  ExternalLink,
  Bookmark,
  MoreHorizontal,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { ArtifactTabs, type ArtifactTab } from "./ArtifactTabs";

// Types
interface ReportSection {
  id: string;
  title: string;
  content: string;
  confidence?: "high" | "medium" | "low";
  sourceCount?: number;
}

interface Source {
  id: string;
  title: string;
  url?: string;
  domain: string;
  confidence: number;
  date?: string;
}

interface ActivityEvent {
  id: string;
  type: "created" | "updated" | "synced" | "exported";
  description: string;
  timestamp: Date;
  user?: string;
}

interface ArtifactFile {
  id: string;
  name: string;
  type: string;
  size: string;
  url?: string;
}

interface ArtifactHostProps {
  /** Artifact title */
  title: string;
  /** Artifact type */
  type: "report" | "notebook" | "entity" | "draft";
  /** Current tab */
  activeTab: ArtifactTab;
  /** Tab change handler */
  onTabChange: (tab: ArtifactTab) => void;
  /** Report sections (for brief/notebook tabs) */
  sections?: ReportSection[];
  /** Sources (for sources tab) */
  sources?: Source[];
  /** Activity events (for activity tab) */
  activity?: ActivityEvent[];
  /** Files (for files tab) */
  files?: ArtifactFile[];
  /** Last updated timestamp */
  lastUpdated?: Date;
  /** Confidence score (0-100) */
  confidenceScore?: number;
  /** Whether artifact is being tracked */
  isTracked?: boolean;
  /** Track toggle handler */
  onTrackToggle?: () => void;
  /** Share handler */
  onShare?: () => void;
  /** Export handler */
  onExport?: (format: "pdf" | "csv" | "notion") => void;
  /** Optional className */
  className?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Empty state - no content yet */
  isEmpty?: boolean;
}

// Tab content components
function BriefView({ sections }: { sections?: ReportSection[] }) {
  if (!sections || sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <FileText className="w-6 h-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-2">No brief yet</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Start a conversation in the chat panel to generate an executive brief.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <motion.div
          key={section.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{section.title}</h3>
            {section.confidence && (
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  section.confidence === "high" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                  section.confidence === "medium" && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                  section.confidence === "low" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}
              >
                {section.confidence} confidence
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {section.content}
          </p>
          {section.sourceCount && (
            <p className="text-xs text-muted-foreground">
              Based on {section.sourceCount} source{section.sourceCount !== 1 ? "s" : ""}
            </p>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function NotebookView({ sections }: { sections?: ReportSection[] }) {
  return (
    <div className="space-y-8">
      {sections?.map((section, idx) => (
        <motion.section
          key={section.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05 }}
          className="border-l-2 border-primary/20 pl-4"
        >
          <h2 className="text-xl font-semibold mb-3">{section.title}</h2>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {section.content}
          </div>
        </motion.section>
      ))}
    </div>
  );
}

function SourcesView({ sources }: { sources?: Source[] }) {
  if (!sources || sources.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No sources yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sources.map((source) => (
        <div
          key={source.id}
          className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-colors"
        >
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-muted-foreground">
              {source.domain.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{source.title}</p>
            <p className="text-xs text-muted-foreground">{source.domain}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded",
                source.confidence > 80 && "bg-emerald-100 text-emerald-700",
                source.confidence > 50 && source.confidence <= 80 && "bg-amber-100 text-amber-700",
                source.confidence <= 50 && "bg-red-100 text-red-700"
              )}
            >
              {source.confidence}%
            </span>
            {source.url && (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-muted rounded"
              >
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityView({ activity }: { activity?: ActivityEvent[] }) {
  if (!activity || activity.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activity.map((event) => (
        <div key={event.id} className="flex items-start gap-3">
          <div
            className={cn(
              "w-2 h-2 rounded-full mt-2",
              event.type === "created" && "bg-emerald-500",
              event.type === "updated" && "bg-blue-500",
              event.type === "synced" && "bg-purple-500",
              event.type === "exported" && "bg-amber-500"
            )}
          />
          <div className="flex-1">
            <p className="text-sm">{event.description}</p>
            <p className="text-xs text-muted-foreground">
              {event.timestamp.toLocaleString()}
              {event.user && ` · ${event.user}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilesView({ files }: { files?: ArtifactFile[] }) {
  if (!files || files.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No files yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {files.map((file) => (
        <a
          key={file.id}
          href={file.url}
          className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {file.type} · {file.size}
            </p>
          </div>
        </a>
      ))}
    </div>
  );
}

// Action bar component
function ArtifactActionBar({
  isTracked,
  onTrackToggle,
  onShare,
  onExport,
}: {
  isTracked?: boolean;
  onTrackToggle?: () => void;
  onShare?: () => void;
  onExport?: (format: "pdf" | "csv" | "notion") => void;
}) {
  const [exportOpen, setExportOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-2">
      {/* Track/Untrack */}
      {onTrackToggle && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onTrackToggle}
          className={cn(
            "gap-1.5",
            isTracked && "text-primary"
          )}
        >
          <Bookmark className={cn("w-4 h-4", isTracked && "fill-current")} />
          <span className="hidden sm:inline">{isTracked ? "Tracked" : "Track"}</span>
        </Button>
      )}

      {/* Share */}
      {onShare && (
        <Button variant="ghost" size="sm" onClick={onShare} className="gap-1.5">
          <Share2 className="w-4 h-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
      )}

      {/* Export dropdown */}
      {onExport && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExportOpen(!exportOpen)}
            className="gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>

          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[120px] z-50">
              {(["pdf", "csv", "notion"] as const).map((format) => (
                <button
                  key={format}
                  onClick={() => {
                    onExport(format);
                    setExportOpen(false);
                  }}
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted rounded-md capitalize"
                >
                  {format}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* More actions */}
      <Button variant="ghost" size="icon" className="h-8 w-8">
        <MoreHorizontal className="w-4 h-4" />
      </Button>
    </div>
  );
}

export function ArtifactHost({
  title,
  type,
  activeTab,
  onTabChange,
  sections,
  sources,
  activity,
  files,
  lastUpdated,
  confidenceScore,
  isTracked,
  onTrackToggle,
  onShare,
  onExport,
  className,
  isLoading,
  isEmpty,
}: ArtifactHostProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);

  if (isEmpty) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            <FileText className="w-8 h-8 text-primary/60" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Start your research</h2>
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            Ask a question in the chat panel to generate a research artifact. 
            You&apos;ll see the results here.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {["What does Stripe do?", "Compare Vercel to Netlify", "Summarize the latest YC batch"].map(
              (suggestion) => (
                <button
                  key={suggestion}
                  className="px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                >
                  {suggestion}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-border/50">
        <div className="space-y-1 min-w-0 flex-1">
          {/* Title */}
          <h1 className="text-2xl font-semibold truncate">{title}</h1>

          {/* Meta row */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleDateString()}`
                : "Draft"}
            </span>
            {confidenceScore !== undefined && (
              <span className="flex items-center gap-1.5">
                {confidenceScore > 70 ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                )}
                {confidenceScore}% confidence
              </span>
            )}
            <span className="px-2 py-0.5 bg-muted rounded-full text-xs capitalize">
              {type}
            </span>
          </div>
        </div>

        {/* Actions */}
        <ArtifactActionBar
          isTracked={isTracked}
          onTrackToggle={onTrackToggle}
          onShare={onShare}
          onExport={onExport}
        />
      </div>

      {/* Tabs */}
      <div className="px-6 py-3 border-b border-border/50">
        <ArtifactTabs activeTab={activeTab} onTabChange={onTabChange} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === "brief" && <BriefView sections={sections} />}
            {activeTab === "notebook" && <NotebookView sections={sections} />}
            {activeTab === "sources" && <SourcesView sources={sources} />}
            {activeTab === "activity" && <ActivityView activity={activity} />}
            {activeTab === "files" && <FilesView files={files} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
