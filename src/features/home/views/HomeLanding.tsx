import { useEffect, useMemo, useRef, useState } from "react";
import { MobileHomeSurface } from "./MobileHomeSurface";
import { MemoryPulse } from "@/features/home/components/MemoryPulse";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useConvex, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowUpRight, Clock3, Eye, FileText, Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { useConvexApi } from "@/lib/convexApi";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";
import { staggerDelay } from "@/lib/ui/stagger";
import { LENSES, type LensId } from "@/features/controlPlane/components/searchTypes";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import {
  addRecentSearch,
  formatRecentSearchLabel,
  getRecentSearches,
  loadProductDraft,
  saveProductDraft,
  shouldPersistDraftQueryInUrl,
  type ProductDraftFile,
} from "@/features/product/lib/productSession";
import { ReportCardSkeleton } from "@/components/skeletons";
import { ProductThumbnail } from "@/features/product/components/ProductThumbnail";
import { ProductSourceIdentity } from "@/features/product/components/ProductSourceIdentity";
import {
  ProductIntakeComposer,
  type ProductComposerMode,
  type ProductResearchLane,
} from "@/features/product/components/ProductIntakeComposer";
import { IntakeDetectedSources } from "@/features/product/components/IntakeDetectedSources";
import { ComposerRoutingPreview } from "@/features/product/components/ComposerRoutingPreview";
import { useProductBootstrap } from "@/features/product/lib/useProductBootstrap";
import { buildOperatorContextHint, buildOperatorContextLabel } from "@/features/product/lib/operatorContext";
import { uploadProductDraftFiles } from "@/features/product/lib/uploadDraftFiles";
import { buildEntityAliasKey } from "../../../../shared/reportArtifacts";

const SUGGESTED_PROMPTS = [
  "DISCO - worth reaching out? Fastest debrief.",
  "Summarize the attached 10-K into a 1-pager.",
  "Watch Mercor and nudge me on hiring signal.",
  "Stripe prep brief for tomorrow's call.",
] as const;

const WEB_KIT_PROMPT_CARDS = [
  { icon: Sparkles, prompt: SUGGESTED_PROMPTS[0] },
  { icon: FileText, prompt: SUGGESTED_PROMPTS[1] },
  { icon: Eye, prompt: SUGGESTED_PROMPTS[2] },
] as const;

const WEB_KIT_RESEARCH_LANES = [
  { id: "answer", label: "Quick answer", note: "fast read" },
  { id: "deep", label: "Deep research", note: "more sources" },
] as const satisfies readonly ProductResearchLane[];

type WebKitResearchLaneId = (typeof WEB_KIT_RESEARCH_LANES)[number]["id"];

const STARTER_REPORTS = [
  {
    key: "starter-company",
    title: "Company report",
    summary: "Start with a company and get a clean summary, the main risks, and what to do next.",
    prompt: "Build a company report from this screenshot, link, or description.",
    type: "company",
    lens: "founder" as LensId,
    updatedLabel: "Starter",
    origin: "starter" as const,
    originLabel: "Template",
  },
  {
    key: "starter-market",
    title: "Market report",
    summary: "Turn a market, category, or trend into a report with useful sources and clear watch items.",
    prompt: "Summarize this market and tell me what changed recently.",
    type: "market",
    lens: "investor" as LensId,
    updatedLabel: "Starter",
    origin: "starter" as const,
    originLabel: "Template",
  },
  {
    key: "starter-role",
    title: "Role fit",
    summary: "Compare a role, recruiter note, or job description against your background and surface the gaps.",
    prompt: "Compare this role to my resume and tell me what is missing.",
    type: "job",
    lens: "founder" as LensId,
    updatedLabel: "Starter",
    origin: "starter" as const,
    originLabel: "Template",
  },
] as const;

type HomeReportCard = {
  key: string;
  title: string;
  summary: string;
  prompt: string;
  type: string;
  lens: LensId;
  thumbnailUrl?: string;
  thumbnailUrls?: string[];
  sourceUrls?: string[];
  sourceLabels?: string[];
  updatedLabel: string;
  updatedAt?: number;
  entitySlug?: string;
  origin?: "user" | "system" | "starter";
  originLabel?: string;
};

function normalizeHomeReportDedupeKey(report: Pick<HomeReportCard, "entitySlug" | "type" | "title" | "prompt">) {
  const aliasKey = buildEntityAliasKey({
    primaryEntity: report.title,
    title: report.title,
    query: report.prompt,
    type: report.type,
    entityType: report.type,
    slug: report.entitySlug,
  });
  if (aliasKey) return `entity:${aliasKey}`;
  const entitySlug = report.entitySlug?.trim().toLowerCase();
  if (entitySlug) return `entity:${entitySlug}`;
  const type = report.type.trim().toLowerCase();
  const title = report.title.trim().toLowerCase();
  const prompt = report.prompt.trim().toLowerCase();
  return `report:${type}:${title}:${prompt}`;
}

export function buildVisibleHomeReports(
  reports: HomeReportCard[],
  maxItems = 3,
): HomeReportCard[] {
  const uniqueReports: HomeReportCard[] = [];
  const seen = new Set<string>();

  for (const report of reports) {
    const dedupeKey = normalizeHomeReportDedupeKey(report);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    uniqueReports.push(report);
  }

  const visible = uniqueReports.slice(0, maxItems);
  if (visible.length >= maxItems) return visible;

  const usedTypes = new Set(visible.map((report) => report.type.trim().toLowerCase()));
  for (const starter of STARTER_REPORTS) {
    if (visible.length >= maxItems) break;
    if (usedTypes.has(starter.type.trim().toLowerCase())) continue;
    visible.push(starter);
    usedTypes.add(starter.type.trim().toLowerCase());
  }

  if (visible.length >= maxItems) return visible;

  for (const starter of STARTER_REPORTS) {
    if (visible.length >= maxItems) break;
    if (visible.some((report) => report.key === starter.key)) continue;
    visible.push(starter);
  }

  return visible;
}

function getReportThumbnailTone(type: string | undefined, lens: LensId, index: number) {
  const normalizedType = type?.toLowerCase() ?? "";
  if (normalizedType.includes("company")) return 0;
  if (normalizedType.includes("market")) return 2;
  if (normalizedType.includes("job") || normalizedType.includes("role")) return 4;
  if (normalizedType.includes("person") || normalizedType.includes("founder")) return 3;
  if (lens === "investor") return 1;
  if (lens === "banker") return 5;
  return index % 6;
}

export type HomePulsePreview = {
  freshnessState?: string | null;
  items?: unknown[] | null;
  updatedAt?: number;
} | null;

type PublicResearchHomeRow = {
  researchRunId: string;
  status: string;
  entityKey: string;
  entityName: string;
  entityType: string;
  updatedAt: number;
  claimCount: number;
  sourceCount: number;
  confidence: number;
  summary?: string;
  sources?: Array<{ title?: string; url: string }>;
};

export function formatPulseFreshness(updatedAt?: number) {
  if (!updatedAt) return "Updated recently";
  const ageMinutes = Math.max(1, Math.round((Date.now() - updatedAt) / 60000));
  if (ageMinutes < 60) return `Updated ${ageMinutes}m ago`;
  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 24) return `Updated ${ageHours}h ago`;
  const ageDays = Math.round(ageHours / 24);
  return `Updated ${ageDays}d ago`;
}

export function isPulsePreviewVisible(pulsePreview: HomePulsePreview) {
  return Boolean(
    pulsePreview &&
      pulsePreview.freshnessState === "fresh" &&
      Array.isArray(pulsePreview.items) &&
      pulsePreview.items.length >= 3,
  );
}

export function HomeLanding() {
  useProductBootstrap();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const api = useConvexApi();
  const convex = useConvex();
  const landingStartedAtRef = useRef(
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  );
  const draft = useMemo(() => loadProductDraft(), []);
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<LensId>("founder");
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<ProductDraftFile[]>(() => draft?.files ?? []);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [composerMode, setComposerMode] = useState<ProductComposerMode>("ask");
  const [researchLane, setResearchLane] = useState<WebKitResearchLaneId>("answer");
  const [savingCapture, setSavingCapture] = useState(false);
  const [pulsePreview, setPulsePreview] = useState<any | null>(null);
  const [recentSearches] = useState(() => getRecentSearches());
  const queryParam = searchParams.get("q");

  const generateUploadUrl = useMutation(
    api?.domains.product.me.generateUploadUrl ?? ("skip" as any),
  );
  const saveFileMutation = useMutation(
    api?.domains.product.me.saveFile ?? ("skip" as any),
  );
  const saveContextCapture = useMutation(
    api?.domains.product.me.saveContextCapture ?? ("skip" as any),
  );
  const meSnapshot = useQuery(
    api?.domains.product.me.getMeSnapshot ?? "skip",
    api?.domains.product.me.getMeSnapshot
      ? { anonymousSessionId: getAnonymousProductSessionId() }
      : "skip",
  );

  const savedReports = useQuery(
    api?.domains.product.reports.listReports ?? "skip",
    api?.domains.product.reports.listReports
      ? { anonymousSessionId: getAnonymousProductSessionId() }
      : "skip",
  );
  const systemReports = useQuery(
    api?.domains?.product?.systemIntelligence?.listSystemReportCards ?? "skip",
    api?.domains?.product?.systemIntelligence?.listSystemReportCards
      ? { filter: "All" }
      : "skip",
  );
  const latestPublicResearch = useQuery(
    (api as any)?.domains?.publicResearch?.core?.listLatestPublicEntityResearch ?? "skip",
    (api as any)?.domains?.publicResearch?.core?.listLatestPublicEntityResearch
      ? { limit: 6 }
      : "skip",
  ) as PublicResearchHomeRow[] | undefined;
  const operatorProfile = meSnapshot?.profile ?? null;
  const operatorContextHint = useMemo(() => buildOperatorContextHint(operatorProfile), [operatorProfile]);
  const operatorContextLabel = useMemo(() => buildOperatorContextLabel(operatorProfile), [operatorProfile]);

  const reports: HomeReportCard[] = (savedReports ?? []).slice(0, 12).map((report: any) => ({
    key: String(report._id),
    title: report.title as string,
    summary: report.summary as string,
    prompt: (report.query || report.title) as string,
    type: (report.type as string) || "report",
    lens: (report.lens || "founder") as LensId,
    entitySlug: typeof report.entitySlug === "string" ? report.entitySlug : undefined,
    thumbnailUrl: typeof report.thumbnailUrl === "string" ? report.thumbnailUrl : undefined,
    thumbnailUrls: Array.isArray(report.thumbnailUrls)
      ? report.thumbnailUrls.filter((url: unknown): url is string => typeof url === "string")
      : undefined,
    sourceUrls: Array.isArray(report.sourceUrls)
      ? report.sourceUrls.filter((url: unknown): url is string => typeof url === "string")
      : undefined,
    sourceLabels: Array.isArray(report.sourceLabels)
      ? report.sourceLabels.filter((label: unknown): label is string => typeof label === "string")
      : undefined,
    updatedAt: typeof report.updatedAt === "number" ? report.updatedAt : undefined,
    updatedLabel: report.updatedAt
      ? new Date(report.updatedAt).toLocaleDateString()
      : "Recently",
    origin: "user",
    originLabel: "Workspace",
  }));
  const projectedSystemReports: HomeReportCard[] = (systemReports ?? []).slice(0, 12).map((report: any) => ({
    key: `system:${report.slug}`,
    title: report.name as string,
    summary: report.summary as string,
    prompt: `What matters most about ${report.name} right now?`,
    type: (report.entityType as string) || "report",
    lens: (report.entityType === "market" ? "investor" : "founder") as LensId,
    entitySlug: typeof report.slug === "string" ? report.slug : undefined,
    thumbnailUrl: typeof report.thumbnailUrl === "string" ? report.thumbnailUrl : undefined,
    thumbnailUrls: Array.isArray(report.thumbnailUrls)
      ? report.thumbnailUrls.filter((url: unknown): url is string => typeof url === "string")
      : undefined,
    sourceUrls: Array.isArray(report.sourceUrls)
      ? report.sourceUrls.filter((url: unknown): url is string => typeof url === "string")
      : undefined,
    sourceLabels: Array.isArray(report.sourceLabels)
      ? report.sourceLabels.filter((label: unknown): label is string => typeof label === "string")
      : undefined,
    updatedAt: typeof report.latestReportUpdatedAt === "number" ? report.latestReportUpdatedAt : undefined,
    updatedLabel:
      typeof report.latestReportUpdatedAt === "number"
        ? new Date(report.latestReportUpdatedAt).toLocaleDateString()
        : "System",
    origin: "system",
    originLabel: typeof report.originLabel === "string" ? report.originLabel : "System intelligence",
  }));
  const visibleReports = useMemo(
    () => buildVisibleHomeReports([...reports, ...projectedSystemReports]),
    [projectedSystemReports, reports],
  );
  const showPulseCard = isPulsePreviewVisible(pulsePreview);
  const extraPrompts = showAllPrompts ? SUGGESTED_PROMPTS.slice(WEB_KIT_PROMPT_CARDS.length) : [];

  useEffect(() => {
    let cancelled = false;
    const pulseQuery = (api?.domains?.product?.home as any)?.getPulsePreview;
    if (!pulseQuery) {
      setPulsePreview(null);
      return () => {
        cancelled = true;
      };
    }

    try {
      void convex
        .query(pulseQuery, {})
        .then((result) => {
          if (cancelled) return;
          setPulsePreview(result ?? null);
        })
        .catch((error) => {
          if (cancelled) return;
          console.warn("[home] getPulsePreview rejected; hiding pulse card", error);
          setPulsePreview(null);
        });
    } catch (error) {
      if (!cancelled) {
        console.warn("[home] getPulsePreview threw synchronously; hiding pulse card", error);
        setPulsePreview(null);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [api?.domains?.product?.home, convex]);

  useEffect(() => {
    if (!operatorProfile?.preferredLens) return;
    if (queryParam) return;
    if (!LENSES.some((option) => option.id === operatorProfile.preferredLens)) return;
    if (lens === operatorProfile.preferredLens) return;
    setLens(operatorProfile.preferredLens as LensId);
  }, [lens, operatorProfile?.preferredLens, queryParam]);

  /* ---- Core action: navigate to workspace ---- */
  const startChat = (
    nextQuery?: string,
    nextLens?: LensId,
    source = "composer",
  ) => {
    const resolvedQuery = (nextQuery ?? query).trim();
    const resolvedLens = nextLens ?? lens;
    if (!resolvedQuery) return;
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    addRecentSearch(resolvedQuery, resolvedLens);
    saveProductDraft({
      query: resolvedQuery,
      lens: resolvedLens,
      files: pendingFiles,
    });
    trackEvent("landing_to_first_run_start", {
      durationMs: Math.max(
        0,
        Math.round(now - landingStartedAtRef.current),
      ),
      source,
      uploads: pendingFiles.length,
      queryLength: resolvedQuery.length,
    });

    navigate(
      buildCockpitPath({
        surfaceId: "workspace",
        extra: shouldPersistDraftQueryInUrl(resolvedQuery)
          ? { q: resolvedQuery, lens: resolvedLens, lane: researchLane }
          : { lens: resolvedLens, lane: researchLane, draft: "1" },
      }),
    );
  };

  /* ---- Shareable link support: ?q=&lens= ---- */
  const didAutoStartRef = useRef(false);
  useEffect(() => {
    if (didAutoStartRef.current) return;
    const urlQuery = searchParams.get("q");
    const urlLens = searchParams.get("lens") as LensId | null;
    if (urlQuery?.trim()) {
      didAutoStartRef.current = true;
      setQuery(urlQuery.trim());
      startChat(urlQuery.trim(), urlLens ?? lens, "shared_link");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- File upload handler ---- */
  const handleFilesSelected = async (files: File[]) => {
    if (!files.length || !api) return;
    setUploadingFiles(true);
    try {
      const uploaded: ProductDraftFile[] = await uploadProductDraftFiles({
        files,
        anonymousSessionId: getAnonymousProductSessionId(),
        generateUploadUrl,
        saveFileMutation,
      });
      setPendingFiles((current) => [...current, ...uploaded]);
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleSaveCapture = async (mode: Exclude<ProductComposerMode, "ask">, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSavingCapture(true);
    try {
      await saveContextCapture({
        anonymousSessionId: getAnonymousProductSessionId(),
        type: mode,
        content: trimmed,
      });
      setQuery("");
      setComposerMode("ask");
      saveProductDraft({
        query: "",
        lens,
        files: pendingFiles,
      });
      toast.success(mode === "note" ? "Note saved to inbox" : "Task saved to inbox");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save quick capture");
    } finally {
      setSavingCapture(false);
    }
  };

  return (
    <>
      {/* Mobile-viewport surface — matches
          docs/design/nodebench-ai-design-system/ui_kits/nodebench-mobile/MobileHome.jsx
          Desktop shell below stays untouched via md:flex / md:hidden split. */}
      <MobileHomeSurface />
    <div className="mx-auto hidden min-h-[calc(100vh-4rem)] w-full max-w-[1120px] flex-col px-4 pb-24 pt-6 sm:px-6 sm:pb-12 sm:pt-10 md:flex">
      <section className="mx-auto w-full max-w-[760px] text-center">
        {/* "NEW RUN" pill removed — the composer below IS the CTA.
            Perplexity / Claude / ChatGPT all omit this label. If
            removing an element loses no function, remove it. */}
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
          ENTITY INTELLIGENCE
        </div>
        <h1 className="text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.01em] text-gray-900 dark:text-gray-100 md:text-[2.25rem]">
          What are we researching today?
        </h1>
        <p className="mx-auto mt-2 max-w-[460px] text-[15px] leading-6 text-gray-500 dark:text-gray-400">
          Answer-first. Backed by sources. Saved reports become reusable memory.
        </p>
        {operatorContextLabel ? (
          <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300">
            <span className="font-medium">Using your context</span>
            <span className="text-gray-400 dark:text-gray-500">{operatorContextLabel}</span>
          </div>
        ) : null}

        <div className="mt-6 sm:mt-8">
          <ProductIntakeComposer
            value={query}
            onChange={setQuery}
            onSubmit={() => startChat()}
            onFilesSelected={handleFilesSelected}
            files={pendingFiles}
            lens={lens}
            onLensChange={setLens}
            researchLanes={WEB_KIT_RESEARCH_LANES}
            selectedResearchLane={researchLane}
            onResearchLaneChange={(laneId) => setResearchLane(laneId as WebKitResearchLaneId)}
            operatorContextLabel={operatorContextLabel}
            operatorContextHint={operatorContextHint}
            uploadingFiles={uploadingFiles}
            placeholder="Ask anything - a company, a market, a question..."
            helperText="Accepts URLs, PDFs, docs, and notes."
            submitLabel="Open workspace"
            showOperatorContextChip={false}
            showOperatorContextHint={false}
            showLensSelector={false}
            autoFocus
            mode={composerMode}
            onModeChange={setComposerMode}
            showCaptureModes={false}
            onSaveCapture={handleSaveCapture}
            captureSavePending={savingCapture}
          />
          {/* Live classifier affordance — stays silent until the user types
              or drops files, then shows "Detected: N LinkedIn profiles ·
              1 pitch deck · founder note" + per-source chips. Proves the
              intake breadth claim in the elevator pitch. */}
          <IntakeDetectedSources
            text={query}
            files={pendingFiles}
            className="mt-3"
          />
          <ComposerRoutingPreview
            text={query}
            files={pendingFiles}
            mode={composerMode}
            activeContextLabel="workspace inbox"
            className="mt-3"
          />
          {/* Developer install chip — matches `docs/design/.../ui_kits/nodebench-mcp`.
              Visitors who arrive via Claude/Cursor discover the install path
              above the fold without a separate tab switch. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
            <span className="uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
              Use from Claude or Cursor
            </span>
            <code className="rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-700 dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-gray-200">
              npx nodebench-mcp
            </code>
            <a
              href="/cli"
              className="text-[12px] font-medium text-[var(--accent-primary)] transition hover:underline"
            >
              CLI instructions -&gt;
            </a>
          </div>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            {WEB_KIT_PROMPT_CARDS.map(({ icon: Icon, prompt }, index) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setQuery(prompt);
                  startChat(prompt, lens, "suggested_prompt");
                }}
                className="h-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-[0_18px_40px_-30px_rgba(15,23,42,0.25)] transition hover:-translate-y-0.5 hover:border-[var(--accent-primary)]/35 hover:shadow-[0_22px_52px_-34px_rgba(217,119,87,0.38)] dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-[var(--accent-primary)]/35"
                style={staggerDelay(index)}
                data-testid="web-kit-prompt-card"
              >
                <span className="mb-4 inline-flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="block text-sm font-semibold leading-5 text-gray-900 dark:text-gray-100">{prompt}</span>
              </button>
            ))}
          </div>
          {SUGGESTED_PROMPTS.length > WEB_KIT_PROMPT_CARDS.length ? (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {extraPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    setQuery(prompt);
                    startChat(prompt, lens, "suggested_prompt");
                  }}
                  className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition hover:border-[var(--accent-primary)]/35 hover:text-gray-900 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:border-[var(--accent-primary)]/35"
                >
                  {prompt}
                </button>
              ))}
              <button
                type="button"
                className="rounded-full px-4 py-2 text-sm font-medium text-[var(--accent-primary)] transition hover:bg-[var(--accent-primary)]/10"
                onClick={() => setShowAllPrompts((value) => !value)}
              >
                {showAllPrompts ? "Hide examples" : "More examples"}
              </button>
            </div>
          ) : null}
        </div>

        {/*
          Memory pulse band — kit parity per ui_kits/nodebench-web/PulseStrip.jsx.
          HONEST_SCORES: only renders when the user has >= 3 entities; metrics
          are computed from the existing listEntities query (no fake numbers).
        */}
        {/* HONEST_SCORES: count only user-created saved reports.  visibleReports
            mixes in system-intelligence cards everyone sees, which would
            show "3 reports created" to a brand-new user with zero chats. */}
        <MemoryPulse reportsCreated={savedReports?.length ?? 0} className="mt-6 sm:mt-8" />

        {/*
          Welcome fallback — shown only when there's nothing else to anchor the
          Home view (no pulse, no recent searches, no saved reports). Prevents
          the "white void" state for first-time and guest users. Designed to
          match Jony Ive empty-state guidance: intentional, actionable, warm.
        */}
        {!showPulseCard &&
        (latestPublicResearch?.length ?? 0) === 0 &&
        recentSearches.length === 0 &&
        visibleReports.length === 0 ? (
          <div
            data-testid="welcome"
            className="mt-5 rounded-[28px] border border-gray-200 bg-[radial-gradient(circle_at_top_left,_rgba(217,119,87,0.10),_transparent_40%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,245,241,0.96))] p-5 text-left dark:border-white/[0.10] dark:bg-[radial-gradient(circle_at_top_left,_rgba(217,119,87,0.14),_transparent_34%),linear-gradient(180deg,_rgba(23,28,34,0.96),_rgba(18,22,27,0.98))]"
          >
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              <span className="inline-flex h-2 w-2 rounded-full bg-[var(--accent-primary)]" aria-hidden="true" />
              Welcome to NodeBench
            </div>
            <h2 className="mt-2 text-[20px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              Questions become durable work.
            </h2>
            <p className="mt-2 text-[14px] leading-6 text-gray-600 dark:text-gray-300">
              Ask about a company, person, product, event, location, or job below.
              Get a cited answer fast. If it&rsquo;s a bigger question, the same artifact
              keeps deepening.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {SUGGESTED_PROMPTS.slice(0, 2).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => startChat(prompt, lens, "welcome_prompt")}
                  className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition hover:border-[var(--accent-primary)]/35 hover:text-gray-900 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:border-[var(--accent-primary)]/35 dark:hover:bg-white/[0.06]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {(latestPublicResearch?.length ?? 0) > 0 ? (
          <div className="mt-6 text-left" data-testid="latest-public-research">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                  Latest public research
                </p>
                <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  Reusable entity memory
                </h2>
              </div>
              <span className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-500 dark:border-white/[0.10] dark:text-gray-400">
                Public facts only
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {latestPublicResearch?.slice(0, 4).map((item) => (
                <button
                  key={item.entityKey}
                  type="button"
                  onClick={() => startChat(`Open public dossier for ${item.entityName}`, "founder", "public_research_home")}
                  className="group min-w-0 rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:border-[var(--accent-primary)]/35 hover:shadow-[0_18px_42px_-32px_rgba(217,119,87,0.38)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 dark:border-white/[0.10] dark:bg-white/[0.03] dark:hover:border-[var(--accent-primary)]/35"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                        {item.entityName}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                        <span>{item.entityType}</span>
                        <span>{item.status.replace(/_/g, " ")}</span>
                      </div>
                    </div>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition group-hover:text-[var(--accent-primary)]" />
                  </div>
                  <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-gray-600 dark:text-gray-300">
                    {item.summary || "Research run recorded. Verified public claims will appear as sources are extracted."}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
                    <span>{item.claimCount} claim{item.claimCount === 1 ? "" : "s"}</span>
                    <span>{item.sourceCount} source{item.sourceCount === 1 ? "" : "s"}</span>
                    <span>{Math.round((item.confidence || 0) * 100)}% confidence</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showPulseCard ? (
          <button
            type="button"
            data-testid="pulse-card"
            onClick={() => startChat(pulsePreview.prompt, "founder", "daily_pulse")}
            className="mt-5 w-full rounded-[28px] border border-gray-200 bg-[radial-gradient(circle_at_top_left,_rgba(217,119,87,0.16),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,245,241,0.98))] p-5 text-left transition hover:border-[var(--accent-primary)]/35 hover:shadow-[0_24px_60px_rgba(217,119,87,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 dark:border-white/[0.12] dark:bg-[radial-gradient(circle_at_top_left,_rgba(217,119,87,0.2),_transparent_28%),linear-gradient(180deg,_rgba(23,28,34,0.96),_rgba(18,22,27,0.98))] dark:hover:border-[var(--accent-primary)]/38"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  <span className="inline-flex h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                  Daily Pulse
                </div>
                <h2 className="mt-2 text-[20px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  {pulsePreview.title || "Today's strongest signals"}
                </h2>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-[12px] text-gray-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-300">
                <Clock3 className="h-3.5 w-3.5" />
                {formatPulseFreshness(pulsePreview.updatedAt)}
              </span>
            </div>
            {pulsePreview.summary ? (
              <p className="mt-3 text-[14px] leading-6 text-gray-600 dark:text-gray-300">
                {pulsePreview.summary}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3">
              {pulsePreview.items.slice(0, 3).map((item: any, index: number) => (
                <div
                  key={item.id ?? `${item.title}-${index}`}
                  className="rounded-2xl border border-gray-200/80 bg-white/70 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                        {item.title}
                      </div>
                      <p className="mt-1 text-[14px] leading-6 text-gray-600 dark:text-gray-300">
                        {item.summary}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-gray-200 px-2 py-1 text-[11px] text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
                      {item.sourceCount} source{item.sourceCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--accent-primary)]">
              Open full brief in Chat
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </button>
        ) : null}

        {recentSearches.length > 0 && (
          <div className="mt-5 sm:mt-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
              Recent
            </p>
            <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 sm:flex-wrap sm:justify-center sm:overflow-visible">
              {recentSearches.slice(0, 6).map((r) => (
                <button
                  key={r.query}
                  type="button"
                  onClick={() =>
                    startChat(r.query, r.lens as LensId, "recent_search")
                  }
                  title={r.query}
                  aria-label={r.query}
                  className="min-w-0 max-w-[min(88vw,44rem)] rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-white/[0.12] dark:bg-[#161b20] dark:text-gray-300 dark:hover:border-white/[0.2] dark:hover:bg-[#20262d] dark:hover:text-gray-100"
                >
                  <span className="block truncate">{formatRecentSearchLabel(r.query)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mt-10 sm:mt-14">
        <div className="mb-4 flex items-end justify-between gap-4 sm:mb-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
              Pick up where you left off
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              Your recent reports
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {savedReports === undefined && visibleReports.length === 0
            ? [0, 1, 2].map((i) => <ReportCardSkeleton key={`skeleton-${i}`} />)
            : null}
          {visibleReports.map((r, index) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                if (r.entitySlug && r.origin !== "starter") {
                  navigate(`/entity/${encodeURIComponent(r.entitySlug)}`);
                  return;
                }
                startChat(r.prompt, r.lens, "report_card");
              }}
              className="starting-point-card nb-hover-lift nb-hover-lift-accent group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-white/[0.1] dark:bg-[#171b20] dark:hover:bg-[#1b2026] dark:focus-visible:ring-offset-[#0a0d10]"
              style={staggerDelay(index)}
            >
              <ProductThumbnail
                className="mb-3 aspect-[16/9]"
                title={r.title}
                summary={r.summary}
                type={r.type}
                imageUrl={r.thumbnailUrl}
                imageUrls={r.thumbnailUrls}
                sourceUrls={r.sourceUrls}
                sourceLabels={r.sourceLabels}
                tone={getReportThumbnailTone(r.type, r.lens, index)}
                compact
              />
              <h3 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                {r.title}
              </h3>
              <p className="mt-1.5 line-clamp-3 min-h-[4.25em] text-sm leading-5 text-gray-500 dark:text-gray-400">
                {r.summary}
              </p>
              <div className="mt-auto pt-3">
                <span className="block text-[11px] uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">
                  {r.originLabel ?? r.updatedLabel}
                </span>
                <span className="mt-1 block text-xs text-gray-400 dark:text-gray-500">
                  {r.updatedLabel}
                </span>
                <div className="mt-2 min-h-[20px]">
                  <ProductSourceIdentity
                    sourceUrls={r.sourceUrls}
                    sourceLabels={r.sourceLabels}
                    maxItems={1}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
    </>
  );
}

export default HomeLanding;
