/**
 * ReportsHomeEnhanced — Reports/Packet surface with ObjectFirst layout integration.
 *
 * This wraps the existing ReportsHome with the new object-first two-column layout
 * when the feature flag is enabled. Falls back to legacy ReportsHome when disabled.
 */

import React, { useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ObjectFirstSurfaceHost } from "@/layouts/ObjectFirstSurfaceHost";
import type { ArtifactTab } from "@/features/artifacts/components/ArtifactTabs";
import type { LensId } from "@/features/controlPlane/components/searchTypes";
import type { ArtifactMode, ArtifactState } from "@/features/artifacts/context/ArtifactContext";
import { ReportsHome as LegacyReportsHome } from "./ReportsHome";
import { useFeatureFlag } from "@/lib/featureFlags";

// Types
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
  suggestions?: Array<{
    id: string;
    label: string;
    onClick: () => void;
  }>;
}

interface ArtifactSection {
  id: string;
  title: string;
  content: string;
  confidence?: "high" | "medium" | "low";
  sourceCount?: number;
}

interface ArtifactSource {
  id: string;
  title: string;
  domain: string;
  confidence: number;
  url?: string;
}

interface ActivityEvent {
  id: string;
  type: "created" | "updated" | "synced" | "exported";
  description: string;
  timestamp: Date;
}

/**
 * ReportsHomeEnhanced — Object-first integrated reports surface.
 *
 * Usage:
 * - Automatically detects feature flag
 * - Renders ObjectFirst layout when enabled
 * - Falls back to legacy ReportsHome when disabled
 * - URL opt-in: ?layout=object-first or ?ff_object-first-reports=1
 */
export function ReportsHomeEnhanced() {
  // Check feature flag
  const objectFirstEnabled = useFeatureFlag("object-first-reports");

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ArtifactTab>("brief");
  const [mode, setMode] = useState<ArtifactMode>("quick");
  const [lens, setLens] = useState<LensId>("investor");
  const [entityState, setEntityState] = useState<ArtifactState>("saved");
  const [selectedReport, setSelectedReport] = useState<string | null>(null);

  // Get entity from URL
  const [searchParams] = useSearchParams();
  const entityName = selectedReport || searchParams.get("entity") || "Saved Reports";

  // Handle submit
  const handleSubmit = useCallback(() => {
    if (!inputValue.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    setTimeout(() => {
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `I've updated the report with information about "${inputValue}".`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1000);
  }, [inputValue]);

  // Quick actions
  const quickActions = useMemo(
    () => [
      {
        id: "refresh",
        label: "Refresh data",
        onClick: () => setEntityState("syncing"),
      },
      {
        id: "compare",
        label: "Compare reports",
        onClick: () => {},
      },
      {
        id: "export",
        label: "Export all",
        onClick: () => {},
      },
    ],
    []
  );

  // Sample data for selected report
  const artifactSections: ArtifactSection[] = useMemo(
    () =>
      selectedReport
        ? [
            {
              id: "overview",
              title: "Overview",
              content: `Comprehensive research report on ${entityName}. This report covers market position, competitive analysis, and growth trajectory.`,
              confidence: "high",
              sourceCount: 24,
            },
            {
              id: "market-position",
              title: "Market Position",
              content: `${entityName} holds a strong position in their target market with significant moats around their core business.`,
              confidence: "high",
              sourceCount: 15,
            },
            {
              id: "risks",
              title: "Key Risks",
              content: "Regulatory changes, competitive pressure, and macroeconomic factors present the primary risks to watch.",
              confidence: "medium",
              sourceCount: 8,
            },
          ]
        : [],
    [selectedReport, entityName]
  );

  const artifactSources: ArtifactSource[] = useMemo(
    () => [
      { id: "1", title: "Annual Report", domain: "sec.gov", confidence: 98 },
      { id: "2", title: "Market Analysis", domain: "bloomberg.com", confidence: 92 },
      { id: "3", title: "Competitor Benchmark", domain: "cbinsights.com", confidence: 85 },
    ],
    []
  );

  const activity: ActivityEvent[] = useMemo(
    () => [
      {
        id: "1",
        type: "created",
        description: "Report created",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
      {
        id: "2",
        type: "updated",
        description: "Data refreshed",
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
      },
    ],
    []
  );

  // If not enabled, render legacy
  if (!objectFirstEnabled) {
    return <LegacyReportsHome />;
  }

  return (
    <ObjectFirstSurfaceHost
      surfaceId="packets"
      entityName={entityName}
      entityState={entityState}
      mode={mode}
      onModeChange={setMode}
      syncStatus="Saved"
      sourceCount={24}
      lens={lens}
      onLensChange={setLens}
      messages={messages}
      isLoading={isLoading}
      inputValue={inputValue}
      onInputChange={setInputValue}
      onSubmit={handleSubmit}
      quickActions={quickActions}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      artifactTitle={entityName}
      artifactType="report"
      artifactSections={artifactSections}
      artifactSources={artifactSources}
      artifactActivity={activity}
      lastUpdated={new Date(Date.now() - 1000 * 60 * 30)}
      confidenceScore={92}
      isEmpty={!selectedReport && messages.length === 0}
    >
      <LegacyReportsHome />
    </ObjectFirstSurfaceHost>
  );
}

export default ReportsHomeEnhanced;
