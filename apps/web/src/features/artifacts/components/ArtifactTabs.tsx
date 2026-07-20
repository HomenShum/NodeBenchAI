/**
 * ArtifactTabs — Business-oriented tabs for artifact navigation.
 *
 * Tabs: Brief | Notebook | Sources | Activity | Files
 *
 * This replaces technical/tab-gated sections with clear business concepts.
 */

import React from "react";
import { motion } from "framer-motion";
import {
  FileText,
  BookOpen,
  Database,
  Activity,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ArtifactTab = "brief" | "notebook" | "sources" | "activity" | "files";

interface TabConfig {
  id: ArtifactTab;
  label: string;
  icon: React.ElementType;
  description: string;
}

const TABS: TabConfig[] = [
  {
    id: "brief",
    label: "Brief",
    icon: FileText,
    description: "Executive summary",
  },
  {
    id: "notebook",
    label: "Notebook",
    icon: BookOpen,
    description: "Full structured report",
  },
  {
    id: "sources",
    label: "Sources",
    icon: Database,
    description: "Evidence and citations",
  },
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    description: "Run history and updates",
  },
  {
    id: "files",
    label: "Files",
    icon: FolderOpen,
    description: "Attachments and exports",
  },
];

interface ArtifactTabsProps {
  /** Currently active tab */
  activeTab: ArtifactTab;
  /** Tab change handler */
  onTabChange: (tab: ArtifactTab) => void;
  /** Optional className */
  className?: string;
  /** Whether to show descriptions (larger screens) */
  showDescriptions?: boolean;
}

export function ArtifactTabs({
  activeTab,
  onTabChange,
  className,
  showDescriptions = false,
}: ArtifactTabsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 p-1 bg-muted/50 rounded-xl border border-border/50",
        className
      )}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Icon className="w-4 h-4" />
            <span>{tab.label}</span>
            {showDescriptions && !isActive && (
              <span className="hidden lg:inline text-xs text-muted-foreground/70">
                {tab.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Vertical variant for side panels
interface ArtifactTabsVerticalProps {
  activeTab: ArtifactTab;
  onTabChange: (tab: ArtifactTab) => void;
  className?: string;
}

export function ArtifactTabsVertical({
  activeTab,
  onTabChange,
  className,
}: ArtifactTabsVerticalProps) {
  return (
    <div className={cn("flex flex-col gap-1 p-2", className)}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 text-left",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <div className="flex flex-col">
              <span>{tab.label}</span>
              <span className="text-xs text-muted-foreground/70">
                {tab.description}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
