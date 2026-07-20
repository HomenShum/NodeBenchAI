// src/components/newsletter/NewsletterView.tsx
// Wrapper that renders parsed sections in newsletter layout
// FIX: Now uses smart artifact-section matching instead of broken store lookup

import React, { useState, useMemo, useCallback } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { parseMarkdownToDossier } from '../../utils/newsletterParser';
import { NewsletterSectionBlock, DigestHero, type NewsletterSection, type NewsletterMediaItem } from './NewsletterComponents';
import { EvidenceDrawer, type EvidenceSource } from './EvidenceDrawer';
import { TrendingUp, Users, Briefcase, AlertTriangle, Lightbulb, FileText, Target, DollarSign, ShieldAlert, HelpCircle, Link2, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { DEFAULT_MODEL } from "@shared/llm/approvedModels";

// ═══════════════════════════════════════════════════════════════════════════
// ICON MAPPING
// ═══════════════════════════════════════════════════════════════════════════

const SECTION_ICONS: Record<string, React.ReactNode> = {
    executive_summary: <Lightbulb className="w-4 h-4" />,
    company_overview: <FileText className="w-4 h-4" />,
    market_landscape: <TrendingUp className="w-4 h-4" />,
    funding_signals: <DollarSign className="w-4 h-4" />,
    product_analysis: <Target className="w-4 h-4" />,
    competitive_analysis: <Briefcase className="w-4 h-4" />,
    founder_background: <Users className="w-4 h-4" />,
    investment_thesis: <TrendingUp className="w-4 h-4" />,
    risk_flags: <AlertTriangle className="w-4 h-4" />,
    open_questions: <HelpCircle className="w-4 h-4" />,
    sources_and_media: <FileText className="w-4 h-4" />,
};

// ═══════════════════════════════════════════════════════════════════════════
// SMART ARTIFACT-SECTION MATCHING
// ═══════════════════════════════════════════════════════════════════════════

/** Keywords that help match artifacts to sections */
const SECTION_KEYWORDS: Record<string, string[]> = {
    executive_summary: ['summary', 'overview', 'key', 'highlights', 'tldr'],
    company_overview: ['company', 'about', 'founded', 'headquarters', 'mission'],
    market_landscape: ['market', 'industry', 'sector', 'trends', 'tam', 'sam'],
    funding_signals: ['funding', 'raised', 'investors', 'valuation', 'round', 'series', 'venture'],
    product_analysis: ['product', 'technology', 'platform', 'solution', 'features'],
    competitive_analysis: ['competitor', 'competition', 'versus', 'compare', 'alternative'],
    founder_background: ['founder', 'ceo', 'team', 'leadership', 'executive', 'linkedin'],
    investment_thesis: ['thesis', 'investment', 'opportunity', 'why invest'],
    risk_flags: ['risk', 'concern', 'challenge', 'threat', 'weakness'],
    open_questions: ['question', 'unclear', 'investigate', 'diligence'],
    sources_and_media: ['source', 'reference', 'citation', 'media'],
};

/** Score how well an artifact matches a section based on keywords */
function scoreArtifactMatch(artifact: any, sectionKey: string, sectionContent: string): number {
    const keywords = SECTION_KEYWORDS[sectionKey] || [];
    const artifactText = `${artifact.title || ''} ${artifact.domain || ''} ${artifact.snippet || ''}`.toLowerCase();
    const sectionLower = sectionContent.toLowerCase();

    let score = 0;

    // Check if artifact URL/domain appears in section content
    if (artifact.url && sectionLower.includes(artifact.domain?.toLowerCase() || '')) {
        score += 10;
    }

    // Check keyword matches
    for (const keyword of keywords) {
        if (artifactText.includes(keyword)) score += 2;
        if (sectionLower.includes(keyword) && artifactText.includes(keyword)) score += 3;
    }

    return score;
}

/** Distribute artifacts across sections using smart matching */
function matchArtifactsToSections(
    artifacts: any[],
    sections: Array<{ key: string; sectionId: string; content: string }>
): Map<string, any[]> {
    const result = new Map<string, any[]>();
    const usedArtifacts = new Set<string>();

    // Initialize empty arrays
    sections.forEach(s => result.set(s.sectionId, []));

    // First pass: assign artifacts with explicit sectionId
    artifacts.forEach(artifact => {
        if (artifact.sectionId && result.has(artifact.sectionId)) {
            result.get(artifact.sectionId)!.push(artifact);
            usedArtifacts.add(artifact.id || artifact.url);
        }
    });

    // Second pass: smart matching for unassigned artifacts
    const unassigned = artifacts.filter(a => !usedArtifacts.has(a.id || a.url));

    for (const artifact of unassigned) {
        let bestSection = sections[0];
        let bestScore = 0;

        for (const section of sections) {
            const score = scoreArtifactMatch(artifact, section.key, section.content);
            if (score > bestScore) {
                bestScore = score;
                bestSection = section;
            }
        }

        // Only assign if there's a meaningful match (score > 0)
        // Otherwise, assign to sources_and_media or first section
        if (bestScore > 0) {
            result.get(bestSection.sectionId)!.push(artifact);
        } else {
            // Find sources section or use last section
            const sourcesSection = sections.find(s => s.key === 'sources_and_media');
            const targetSection = sourcesSection || sections[sections.length - 1];
            if (targetSection) {
                result.get(targetSection.sectionId)!.push(artifact);
            }
        }
    }

    return result;
}

function convertArtifactsToMediaItems(artifacts: any[]): NewsletterMediaItem[] {
    return artifacts.map(artifact => {
        let type: 'youtube' | 'web' | 'sec' | 'pdf' = 'web';

        if (artifact.url?.includes('youtube.com') || artifact.url?.includes('youtu.be')) {
            type = 'youtube';
        } else if (artifact.url?.includes('sec.gov')) {
            type = 'sec';
        } else if (artifact.type === 'pdf' || artifact.url?.endsWith('.pdf')) {
            type = 'pdf';
        }

        return {
            type,
            title: artifact.title || 'Untitled',
            domain: artifact.domain || (artifact.url ? new URL(artifact.url).hostname : 'unknown'),
            url: artifact.url,
            verified: artifact.verified ?? false,
        };
    }).slice(0, 6); // Max 6 items per section
}

function convertArtifactsToEvidenceSources(artifacts: any[]): EvidenceSource[] {
    return artifacts.map(artifact => {
        let type: 'web' | 'youtube' | 'sec' | 'pdf' | 'news' = 'web';
        if (artifact.url?.includes('youtube.com')) type = 'youtube';
        else if (artifact.url?.includes('sec.gov')) type = 'sec';
        else if (artifact.type === 'pdf') type = 'pdf';

        return {
            id: artifact.id || artifact.url,
            title: artifact.title || 'Untitled',
            url: artifact.url,
            domain: artifact.domain || (artifact.url ? new URL(artifact.url).hostname : 'unknown'),
            type,
            snippet: artifact.snippet,
            verified: artifact.verified,
            discoveredAt: Date.now(), // Mock timestamp if missing
        };
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface NewsletterViewProps {
    markdown: string;
    runId: string;
    artifacts: any[];
    isStreaming?: boolean;
    topic?: string;
    onRefresh?: (newMarkdown: string) => void;
}

export function NewsletterView({ markdown, runId, artifacts, isStreaming, topic, onRefresh }: NewsletterViewProps) {
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['executive_summary', 'market_landscape']));
    const [pinnedSections, setPinnedSections] = useState<Set<string>>(new Set());
    const [isGenerating, setIsGenerating] = useState(false);

    // Agent action for generating/refreshing newsletter content
    const generateWithAgent = useAction(api.domains.agents.arbitrage.agent.research);

    const handleGenerateWithAgent = useCallback(async () => {
        if (!topic || isGenerating) return;
        
        setIsGenerating(true);
        try {
            const result = await generateWithAgent({
                prompt: `Generate a comprehensive dossier for "${topic}" with verification. Include executive summary, market landscape, funding signals, competitive analysis, and risk flags. Use receipts-first research approach.`,
                model: DEFAULT_MODEL,
            });
            
            if (result && onRefresh) {
                // Assuming the result contains markdown content
                const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                onRefresh(content);
            }
        } catch (error) {
            console.error('[NewsletterView] Agent generation failed:', error);
        } finally {
            setIsGenerating(false);
        }
    }, [topic, isGenerating, generateWithAgent, onRefresh]);

    // Parse markdown into sections
    const parseResult = useMemo(() => {
        return parseMarkdownToDossier(markdown, runId);
    }, [markdown, runId]);

    // Smart artifact-section matching (FIX: replaces broken store lookup)
    const artifactsBySection = useMemo(() => {
        return matchArtifactsToSections(artifacts, parseResult.sections);
    }, [artifacts, parseResult.sections]);

    // Convert all artifacts for EvidenceDrawer
    const evidenceSources = useMemo(() => {
        return convertArtifactsToEvidenceSources(artifacts);
    }, [artifacts]);

    // Convert to NewsletterSection format
    const newsletterSections: NewsletterSection[] = useMemo(() => {
        return parseResult.sections.map(section => ({
            key: section.key,
            title: section.title,
            icon: SECTION_ICONS[section.key] || <FileText className="w-4 h-4" />,
            freshness: section.freshness,
            bullets: section.bullets,
            mediaRail: convertArtifactsToMediaItems(artifactsBySection.get(section.sectionId) || []),
            takeaway: undefined, // Could extract from section content later
            isPinned: pinnedSections.has(section.key),
            isExpanded: expandedSections.has(section.key),
            confidence: section.confidence,
        }));
    }, [parseResult.sections, artifactsBySection, expandedSections, pinnedSections]);

    // Extract Hero Data (from Executive Summary if available)
    const heroData = useMemo(() => {
        const summarySection = newsletterSections.find(s => s.key === 'executive_summary');
        if (!summarySection) return null;

        // Use the first bullet as summary text for now
        const summaryText = summarySection.bullets[0]?.text || "No summary available.";

        return {
            title: `Dossier: ${runId.split('-')[0] || 'Intelligence Report'}`, // Fallback title
            summary: summaryText,
            confidence: summarySection.confidence,
        };
    }, [newsletterSections, runId]);

    const handleToggleExpand = (key: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    const handleTogglePin = (key: string) => {
        setPinnedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    // Sort: pinned first, then normal
    const sortedSections = useMemo(() => {
        const pinned = newsletterSections.filter(s => s.isPinned);
        const unpinned = newsletterSections.filter(s => !s.isPinned);
        return [...pinned, ...unpinned];
    }, [newsletterSections]);

    // State for Evidence Drawer (Overlay)
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    if (parseResult.sections.length === 0 && !isStreaming) {
        return (
            <div className="text-center py-12 text-content-secondary">
                <p className="text-sm">No structured sections found in this dossier.</p>
                <p className="text-xs mt-2">Switch to Markdown view to see raw content.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-surface editorial-layout">
            {/* Main Document Container - Centered, max-w-3xl like a standard doc */}
            <div className="max-w-3xl mx-auto px-8 py-12">

                {/* Generate with Agent CTA */}
                {topic && onRefresh && (
                    <div className="flex justify-end mb-4">
                        <button
                            onClick={handleGenerateWithAgent}
                            disabled={isGenerating || isStreaming}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4" />
                                    Generate with AI
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* Digest Hero (Document Title) */}
                {heroData && (
                    <DigestHero
                        title={heroData.title}
                        summary={heroData.summary}
                        confidence={heroData.confidence}
                    />
                )}

                {/* Content before first section (if any) */}
                {parseResult.contentBeforeFirstSection && (
                    <div className="prose prose-lg max-w-none text-content mb-10">
                        {parseResult.contentBeforeFirstSection}
                    </div>
                )}

                {/* Section Blocks */}
                <div className="space-y-2">
                    {sortedSections.map((section, idx) => (
                        <NewsletterSectionBlock
                            key={`${section.key}-${idx}`}
                            section={section}
                            onToggleExpand={() => handleToggleExpand(section.key)}
                            onEvidenceChipClick={(chipId) => {
                                setIsDrawerOpen(true); // Open drawer on click
                            }}
                        />
                    ))}
                </div>

                {/* Streaming indicator */}
                {isStreaming && (
                    <div className="flex items-center gap-3 mt-8 text-content-secondary motion-safe:animate-pulse">
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                        <span className="text-sm font-medium">Writing...</span>
                    </div>
                )}
            </div>

            {/* Evidence Drawer - Overlay only */}
            <EvidenceDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                sources={evidenceSources}
            />
        </div>
    );
}
