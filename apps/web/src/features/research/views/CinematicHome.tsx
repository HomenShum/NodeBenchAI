import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
    Activity,
    ArrowRight,
    ArrowUpRight,
    Bot,
    Cpu,
    FileText,
    FolderOpen,
    GitBranch,
    Radar,
    Shield,
    Sparkles,
    TrendingUp,
} from 'lucide-react';
import { useQuery } from 'convex/react';
import { useMotionConfig } from '@/lib/motion';
import { SignatureOrb } from '../../../shared/ui/SignatureOrb';
import { api } from '../../../../convex/_generated/api';
import { JarvisHUDLayout } from '@/features/agents/components/FastAgentPanel/JarvisHUDLayout';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { sanitizeReadableText } from '@/lib/displayText';

interface CinematicHomeProps {
    onEnterHub: (tab?: "overview" | "signals" | "briefing" | "forecasts") => void;
    onEnterWorkspace: () => void;
    onOpenFastAgent: () => void;
    onOpenFastAgentWithPrompt?: (prompt: string) => void;
    onOpenWorkbench?: () => void;
    onOpenAgents?: () => void;
}

export default function CinematicHome({
    onEnterHub,
    onEnterWorkspace,
    onOpenFastAgent,
    onOpenFastAgentWithPrompt,
    onOpenWorkbench,
    onOpenAgents,
}: CinematicHomeProps) {
    const { instant, transition } = useMotionConfig();
    const navigate = useNavigate();

    const userStats = useQuery(api.domains.auth.userStats.getUserActivitySummary);
    const insights = useQuery(api.domains.auth.userStats.getProductivityInsights);
    const dashboardSnapshot = useQuery(api.domains.research.dashboardQueries.getLatestDashboardSnapshot);
    const dealFlow = useQuery(api.domains.research.dealFlowQueries.getDealFlow);
    const trendingRepos = useQuery(api.domains.research.githubExplorer.getTrendingRepos, { limit: 4 });
    const latestMemory = useQuery(api.domains.research.dailyBriefMemoryQueries.getLatestMemory);
    const systemHealth = useQuery(api.domains.observability.healthMonitor.getSystemHealth);
    const isDashboardLoading = dashboardSnapshot === undefined;
    const isDealLoading = dealFlow === undefined;
    const isRepoLoading = trendingRepos === undefined;
    const isBriefLoading = latestMemory === undefined;
    const isHealthLoading = systemHealth === undefined;
    const isAnyLiveLoading = isDashboardLoading || isDealLoading || isRepoLoading || isBriefLoading || isHealthLoading;
    const [showLoadingEscalation, setShowLoadingEscalation] = useState(false);

    const [localGreeting, setLocalGreeting] = useState(() => {
        const hour = new Date().getHours();
        if (hour < 12) return "Good morning";
        if (hour < 18) return "Good afternoon";
        return "Good evening";
    });

    useEffect(() => {
        const updateGreeting = () => {
            const hour = new Date().getHours();
            if (hour < 12) setLocalGreeting("Good morning");
            else if (hour < 18) setLocalGreeting("Good afternoon");
            else setLocalGreeting("Good evening");
        };
        updateGreeting();
        const timer = window.setInterval(updateGreeting, 60_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!isAnyLiveLoading) {
            setShowLoadingEscalation(false);
            return;
        }
        const timer = window.setTimeout(() => setShowLoadingEscalation(true), 6000);
        return () => window.clearTimeout(timer);
    }, [isAnyLiveLoading]);

    const handleHudPromptSubmit = useCallback((prompt: string) => {
        const normalized = prompt.trim();
        if (!normalized) {
            onOpenFastAgent();
            return;
        }
        if (onOpenFastAgentWithPrompt) {
            onOpenFastAgentWithPrompt(normalized);
            return;
        }
        onOpenFastAgent();
    }, [onOpenFastAgent, onOpenFastAgentWithPrompt]);

    const deals = useMemo(() => (Array.isArray(dealFlow) ? dealFlow : []), [dealFlow]);
    const repos = useMemo(() => (Array.isArray(trendingRepos) ? trendingRepos : []), [trendingRepos]);
    const keyStats = dashboardSnapshot?.dashboardMetrics?.keyStats ?? [];
    const topKeyStats = keyStats.slice(0, 3);
    const financeHeadlines = useMemo(() => deals.slice(0, 3).map((deal) => getDealHeadline(deal, 'funding')), [deals]);
    const githubHeadlines = useMemo(() => repos.slice(0, 3).map((repo) => getRepoHeadline(repo, 'github-explorer')), [repos]);
    const loadingLabel = showLoadingEscalation ? 'Awaiting live data' : 'Syncing';
    const slowLoadingDetail = 'Live data is taking longer than expected. Open the hub to verify feed connectivity.';
    const capitalPulseRows = useMemo(
        () => financeHeadlines.length
            ? financeHeadlines
            : [{
                label: isDealLoading ? (showLoadingEscalation ? 'Capital feed delayed' : 'Capital feed warming up') : 'Capital feed standing by',
                detail: isDealLoading ? (showLoadingEscalation ? slowLoadingDetail : 'Syncing funding motion now...') : 'Open Funding to refresh the broader market feed.',
                targetView: 'funding',
            }],
        [financeHeadlines, isDealLoading, showLoadingEscalation],
    );
    const sourceCount = useMemo(
        () => summarizeSourceCount(dashboardSnapshot?.sourceSummary),
        [dashboardSnapshot?.sourceSummary],
    );

    const componentSummary = useMemo(() => {
        const components = systemHealth?.components ? Object.values(systemHealth.components) : [];
        return {
            total: components.length,
            healthy: components.filter((component) => component.status === 'healthy').length,
            degraded: components.filter((component) => component.status === 'degraded').length,
            unhealthy: components.filter((component) => component.status === 'unhealthy').length,
        };
    }, [systemHealth?.components]);

    const openView = useCallback((path: string) => {
        navigate(path);
    }, [navigate]);

    const focusNotes = useMemo(() => {
        const notes = [
            'Every major claim should point back to captured evidence, not memory.',
            'Use the command deck to investigate, route, summarize, or launch an agent thread.',
            'Review the live board before you open funding, repositories, briefs, or observability.',
        ];
        if (insights?.[0]?.message) {
            notes.unshift(insights[0].message);
        }
        return notes.slice(0, 3);
    }, [insights]);

    const proofPillars = useMemo(() => [
        {
            title: 'Evidence-linked',
            detail: 'Every important conclusion can be traced back to captured artifacts.',
        },
        {
            title: 'Traceable',
            detail: 'Tool calls, model steps, and live signals stay visible for review.',
        },
        {
            title: 'Governed',
            detail: 'Recommendations can be drafted fast, but consequential action stays human-approved.',
        },
    ], []);

    const heroSnapshotStats = useMemo(() => ([
        {
            label: 'Sources watched',
            value: isDashboardLoading ? 'Syncing' : formatCompactCount(sourceCount),
            detail: isDashboardLoading ? 'Building the first evidence graph' : 'Across live monitoring and source feeds',
        },
        {
            label: 'Active alerts',
            value: isHealthLoading ? 'Syncing' : String(systemHealth?.activeAlerts ?? 0),
            detail: isHealthLoading ? 'Monitoring stack warming up' : formatHealthLabel(systemHealth?.overall),
        },
        {
            label: 'Top signal',
            value: isDashboardLoading ? 'Syncing' : String(topKeyStats[0]?.value ?? 'No data'),
            detail: isDashboardLoading ? 'Loading dashboard snapshot' : topKeyStats[0]?.label ?? 'Awaiting first key stat',
        },
        {
            label: 'Brief memory',
            value: isBriefLoading ? 'Syncing' : latestMemory?.dateString ?? 'Pending',
            detail: isBriefLoading
                ? 'Loading latest brief'
                : latestMemory?.generatedAt
                ? `Updated ${formatRelativeTime(latestMemory.generatedAt)}`
                : 'No briefing captured yet',
        },
    ]), [
        isBriefLoading,
        isDashboardLoading,
        isHealthLoading,
        latestMemory?.dateString,
        latestMemory?.generatedAt,
        sourceCount,
        systemHealth?.activeAlerts,
        systemHealth?.overall,
        topKeyStats,
    ]);

    const quickActions = useMemo(() => ([
        {
            title: 'Investigate live signals',
            desc: 'Open observability, traces, and alerts when something changes.',
            icon: <Shield className="h-4 w-4" />,
            onClick: () => openView('/observability'),
            agentId: 'view:home:quick:observability',
            agentTarget: 'observability',
        },
        {
            title: 'Open research hub',
            desc: 'Move from anomaly to sources, briefs, and context in one jump.',
            icon: <Radar className="h-4 w-4" />,
            onClick: () => onEnterHub('signals'),
            agentId: 'view:home:quick:research',
            agentTarget: 'research',
        },
        {
            title: 'Ask Fast Agent',
            desc: 'Draft an evidence-grounded investigation or next-action summary.',
            icon: <Bot className="h-4 w-4" />,
            onClick: () => handleHudPromptSubmit('Investigate what changed, show the strongest evidence, and draft the next action.'),
            agentId: 'view:home:quick:assistant',
            agentTarget: 'agents',
        },
        {
            title: 'Run a benchmark',
            desc: 'Compare models and workflows on the tasks that matter to your team.',
            icon: <Sparkles className="h-4 w-4" />,
            onClick: () => (onOpenWorkbench ? onOpenWorkbench() : onEnterHub()),
            agentId: 'view:home:quick:benchmark',
            agentTarget: 'benchmarks',
        },
    ]), [handleHudPromptSubmit, onEnterHub, onOpenWorkbench, openView]);

    const investigationPaths = useMemo(() => ([
        {
            title: 'Incident investigations',
            desc: 'Turn latency shifts, failures, and retries into ranked hypotheses and action drafts.',
            icon: <Shield className="h-4 w-4" />,
            onClick: () => openView('/observability'),
            agentId: 'view:home:path:incident',
            agentTarget: 'observability',
        },
        {
            title: 'Research briefings',
            desc: 'Link sources, summaries, and updates into a decision-ready narrative with citations.',
            icon: <FileText className="h-4 w-4" />,
            onClick: () => onEnterHub('briefing'),
            agentId: 'view:home:path:briefing',
            agentTarget: 'research',
        },
        {
            title: 'Workspace execution',
            desc: 'Move from evidence pack to documents, tasks, and reports without losing context.',
            icon: <FolderOpen className="h-4 w-4" />,
            onClick: onEnterWorkspace,
            agentId: 'view:home:path:workspace',
            agentTarget: 'documents',
        },
        {
            title: 'Agent workflows',
            desc: 'Launch a guided assistant thread when you need help turning findings into next steps.',
            icon: <Bot className="h-4 w-4" />,
            onClick: () => (onOpenAgents ? onOpenAgents() : onOpenFastAgent()),
            agentId: 'view:home:path:agents',
            agentTarget: 'agents',
        },
    ]), [onEnterHub, onEnterWorkspace, onOpenAgents, onOpenFastAgent, openView]);

    const workflowSteps = useMemo(() => ([
        {
            step: '01',
            title: 'Detect what changed',
            description: 'Watch live time-series, traces, and event streams for meaningful shifts instead of relying on scattered recollection.',
        },
        {
            step: '02',
            title: 'Capture the evidence',
            description: 'Link documents, dashboards, messages, and source artifacts into one normalized evidence trail.',
        },
        {
            step: '03',
            title: 'Rank the hypotheses',
            description: 'Separate observed facts from interpretation and score the competing explanations side by side.',
        },
        {
            step: '04',
            title: 'Draft the next action',
            description: 'Produce a remediation draft, evidence pack, and replay trace without skipping the human approval boundary.',
        },
    ]), []);

    const deliverables = useMemo(() => ([
        {
            title: 'Observed facts',
            detail: 'Direct statements tied to captured metrics, traces, documents, or messages.',
        },
        {
            title: 'Derived signals',
            detail: 'Anomaly windows, trend shifts, and forecasts separated from the final judgment layer.',
        },
        {
            title: 'Ranked hypotheses',
            detail: 'Supporting and weakening evidence shown together instead of buried in prose.',
        },
        {
            title: 'Counter-analysis',
            detail: 'Alternative explanations are tested explicitly before a preferred answer is shown.',
        },
        {
            title: 'Recommended actions',
            detail: 'Draft remediations and handoffs are ready, but consequential action remains approval-gated.',
        },
        {
            title: 'Evidence pack',
            detail: 'Replay traces, artifact integrity, and limitations stay bundled with the final report.',
        },
    ]), []);

    const pulseMetrics = useMemo(() => ([
        {
            label: 'Capital pulse',
            value: isDealLoading ? loadingLabel : deals.length ? `${deals.length} live` : 'Quiet',
            detail: financeHeadlines[0]?.detail ?? (showLoadingEscalation ? slowLoadingDetail : 'Funding events and market motion'),
            icon: <TrendingUp className="h-4 w-4" />,
            onClick: () => openView('/funding'),
        },
        {
            label: 'GitHub radar',
            value: isRepoLoading ? loadingLabel : repos.length ? `${repos.length} tracked` : 'Quiet',
            detail: githubHeadlines[0]?.label ?? (showLoadingEscalation ? slowLoadingDetail : 'Repos rising across the stack'),
            icon: <GitBranch className="h-4 w-4" />,
            onClick: () => openView('/github-explorer'),
        },
        {
            label: 'Briefing memory',
            value: isBriefLoading ? loadingLabel : latestMemory?.dateString ?? 'Pending',
            detail: latestMemory?.generatedAt ? `Updated ${formatRelativeTime(latestMemory.generatedAt)}` : (showLoadingEscalation ? slowLoadingDetail : 'No brief generated yet'),
            icon: <Sparkles className="h-4 w-4" />,
            onClick: () => openView('/research/briefing'),
        },
        {
            label: 'System health',
            value: isHealthLoading ? loadingLabel : formatHealthLabel(systemHealth?.overall),
            detail: systemHealth ? `${systemHealth.activeAlerts} active alerts` : (showLoadingEscalation ? slowLoadingDetail : 'Monitoring stack not loaded'),
            icon: <Shield className="h-4 w-4" />,
            onClick: () => openView('/observability'),
        },
    ]), [deals.length, financeHeadlines, githubHeadlines, isBriefLoading, isDealLoading, isHealthLoading, isRepoLoading, latestMemory?.dateString, latestMemory?.generatedAt, loadingLabel, openView, repos.length, showLoadingEscalation, systemHealth]);

    const engineeringRows = useMemo(() => {
        const repairRow = {
            label: 'Self-healing lane',
            detail: showLoadingEscalation
                ? slowLoadingDetail
                : 'Open Observability to inspect repair activity and maintenance history.',
            targetView: 'observability',
        };
        return [...githubHeadlines, repairRow];
    }, [githubHeadlines, showLoadingEscalation]);

    return (
        <div className="nb-page-shell">
            <div className="nb-page-inner py-8 md:py-10">
                <div className="relative z-10 w-full max-w-7xl px-4 md:px-6">
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_320px] lg:items-start">
                        <div className="min-w-0">
                            <motion.section
                                initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={transition({ duration: 0.3, delay: 0.1 })}
                                className="relative overflow-hidden rounded-[28px] border border-edge bg-[linear-gradient(180deg,rgba(99,102,241,0.1),rgba(15,23,42,0.02)_36%,transparent_100%)] px-5 py-5 shadow-[0_24px_80px_rgba(2,6,23,0.08)] md:px-7 md:py-7"
                            >
                                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.16),transparent_68%)]" />
                                <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_300px] xl:items-start">
                                    <div className="min-w-0">
                                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-primary/90">
                                            <Radar className="h-3.5 w-3.5" />
                                            Evidence-grounded investigation engine
                                        </div>
                                        <h1 className="sr-only">Home</h1>
                                        <p className="text-sm font-medium text-content-secondary">
                                            {localGreeting}{userStats?.userName ? `, ${userStats.userName}` : ''}
                                        </p>
                                        <h2 className="mt-2 type-page-title text-content md:text-4xl">
                                            No more unverifiable postmortems.
                                        </h2>
                                        <p className="mt-3 max-w-3xl text-sm leading-6 text-content-secondary md:text-[15px]">
                                            NodeBench turns telemetry, documents, and execution traces into evidence-grounded hypotheses,
                                            tamper-evident evidence packs, and approval-gated remediation drafts. Use the home surface to
                                            move from “something changed” to “here is the best-supported explanation and the next action.”
                                        </p>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {focusNotes.map((note) => (
                                                <FocusChip key={note} label={note} />
                                            ))}
                                        </div>

                                        <div className="mt-5 grid gap-3 md:grid-cols-3">
                                            {proofPillars.map((pillar) => (
                                                <ProofPill key={pillar.title} title={pillar.title} detail={pillar.detail} />
                                            ))}
                                        </div>

                                        <div className="mt-5 flex flex-wrap gap-3">
                                            <HeroActionButton onClick={() => onEnterHub('signals')} primary>
                                                Open Research Hub
                                            </HeroActionButton>
                                            <HeroActionButton onClick={() => handleHudPromptSubmit('Investigate the most important live signal and draft the next action.')}>
                                                Ask Fast Agent
                                            </HeroActionButton>
                                            <HeroActionButton onClick={onEnterWorkspace}>Open Workspace</HeroActionButton>
                                        </div>
                                    </div>

                                    <div className="rounded-[24px] border border-edge/80 bg-surface/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                                                    Decision-ready artifact
                                                </p>
                                                <h3 className="mt-1 text-lg font-semibold tracking-tight text-content">
                                                    What the final investigation should contain
                                                </h3>
                                                <p className="mt-1 text-sm text-content-secondary">
                                                    Facts, signals, hypotheses, counter-analysis, remediation, and limitations in one replayable pack.
                                                </p>
                                            </div>
                                            <div className="hidden rounded-[20px] border border-edge bg-surface/80 p-3 lg:block">
                                                <SignatureOrb variant="signature" size="sm" />
                                            </div>
                                        </div>

                                        <div className="mt-4 space-y-2.5">
                                            {deliverables.slice(0, 4).map((item) => (
                                                <MetricRow key={item.title} label={item.title} value={item.detail} />
                                            ))}
                                        </div>

                                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                            {heroSnapshotStats.map((item) => (
                                                <MiniStatCard key={item.label} label={item.label} value={item.value} detail={item.detail} />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <motion.div
                                    initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={transition({ duration: 0.3, delay: 0.2 })}
                                    className="relative z-10 mt-5 rounded-[24px] border border-edge bg-surface/72 px-3 py-4 backdrop-blur-sm md:px-4"
                                >
                                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-muted">
                                                Ask or command
                                            </p>
                                            <p className="mt-1 text-sm text-content-secondary">
                                                Search, investigate, route, and draft action from one command deck while the live system context stays in view.
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2 text-xs text-content-muted">
                                            <span className="rounded-full border border-edge bg-surface px-2.5 py-1">Voice wake word</span>
                                            <span className="rounded-full border border-edge bg-surface px-2.5 py-1">Live transcript</span>
                                            <span className="rounded-full border border-edge bg-surface px-2.5 py-1">Command routing</span>
                                        </div>
                                    </div>
                                    <JarvisHUDLayout onPromptSubmit={handleHudPromptSubmit} />
                                </motion.div>

                                <div className="mt-4 grid gap-3 lg:grid-cols-4">
                                    {pulseMetrics.map((metric) => (
                                        <PulseCard
                                            key={metric.label}
                                            label={metric.label}
                                            value={metric.value}
                                            detail={metric.detail}
                                            icon={metric.icon}
                                            onClick={metric.onClick}
                                        />
                                    ))}
                                </div>
                            </motion.section>

                            <motion.section
                                initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={transition({ duration: 0.3, delay: 0.28 })}
                                className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
                            >
                                <div className="rounded-[24px] border border-edge bg-surface/72 p-4 backdrop-blur-sm">
                                    <SectionHeading
                                        eyebrow="Start now"
                                        title="Start an investigation"
                                        description="The highest-leverage actions when you need to go from signal to evidence fast."
                                    />
                                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        {quickActions.map((action) => (
                                            <QuickStartCard
                                                key={action.title}
                                                title={action.title}
                                                desc={action.desc}
                                                icon={action.icon}
                                                onClick={action.onClick}
                                                agentId={action.agentId}
                                                agentTarget={action.agentTarget}
                                            />
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-[24px] border border-edge bg-surface/72 p-4 backdrop-blur-sm">
                                    <SectionHeading
                                        eyebrow="Use cases"
                                        title="Where teams start"
                                        description="Use the home surface as the control plane for operations, research, and execution."
                                    />
                                    <div className="mt-4 grid gap-3">
                                        {investigationPaths.map((path) => (
                                            <CompactDestinationCard
                                                key={path.title}
                                                title={path.title}
                                                desc={path.desc}
                                                icon={path.icon}
                                                onClick={path.onClick}
                                                agentId={path.agentId}
                                                agentTarget={path.agentTarget}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </motion.section>

                            <motion.section
                                initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={transition({ duration: 0.3, delay: 0.31 })}
                                className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]"
                            >
                                <div className="rounded-[24px] border border-edge bg-surface/72 p-4 backdrop-blur-sm">
                                    <SectionHeading
                                        eyebrow="Workflow"
                                        title="How NodeBench works"
                                        description="The system is strongest when it keeps evidence, uncertainty, and next actions in the same loop."
                                    />
                                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                        {workflowSteps.map((step) => (
                                            <WorkflowStepCard
                                                key={step.step}
                                                step={step.step}
                                                title={step.title}
                                                description={step.description}
                                            />
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-[24px] border border-edge bg-surface/72 p-4 backdrop-blur-sm">
                                    <SectionHeading
                                        eyebrow="Output"
                                        title="Decision-ready artifacts"
                                        description="The goal is not an AI paragraph. It is a structured investigation that survives later scrutiny."
                                    />
                                    <div className="mt-4 space-y-3">
                                        {deliverables.map((item) => (
                                            <DeliverableCard key={item.title} title={item.title} detail={item.detail} />
                                        ))}
                                    </div>
                                    <div className="mt-4 rounded-2xl border border-dashed border-edge bg-surface px-4 py-3 text-sm text-content-secondary">
                                        NodeBench can verify the integrity of captured artifacts. It does not claim cryptographic proof of causation.
                                        Causality still has to be argued from evidence, tested against alternatives, and scored with uncertainty.
                                    </div>
                                </div>
                            </motion.section>

                            <motion.section
                                initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={transition({ duration: 0.3, delay: 0.34 })}
                                className="mt-5 rounded-[24px] border border-edge bg-surface/72 p-4 backdrop-blur-sm"
                            >
                                <SectionHeading
                                    eyebrow="Live board"
                                    title="What is moving right now"
                                    description="A denser strip for the data streams you expect to see without leaving home."
                                />
                                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                                    <CompactRailBlock
                                        title="Capital and company motion"
                                        subtitle={isDashboardLoading ? 'Loading market snapshot...' : dashboardSnapshot?.dateString ? `Snapshot ${dashboardSnapshot.dateString}` : 'Awaiting fresh market snapshot'}
                                        rows={capitalPulseRows}
                                        emptyMessage="Capital feed is standing by."
                                        loading={isDealLoading}
                                        loadingMessage="Syncing capital motion..."
                                        onRowClick={(targetView) => openView(`/${targetView}`)}
                                    />
                                    <CompactRailBlock
                                        title="Code and system motion"
                                        subtitle={isHealthLoading ? 'Loading health signal...' : systemHealth?.lastChecked ? `Health checked ${formatRelativeTime(systemHealth.lastChecked)}` : 'Monitoring is warming up'}
                                        rows={engineeringRows}
                                        emptyMessage="No active engineering signals yet."
                                        loading={isRepoLoading && isHealthLoading}
                                        loadingMessage="Syncing engineering motion..."
                                        onRowClick={(targetView) => openView(`/${targetView}`)}
                                    />
                                </div>
                            </motion.section>

                            <motion.section
                                initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={transition({ duration: 0.3, delay: 0.4 })}
                                className="mt-5 rounded-[24px] border border-edge bg-[linear-gradient(180deg,rgba(99,102,241,0.08),rgba(15,23,42,0.01)_100%)] p-5 shadow-[0_16px_48px_rgba(15,23,42,0.08)]"
                            >
                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                                            Closing loop
                                        </p>
                                        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-content">
                                            Turn scattered artifacts into traceable decisions.
                                        </h2>
                                        <p className="mt-2 max-w-2xl text-sm leading-6 text-content-secondary">
                                            Open the hub, review the live board, or start an agent thread when you need a faster path from signal to evidence to action.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        <HeroActionButton onClick={() => onEnterHub()} primary>
                                            Open Research Hub
                                        </HeroActionButton>
                                        <HeroActionButton onClick={onOpenFastAgent}>Open Fast Agent</HeroActionButton>
                                    </div>
                                </div>
                            </motion.section>
                        </div>

                        <aside className="min-w-0 lg:sticky lg:top-24">
                            <motion.div
                                initial={{ opacity: instant ? 1 : 0, x: instant ? 0 : 8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={transition({ duration: 0.3, delay: 0.18 })}
                                className="space-y-3"
                            >
                                <IntelCard
                                    eyebrow="Operating picture"
                                    title="System snapshot"
                                    summary="A live view across source coverage, key stats, and active alerts."
                                    footer={isDashboardLoading ? 'Syncing the first snapshot...' : dashboardSnapshot?.generatedAt ? `Refreshed ${formatRelativeTime(dashboardSnapshot.generatedAt)}` : 'Waiting for the first snapshot'}
                                >
                                    <MetricRow label="Sources watched" value={isDashboardLoading ? 'Syncing' : formatCompactCount(sourceCount)} onClick={() => openView('/research')} />
                                    <MetricRow label="Top stat" value={isDashboardLoading ? 'Syncing' : topKeyStats[0]?.value ?? 'No data'} detail={isDashboardLoading ? 'Loading dashboard snapshot...' : topKeyStats[0]?.label ?? 'No key stats loaded'} onClick={() => openView('/research')} />
                                    <MetricRow label="Active alerts" value={isHealthLoading ? 'Syncing' : systemHealth ? String(systemHealth.activeAlerts) : '0'} detail={isHealthLoading ? 'Loading health checks...' : formatHealthLabel(systemHealth?.overall)} onClick={() => openView('/observability')} />
                                </IntelCard>

                                <IntelCard
                                    eyebrow="Finance"
                                    title="Capital pulse"
                                    summary="Fast read on funding flow and company motion."
                                    footer={isDealLoading ? 'Syncing funding activity...' : deals.length ? `${deals.length} active entries in the current feed` : 'No funding activity loaded yet'}
                                >
                                    {isDealLoading ? (
                                        <EmptyRailState message="Syncing capital motion..." />
                                    ) : capitalPulseRows.length ? capitalPulseRows.map((row) => (
                                        <MetricRow key={`${row.label}-${row.detail}`} label={row.label} value={row.detail} onClick={() => openView('/funding')} />
                                    )) : (
                                        <EmptyRailState message="No deal headlines are available right now." />
                                    )}
                                </IntelCard>

                                <IntelCard
                                    eyebrow="Engineering"
                                    title="GitHub radar"
                                    summary="Fast read on repository momentum and engineering signals."
                                    footer={isRepoLoading ? 'Syncing repository signals...' : repos.length ? `${repos.length} repositories surfaced by phoenix score` : 'Repository signals are still loading'}
                                >
                                    {isRepoLoading ? (
                                        <EmptyRailState message="Syncing repository momentum..." />
                                    ) : githubHeadlines.length ? githubHeadlines.map((row) => (
                                        <MetricRow key={`${row.label}-${row.detail}`} label={row.label} value={row.detail} onClick={() => openView('/github-explorer')} />
                                    )) : (
                                        <EmptyRailState message="No repository momentum is available yet." />
                                    )}
                                </IntelCard>

                                <IntelCard
                                    eyebrow="Autonomy"
                                    title="Briefing and repair loop"
                                    summary="Check whether briefing memory is fresh and whether automated maintenance is holding."
                                    footer={isBriefLoading ? 'Syncing latest brief...' : latestMemory?.dateString ? `Latest brief ${latestMemory.dateString}` : 'No daily brief memory yet'}
                                >
                                    <MetricRow
                                        label="Brief memory"
                                        value={isBriefLoading ? 'Syncing' : latestMemory?.generatedAt ? formatRelativeTime(latestMemory.generatedAt) : 'Pending'}
                                        detail={isBriefLoading ? 'Loading latest briefing memory...' : latestMemory?.dateString ?? 'No briefing date yet'}
                                        onClick={() => openView('/research/briefing')}
                                    />
                                    <ErrorBoundary
                                        section="Research repair loop"
                                        fallback={<RepairAttemptsFallbackRow onClick={() => openView('/observability')} />}
                                    >
                                        <RepairAttemptsMetricRow onClick={() => openView('/observability')} />
                                    </ErrorBoundary>
                                    <MetricRow
                                        label="Component coverage"
                                        value={isHealthLoading ? 'Syncing' : componentSummary.total ? `${componentSummary.healthy}/${componentSummary.total}` : '0/0'}
                                        detail={isHealthLoading ? 'Loading component health...' : componentSummary.degraded || componentSummary.unhealthy
                                            ? `${componentSummary.degraded} degraded, ${componentSummary.unhealthy} unhealthy`
                                            : 'All tracked components healthy'}
                                        onClick={() => openView('/observability')}
                                    />
                                </IntelCard>
                            </motion.div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}

function FocusChip({ label }: { label: string }) {
    return (
        <span className="inline-flex items-center rounded-full border border-edge bg-surface/70 px-3 py-1.5 text-xs text-content-secondary">
            {label}
        </span>
    );
}

function ProofPill({ title, detail }: { title: string; detail: string }) {
    return (
        <div className="rounded-2xl border border-edge bg-surface/72 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary/90">{title}</div>
            <div className="mt-1 text-sm leading-6 text-content-secondary">{detail}</div>
        </div>
    );
}

function HeroActionButton({
    children,
    onClick,
    primary = false,
}: {
    children: React.ReactNode;
    onClick: () => void;
    primary?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                'inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200',
                primary
                    ? 'bg-primary text-primary-foreground shadow-[0_12px_24px_rgba(99,102,241,0.24)] hover:-translate-y-0.5'
                    : 'border border-edge bg-surface text-content hover:-translate-y-0.5 hover:bg-surface-hover',
            ].join(' ')}
        >
            {children}
        </button>
    );
}

function SectionHeading({
    eyebrow,
    title,
    description,
}: {
    eyebrow: string;
    title: string;
    description: string;
}) {
    return (
        <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                {eyebrow}
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-content">{title}</h2>
            <p className="mt-1 text-sm text-content-secondary">{description}</p>
        </div>
    );
}

function WorkflowStepCard({
    step,
    title,
    description,
}: {
    step: string;
    title: string;
    description: string;
}) {
    return (
        <div className="rounded-2xl border border-edge bg-surface px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-semibold text-primary">
                {step}
            </div>
            <h3 className="mt-3 text-sm font-semibold tracking-tight text-content">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-content-secondary">{description}</p>
        </div>
    );
}

function DeliverableCard({ title, detail }: { title: string; detail: string }) {
    return (
        <div className="rounded-2xl border border-edge bg-surface px-4 py-3">
            <div className="text-sm font-semibold text-content">{title}</div>
            <div className="mt-1 text-sm leading-6 text-content-secondary">{detail}</div>
        </div>
    );
}

function MiniStatCard({
    label,
    value,
    detail,
}: {
    label: string;
    value: string;
    detail: string;
}) {
    return (
        <div className="rounded-2xl border border-edge bg-surface px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">{label}</div>
            <div className="mt-1 text-sm font-semibold text-content">{value}</div>
            <div className="mt-1 text-xs leading-5 text-content-secondary">{detail}</div>
        </div>
    );
}

function PulseCard({
    label,
    value,
    detail,
    icon,
    onClick,
}: {
    label: string;
    value: string;
    detail: string;
    icon: React.ReactNode;
    onClick?: () => void;
}) {
    const content = (
        <div className="rounded-2xl border border-edge bg-surface/78 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-2 text-content-muted">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-edge bg-surface-secondary">
                    {icon}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</span>
            </div>
            <div className="mt-3 break-words text-base font-semibold tracking-tight text-content">{value}</div>
            <div className="mt-1 break-words text-xs leading-5 text-content-secondary">{detail}</div>
        </div>
    );
    if (!onClick) return content;
    return (
        <button type="button" onClick={onClick} className="w-full text-left hover:-translate-y-0.5 transition-transform duration-200">
            {content}
        </button>
    );
}

function IntelCard({
    eyebrow,
    title,
    summary,
    footer,
    children,
}: {
    eyebrow: string;
    title: string;
    summary: string;
    footer: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-[24px] border border-edge bg-surface/78 p-4 backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                {eyebrow}
            </p>
            <div className="mt-2 flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                    <Activity className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold tracking-tight text-content">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-content-secondary">{summary}</p>
                </div>
            </div>
            <div className="mt-4 space-y-2.5">
                {children}
            </div>
            <div className="mt-4 border-t border-edge pt-3 text-xs text-content-muted">
                {footer}
            </div>
        </section>
    );
}

function MetricRow({
    label,
    value,
    detail,
    onClick,
}: {
    label: string;
    value: string;
    detail?: string;
    onClick?: () => void;
}) {
    const content = (
        <div className="rounded-2xl border border-edge/80 bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-content-secondary">{label}</span>
                <span className="text-sm font-semibold text-content">{value}</span>
            </div>
            {detail ? (
                <div className="mt-1 text-xs leading-5 text-content-muted">{detail}</div>
            ) : null}
        </div>
    );
    if (!onClick) return content;
    return (
        <button type="button" onClick={onClick} className="w-full text-left hover:-translate-y-0.5 transition-transform duration-200">
            {content}
        </button>
    );
}

function RepairAttemptsMetricRow({ onClick }: { onClick: () => void }) {
    const healingSummary = useQuery(api.domains.observability.selfHealer.getHealingStatsSummary, { hours: 24 });
    const isHealingLoading = healingSummary === undefined;

    return (
        <MetricRow
            label="Repair attempts"
            value={isHealingLoading ? 'Syncing' : healingSummary ? String(healingSummary.attempted) : '0'}
            detail={isHealingLoading ? 'Loading repair history...' : healingSummary ? `${healingSummary.succeeded} succeeded, ${healingSummary.failed} failed` : 'No healing actions recorded'}
            onClick={onClick}
        />
    );
}

function RepairAttemptsFallbackRow({ onClick }: { onClick: () => void }) {
    return (
        <MetricRow
            label="Repair attempts"
            value="Unavailable"
            detail="Repair history is temporarily unavailable. Open Observability to inspect maintenance status."
            onClick={onClick}
        />
    );
}

function CompactRailBlock({
    title,
    subtitle,
    rows,
    emptyMessage,
    loading,
    loadingMessage,
    onRowClick,
}: {
    title: string;
    subtitle: string;
    rows: Array<{ label: string; detail: string; targetView?: string }>;
    emptyMessage: string;
    loading?: boolean;
    loadingMessage?: string;
    onRowClick?: (targetView: string) => void;
}) {
    return (
        <div className="rounded-2xl border border-edge bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold tracking-tight text-content">{title}</h3>
                    <p className="mt-1 text-xs text-content-muted">{subtitle}</p>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-edge bg-surface-secondary text-content-secondary">
                    <Cpu className="h-4 w-4" />
                </div>
            </div>
            <div className="mt-3 space-y-2">
                {loading ? (
                    <EmptyRailState message={loadingMessage ?? 'Syncing live board...'} />
                ) : rows.length ? rows.map((row) => (
                    <button
                        key={`${row.label}-${row.detail}`}
                        type="button"
                        onClick={() => onRowClick?.(row.targetView ?? 'research')}
                        className="flex w-full flex-col items-start gap-2 rounded-2xl border border-edge/70 bg-surface-secondary/60 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                    >
                        <span className="w-full break-words text-sm font-medium text-content sm:w-auto">{row.label}</span>
                        <span className="w-full break-words text-left text-xs leading-5 text-content-secondary sm:max-w-[55%] sm:text-right">{row.detail}</span>
                    </button>
                )) : (
                    <EmptyRailState message={emptyMessage} />
                )}
            </div>
        </div>
    );
}

function EmptyRailState({ message }: { message: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-edge bg-surface px-3 py-3 text-xs text-content-muted">
            {message}
        </div>
    );
}

function QuickStartCard({ title, desc, icon, onClick, agentId, agentTarget }: {
    title: string;
    desc: string;
    icon: React.ReactNode;
    onClick: () => void;
    agentId?: string;
    agentTarget?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="
                group w-full rounded-2xl border border-edge bg-surface text-left
                px-4 py-3.5 transition-all duration-200
                hover:-translate-y-0.5 hover:bg-surface-hover hover:border-edge hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]
                active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
            "
            data-agent-id={agentId}
            data-agent-action="navigate"
            data-agent-label={title}
            data-agent-target={agentTarget}
        >
            <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-edge bg-surface-secondary text-content-secondary transition-transform duration-200 group-hover:scale-[1.04]">
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-tight text-content">{title}</div>
                    <div className="mt-1 text-xs leading-5 text-content-muted">{desc}</div>
                    <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                        Open
                        <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </div>
                </div>
            </div>
        </button>
    );
}

function CompactDestinationCard({ title, desc, icon, onClick, agentId, agentTarget }: {
    title: string;
    desc: string;
    icon: React.ReactNode;
    onClick: () => void;
    agentId?: string;
    agentTarget?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-agent-id={agentId}
            data-agent-action="navigate"
            data-agent-label={title}
            data-agent-target={agentTarget}
            className="
                group relative overflow-hidden rounded-2xl border border-edge bg-surface p-4 text-left transition-all duration-200
                hover:-translate-y-0.5 hover:bg-surface-hover hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]
                active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
            "
        >
            <div className="relative z-10 flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold tracking-tight text-content">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-content-secondary">
                        {desc}
                    </p>
                    <div className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
                        Open
                        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                    </div>
                </div>
            </div>
        </button>
    );
}

function getDealHeadline(deal: any, targetView: string): { label: string; detail: string; targetView: string } {
    const label = sanitizeReadableText(firstString(deal, ['companyName', 'company', 'title', 'name']) ?? 'Funding event');
    const amount = firstValue(deal, ['amountDisplay', 'amountUsdDisplay', 'amount', 'fundingAmount', 'investmentAmount']);
    const round = firstString(deal, ['round', 'roundType', 'stage']);
    const detailParts = [amount, round].filter(Boolean).map(String);
    return {
        label,
        detail: sanitizeReadableText(detailParts.join(' | ') || 'Capital event tracked'),
        targetView,
    };
}

function getRepoHeadline(repo: any, targetView: string): { label: string; detail: string; targetView: string } {
    const label = sanitizeReadableText(firstString(repo, ['fullName', 'name']) ?? 'Repository');
    const stars = typeof repo?.stars === 'number' ? `${formatCompactCount(repo.stars)} stars` : null;
    const growth = typeof repo?.starGrowth7d === 'number' ? `+${formatCompactCount(repo.starGrowth7d)} this week` : null;
    const language = firstString(repo, ['language']);
    const detailParts = [stars, growth, language].filter(Boolean);
    return {
        label,
        detail: sanitizeReadableText(detailParts.join(' | ') || 'GitHub activity tracked'),
        targetView,
    };
}

function summarizeSourceCount(sourceSummary: unknown): number {
    if (!sourceSummary) return 0;
    if (Array.isArray(sourceSummary)) return sourceSummary.length;
    if (typeof sourceSummary !== 'object') return 0;
    return Object.values(sourceSummary as Record<string, unknown>).reduce((total, value) => {
        if (typeof value === 'number' && Number.isFinite(value)) return total + value;
        if (Array.isArray(value)) return total + value.length;
        return total;
    }, 0);
}

function formatCompactCount(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: value >= 1000 ? 1 : 0,
    }).format(value);
}

function formatRelativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function formatHealthLabel(status?: string): string {
    if (!status) return 'Monitoring';
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function firstString(record: any, keys: string[]): string | null {
    for (const key of keys) {
        const value = record?.[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function firstValue(record: any, keys: string[]): string | number | null {
    for (const key of keys) {
        const value = record?.[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}
