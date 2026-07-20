import { useQuery } from "convex/react";
import { DeepAgentProgress } from "@/features/agents/views/DeepAgentProgress";
import { TaskPlanPanel, workflowProgressToTaskSteps } from "@/features/agents/views/TaskPlanPanel";
import { InlineMetrics, type WorkflowMetrics } from "@/features/agents/views/WorkflowMetricsBar";
import { api } from "@convex/_generated/api";
import { useUIMessages } from "@convex-dev/agent/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useMemo, useState } from "react";
import { Sparkles, TrendingUp, Users, Briefcase, FileText, Lightbulb, ChevronRight, ChevronDown, Loader2, Radio, Activity, Bot, Globe, Database, Zap, CheckCircle2, AlertCircle, Link2, ExternalLink, Calendar, Youtube, FileSearch, Copy, Check, Image as ImageIcon, Play, User } from "lucide-react";
import { Id } from "@convex/_generated/dataModel";
import { toolPartsToTimelineSteps, type TimelineStep } from "@features/agents/components/FastAgentPanel/StepTimeline";

// Artifact streaming integration
import { ArtifactStoreProvider } from "@/hooks/useArtifactStore";
import { useArtifactStreamConsumer } from "@/hooks/useArtifactStreamConsumer";
import { EvidenceDrawer, WhatChangedStrip, type EvidenceSource } from "@/features/research/components/newsletter";
import { useInlineCitations, useSourcesList } from "@/hooks/useInlineCitations";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Media and Document components for unified view
import { RichMediaSection } from "@features/agents/components/FastAgentPanel/RichMediaSection";
import { DocumentActionGrid, type DocumentAction } from "@features/agents/components/FastAgentPanel/DocumentActionCard";
import type { ExtractedMedia } from "@features/agents/components/FastAgentPanel/utils/mediaExtractor";

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPER UTILITIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const truncateText = (text: string, max = 160) => {
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max)}...` : text;
};

// QuickActionButton Component - Refined Look
interface QuickActionButtonProps {
    icon: React.ReactNode;
    label: string;
    query: string;
    onClick: (query: string) => void;
}

function QuickActionButton({ icon, label, query, onClick }: QuickActionButtonProps) {
    return (
        <button
            type="button"
            onClick={() => onClick(query)}
            className="group flex items-center gap-3 px-4 py-3 bg-surface dark:bg-surface-secondary border border-edge dark:border-edge hover:border-primary/50 hover:bg-primary/5 text-foreground rounded-lg font-medium text-base shadow-sm transition-all duration-200 text-left w-full"
        >
            <span className="flex-shrink-0 p-2 bg-surface-secondary dark:bg-surface-secondary group-hover:bg-primary/10 rounded-lg text-content dark:text-content group-hover:text-primary transition-colors">
                {icon}
            </span>
            <span className="flex-1">{label}</span>
            <ChevronRight className="w-4 h-4 text-content-secondary group-hover:text-primary opacity-0 group-hover:opacity-100 transition-all" />
        </button>
    );
}

// SuggestedFollowUps Component
interface SuggestedFollowUpsProps {
    onSelectFollowUp: (query: string) => void;
    contentContext?: string;
}

function SuggestedFollowUps({ onSelectFollowUp, contentContext = "" }: SuggestedFollowUpsProps) {
    // Detect context from content
    const isCompany = /\b(LLC|Inc|Corporation|Company|startup|business)\b/i.test(contentContext);
    const isPerson = /\b(founder|CEO|CTO|executive|director)\b/i.test(contentContext);

    // Extract entity name from content (simple heuristic)
    const entityMatch = contentContext.match(/(?:^|\n)(?:First — to make sure.*?— )?(?:\*\*)?([A-Z][a-zA-Z0-9\s&]+(?:LLC|Inc|Corporation)?)/);
    const entityName = entityMatch ? entityMatch[1].trim() : "";

    // Generate contextual follow-ups
    const followUps = useMemo(() => {
        if (isCompany && entityName) {
            return [
                { icon: <TrendingUp className="w-4 h-4" />, label: "Full Report", query: `Run the full enrichment report for ${entityName} including founders, investors, corporate details, and competitive analysis.` },
                { icon: <Users className="w-4 h-4" />, label: "Founder Deep Dive", query: `Tell me about the founders of ${entityName} - their backgrounds, education, previous ventures, and expertise.` },
                { icon: <Briefcase className="w-4 h-4" />, label: "Client & Partner Analysis", query: `Who are the major clients and partners of ${entityName}? Include case studies if available.` },
                { icon: <FileText className="w-4 h-4" />, label: "IP & Patents", query: `What intellectual property, patents, and proprietary technology does ${entityName} have?` },
            ];
        } else if (isPerson && entityName) {
            return [
                { icon: <Users className="w-4 h-4" />, label: "Professional Background", query: `Tell me about ${entityName}'s professional background and career history.` },
                { icon: <Briefcase className="w-4 h-4" />, label: "Previous Ventures", query: `What companies or ventures has ${entityName} founded or been involved with?` },
                { icon: <FileText className="w-4 h-4" />, label: "Education & Expertise", query: `What is ${entityName}'s education background and areas of expertise?` },
            ];
        } else {
            return [
                { icon: <Lightbulb className="w-4 h-4" />, label: "More Details", query: `Provide more detailed information and context.` },
                { icon: <TrendingUp className="w-4 h-4" />, label: "Related Topics", query: `What are related topics and areas I should explore?` },
                { icon: <FileText className="w-4 h-4" />, label: "Recent News", query: `What is the latest news and recent developments?` },
            ];
        }
    }, [isCompany, isPerson, entityName]);

    return (
        <div className="mt-14 mb-10 p-6 bg-gradient-to-br from-surface-secondary to-[var(--accent-primary-bg)] dark:from-surface-secondary/50 dark:to-[var(--accent-primary-bg)] rounded-lg border border-edge dark:border-edge">
            <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                    <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-foreground">
                    Suggested Next Steps
                </h3>
            </div>
            <p className="text-sm text-content dark:text-content-secondary mb-6 flex items-center gap-2 flex-wrap">
                <span>Run a focused follow-up and append results to this live report.</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-content dark:bg-surface-secondary text-white dark:text-content rounded-full text-xs font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-surface"></span>
                    No refresh needed
                </span>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {followUps.map((followUp, idx) => (
                    <QuickActionButton
                        key={idx}
                        icon={followUp.icon}
                        label={followUp.label}
                        query={followUp.query}
                        onClick={onSelectFollowUp}
                    />
                ))}
            </div>
        </div>
    );
}

// Props for unified Live Dossier view
interface LiveDossierDocumentProps {
    threadId: string | null;
    isLoading?: boolean;
    onRunFollowUp?: (query: string) => void | Promise<void>;
    /** Extracted media from agent results (videos, images, sources, profiles) */
    media?: ExtractedMedia;
    /** Document actions (created/updated documents) */
    documents?: DocumentAction[];
    /** Handler for document selection */
    onDocumentSelect?: (documentId: string) => void;
}

// Wrapper component with ArtifactStoreProvider
export default function LiveDossierDocument(props: LiveDossierDocumentProps) {
    return (
        <ArtifactStoreProvider>
            <LiveDossierDocumentInner {...props} />
        </ArtifactStoreProvider>
    );
}

// Inner component with all the logic
function LiveDossierDocumentInner({
    threadId,
    isLoading = false,
    onRunFollowUp,
    media,
    documents = [],
    onDocumentSelect
}: LiveDossierDocumentProps) {
    // 1. Subscribe to the Agent's Output
    const streamingThread = useQuery(
        api.domains.agents.fastAgentPanelStreaming.getThreadByStreamId,
        threadId ? { threadId: threadId as Id<"chatThreadsStream"> } : "skip"
    );

    const agentThreadId = streamingThread?.agentThreadId;

    const { results: uiMessages } = useUIMessages(
        api.domains.agents.fastAgentPanelStreaming.getThreadMessagesWithStreaming,
        agentThreadId ? { threadId: agentThreadId as Id<"chatThreadsStream"> } : "skip",
        { initialNumItems: 50, stream: true }
    );

    const extractMessageText = (message: any) => {
        if (typeof message?.text === "string" && message.text.trim()) return message.text;
        if (Array.isArray(message?.content)) {
            const parts = message.content
                .filter((c: any) => typeof c?.text === "string")
                .map((c: any) => c.text)
                .join("\n\n");
            if (parts.trim()) return parts;
        }
        if (typeof message?.message?.text === "string") return message.message.text;
        // Tool-result fallback so we render appended outputs even if the agent didn't emit a final assistant message
        if (message?.type === "tool-result" || message?.kind === "tool-result") {
            const toolOutput = message?.output?.value ?? message?.output ?? message?.result;
            if (typeof toolOutput === "string" && toolOutput.trim()) return toolOutput;
        }
        return "";
    };

    // Filter out planner-only JSON artifacts and agent process messages
    const isPlannerArtifact = (text: string) => {
        const trimmed = text.trim();

        // Filter agent process/meta messages that clutter the output
        const agentProcessPatterns = [
            /^I've launched\s+(two|three|four|multiple|coordinated|the)/i,
            /^I've initiated\s/i,
            /^I'm now\s+(launching|running|searching|gathering)/i,
            /^I'll\s+(now|begin|start)\s/i,
            /^Once\s+(these|both|all|the)\s+(complete|return|finish)/i,
            /^Let me\s+(now|start|begin|search|gather)/i,
            /^Now\s+(let me|I'll|searching)/i,
            /^Starting\s+(the|my|to)\s/i,
            /^Initiating\s/i,
            /^Gathering\s+(information|data|details)/i,
            /^Searching\s+(for|across|through)/i,
        ];

        // Check if it's a short agent process message (< 500 chars and matches pattern)
        if (trimmed.length < 500 && agentProcessPatterns.some(p => p.test(trimmed))) {
            return true;
        }

        // Must start with JSON brackets for JSON filtering
        if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;

        // Check for common planner/metadata JSON patterns
        const plannerPatterns = [
            /"queryClassification"|"query_classification"/i,
            /"mode"\s*:\s*"(simple|complex)"/i,
            /"currentIntent"|"activeTheme"|"researchPlan"/i,
            /"delegationStrategy"|"agentAssignments"/i,
            /"workflowPhase"|"executionPlan"/i,
            /"toolSequence"|"nextSteps"/i,
            /"Compiled and Verified"|"Primary Agents"|"secundary"/i,
            /"InvestorSignals"|"AnnouncementMentions"/i,
            /"Late stage"|"completedTPC"|"memoryUpdated"/i,
            /"sectionConfidence"|"CrossSourceAlignment"/i,
            /"FundingRaiserVerification"|"SECAndRegulatoryVerification"/i,
            /"verifiedSources"|"summaryInsights"|"MarketSentiment"/i,
            /"RegulatoryFootprint"|"entityName"\s*:\s*".*funding.*week/i,
        ];

        if (plannerPatterns.some(pattern => pattern.test(trimmed))) return true;

        // Filter large JSON blocks without prose
        if (trimmed.length > 300 && /{[\s\S]*"[^"]+"\s*:/.test(trimmed)) {
            const withoutJsonStrings = trimmed.replace(/"[^"]*"/g, '');
            const hasProse = /[a-z]{20,}/i.test(withoutJsonStrings);
            if (!hasProse) return true;
        }

        return false;
    };

    const [appendTriggered, setAppendTriggered] = useState(false);
    const [isAppending, setIsAppending] = useState(false);
    const [justAppended, setJustAppended] = useState(false);

    // Citation sanitization schema - allows our injected sup/a elements
    const citationSchema = useMemo(() => ({
        ...defaultSchema,
        tagNames: [...(defaultSchema.tagNames ?? []), "sup"],
        attributes: {
            ...(defaultSchema.attributes ?? {}),
            a: ["href", "data-artifact-id", "className"],
            sup: ["className", "aria-label"],
        },
        protocols: {
            ...(defaultSchema.protocols ?? {}),
            href: ["#", "http", "https"],
        },
    }), []);

    // Evidence drawer state
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const assistantMessages = useMemo(() => {
        if (!uiMessages || uiMessages.length === 0) return [] as { raw: any; text: string }[];
        return uiMessages
            .filter((m: any) => {
                const role = m.role ?? m?.message?.role;
                return role === "assistant" || m?.type === "tool-result" || m?.kind === "tool-result";
            })
            .map((m: any) => ({ raw: m, text: extractMessageText(m) }))
            .filter(({ text }) => Boolean(text && text.trim()) && !isPlannerArtifact(text));
    }, [uiMessages]);


    const combinedContent = useMemo(() => {
        if (!assistantMessages.length) return "";
        return assistantMessages.map(({ text }) => text).join("\n\n---\n\n");
    }, [assistantMessages]);

    // Process inline citations for newsletter-style footnotes
    const { injectedMarkdown, numToArtifactId, artifactIdToNum } = useInlineCitations(combinedContent);
    const sourcesList = useSourcesList(numToArtifactId);

    const latestAssistantMessage = assistantMessages.length ? assistantMessages[assistantMessages.length - 1].raw : null;
    const hasContent = combinedContent.length > 0;
    const isStreaming = (latestAssistantMessage as any)?.status === "streaming" || (latestAssistantMessage as any)?.message?.status === "streaming";

    const latestUserMessage = useMemo(() => {
        if (!uiMessages || uiMessages.length === 0) return null;
        for (let i = uiMessages.length - 1; i >= 0; i--) {
            const msg = uiMessages[i] as any;
            const role = msg.role ?? msg?.message?.role;
            if (role === "user") return msg;
        }
        return null;
    }, [uiMessages]);

    const latestRequestText = useMemo(() => latestUserMessage ? extractMessageText(latestUserMessage) : "", [latestUserMessage]);

    const latestToolParts = useMemo(() => {
        const raw = latestAssistantMessage as any;
        const parts = raw?.parts || raw?.message?.parts;
        if (Array.isArray(parts)) {
            return parts.filter((p: any) => typeof p?.type === "string" && p.type.startsWith("tool-"));
        }
        return [] as any[];
    }, [latestAssistantMessage]);

    const timelineSteps = useMemo(() => toolPartsToTimelineSteps(latestToolParts).slice(-8), [latestToolParts]);

    // Artifact streaming - consume artifacts from reactive query (server persists, client hydrates)
    const { artifacts: allArtifacts, count: artifactCount } = useArtifactStreamConsumer({
        runId: agentThreadId || null,
        debug: false,
    });

    // Convert artifacts to EvidenceSource format for drawer
    const evidenceSources: EvidenceSource[] = useMemo(() => {
        return allArtifacts.map(a => ({
            id: a.id,
            title: a.title || 'Untitled',
            url: a.canonicalUrl || '',
            domain: a.host || '',
            type: a.canonicalUrl?.includes('youtube') ? 'youtube' as const :
                a.canonicalUrl?.includes('sec.gov') ? 'sec' as const :
                    a.canonicalUrl?.endsWith('.pdf') ? 'pdf' as const : 'web' as const,
            snippet: a.snippet,
            verified: a.flags?.isCited ?? false,
            discoveredAt: a.discoveredAt,
        }));
    }, [allArtifacts]);

    // Extract entity name from first heading in content
    const entityName = useMemo(() => {
        const match = combinedContent.match(/^#\s+(.+?)(?:\n|$)/m) ||
            combinedContent.match(/^##\s+(.+?)(?:\n|$)/m);
        return match ? match[1].trim() : 'Research Report';
    }, [combinedContent]);

    const observationStep = useMemo(() => {
        for (let i = timelineSteps.length - 1; i >= 0; i--) {
            const step = timelineSteps[i];
            if (step.status === "error" || step.result || step.description) return step;
        }
        return null;
    }, [timelineSteps]);

    const agentStatuses = useMemo(() => {
        const statusMap = new Map<string, TimelineStep["status"]>();
        const inferRoleFromName = (name: string | undefined) => {
            const normalized = (name || "").toLowerCase();
            if (normalized.includes("document")) return "documentAgent";
            if (normalized.includes("media")) return "mediaAgent";
            if (normalized.includes("sec")) return "secAgent";
            if (normalized.includes("web")) return "webAgent";
            if (normalized.includes("delegate") || normalized.includes("coordinate")) return "coordinator";
            return undefined;
        };

        timelineSteps.forEach((step) => {
            const role = (step.agentRole || inferRoleFromName(step.toolName || step.title)) as string | undefined;
            if (!role) return;
            const current = statusMap.get(role);
            if (!current || current === "pending") {
                statusMap.set(role, step.status);
                return;
            }
            if (step.status === "error" || step.status === "running" || (step.status === "complete" && current !== "error")) {
                statusMap.set(role, step.status);
            }
        });

        return Array.from(statusMap.entries()).map(([role, status]) => ({ role: role as TimelineStep["agentRole"], status }));
    }, [timelineSteps]);

    const liveOutputPreview = useMemo(() => {
        return latestAssistantMessage ? extractMessageText(latestAssistantMessage as any) : "";
    }, [latestAssistantMessage]);

    const visibleSteps = (isAppending && !isStreaming) ? [] : timelineSteps;
    const visibleAgentStatuses = (isAppending && !isStreaming) ? [] : agentStatuses;
    const visibleObservation = (isAppending && !isStreaming) ? null : observationStep;
    const visibleLiveOutput = (isAppending && !isStreaming) ? "" : liveOutputPreview;

    // Track which follow-up is currently running
    const [currentFollowUpLabel, setCurrentFollowUpLabel] = useState<string>("");

    // Follow-up status handling
    const prevAppendingRef = useRef(false);
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
    const prevMessageCountRef = useRef(0);

    useEffect(() => {
        // Clear appending flags if streaming started (detected by new messages)
        if (appendTriggered && isStreaming) {
            setAppendTriggered(false);
        }

        // Clear loading state if NOT streaming and NOT in the triggered phase
        if (!isStreaming && !appendTriggered) {
            setIsAppending(false);
            setCurrentFollowUpLabel("");
        }

        // Detect NEW content arrival (message count increased)
        if (assistantMessages.length > prevMessageCountRef.current) {
            if (isAppending) {
                // New content arrived! Clear the loading state
                setIsAppending(false);
                setCurrentFollowUpLabel("");
                // Highlight the newest section
                setHighlightedIndex(assistantMessages.length - 1);
                setTimeout(() => {
                    setHighlightedIndex(-1);
                }, 3000);
            }
            prevMessageCountRef.current = assistantMessages.length;
        }

        // Store previous state for transition detection
        prevAppendingRef.current = isAppending;
    }, [appendTriggered, isStreaming, isAppending, assistantMessages.length]);

    const handleFollowUp = async (query: string) => {
        if (!onRunFollowUp) return;

        // Extract label from query for display
        const label = query.includes("full enrichment") ? "Full Research Report" :
            query.includes("Synthesize") ? "Synthesizing Final Report" :
                query.includes("founders") ? "Founder Deep Dive" :
                    query.includes("clients") || query.includes("partners") ? "Client & Partner Analysis" :
                        query.includes("intellectual property") || query.includes("patents") ? "IP & Patents" :
                            "Follow-up Research";

        setCurrentFollowUpLabel(label);
        setAppendTriggered(true);
        setIsAppending(true);
        let cleared = false;
        const clearFlags = () => {
            if (cleared) return;
            cleared = true;
            setAppendTriggered(false);
            setIsAppending(false);
            setCurrentFollowUpLabel("");
        };
        const timeoutId = setTimeout(clearFlags, 5000); // safety net if streaming never starts
        try {
            const result = onRunFollowUp(query);
            if (result && typeof (result as Promise<any>).then === "function") {
                await result;
            }
            // If streaming didn't kick in quickly, fall back to clearing flags
            if (!isStreaming) {
                setAppendTriggered(false);
                setIsAppending(false);
                setCurrentFollowUpLabel("");
            }
        } catch (error) {
            console.error("[LiveDossierDocument] Follow-up failed", error);
            clearFlags();
        } finally {
            clearTimeout(timeoutId);
        }
    };

    // Auto-scroll logic
    const bottomRef = useRef<HTMLDivElement>(null);
    const latestSectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isStreaming) {
            latestSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [combinedContent, isStreaming]);

    // 2. Enhanced Skeleton Loader with shimmer effect
    if (isLoading && !hasContent) {
        return (
            <div className="mx-auto max-w-[860px] px-6 sm:px-8 lg:px-10 py-10">
                {/* Shimmer animation container */}
                <div className="relative overflow-hidden">
                    {/* Shimmer overlay */}
                    <div className="absolute inset-0 -translate-x-full motion-safe:animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 dark:via-white/5 to-transparent" />

                    {/* Masthead skeleton - matches newspaper style */}
                    <div className="mb-10">
                        {/* Top rules */}
                        <div className="h-1 bg-surface-secondary dark:bg-surface-secondary mb-3 rounded" />
                        <div className="h-0.5 bg-surface-secondary dark:bg-surface-secondary mb-4 rounded" />

                        {/* Edition & Date row */}
                        <div className="flex justify-between items-center mb-5">
                            <div className="h-3 bg-surface-secondary dark:bg-surface-secondary rounded w-32" />
                            <div className="h-3 bg-surface-secondary dark:bg-surface-secondary rounded w-40" />
                        </div>

                        {/* Title skeleton - centered, large */}
                        <div className="flex justify-center mb-4">
                            <div className="h-12 sm:h-14 bg-surface-secondary dark:bg-surface-secondary rounded-lg w-3/4 sm:w-2/3" />
                        </div>

                        {/* Decorative divider */}
                        <div className="flex items-center gap-4 my-5">
                            <div className="flex-1 h-px bg-surface-secondary dark:bg-surface-secondary" />
                            <div className="w-3 h-3 bg-surface-secondary dark:bg-surface-secondary rounded-full" />
                            <div className="flex-1 h-px bg-surface-secondary dark:bg-surface-secondary" />
                        </div>

                        {/* Entity name skeleton */}
                        <div className="flex flex-col items-center gap-2 mb-6">
                            <div className="h-6 bg-surface-secondary dark:bg-surface-secondary rounded w-48" />
                            <div className="h-4 bg-surface-secondary dark:bg-surface-secondary rounded w-24" />
                        </div>

                        {/* Bottom rules */}
                        <div className="h-0.5 bg-surface-secondary dark:bg-surface-secondary mb-1 rounded" />
                        <div className="h-1 bg-surface-secondary dark:bg-surface-secondary rounded" />
                    </div>

                    {/* Content paragraphs skeleton */}
                    <div className="space-y-6">
                        {/* Paragraph 1 */}
                        <div className="space-y-3">
                            <div className="h-5 bg-surface-secondary dark:bg-surface-secondary rounded w-full" />
                            <div className="h-5 bg-surface-secondary dark:bg-surface-secondary rounded w-11/12" />
                            <div className="h-5 bg-surface-secondary dark:bg-surface-secondary rounded w-10/12" />
                            <div className="h-5 bg-surface-secondary dark:bg-surface-secondary rounded w-full" />
                        </div>

                        {/* Paragraph 2 */}
                        <div className="space-y-3">
                            <div className="h-5 bg-surface-secondary dark:bg-surface-secondary rounded w-full" />
                            <div className="h-5 bg-surface-secondary dark:bg-surface-secondary rounded w-9/12" />
                            <div className="h-5 bg-surface-secondary dark:bg-surface-secondary rounded w-11/12" />
                        </div>
                    </div>

                    {/* Source cards skeleton */}
                    <div className="mt-10 pt-8 border-t border-edge dark:border-edge">
                        <div className="h-5 bg-surface-secondary dark:bg-surface-secondary rounded w-40 mb-4" />
                        <div className="space-y-3">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center gap-3 p-4 border border-edge dark:border-edge rounded-lg">
                                    <div className="w-8 h-8 bg-surface-secondary dark:bg-surface-secondary rounded-lg shrink-0" />
                                    <div className="w-5 h-5 bg-surface-secondary dark:bg-surface-secondary rounded shrink-0" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 bg-surface-secondary dark:bg-surface-secondary rounded w-3/4" />
                                        <div className="h-3 bg-surface-secondary dark:bg-surface-secondary rounded w-1/2" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Add shimmer keyframes via style tag */}
                <style>{`
                    @keyframes shimmer {
                        100% { transform: translateX(100%); }
                    }
                `}</style>
            </div>
        );
    }

    if (!threadId) return <EmptyState />;

    // Click handler for citation links
    const handleCitationClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const link = target.closest('a[data-artifact-id]') as HTMLAnchorElement | null;
        if (!link) return;

        const artifactId = link.getAttribute('data-artifact-id');
        if (artifactId) {
            e.preventDefault();
            // Open the evidence drawer with the artifact highlighted
            setIsDrawerOpen(true);
        }
    };

    // Format edition label based on time of day
    const hour = new Date().getHours();
    const editionLabel = hour < 12 ? 'MORNING EDITION' : hour < 17 ? 'AFTERNOON EDITION' : 'EVENING EDITION';
    const formattedDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return (
        <div className="w-full animate-in fade-in duration-700 editorial-layout">
            {/* Newsletter Container - Wider for better readability */}
            <div className="mx-auto max-w-[860px] px-6 sm:px-8 lg:px-10 py-8 sm:py-10">

                {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                    NEWSPAPER-STYLE MASTHEAD
                    Classic newspaper design with serif fonts and decorative rules
                â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                <header className="mb-10">
                    {/* Top decorative rule */}
                    <div className="h-1 bg-content dark:bg-surface-secondary mb-3" />
                    <div className="h-0.5 bg-content-secondary dark:bg-surface-secondary mb-4" />

                    {/* Edition & Date Row */}
                    <div className="flex justify-between items-center text-xs sm:text-sm mb-5">
                        <div className="flex items-center gap-3">
                            <span className="font-bold text-muted-foreground">
                                {editionLabel}
                            </span>
                            {isStreaming && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-red-600 text-white rounded-full text-xs font-bold motion-safe:animate-pulse">
                                    <span className="w-1.5 h-1.5 bg-white rounded-full" />
                                    Live
                                </span>
                            )}
                        </div>
                        <span className="text-muted-foreground font-medium">
                            {formattedDate}
                        </span>
                    </div>

                    {/* Masthead Title - Serif font for newspaper feel */}
                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground text-center mb-4">
                        Today's Report
                    </h1>

                    {/* Decorative divider */}
                    <div className="flex items-center gap-4 my-5">
                        <div className="flex-1 h-px bg-[color:var(--border-color)] dark:bg-surface-secondary" />
                        <span className="text-content-secondary dark:text-content-secondary">✦</span>
                        <div className="flex-1 h-px bg-[color:var(--border-color)] dark:bg-surface-secondary" />
                    </div>

                    {/* Entity Name as Subhead */}
                    <div className="text-center mb-6">
                        <h2 className="text-xl sm:text-2xl font-semibold text-foreground italic">
                            {entityName}
                        </h2>
                        {allArtifacts.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setIsDrawerOpen(true)}
                                className="mt-2 inline-flex items-center gap-1.5 text-content-secondary dark:text-content-secondary hover:text-primary transition-colors text-sm font-medium"
                            >
                                <Link2 className="w-3.5 h-3.5" />
                                {allArtifacts.length} sources cited
                            </button>
                        )}
                    </div>

                    {/* Bottom double border */}
                    <div className="h-0.5 bg-content-secondary dark:bg-surface-secondary mb-1" />
                    <div className="h-1 bg-content dark:bg-surface-secondary" />
                </header>

                {(isAppending || isStreaming) && (
                    <LiveAgentTicker
                        isActive={isAppending || isStreaming}
                        followUpLabel={currentFollowUpLabel}
                        requestPreview={latestRequestText}
                        liveOutput={visibleLiveOutput}
                        agentStatuses={visibleAgentStatuses}
                        observationStep={visibleObservation}
                        steps={visibleSteps}
                    />
                )}

                {/* What Changed Strip - Show when there are new sources */}
                {hasContent && allArtifacts.length > 0 && (
                    <WhatChangedStrip
                        newSources={allArtifacts.filter(a => a.discoveredAt && Date.now() - a.discoveredAt < 60000).length}
                        updates={0}
                        contradictions={0}
                        lastUpdated={new Date()}
                        onViewDiff={() => setIsDrawerOpen(true)}
                        className="mb-6"
                    />
                )}

                {/* Main Content - Optimized for readability */}
                <article
                    className="prose prose-lg prose-neutral dark:prose-invert max-w-none
                        prose-p:leading-[1.8] prose-p:text-[17px] prose-p:text-foreground prose-p:mb-5
                        prose-a:text-primary prose-a:font-medium prose-a:no-underline hover:prose-a:underline
                        prose-headings:text-foreground prose-headings:font-bold prose-headings:tracking-tight
                        prose-h1:text-3xl prose-h1:mt-10 prose-h1:mb-5
                        prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:pb-2 prose-h2:border-b prose-h2:border-border/30
                        prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
                        prose-h4:text-lg prose-h4:mt-6 prose-h4:mb-2
                        prose-ul:my-4 prose-ul:space-y-1.5 prose-ol:my-4 prose-ol:space-y-1.5 prose-li:my-0 prose-li:leading-relaxed
                        prose-blockquote:border-l-4 prose-blockquote:border-edge prose-blockquote:bg-surface-secondary/60 dark:prose-blockquote:bg-surface-secondary/40 prose-blockquote:pl-5 prose-blockquote:pr-4 prose-blockquote:py-3 prose-blockquote:rounded-r-lg prose-blockquote:text-content dark:prose-blockquote:text-content prose-blockquote:not-italic
                        prose-hr:my-10 prose-hr:border-border/50
                        prose-code:bg-surface-secondary dark:prose-code:bg-surface-secondary prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:font-medium prose-code:before:content-none prose-code:after:content-none
                        prose-table:text-base
                        prose-strong:text-foreground prose-strong:font-semibold
                        prose-em:text-content dark:prose-em:text-content-secondary
                        [&_.nb-cite]:align-super [&_.nb-cite]:text-[0.65em] [&_.nb-cite]:font-semibold
                        [&_.nb-cite-link]:text-primary [&_.nb-cite-link]:no-underline [&_.nb-cite-link:hover]:underline"
                    onClick={handleCitationClick}
                    ref={latestSectionRef}
                >
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw, [rehypeSanitize, citationSchema]]}
                    >
                        {injectedMarkdown}
                    </ReactMarkdown>

                    {/* Streaming cursor */}
                    {isStreaming && (
                        <span className="inline-block w-2.5 h-6 bg-indigo-600 ml-1 motion-safe:animate-pulse align-middle rounded-sm"></span>
                    )}
                </article>

                {/* Sources Section - Improved visual design */}
                {hasContent && sourcesList.length > 0 && (
                    <section id="sources" className="mt-12 pt-8 border-t border-edge dark:border-edge scroll-mt-24">
                        <h3 className="text-base font-bold text-foreground mb-5 flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-content-secondary dark:text-content-secondary" />
                            Sources & References
                        </h3>
                        <div className="grid gap-2.5">
                            {sourcesList.map((source) => {
                                const isVideo = source.domain?.includes('youtube') || source.domain?.includes('vimeo');
                                const isPdf = source.url?.endsWith('.pdf') || source.kind === 'file';
                                const isSec = source.domain?.includes('sec.gov');

                                const SourceIcon = isVideo ? Youtube :
                                    isPdf ? FileText :
                                        isSec ? FileSearch :
                                            Globe;

                                return (
                                    <button
                                        type="button"
                                        key={source.artifactId}
                                        id={`source-${source.num}`}
                                        className="flex items-center gap-3 p-4 text-left rounded-lg border border-edge dark:border-edge hover:border-primary/40 hover:bg-primary/5 transition-all group"
                                        onClick={() => source.url && window.open(source.url, '_blank')}
                                    >
                                        <span className="w-7 h-7 flex items-center justify-center bg-surface-secondary dark:bg-surface-secondary rounded-lg text-xs font-bold text-content dark:text-content shrink-0">
                                            {source.num}
                                        </span>
                                        <SourceIcon className="w-4 h-4 text-content-secondary dark:text-content-secondary shrink-0 group-hover:text-primary transition-colors" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                                                {source.title}
                                            </div>
                                            <div className="text-xs text-content-secondary dark:text-content-secondary truncate">
                                                {source.domain}
                                            </div>
                                        </div>
                                        <ExternalLink className="w-3.5 h-3.5 text-content-secondary dark:text-content-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Inline Media Section - Collapsible */}
                {media && hasAnyMedia(media) && (
                    <CollapsibleMediaSection
                        media={media}
                        defaultExpanded={false}
                    />
                )}

                {/* Inline Documents Section - Collapsible */}
                {documents && documents.length > 0 && (
                    <CollapsibleDocumentsSection
                        documents={documents}
                        onDocumentSelect={onDocumentSelect}
                        defaultExpanded={false}
                    />
                )}

                {/* Deep Agent Progress - Task Plan Panel with Metrics */}
                {streamingThread?.workflowProgress && (
                    <div className="mb-12 border-t-2 border-edge pt-8 animate-in fade-in duration-500">
                        <TaskPlanPanel
                            steps={workflowProgressToTaskSteps(streamingThread.workflowProgress)}
                            metrics={streamingThread.workflowProgress.metrics as WorkflowMetrics}
                            isRunning={isStreaming || isAppending}
                            title="Research Progress"
                        />
                    </div>
                )}

                {/* Final Synthesis Action - Refined */}
                {hasContent && onRunFollowUp && !isStreaming && (
                    <div className="mt-12 mb-10 flex justify-center">
                        <button
                            type="button"
                            onClick={() => handleFollowUp("Synthesize all the above information into a single, comprehensive, and well-structured final report. Remove redundancies and organize logically.")}
                            disabled={isAppending}
                            className={`btn-primary-sm group flex items-center gap-3 px-8 py-4 rounded-full font-semibold text-base shadow-xl ${isAppending ? 'opacity-80 cursor-not-allowed scale-100' : ''}`}
                        >
                            {isAppending ? (
                                <Loader2 className="w-5 h-5 motion-safe:animate-spin text-white/80" />
                            ) : (
                                <Sparkles className="w-5 h-5 text-white/80 group-hover:motion-safe:animate-pulse" />
                            )}
                            <span className="tracking-wide">
                                {isAppending ? 'Synthesizing Report...' : 'Synthesize Final Report'}
                            </span>
                        </button>
                    </div>
                )}

                {/* Suggested Follow-ups Section - Only show when content is ready and callback provided */}
                {hasContent && onRunFollowUp && (
                    <SuggestedFollowUps
                        onSelectFollowUp={handleFollowUp}
                        contentContext={combinedContent}
                    />
                )}

                <div ref={bottomRef} />

                {/* Footer */}
                <footer className="mt-12 pt-4 border-t border-edge dark:border-edge text-center">
                    <p className="text-sm text-content-secondary dark:text-content-secondary">
                        AI Assistant • {new Date().toLocaleTimeString()}
                    </p>
                </footer>
            </div>

            {/* Evidence Drawer - Right sidebar (for deep dive) */}
            <EvidenceDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                sources={evidenceSources}
                onSourceClick={(source) => {
                    if (source.url) window.open(source.url, '_blank');
                }}
            />
        </div>
    );
}

function EmptyState() {
    return (
        <div className="mx-auto max-w-[860px] px-6 sm:px-8 lg:px-10 py-16">
            <div className="text-center">
                {/* Icon container - rounded-lg for consistency */}
                <div className="inline-flex items-center justify-center p-6 rounded-lg bg-gradient-to-br from-[var(--accent-primary-bg)] to-surface-secondary dark:from-[var(--accent-primary-bg)] dark:to-surface-secondary/70 mb-6">
                    <FileText className="w-10 h-10 text-indigo-600 dark:text-indigo-400" />
                </div>

                {/* Heading */}
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
                    Your Live Report Awaits
                </h2>

                {/* Description */}
                <p className="text-muted-foreground max-w-md mx-auto mb-8 leading-relaxed">
                    Start a research query to generate a comprehensive live report with verified sources,
                    rich media, and actionable insights -- all updated in real-time.
                </p>

                {/* Feature hints */}
                <div className="flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/50 rounded-lg">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span>Multi-source verification</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/50 rounded-lg">
                        <Youtube className="w-4 h-4 text-red-500" />
                        <span>Media discovery</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/50 rounded-lg">
                        <Link2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        <span>Inline citations</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COLLAPSIBLE MEDIA SECTION - Unified inline display
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function hasAnyMedia(media: ExtractedMedia): boolean {
    return (
        (media.youtubeVideos?.length || 0) > 0 ||
        (media.images?.length || 0) > 0 ||
        (media.webSources?.length || 0) > 0 ||
        (media.secDocuments?.length || 0) > 0 ||
        (media.profiles?.length || 0) > 0
    );
}

function getMediaCounts(media: ExtractedMedia) {
    return {
        videos: media.youtubeVideos?.length || 0,
        images: media.images?.length || 0,
        sources: (media.webSources?.length || 0) + (media.secDocuments?.length || 0),
        profiles: media.profiles?.length || 0,
    };
}

interface CollapsibleMediaSectionProps {
    media: ExtractedMedia;
    defaultExpanded?: boolean;
}

function CollapsibleMediaSection({ media, defaultExpanded = false }: CollapsibleMediaSectionProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const counts = getMediaCounts(media);
    const totalCount = counts.videos + counts.images + counts.sources + counts.profiles;

    if (totalCount === 0) return null;

    return (
        <section className="mt-8 mb-6 border border-edge dark:border-edge rounded-lg overflow-hidden bg-surface-secondary/50 dark:bg-surface-secondary/30">
            {/* Header - Always visible */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 transition-colors text-left"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                        <ImageIcon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">Media & Evidence</h3>
                        <p className="text-xs text-content dark:text-content-secondary">
                            {counts.videos > 0 && `${counts.videos} videos`}
                            {counts.videos > 0 && counts.images > 0 && " · "}
                            {counts.images > 0 && `${counts.images} images`}
                            {(counts.videos > 0 || counts.images > 0) && counts.sources > 0 && " · "}
                            {counts.sources > 0 && `${counts.sources} sources`}
                            {(counts.videos > 0 || counts.images > 0 || counts.sources > 0) && counts.profiles > 0 && " · "}
                            {counts.profiles > 0 && `${counts.profiles} people`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-content dark:text-content bg-surface-secondary dark:bg-surface-secondary px-2.5 py-1 rounded-full">
                        {totalCount}
                    </span>
                    {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-content-secondary dark:text-content-secondary" />
                    ) : (
                        <ChevronRight className="w-4 h-4 text-content-secondary dark:text-content-secondary" />
                    )}
                </div>
            </button>

            {/* Content - Collapsible */}
            {isExpanded && (
                <div className="px-4 pb-4 pt-2 border-t border-edge dark:border-edge animate-in slide-in-from-top-2 duration-200">
                    <RichMediaSection media={media} />
                </div>
            )}
        </section>
    );
}

interface CollapsibleDocumentsSectionProps {
    documents: DocumentAction[];
    onDocumentSelect?: (documentId: string) => void;
    defaultExpanded?: boolean;
}

function CollapsibleDocumentsSection({ documents, onDocumentSelect, defaultExpanded = false }: CollapsibleDocumentsSectionProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    if (documents.length === 0) return null;

    const createdCount = documents.filter(d => d.action === 'created').length;
    const updatedCount = documents.filter(d => d.action === 'updated').length;

    return (
        <section className="mt-6 mb-6 border border-edge dark:border-edge rounded-lg overflow-hidden bg-surface-secondary/50 dark:bg-surface-secondary/30">
            {/* Header - Always visible */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 transition-colors text-left"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-500/10">
                        <FileText className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">Generated Documents</h3>
                        <p className="text-xs text-content dark:text-content-secondary">
                            {createdCount > 0 && `${createdCount} created`}
                            {createdCount > 0 && updatedCount > 0 && " · "}
                            {updatedCount > 0 && `${updatedCount} updated`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-content dark:text-content bg-surface-secondary dark:bg-surface-secondary px-2.5 py-1 rounded-full">
                        {documents.length}
                    </span>
                    {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-content-secondary dark:text-content-secondary" />
                    ) : (
                        <ChevronRight className="w-4 h-4 text-content-secondary dark:text-content-secondary" />
                    )}
                </div>
            </button>

            {/* Content - Collapsible */}
            {isExpanded && (
                <div className="px-4 pb-4 pt-2 border-t border-edge dark:border-edge animate-in slide-in-from-top-2 duration-200">
                    <DocumentActionGrid
                        documents={documents}
                        onDocumentSelect={onDocumentSelect}
                        title=""
                    />
                </div>
            )}
        </section>
    );
}

interface LiveAgentTickerProps {
    isActive: boolean;
    followUpLabel?: string;
    requestPreview?: string;
    liveOutput?: string;
    agentStatuses: { role: TimelineStep["agentRole"]; status: TimelineStep["status"] }[];
    observationStep: TimelineStep | null;
    steps: TimelineStep[];
}

// Progress Ring Component
function ProgressRing({ progress, size = 48, strokeWidth = 3 }: { progress: number; size?: number; strokeWidth?: number }) {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (progress / 100) * circumference;

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90" width={size} height={size}>
                {/* Background circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth={strokeWidth}
                    fill="none"
                />
                {/* Progress circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="url(#progressGradient)"
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className="transition-all duration-500 ease-out"
                />
                <defs>
                    <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-white">{Math.round(progress)}%</span>
            </div>
        </div>
    );
}

// Agent Icon Component
function AgentIcon({ role, status }: { role: string; status: TimelineStep["status"] }) {
    const icons: Record<string, React.ReactNode> = {
        coordinator: <Users className="w-3.5 h-3.5" />,
        documentAgent: <FileText className="w-3.5 h-3.5" />,
        mediaAgent: <Database className="w-3.5 h-3.5" />,
        secAgent: <Briefcase className="w-3.5 h-3.5" />,
        webAgent: <Globe className="w-3.5 h-3.5" />,
    };

    const statusColors = {
        pending: "bg-content-secondary/20 text-content-secondary border-content-secondary/30",
        running: "bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
        complete: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        error: "bg-red-500/20 text-red-400 border-red-500/30",
    };

    return (
        <div className={`relative w-8 h-8 rounded-lg border flex items-center justify-center transition-all duration-300 ${statusColors[status]}`}>
            {icons[role] || <Bot className="w-3.5 h-3.5" />}
            {status === "running" && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-indigo-600 rounded-full live-dot" />
            )}
        </div>
    );
}

// Tool Chip Component
function ToolChip({ step, index }: { step: TimelineStep; index: number }) {
    const statusIcons = {
        pending: <Loader2 className="w-3 h-3 text-content-secondary" />,
        running: <Loader2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400 motion-safe:animate-spin" />,
        complete: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
        error: <AlertCircle className="w-3 h-3 text-red-400" />,
    };

    const statusBg = {
        pending: "bg-content-secondary/10 border-content-secondary/20",
        running: "bg-indigo-600/10 border-indigo-500/20",
        complete: "bg-emerald-500/10 border-emerald-500/20",
        error: "bg-red-500/10 border-red-500/20",
    };

    return (
        <div
            className={`tool-chip flex items-center gap-2 px-3 py-1.5 rounded-lg border ${statusBg[step.status]} transition-all duration-300`}
            style={{ "--index": index } as React.CSSProperties}
        >
            {statusIcons[step.status]}
            <span className="text-xs font-medium text-white/90 whitespace-nowrap">
                {step.toolName || step.title || "Processing"}
            </span>
        </div>
    );
}

function LiveAgentTicker({
    isActive,
    followUpLabel,
    requestPreview,
    liveOutput,
    agentStatuses,
    observationStep,
    steps
}: LiveAgentTickerProps) {
    const roleLabels: Record<string, string> = {
        coordinator: "Coordinator",
        documentAgent: "Documents",
        mediaAgent: "Media",
        secAgent: "SEC",
        webAgent: "Web"
    };

    const recentSteps = (steps || []).slice(-6);

    // Calculate progress based on steps
    const completedSteps = steps.filter(s => s.status === "complete").length;
    const totalSteps = Math.max(steps.length, 1);
    const progress = Math.min((completedSteps / totalSteps) * 100, 95); // Cap at 95% until truly done

    // Get the current action text
    const currentAction = useMemo(() => {
        const runningStep = steps.find(s => s.status === "running");
        if (runningStep) {
            return runningStep.toolName || runningStep.title || "Processing...";
        }
        if (observationStep?.description) {
            return truncateText(observationStep.description, 60);
        }
        return "Analyzing data...";
    }, [steps, observationStep]);

    return (
        <div className="sticky top-20 z-30 mb-8 pointer-events-none">
            <div className={`pointer-events-auto relative overflow-hidden rounded-lg transition-all duration-500 ${isActive ? 'active-glow' : ''}`}>
                {/* Animated gradient border */}
                {isActive && (
                    <div className="absolute inset-0 rounded-lg gradient-border" />
                )}

                {/* Glass container */}
                <div className="relative glass-container rounded-lg p-4 md:p-6 flowing-gradient">
                    {/* Shimmer overlay when active */}
                    {isActive && (
                        <div className="absolute inset-0 shimmer-bg pointer-events-none rounded-lg" />
                    )}

                    {/* Header Row */}
                    <div className="relative flex items-center gap-4">
                        {/* Progress Ring */}
                        <ProgressRing progress={isActive ? progress : 100} />

                        {/* Title & Status */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-white font-semibold text-sm">
                                    Multi-Agent Research
                                </h3>
                                {isActive && (
                                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-600/20 border border-indigo-500/30">
                                        <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full live-dot" />
                                        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Live</span>
                                    </span>
                                )}
                                {followUpLabel && (
                                    <span className="px-2 py-0.5 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                                        {followUpLabel}
                                    </span>
                                )}
                            </div>
                            <p className="text-white/60 text-xs mt-0.5 truncate">
                                {isActive ? currentAction : "Research complete"}
                            </p>
                        </div>

                        {/* Active Agents */}
                        <div className="hidden md:flex items-center gap-1.5">
                            {agentStatuses.length > 0 ? (
                                agentStatuses.slice(0, 4).map(({ role, status }, idx) => (
                                    <div key={`${role}-${idx}`} className="group relative">
                                        <AgentIcon role={role || "coordinator"} status={status} />
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-surface border border-edge rounded text-xs text-content whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                            {roleLabels[role || "coordinator"]} • {status}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="flex items-center gap-1.5 text-white/40 text-xs">
                                    <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" />
                                    <span>Initializing...</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tool Timeline - Horizontal Scroll */}
                    {recentSteps.length > 0 && (
                        <div className="relative mt-4 pt-4 border-t border-edge">
                            <div className="flex items-center gap-2 mb-3">
                                <Activity className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                                    Tool Activity
                                </span>
                                <span className="text-xs text-white/40">
                                    {recentSteps.length} recent
                                </span>
                            </div>
                            <div className="flex gap-2 overflow-x-auto timeline-scroll pb-1 stagger-children">
                                {recentSteps.map((step, idx) => (
                                    <ToolChip key={step.id} step={step} index={idx} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Live Output Preview */}
                    {isActive && liveOutput && (
                        <div className="mt-4 pt-4 border-t border-edge">
                            <div className="flex items-center gap-2 mb-2">
                                <Zap className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                                    Live Output
                                </span>
                            </div>
                            <div className="bg-black/20 rounded-lg p-3 border border-edge">
                                <p className="text-xs text-white/80 font-mono leading-relaxed">
                                    {truncateText(liveOutput, 200)}
                                    <span className="typewriter-cursor text-indigo-600 dark:text-indigo-400" />
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
