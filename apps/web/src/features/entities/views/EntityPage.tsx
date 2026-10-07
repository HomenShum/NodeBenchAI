/**
 * EntityPage - Compound note page for a single entity.
 *
 * Like an Obsidian vault page: shows ALL interactions with one entity over time.
 * Temporal diffs between reports, editable notes, source accumulation.
 *
 * Route: /entity/:slug (via viewRegistry "entity" entry)
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Ellipsis,
  ExternalLink,
  FileText,
  Link2,
  MessageSquare,
  Search,
  Building2,
  User,
  Users,
  Briefcase,
  TrendingUp,
  StickyNote,
  Upload,
  Sparkles,
  Bookmark,
  RefreshCw,
  Bell,
  BellRing,
  GitBranch,
} from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { useProductBootstrap } from "@/features/product/lib/useProductBootstrap";
import { ProductWorkspaceHeader } from "@/features/product/components/ProductWorkspaceHeader";
import { ProductSourceIdentity } from "@/features/product/components/ProductSourceIdentity";
import { useToast } from "@/shared/ui";
import type { EntityNoteEditorHandle } from "@/features/entities/components/EntityNoteEditor";
import {
  buildPrepBriefPrompt,
  getReportArtifactLabel,
  isPrepBriefType,
} from "../../../../../../shared/reportArtifacts";
import {
  buildEntityPath,
  buildCrmSummary,
  buildEntityExecutiveBrief,
  buildEntityInviteUrl,
  buildEntityMarkdown,
  buildEntityShareUrl,
  buildOutreachDraft,
} from "@/features/entities/lib/entityExport";
import {
  useActiveEntity,
  useFastAgent,
} from "@/features/agents/context/FastAgentContext";
import { PulseBadge } from "@/features/pulse/components/PulseBadge";
import { EntityMemoryGraph } from "@/features/entities/components/EntityMemoryGraph";
import { EntityNotebookMeta } from "@/features/entities/components/EntityNotebookMeta";
import { EntityNotebookSurface } from "@/features/entities/components/EntityNotebookSurface";
import { ViewModeToggle } from "@/features/entities/components/ViewModeToggle";
import { useViewMode } from "@/features/entities/lib/useViewMode";
import { EntityShareSheet } from "@/features/entities/components/EntityShareSheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ai-ui/toggle-group";
import { DiligenceSection } from "@/features/entities/components/DiligenceSection";
import { SignInForm } from "@/SignInForm";
import { SignOutButton } from "@/SignOutButton";
import {
  buildEntityNoteDocumentDraft,
  createEmptyEntityNoteDocument,
  type LegacyEntityNoteBlock,
  type EntityNoteDocument,
} from "@/features/entities/lib/entityNoteDocument";
import { getStarterEntityWorkspace } from "@/features/entities/lib/starterEntityWorkspaces";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ai-ui/dialog";

const EntityNoteEditor = lazy(
  () => import("@/features/entities/components/EntityNoteEditor"),
);
const ENTITY_VIEW_MODE_STORAGE_PREFIX = "nodebench.entityViewMode:";
const LIVE_NOTEBOOK_DISABLE_KEY = "nodebench.liveNotebookDisabled";
const LIVE_NOTEBOOK_FORCE_ENABLE_KEY = "nodebench.liveNotebookForceEnabled";
const DEFAULT_LIVE_NOTEBOOK_ROLLOUT_PERCENT = 100;

// Feature flag / kill switch for the Lexical-backed Live notebook. Two layers:
//   1. Build-time env var — `VITE_NOTEBOOK_LIVE_ENABLED=false` hides the
//      button for all users without a redeploy of the feature itself.
//   2. Runtime localStorage override — a user or on-call engineer can set
//      `nodebench.liveNotebookDisabled=1` in devtools to fall back to
//      Classic view for that specific browser/tab instance.
// If a regression ships, either knob recovers without pushing a new build.
export function normalizeLiveNotebookRolloutPercent(
  value: string | undefined,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIVE_NOTEBOOK_ROLLOUT_PERCENT;
  return Math.min(100, Math.max(0, parsed));
}

export function stableLiveNotebookBucket(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % 100;
}

export function isLiveNotebookInRolloutCohort(
  rolloutPercent: number,
  sessionId: string,
  entitySlug?: string,
): boolean {
  if (rolloutPercent >= 100) return true;
  if (rolloutPercent <= 0) return false;
  const rolloutSeed = `${sessionId}:${entitySlug ?? "global"}`;
  return stableLiveNotebookBucket(rolloutSeed) < rolloutPercent;
}

export function isLiveNotebookEnabled(entitySlug?: string): boolean {
  if (typeof window === "undefined") return true;
  const env = (
    import.meta as {
      env?: {
        VITE_NOTEBOOK_LIVE_ENABLED?: string;
        VITE_NOTEBOOK_LIVE_ROLLOUT_PERCENT?: string;
      };
    }
  ).env;
  const envFlag = env?.VITE_NOTEBOOK_LIVE_ENABLED;
  if (envFlag === "false" || envFlag === "0") return false;
  if (window.localStorage.getItem(LIVE_NOTEBOOK_DISABLE_KEY) === "1")
    return false;
  if (window.localStorage.getItem(LIVE_NOTEBOOK_FORCE_ENABLE_KEY) === "1")
    return true;
  const rolloutPercent = normalizeLiveNotebookRolloutPercent(
    env?.VITE_NOTEBOOK_LIVE_ROLLOUT_PERCENT,
  );
  return isLiveNotebookInRolloutCohort(
    rolloutPercent,
    getAnonymousProductSessionId(),
    entitySlug,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Identity redesign flag (PR-C of ENTITY_PAGE_REDESIGN.md).
// When ON (the default), the entity page hides the Classic/Notebook/Live
// three-way toggle and makes Live the only user-facing editable surface.
// Kill switches still work: VITE_NOTEBOOK_LIVE_ENABLED=false forces
// Classic, as before.
// Two-layer override identical to the other notebook flags:
//   - VITE_NOTEBOOK_IDENTITY_REDESIGN_ENABLED=false  (build-time)
//   - localStorage nodebench.notebookIdentityRedesignDisabled=1  (per-browser)
// ───────────────────────────────────────────────────────────────────────────
const IDENTITY_REDESIGN_DISABLE_KEY =
  "nodebench.notebookIdentityRedesignDisabled";

export function isNotebookIdentityRedesignEnabled(): boolean {
  if (typeof window === "undefined") return true;
  if (window.localStorage.getItem(IDENTITY_REDESIGN_DISABLE_KEY) === "1")
    return false;
  const env = (
    import.meta as {
      env?: { VITE_NOTEBOOK_IDENTITY_REDESIGN_ENABLED?: string };
    }
  ).env;
  const flag = env?.VITE_NOTEBOOK_IDENTITY_REDESIGN_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return true;
}

function readInitialEntityViewMode(
  entitySlug: string,
): "classic" | "notebook" | "live" {
  if (typeof window === "undefined") return "notebook";
  const stored = window.localStorage.getItem(
    `${ENTITY_VIEW_MODE_STORAGE_PREFIX}${entitySlug}`,
  );
  const candidate =
    stored === "classic" || stored === "notebook" || stored === "live"
      ? stored
      : "notebook";
  // Kill-switch fallback: if a user has Live selected but the flag is off
  // (new build, or they flipped the local override), downgrade to Classic
  // without losing any data — blocks remain intact in the database.
  if (candidate === "live" && !isLiveNotebookEnabled(entitySlug))
    return "classic";
  return candidate;
}

// ── Types ────────────────────────────────────────────────────────────────────

type ReportSection = {
  id: string;
  title: string;
  body: string;
  status?: string;
  sourceRefIds?: string[];
};

type ReportSource = {
  id: string;
  label: string;
  href?: string;
  type?: string;
  domain?: string;
};

type SectionDiff = {
  id: string;
  title: string;
  status: "new" | "changed";
  previousBody: string;
  currentBody: string;
};

type TimelineReport = {
  _id: string;
  title: string;
  type: string;
  summary: string;
  query: string;
  lens: string;
  routing?: {
    routingMode: "executive" | "advisor";
    routingReason?: string;
    plannerModel?: string;
    executionModel?: string;
  };
  operatorContext?: {
    label?: string;
    hint?: string;
  };
  sections: ReportSection[];
  sources: ReportSource[];
  diffs: SectionDiff[];
  isLatest: boolean;
  createdAt: number;
  updatedAt: number;
  revision?: number;
};

type EntityWorkspace = {
  entity: {
    _id: string;
    name: string;
    slug: string;
    entityType: string;
    summary: string;
    savedBecause?: string;
    reportCount: number;
    createdAt: number;
    updatedAt: number;
  };
  note: {
    _id: string;
    content: string;
    blocks?: LegacyEntityNoteBlock[];
    createdAt: number;
    updatedAt: number;
  } | null;
  noteDocument?: EntityNoteDocument | null;
  latest: TimelineReport | null;
  timeline: TimelineReport[];
  evidence: Array<{
    _id: string;
    label: string;
    type: string;
    sourceUrl?: string;
    entityId?: string;
  }>;
  relatedEntities?: Array<{
    slug: string;
    name: string;
    entityType: string;
    summary: string;
    reason?: string;
  }>;
  viewerAccess?: {
    mode: "owner" | "share" | "member";
    access: "view" | "edit";
    canEditNotes: boolean;
    canEditNotebook: boolean;
    canManageShare: boolean;
    canManageMembers: boolean;
  } | null;
  viewerIdentity?: {
    ownerKey: string | null;
  } | null;
  ownerProfile?: {
    ownerKey: string;
    userId?: string;
    email?: string;
    name?: string;
    image?: string;
  } | null;
  shareLinks?: {
    view?: { token: string; access: "view" | "edit" } | null;
    edit?: { token: string; access: "view" | "edit" } | null;
  } | null;
  collaborators?: {
    members: Array<{
      _id: string;
      userId: string;
      email: string;
      name?: string;
      image?: string;
      access: "view" | "edit";
      token: string;
      notificationStatus?: "sent" | "link_only";
      notificationUpdatedAt?: number;
      notificationError?: string;
      updatedAt: number;
    }>;
    invites: Array<{
      _id: string;
      email: string;
      access: "view" | "edit";
      token: string;
      notificationStatus?: "sent" | "link_only";
      notificationUpdatedAt?: number;
      notificationError?: string;
      updatedAt: number;
    }>;
  } | null;
};

type WorkspaceInvitePreview = {
  entitySlug: string;
  entityName: string;
  email: string;
  access: "view" | "edit";
} | null;

type WorkspaceAccessPreview = {
  kind: "share" | "member";
  entitySlug: string;
  entityName: string;
  access: "view" | "edit";
  email?: string;
} | null;

type EntityBlockSummary = {
  blockCount: number;
  userEditedCount: number;
  latestUpdatedAt?: number;
  latestUserEditAt?: number;
  latestHumanEditorOwnerKey?: string;
  latestHumanEditorUpdatedAt?: number;
};

type ReportRefreshResult = {
  reportId?: string | null;
  entitySlug?: string | null;
  query?: string | null;
  lens?: string | null;
  refreshPrompt?: string | null;
};

export function getNotebookDriftSummary(
  blockSummary: EntityBlockSummary | null | undefined,
  latestReport: TimelineReport | null | undefined,
): { updatedAt: number; message: string } | null {
  if (!blockSummary || blockSummary.blockCount === 0) return null;
  const latestUserEditAt = blockSummary.latestUserEditAt;
  if (latestUserEditAt == null) return null;
  if (latestUserEditAt <= (latestReport?.updatedAt ?? 0)) return null;
  return {
    updatedAt: latestUserEditAt,
    message: `${blockSummary.userEditedCount} live notebook edits are newer than the saved report. Classic may lag behind Live ✨.`,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number | undefined | null) {
  if (!ts || ts <= 0) return "Recently";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "Recently";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(ts: number | undefined | null): string {
  if (!ts || ts <= 0) return "Recently";
  const delta = Date.now() - ts;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(ts);
}

function normalizeWorkspaceEmail(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function getCollaborationParticipantLabel(args: {
  ownerProfile?: EntityWorkspace["ownerProfile"];
  members?: ReadonlyArray<{
    userId?: string;
    name?: string | null;
    email?: string | null;
  }>;
  ownerKey?: string | null;
}) {
  if (!args.ownerKey) return null;
  if (args.ownerProfile?.ownerKey === args.ownerKey) {
    return (
      args.ownerProfile.name?.trim() ||
      args.ownerProfile.email?.trim() ||
      "Workspace owner"
    );
  }
  const member = (args.members ?? []).find(
    (candidate: any) => `user:${candidate.userId}` === args.ownerKey,
  );
  if (member) {
    const m = member as { name?: string | null; email?: string | null };
    return m.name?.trim() || m.email;
  }
  if (args.ownerKey.startsWith("anon:")) return "Anonymous workspace";
  return "Someone";
}

export function buildEntityReopenChatPath(
  report: Pick<TimelineReport, "query" | "lens"> | null | undefined,
  entity: { slug?: string | null; name?: string | null },
): string {
  return buildCockpitPath({
    surfaceId: "workspace",
    entity: entity.slug ?? undefined,
    extra: {
      q:
        report?.query?.trim() ||
        `Update ${entity.name ?? "this entity"} and show me what changed.`,
      lens: report?.lens ?? "founder",
    },
  });
}

export function buildEntityRefreshChatPath(
  refresh: ReportRefreshResult | null | undefined,
  fallbackReport:
    | Pick<TimelineReport, "_id" | "query" | "lens">
    | null
    | undefined,
  entity: { slug?: string | null; name?: string | null },
): string {
  const subject = entity.name ?? entity.slug ?? "this entity";
  return buildCockpitPath({
    surfaceId: "workspace",
    entity: refresh?.entitySlug ?? entity.slug ?? undefined,
    extra: {
      q:
        refresh?.refreshPrompt?.trim() ||
        `Update ${subject} and show me what changed from the saved report.`,
      lens: refresh?.lens ?? fallbackReport?.lens ?? "founder",
      report: refresh?.reportId ?? fallbackReport?._id ?? null,
    },
  });
}

export function buildEntityPrepChatPath(
  report: Pick<TimelineReport, "query" | "lens"> | null | undefined,
  entity: { slug?: string | null; name?: string | null },
): string {
  return buildCockpitPath({
    surfaceId: "workspace",
    entity: entity.slug ?? undefined,
    extra: {
      q: buildPrepBriefPrompt({
        entityName: entity.name ?? undefined,
        fallbackQuery: report?.query ?? undefined,
      }),
      lens: report?.lens ?? "founder",
    },
  });
}

function entityTypeIcon(type: string) {
  switch (type) {
    case "company":
      return <Building2 className="h-4 w-4" />;
    case "person":
      return <User className="h-4 w-4" />;
    case "job":
      return <Briefcase className="h-4 w-4" />;
    case "market":
      return <TrendingUp className="h-4 w-4" />;
    case "note":
      return <StickyNote className="h-4 w-4" />;
    default:
      return <FileText className="h-4 w-4" />;
  }
}

function computeDiffSummary(diffs: SectionDiff[]): string {
  if (!diffs.length) return "";
  const parts: string[] = [];
  const newSections = diffs.filter((d) => d.status === "new");
  const changedSections = diffs.filter((d) => d.status === "changed");
  if (newSections.length) {
    parts.push(
      `${newSections.length} new section${newSections.length > 1 ? "s" : ""}: ${newSections
        .map((d) => `"${d.title}"`)
        .join(", ")}`,
    );
  }
  if (changedSections.length) {
    parts.push(
      `${changedSections.length} updated: ${changedSections.map((d) => `"${d.title}"`).join(", ")}`,
    );
  }
  return parts.join(" · ");
}

function routingToneLabel(
  report: TimelineReport | null | undefined,
): string | null {
  if (!report?.routing?.routingMode) return null;
  return report.routing.routingMode === "advisor"
    ? "Deep reasoning"
    : "Fast path";
}

const SECTION_PRIORITY = [
  "what-it-is",
  "why-it-matters",
  "signals",
  "what-changed",
  "what-to-do-next",
] as const;

function normalizeSectionKey(section: Pick<ReportSection, "id" | "title">) {
  const id = section.id?.trim().toLowerCase();
  if (id) return id;
  return section.title.trim().toLowerCase().replace(/\s+/g, "-");
}

function orderReportSections(sections: ReportSection[]) {
  return [...sections].sort((left, right) => {
    const leftIndex = SECTION_PRIORITY.indexOf(
      normalizeSectionKey(left) as (typeof SECTION_PRIORITY)[number],
    );
    const rightIndex = SECTION_PRIORITY.indexOf(
      normalizeSectionKey(right) as (typeof SECTION_PRIORITY)[number],
    );
    const resolvedLeft = leftIndex === -1 ? SECTION_PRIORITY.length : leftIndex;
    const resolvedRight =
      rightIndex === -1 ? SECTION_PRIORITY.length : rightIndex;
    if (resolvedLeft !== resolvedRight) return resolvedLeft - resolvedRight;
    return left.title.localeCompare(right.title);
  });
}

function getSourceKey(source: Pick<ReportSource, "id" | "label">) {
  return source.id?.trim() || source.label.trim();
}

export function getSectionSources(
  section: ReportSection,
  sources: ReportSource[],
  maxItems?: number,
) {
  const refs = new Set(
    (section.sourceRefIds ?? []).map((ref) => ref.trim()).filter(Boolean),
  );
  if (!refs.size) return [];
  const matches = sources.filter(
    (source) => refs.has(source.id) || refs.has(source.label),
  );
  return typeof maxItems === "number" ? matches.slice(0, maxItems) : matches;
}

export function getSourceSupportingSections(
  source: ReportSource,
  sections: ReportSection[],
) {
  const sourceKey = getSourceKey(source);
  const sourceLabel = source.label.trim();
  return sections
    .filter((section) => {
      const refs = new Set(
        (section.sourceRefIds ?? []).map((ref) => ref.trim()).filter(Boolean),
      );
      return refs.has(sourceKey) || refs.has(sourceLabel);
    })
    .map((section) => section.title);
}

function totalSources(timeline: TimelineReport[]): number {
  const seen = new Set<string>();
  for (const report of timeline) {
    for (const source of report.sources ?? []) {
      seen.add(source.id || source.label);
    }
  }
  return seen.size;
}

function collectAllSources(timeline: TimelineReport[]): ReportSource[] {
  const seen = new Map<string, ReportSource>();
  for (const report of timeline) {
    for (const source of report.sources ?? []) {
      const key = source.id || source.label;
      if (!seen.has(key)) seen.set(key, source);
    }
  }
  return Array.from(seen.values());
}

function extractDomain(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function getSavedBecausePlaceholder(entityType: string) {
  const normalized = entityType.toLowerCase();
  if (normalized === "job") return "job target";
  if (normalized === "market") return "market watch";
  if (normalized === "person") return "people research";
  return "company briefing";
}

function getEntityVisitStorageKey(slug: string) {
  return `nodebench:entity:last-visited:${slug}`;
}

function readPreviousEntityVisit(slug: string) {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(getEntityVisitStorageKey(slug));
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function waitForEditorFlush() {
  return new Promise<void>((resolve) => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });
}

type VisitBriefItem = {
  label: string;
  value: string;
  icon: "refresh" | "source" | "delta" | "time";
};

function buildVisitBrief(
  timeline: TimelineReport[],
  previousVisitedAt: number | null,
): {
  title: string;
  summary: string;
  items: VisitBriefItem[];
} {
  const latestReport = timeline[0] ?? null;
  if (!latestReport) {
    return {
      title: "No report history yet",
      summary:
        "The first saved run will turn this into a revisitable briefing.",
      items: [],
    };
  }

  if (!previousVisitedAt) {
    return {
      title: "First visit",
      summary:
        "This page now acts like a living briefing, not a one-off answer.",
      items: [
        { label: "Revisions", value: String(timeline.length), icon: "refresh" },
        {
          label: "Sources",
          value: String(totalSources(timeline)),
          icon: "source",
        },
        {
          label: "Latest",
          value: formatRelative(latestReport.updatedAt),
          icon: "time",
        },
      ],
    };
  }

  const changedReports = timeline.filter(
    (report) => (report.updatedAt ?? report.createdAt) > previousVisitedAt,
  );
  const newSources = new Set<string>();
  let updatedSections = 0;
  for (const report of changedReports) {
    for (const source of report.sources ?? []) {
      newSources.add(source.id || source.label);
    }
    updatedSections += report.diffs?.length ?? 0;
  }

  if (!changedReports.length) {
    return {
      title: "No new changes since your last visit",
      summary: `Last refreshed ${formatRelative(latestReport.updatedAt)}. The briefing is stable for now.`,
      items: [
        { label: "Revisions", value: String(timeline.length), icon: "refresh" },
        {
          label: "Sources",
          value: String(totalSources(timeline)),
          icon: "source",
        },
        {
          label: "Latest",
          value: formatRelative(latestReport.updatedAt),
          icon: "time",
        },
      ],
    };
  }

  return {
    title: `${changedReports.length} update${changedReports.length > 1 ? "s" : ""} since your last visit`,
    summary:
      "Open the latest revision, skim the delta, then decide whether this needs follow-up.",
    items: [
      {
        label: "New revisions",
        value: String(changedReports.length),
        icon: "refresh",
      },
      { label: "New sources", value: String(newSources.size), icon: "source" },
      {
        label: "Updated sections",
        value: String(updatedSections),
        icon: "delta",
      },
      {
        label: "Latest",
        value: formatRelative(latestReport.updatedAt),
        icon: "time",
      },
    ],
  };
}

function visitBriefIcon(icon: VisitBriefItem["icon"]) {
  if (icon === "refresh") return <RefreshCw className="h-3.5 w-3.5" />;
  if (icon === "source") return <Sparkles className="h-3.5 w-3.5" />;
  if (icon === "delta") return <Bookmark className="h-3.5 w-3.5" />;
  return <Clock className="h-3.5 w-3.5" />;
}

// ── Entity Index (no entity selected) ────────────────────────────────────────

const FILTERS = [
  "All",
  "Companies",
  "People",
  "Jobs",
  "Markets",
  "Notes",
  "Recent",
] as const;

function EntityIndex() {
  useProductBootstrap();
  const api = useConvexApi();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const anonymousSessionId = getAnonymousProductSessionId();

  const entities = useQuery(
    api?.domains.product.entities.listEntities ?? ("skip" as any),
    api?.domains.product.entities.listEntities
      ? {
          anonymousSessionId,
          search: search || undefined,
          filter: activeFilter,
        }
      : "skip",
  );

  const starterEntities = useMemo(
    () => [
      {
        _id: "starter-company",
        name: "Your first company",
        entityType: "company",
        summary:
          "Search any company in Chat and the entity page will accumulate every report, note, and source about it.",
        reportCount: 0,
        updatedAt: Date.now(),
        starter: true,
      },
    ],
    [],
  );

  const displayEntities = entities?.length ? entities : starterEntities;
  const totalCount = displayEntities.length;

  return (
    <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6 sm:py-8">
      {/* ── Header ── */}
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Entities
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {totalCount} {totalCount === 1 ? "entity" : "entities"}
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            id="entity-search"
            name="entitySearch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            aria-label="Search entities"
            className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-white/10 dark:bg-white/[0.02] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-white/20"
          />
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <nav
        className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-gray-100 dark:border-white/[0.06]"
        aria-label="Filter entities"
      >
        {FILTERS.map((f) => {
          const isActive = activeFilter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFilter(f)}
              className={`relative whitespace-nowrap px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "text-gray-900 dark:text-gray-100"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
              aria-pressed={isActive}
            >
              {f}
              {isActive && (
                <span className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-gray-900 dark:bg-gray-100" />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── List ── */}
      {displayEntities.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-gray-100 bg-white dark:border-white/[0.06] dark:bg-white/[0.01]">
          {displayEntities.map((entity: any, idx: number) => (
            <button
              key={entity._id}
              type="button"
              onClick={() => {
                if (entity.starter) {
                  navigate(buildCockpitPath({ surfaceId: "workspace" }));
                } else {
                  navigate(
                    buildEntityPath(entity.slug ?? entity.name, undefined),
                  );
                }
              }}
              className={`group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02] ${
                idx < displayEntities.length - 1
                  ? "border-b border-gray-100 dark:border-white/[0.04]"
                  : ""
              }`}
            >
              {/* Icon */}
              <span className="flex-shrink-0 text-gray-500 dark:text-gray-400">
                {entityTypeIcon(entity.entityType)}
              </span>

              {/* Title + summary (inline) */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {entity.name}
                </span>
                <span className="hidden truncate text-sm text-gray-500 dark:text-gray-400 md:block">
                  {entity.summary}
                </span>
              </div>

              {/* Metadata */}
              <div className="flex flex-shrink-0 items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                {entity.reportCount > 0 && (
                  <span className="hidden tabular-nums sm:inline">
                    {entity.reportCount} brief
                    {entity.reportCount === 1 ? "" : "s"}
                  </span>
                )}
                <span className="tabular-nums">
                  {entity.updatedLabel ?? formatRelative(entity.updatedAt)}
                </span>
                <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-100 bg-white py-16 text-center dark:border-white/[0.06] dark:bg-white/[0.01]">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {search ? `No entities matching "${search}"` : "No entities yet."}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Entity Page ─────────────────────────────────────────────────────────

export function EntityPage({ entitySlug }: { entitySlug?: string }) {
  useProductBootstrap();
  const api = useConvexApi();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Resolve slug from: prop > URL path /entity/:slug > query param ?entity=
  const slugFromPath = useMemo(() => {
    const match = location.pathname.match(/^\/entity[/\\](.+)$/i);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  const slug = entitySlug || slugFromPath || searchParams.get("entity") || "";
  const shareToken = searchParams.get("share")?.trim() || undefined;
  const inviteToken = searchParams.get("invite")?.trim() || undefined;

  // If no entity, show the index
  if (!slug) return <EntityIndex />;

  if (!api) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-24 rounded bg-white/[0.06]" />
          <div className="h-8 w-64 rounded bg-white/[0.06]" />
          <div className="h-4 w-48 rounded bg-white/[0.06]" />
          <div className="mt-8 h-32 rounded-lg bg-white/[0.03]" />
          <div className="mt-4 h-48 rounded-lg bg-white/[0.03]" />
        </div>
      </div>
    );
  }

  return (
    <EntityWorkspaceView
      slug={slug}
      shareToken={shareToken}
      inviteToken={inviteToken}
      api={api}
    />
  );
}

function EntityWorkspaceView({
  slug,
  shareToken,
  inviteToken,
  api,
}: {
  slug: string;
  shareToken?: string;
  inviteToken?: string;
  api: NonNullable<ReturnType<typeof useConvexApi>>;
}) {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const anonymousSessionId = getAnonymousProductSessionId();
  const { openWithContext } = useFastAgent();
  // Register this entity slug with FastAgentContext so the "Ask NodeBench"
  // side panel always knows which notebook to target — even when the panel
  // is closed. Cleared on unmount.
  useActiveEntity(slug);
  // Read-mode toggle — strips edit chrome via data-view-mode="read" CSS.
  const { isReadMode } = useViewMode();
  const toast = useToast();
  const generateUploadUrl = useMutation(
    api?.domains.product.me.generateUploadUrl ?? ("skip" as any),
  );
  const saveFileMutation = useMutation(
    api?.domains.product.me.saveFile ?? ("skip" as any),
  );
  const attachEvidence = useMutation(
    api?.domains.product.entities.attachEvidenceToEntity ?? ("skip" as any),
  );
  const loggedInUser = useQuery(api?.domains.auth.auth.loggedInUser ?? "skip");

  // Entity tracking — framework audit #5 (Report → Nudge transition).
  // Queries the current subscription state; mutations toggle it. All three
  // gracefully no-op while Convex codegen is behind (the `?? "skip"` guard).
  const subscriptionState = useQuery(
    api?.domains.product.notebookTracking?.isSubscribedToEntity ?? "skip",
    api?.domains.product.notebookTracking?.isSubscribedToEntity
      ? { anonymousSessionId, entitySlug: slug }
      : "skip",
  );
  const subscribeToEntityMut = useMutation(
    api?.domains.product.notebookTracking?.subscribeToEntity ?? ("skip" as any),
  );
  const unsubscribeFromEntityMut = useMutation(
    api?.domains.product.notebookTracking?.unsubscribeFromEntity ??
      ("skip" as any),
  );
  const isTracked = subscriptionState?.subscribed ?? false;
  const [trackPending, setTrackPending] = useState(false);
  const handleToggleTrack = useCallback(async () => {
    if (trackPending || !api?.domains.product.notebookTracking) return;
    setTrackPending(true);
    try {
      if (isTracked) {
        await unsubscribeFromEntityMut({
          anonymousSessionId,
          entitySlug: slug,
        });
      } else {
        await subscribeToEntityMut({ anonymousSessionId, entitySlug: slug });
      }
    } catch (err) {
      // Fail-open; the next useQuery tick will reconcile the button state.
      console.warn("[entity] track toggle failed:", err);
    } finally {
      setTrackPending(false);
    }
  }, [
    api?.domains.product.notebookTracking,
    anonymousSessionId,
    isTracked,
    slug,
    subscribeToEntityMut,
    trackPending,
    unsubscribeFromEntityMut,
  ]);

  const liveWorkspace = useQuery(
    api?.domains.product.entities.getEntityWorkspace ?? ("skip" as any),
    api?.domains.product.entities.getEntityWorkspace
      ? { anonymousSessionId, shareToken, entitySlug: slug }
      : "skip",
  ) as EntityWorkspace | null | undefined;
  const systemWorkspace = useQuery(
    api?.domains?.product?.systemIntelligence?.getSystemEntityWorkspace ??
      ("skip" as any),
    !shareToken &&
      api?.domains?.product?.systemIntelligence?.getSystemEntityWorkspace
      ? { entitySlug: slug }
      : "skip",
  ) as EntityWorkspace | null | undefined;
  const blockSummary = useQuery(
    api?.domains.product.blocks.getEntityBlockSummary ?? ("skip" as any),
    api?.domains.product.blocks.getEntityBlockSummary
      ? { anonymousSessionId, shareToken, entitySlug: slug }
      : "skip",
  ) as EntityBlockSummary | null | undefined;

  const saveNoteDocument = useMutation(
    api?.domains.product.documents.saveEntityNoteDocument ?? ("skip" as any),
  );
  const ensureLiveEntityWorkspace = useMutation(
    api?.domains.product.entities.ensureEntity ?? ("skip" as any),
  );
  const ensureEntityWorkspaceShare = useMutation(
    api?.domains.product.shares.ensureEntityWorkspaceShare ?? ("skip" as any),
  );
  const inviteEntityWorkspaceCollaborator = useAction(
    api?.domains.product.shares.inviteEntityWorkspaceCollaborator ??
      ("skip" as any),
  );
  const acceptEntityWorkspaceInvite = useMutation(
    api?.domains.product.shares.acceptEntityWorkspaceInvite ?? ("skip" as any),
  );
  const updateEntityWorkspaceMemberAccess = useMutation(
    api?.domains.product.shares.updateEntityWorkspaceMemberAccess ??
      ("skip" as any),
  );
  const updateEntityWorkspaceInviteAccess = useMutation(
    api?.domains.product.shares.updateEntityWorkspaceInviteAccess ??
      ("skip" as any),
  );
  const revokeEntityWorkspaceMember = useMutation(
    api?.domains.product.shares.revokeEntityWorkspaceMember ?? ("skip" as any),
  );
  const revokeEntityWorkspaceInvite = useMutation(
    api?.domains.product.shares.revokeEntityWorkspaceInvite ?? ("skip" as any),
  );
  const revokeEntityWorkspaceShare = useMutation(
    api?.domains.product.shares.revokeEntityWorkspaceShare ?? ("skip" as any),
  );
  const invitePreview = useQuery(
    api?.domains.product.shares.previewEntityWorkspaceInvite ?? "skip",
    inviteToken && api?.domains.product.shares.previewEntityWorkspaceInvite
      ? { inviteToken, entitySlug: slug }
      : "skip",
  ) as WorkspaceInvitePreview | undefined;
  const accessTokenPreview = useQuery(
    api?.domains.product.shares.previewEntityWorkspaceAccessToken ?? "skip",
    shareToken && api?.domains.product.shares.previewEntityWorkspaceAccessToken
      ? { shareToken, entitySlug: slug }
      : "skip",
  ) as WorkspaceAccessPreview | undefined;
  const requestRefresh = useMutation(
    api?.domains.product.reports.requestRefresh ?? ("skip" as any),
  );
  const updateSavedBecause = useMutation(
    api?.domains.product.entities.updateEntitySavedBecause ?? ("skip" as any),
  );
  const ensureNoteDocumentBackfill = useMutation(
    api?.domains.product.documents.ensureEntityNoteDocumentBackfill ??
      ("skip" as any),
  );
  const attachableEvidence = useQuery(
    api?.domains.product.entities.listAttachableEvidence ?? ("skip" as any),
    !shareToken && api?.domains.product.entities.listAttachableEvidence
      ? { anonymousSessionId, entitySlug: slug }
      : "skip",
  );

  const [noteDocumentDraft, setNoteDocumentDraft] =
    useState<EntityNoteDocument>(createEmptyEntityNoteDocument());
  const noteDocumentDraftRef = useRef(noteDocumentDraft);
  const noteEditorRef = useRef<EntityNoteEditorHandle | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [copyState, setCopyState] = useState<
    "link" | "brief" | "markdown" | "outreach" | "crm" | null
  >(null);
  const [showActions, setShowActions] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [shareBusyAccess, setShareBusyAccess] = useState<
    "view" | "edit" | null
  >(null);
  const [shareCopyState, setShareCopyState] = useState<"view" | "edit" | null>(
    null,
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAccess, setInviteAccess] = useState<"view" | "edit">("view");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [collaboratorCopyKey, setCollaboratorCopyKey] = useState<string | null>(
    null,
  );
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [savedBecauseDraft, setSavedBecauseDraft] = useState("");
  const [savingSavedBecause, setSavingSavedBecause] = useState(false);
  const [materializingLiveWorkspace, setMaterializingLiveWorkspace] =
    useState(false);
  const [pendingLiveWorkspaceOpen, setPendingLiveWorkspaceOpen] =
    useState(false);
  const [autoMaterializeAttempted, setAutoMaterializeAttempted] =
    useState(false);
  const [refreshingReport, setRefreshingReport] = useState(false);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [attachingEvidenceId, setAttachingEvidenceId] = useState<string | null>(
    null,
  );
  const [workspaceRailView, setWorkspaceRailView] = useState<
    "evidence" | "context"
  >("evidence");
  const [showContextGraph, setShowContextGraph] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [entityViewMode, setEntityViewMode] = useState<
    "classic" | "notebook" | "live"
  >(() => readInitialEntityViewMode(slug));
  const savedBecauseInputId = useId();

  const starterWorkspace = useMemo<EntityWorkspace | null>(() => {
    if (shareToken) return null;
    const starter = getStarterEntityWorkspace(slug);
    if (!starter) return null;
    const starterSources = starter.evidence.map((item, index) => ({
      id: `starter-source-${starter.entity.slug}-${index}`,
      label: item.label,
      href: item.sourceUrl,
      type: item.type,
      domain: undefined,
    }));
    return {
      entity: {
        _id: undefined,
        ...starter.entity,
      },
      note: {
        _id: `starter-note-${starter.entity.slug}`,
        content: starter.note.content,
        blocks: undefined,
        createdAt: starter.entity.createdAt,
        updatedAt: starter.entity.updatedAt,
      },
      noteDocument: null,
      latest: starter.latest
        ? {
            _id: `starter-latest-${starter.entity.slug}`,
            ...starter.latest,
            type: starter.entity.entityType,
            createdAt: starter.latest.updatedAt,
            updatedAt: starter.latest.updatedAt,
            sources: starterSources,
          }
        : null,
      timeline: starter.timeline.map((item, index) => ({
        _id: `starter-${starter.entity.slug}-${index}`,
        ...item,
        type: starter.entity.entityType,
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
        sources: starterSources,
      })),
      evidence: starter.evidence.map((item, index) => ({
        _id: `starter-evidence-${starter.entity.slug}-${index}`,
        ...item,
        entityId: undefined,
      })),
      relatedEntities: starter.relatedEntities,
      viewerAccess: null,
      shareLinks: null,
    } as unknown as EntityWorkspace;
  }, [shareToken, slug]);

  const workspace = inviteToken
    ? (liveWorkspace ?? null)
    : shareToken
      ? (liveWorkspace ?? null)
      : (liveWorkspace ?? systemWorkspace ?? starterWorkspace);
  const liveWorkspaceResolved = liveWorkspace !== undefined;
  const hasLiveEntity = Boolean(liveWorkspace?.entity?._id);
  // Hoisted above the entity-view-mode effects so they can gate on the
  // feature flag without hitting a TDZ reference error.
  const liveNotebookEnabled = isLiveNotebookEnabled(workspace?.entity?.slug);
  const notebookDrift = useMemo(
    () => getNotebookDriftSummary(blockSummary, liveWorkspace?.latest ?? null),
    [blockSummary, liveWorkspace?.latest],
  );
  const collaborationParticipants = useMemo(() => {
    const members = workspace?.collaborators?.members ?? [];
    const ownerProfile = workspace?.ownerProfile ?? null;
    const participants = [
      ownerProfile
        ? {
            ownerKey: ownerProfile.ownerKey,
            label:
              ownerProfile.name?.trim() ||
              ownerProfile.email?.trim() ||
              "Workspace owner",
            email: ownerProfile.email,
          }
        : null,
      ...members.map((member) => ({
        ownerKey: `user:${member.userId}`,
        label: member.name?.trim() || member.email,
        email: member.email,
      })),
    ].filter(Boolean) as Array<{
      ownerKey: string;
      label: string;
      email?: string;
    }>;
    return participants;
  }, [workspace?.collaborators?.members, workspace?.ownerProfile]);
  const latestCollaborationStatus = useMemo(() => {
    if (!blockSummary?.latestHumanEditorUpdatedAt) return null;
    const label = getCollaborationParticipantLabel({
      ownerProfile: workspace?.ownerProfile,
      members: workspace?.collaborators?.members,
      ownerKey: blockSummary.latestHumanEditorOwnerKey,
    });
    if (!label) return null;
    return `Last edited by ${label} ${formatRelative(blockSummary.latestHumanEditorUpdatedAt)}`;
  }, [
    blockSummary?.latestHumanEditorOwnerKey,
    blockSummary?.latestHumanEditorUpdatedAt,
    workspace?.collaborators?.members,
    workspace?.ownerProfile,
  ]);

  useEffect(() => {
    if (invitePreview?.email) {
      setInviteEmail((current) => current || invitePreview.email);
    }
  }, [invitePreview?.email]);

  useEffect(() => {
    if (!isReadMode) return;
    setShowActions(false);
    setShowShareSheet(false);
  }, [isReadMode]);

  useEffect(() => {
    setAutoMaterializeAttempted(false);
  }, [slug]);

  useEffect(() => {
    setEntityViewMode(readInitialEntityViewMode(slug));
  }, [slug]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      `${ENTITY_VIEW_MODE_STORAGE_PREFIX}${slug}`,
      entityViewMode,
    );
  }, [entityViewMode, slug]);

  useEffect(() => {
    if (!liveWorkspaceResolved) return;
    if (!hasLiveEntity && entityViewMode === "live") {
      setEntityViewMode("notebook");
    }
  }, [entityViewMode, hasLiveEntity, liveWorkspaceResolved]);

  useEffect(() => {
    if (!pendingLiveWorkspaceOpen || !hasLiveEntity) return;
    setEntityViewMode("live");
    setPendingLiveWorkspaceOpen(false);
  }, [hasLiveEntity, pendingLiveWorkspaceOpen]);

  useEffect(() => {
    if (!liveWorkspaceResolved) return;
    if (liveNotebookEnabled && hasLiveEntity) {
      if (entityViewMode !== "live") setEntityViewMode("live");
      return;
    }
    if (entityViewMode === "classic") {
      setEntityViewMode("notebook");
    }
  }, [
    entityViewMode,
    hasLiveEntity,
    liveNotebookEnabled,
    liveWorkspaceResolved,
  ]);

  useEffect(() => {
    if (!workspace) return;
    const nextDraft = buildEntityNoteDocumentDraft(
      workspace.entity.name,
      workspace.noteDocument ?? null,
      workspace.note,
    );
    noteDocumentDraftRef.current = nextDraft;
    setNoteDocumentDraft(nextDraft);
    setSavedBecauseDraft(
      workspace.entity.savedBecause?.trim() ||
        getSavedBecausePlaceholder(workspace.entity.entityType),
    );
  }, [workspace]);

  const handleNoteDocumentDraftChange = useCallback(
    (nextDraft: EntityNoteDocument) => {
      noteDocumentDraftRef.current = nextDraft;
      setNoteDocumentDraft(nextDraft);
    },
    [],
  );

  useEffect(() => {
    if (
      !liveWorkspace?.entity?._id ||
      liveWorkspace.noteDocument ||
      !ensureNoteDocumentBackfill ||
      liveWorkspace.viewerAccess?.canEditNotes === false
    ) {
      return;
    }
    void ensureNoteDocumentBackfill({
      anonymousSessionId,
      shareToken,
      entityId: liveWorkspace.entity._id as any,
    }).catch((error: unknown) => {
      console.error("[entity] Failed to ensure notebook backfill:", error);
    });
  }, [
    anonymousSessionId,
    ensureNoteDocumentBackfill,
    liveWorkspace,
    shareToken,
  ]);

  const materializeLiveWorkspace = useCallback(
    async ({
      notifyOnError = true,
      errorTitle = "Failed to open Live notebook",
    }: {
      notifyOnError?: boolean;
      errorTitle?: string;
    } = {}) => {
      if (hasLiveEntity) {
        setEntityViewMode("live");
        return;
      }
      if (
        !workspace?.entity?.slug ||
        shareToken ||
        inviteToken ||
        !ensureLiveEntityWorkspace
      ) {
        return;
      }

      setMaterializingLiveWorkspace(true);
      setPendingLiveWorkspaceOpen(true);
      try {
        await ensureLiveEntityWorkspace({
          anonymousSessionId,
          slug: workspace.entity.slug,
          name: workspace.entity.name,
          entityType: workspace.entity.entityType,
          summary: workspace.entity.summary,
          savedBecause: workspace.entity.savedBecause,
        });
      } catch (error) {
        setPendingLiveWorkspaceOpen(false);
        if (notifyOnError) {
          toast.error(
            errorTitle,
            error instanceof Error
              ? error.message
              : String(error ?? "Unknown error"),
          );
        }
      } finally {
        setMaterializingLiveWorkspace(false);
      }
    },
    [
      anonymousSessionId,
      ensureLiveEntityWorkspace,
      hasLiveEntity,
      inviteToken,
      shareToken,
      toast,
      workspace,
    ],
  );

  const handleSelectLiveView = useCallback(async () => {
    if (hasLiveEntity) {
      setEntityViewMode("live");
      return;
    }
    await materializeLiveWorkspace();
  }, [hasLiveEntity, materializeLiveWorkspace]);

  useEffect(() => {
    if (autoMaterializeAttempted) return;
    if (!liveWorkspaceResolved) return;
    if (hasLiveEntity) return;
    if (!liveNotebookEnabled) return;
    if (shareToken || inviteToken) return;
    if (!workspace?.entity?.slug || !ensureLiveEntityWorkspace) return;

    setAutoMaterializeAttempted(true);
    void materializeLiveWorkspace({
      errorTitle: "Failed to prepare notebook",
    });
  }, [
    autoMaterializeAttempted,
    ensureLiveEntityWorkspace,
    hasLiveEntity,
    inviteToken,
    liveNotebookEnabled,
    liveWorkspaceResolved,
    materializeLiveWorkspace,
    shareToken,
    workspace,
  ]);

  const handleOpenReferenceNotebookToggle = useCallback(() => {
    setEntityViewMode("notebook");
  }, []);
  const handleSelectClassicView = useCallback(() => {
    setEntityViewMode("classic");
  }, []);
  const handleSelectNotebookView = useCallback(() => {
    setEntityViewMode("notebook");
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (
      !saveNoteDocument ||
      !liveWorkspace?.entity?._id ||
      liveWorkspace.viewerAccess?.canEditNotes === false
    ) {
      return;
    }
    setNoteSaving(true);
    try {
      await waitForEditorFlush();
      const latestDraft =
        noteEditorRef.current?.getCurrentDocument() ??
        noteDocumentDraftRef.current;
      await saveNoteDocument({
        anonymousSessionId,
        shareToken,
        entityId: liveWorkspace.entity._id as any,
        title: latestDraft.title,
        markdown: latestDraft.markdown,
        plainText: latestDraft.plainText,
        lexicalState: latestDraft.lexicalState,
        blocks: latestDraft.blocks,
      });
    } catch (err) {
      console.error("[entity] Failed to save note:", err);
    } finally {
      setNoteSaving(false);
    }
  }, [
    anonymousSessionId,
    liveWorkspace?.entity?._id,
    saveNoteDocument,
    shareToken,
  ]);

  const copyPayload = useCallback(
    async (kind: "link" | "brief" | "markdown" | "outreach" | "crm") => {
      if (!workspace) return;
      const exportShareToken =
        shareToken ?? workspace.shareLinks?.view?.token ?? undefined;
      const exportWorkspace = workspace as unknown as Parameters<
        typeof buildEntityExecutiveBrief
      >[0];
      const payload =
        kind === "link"
          ? buildEntityShareUrl(workspace.entity.slug, exportShareToken)
          : kind === "brief"
            ? buildEntityExecutiveBrief(exportWorkspace, undefined, exportShareToken)
            : kind === "markdown"
              ? buildEntityMarkdown(exportWorkspace, undefined, exportShareToken)
              : kind === "outreach"
                ? buildOutreachDraft(exportWorkspace, undefined, exportShareToken)
                : buildCrmSummary(exportWorkspace, undefined, exportShareToken);
      await navigator.clipboard.writeText(payload);
      setCopyState(kind);
      window.setTimeout(() => setCopyState(null), 1500);
    },
    [shareToken, workspace],
  );

  const handleShareCopy = useCallback(
    async (access: "view" | "edit") => {
      if (!workspace?.entity?.slug || !ensureEntityWorkspaceShare) return;
      setShareBusyAccess(access);
      try {
        const existingToken = workspace.shareLinks?.[access]?.token;
        const token =
          existingToken ||
          (
            (await ensureEntityWorkspaceShare({
              anonymousSessionId,
              entitySlug: workspace.entity.slug,
              access,
            })) as { token?: string | null }
          )?.token;
        if (!token) {
          throw new Error("Share link could not be created.");
        }
        await navigator.clipboard.writeText(
          buildEntityShareUrl(workspace.entity.slug, token),
        );
        setShareCopyState(access);
        window.setTimeout(() => setShareCopyState(null), 1500);
      } catch (error) {
        console.error("[entity] Failed to copy share link:", error);
      } finally {
        setShareBusyAccess(null);
      }
    },
    [anonymousSessionId, ensureEntityWorkspaceShare, workspace],
  );

  const handleRevokeShare = useCallback(
    async (access: "view" | "edit") => {
      if (!workspace?.entity?.slug || !revokeEntityWorkspaceShare) return;
      setShareBusyAccess(access);
      try {
        await revokeEntityWorkspaceShare({
          anonymousSessionId,
          entitySlug: workspace.entity.slug,
          access,
        });
      } catch (error) {
        console.error("[entity] Failed to revoke share link:", error);
      } finally {
        setShareBusyAccess(null);
      }
    },
    [anonymousSessionId, revokeEntityWorkspaceShare, workspace],
  );

  const handleInviteCollaborator = useCallback(async () => {
    if (!workspace?.entity?.slug || !inviteEntityWorkspaceCollaborator) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    try {
      const result = (await inviteEntityWorkspaceCollaborator({
        anonymousSessionId,
        entitySlug: workspace.entity.slug,
        email,
        access: inviteAccess,
      })) as {
        kind: "member" | "invite";
        token: string;
        delivery?: {
          status: "sent" | "link_only";
          copiedFallbackLink: boolean;
          error?: string;
        };
      };
      const nextUrl =
        result.kind === "invite"
          ? buildEntityInviteUrl(workspace.entity.slug, result.token)
          : buildEntityShareUrl(workspace.entity.slug, result.token);
      const deliveryStatus = result.delivery?.status ?? "link_only";
      if (deliveryStatus !== "sent") {
        await navigator.clipboard.writeText(nextUrl);
        setCollaboratorCopyKey(`${result.kind}:${email.toLowerCase()}`);
        toast.warning(
          "Invite link copied",
          "Email delivery was unavailable for this address, so the secure link is on your clipboard.",
        );
      } else {
        toast.success(
          "Invite sent",
          `NodeBench emailed ${email} with ${inviteAccess === "edit" ? "edit" : "view"} access.`,
        );
      }
      setInviteEmail("");
      window.setTimeout(() => setCollaboratorCopyKey(null), 1500);
    } catch (error) {
      console.error("[entity] Failed to invite collaborator:", error);
      toast.error(
        "Failed to invite collaborator",
        error instanceof Error
          ? error.message
          : "The workspace invite could not be created.",
      );
    } finally {
      setInviteBusy(false);
    }
  }, [
    anonymousSessionId,
    inviteAccess,
    inviteEmail,
    inviteEntityWorkspaceCollaborator,
    toast,
    workspace?.entity?.slug,
  ]);

  const handleCopyMemberLink = useCallback(
    async (userId: string) => {
      const member = workspace?.collaborators?.members.find(
        (item) => item.userId === userId,
      );
      if (!workspace?.entity?.slug || !member) return;
      await navigator.clipboard.writeText(
        buildEntityShareUrl(workspace.entity.slug, member.token),
      );
      setCollaboratorCopyKey(`member:${userId}`);
      window.setTimeout(() => setCollaboratorCopyKey(null), 1500);
    },
    [workspace],
  );

  const handleCopyInviteLink = useCallback(
    async (inviteId: string) => {
      const invite = workspace?.collaborators?.invites.find(
        (item) => item._id === inviteId,
      );
      if (!workspace?.entity?.slug || !invite) return;
      await navigator.clipboard.writeText(
        buildEntityInviteUrl(workspace.entity.slug, invite.token),
      );
      setCollaboratorCopyKey(`invite:${inviteId}`);
      window.setTimeout(() => setCollaboratorCopyKey(null), 1500);
    },
    [workspace],
  );

  const handleUpdateMemberPermission = useCallback(
    async (userId: string, access: "view" | "edit") => {
      if (!workspace?.entity?.slug || !updateEntityWorkspaceMemberAccess)
        return;
      try {
        await updateEntityWorkspaceMemberAccess({
          anonymousSessionId,
          entitySlug: workspace.entity.slug,
          userId: userId as any,
          access,
        });
      } catch (error) {
        console.error("[entity] Failed to update member access:", error);
      }
    },
    [
      anonymousSessionId,
      updateEntityWorkspaceMemberAccess,
      workspace?.entity?.slug,
    ],
  );

  const handleUpdateInvitePermission = useCallback(
    async (inviteId: string, access: "view" | "edit") => {
      if (!workspace?.entity?.slug || !updateEntityWorkspaceInviteAccess)
        return;
      try {
        await updateEntityWorkspaceInviteAccess({
          anonymousSessionId,
          entitySlug: workspace.entity.slug,
          inviteId: inviteId as any,
          access,
        });
      } catch (error) {
        console.error("[entity] Failed to update invite access:", error);
      }
    },
    [
      anonymousSessionId,
      updateEntityWorkspaceInviteAccess,
      workspace?.entity?.slug,
    ],
  );

  const handleRevokeMember = useCallback(
    async (userId: string) => {
      if (!workspace?.entity?.slug || !revokeEntityWorkspaceMember) return;
      try {
        await revokeEntityWorkspaceMember({
          anonymousSessionId,
          entitySlug: workspace.entity.slug,
          userId: userId as any,
        });
      } catch (error) {
        console.error("[entity] Failed to remove collaborator:", error);
      }
    },
    [anonymousSessionId, revokeEntityWorkspaceMember, workspace?.entity?.slug],
  );

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      if (!workspace?.entity?.slug || !revokeEntityWorkspaceInvite) return;
      try {
        await revokeEntityWorkspaceInvite({
          anonymousSessionId,
          entitySlug: workspace.entity.slug,
          inviteId: inviteId as any,
        });
      } catch (error) {
        console.error("[entity] Failed to revoke invite:", error);
      }
    },
    [anonymousSessionId, revokeEntityWorkspaceInvite, workspace?.entity?.slug],
  );

  const handleAcceptInvite = useCallback(async () => {
    if (!inviteToken || !acceptEntityWorkspaceInvite) return;
    setAcceptingInvite(true);
    try {
      const result = (await acceptEntityWorkspaceInvite({
        anonymousSessionId,
        inviteToken,
        entitySlug: slug,
      })) as { shareToken: string; entitySlug: string };
      navigate(buildEntityPath(result.entitySlug, result.shareToken), {
        replace: true,
      });
    } catch (error) {
      console.error("[entity] Failed to accept invite:", error);
    } finally {
      setAcceptingInvite(false);
    }
  }, [
    acceptEntityWorkspaceInvite,
    anonymousSessionId,
    inviteToken,
    navigate,
    slug,
  ]);

  const handleAttachFile = useCallback(
    async (file: File) => {
      if (!workspace || !liveWorkspace?.entity?._id || !api) return;
      setUploadingEvidence(true);
      try {
        const uploadUrl = await generateUploadUrl();
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const { storageId } = await uploadResponse.json();
        await saveFileMutation({
          anonymousSessionId,
          storageId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          entitySlug: workspace.entity.slug,
        });
      } finally {
        setUploadingEvidence(false);
      }
    },
    [
      anonymousSessionId,
      api,
      generateUploadUrl,
      liveWorkspace?.entity?._id,
      saveFileMutation,
      workspace,
    ],
  );

  const handleSaveSavedBecause = useCallback(async () => {
    if (!liveWorkspace?.entity?._id || !updateSavedBecause) return;
    const nextValue = savedBecauseDraft.trim();
    if (!nextValue) return;
    setSavingSavedBecause(true);
    try {
      await updateSavedBecause({
        anonymousSessionId,
        entityId: liveWorkspace.entity._id as any,
        savedBecause: nextValue,
      });
    } catch (error) {
      console.error("[entity] Failed to save savedBecause:", error);
    } finally {
      setSavingSavedBecause(false);
    }
  }, [
    anonymousSessionId,
    liveWorkspace?.entity?._id,
    savedBecauseDraft,
    updateSavedBecause,
  ]);

  const handleRefreshLatestReport = useCallback(async () => {
    const latestReport = liveWorkspace?.latest;
    if (!latestReport?._id || !requestRefresh || !liveWorkspace) return;
    setRefreshingReport(true);
    try {
      const result = await requestRefresh({
        anonymousSessionId,
        reportId: latestReport._id as any,
        triggeredBy: "user",
      });
      navigate(
        buildEntityRefreshChatPath(
          result as ReportRefreshResult,
          latestReport,
          liveWorkspace.entity,
        ),
      );
    } catch (error) {
      console.error("[entity] Failed to queue report refresh:", error);
    } finally {
      setRefreshingReport(false);
    }
  }, [
    anonymousSessionId,
    liveWorkspace?.entity,
    liveWorkspace?.latest,
    navigate,
    requestRefresh,
  ]);

  const sourceCount = useMemo(
    () => totalSources(workspace?.timeline ?? []),
    [workspace?.timeline],
  );
  const allSources = useMemo(
    () => collectAllSources(workspace?.timeline ?? []),
    [workspace?.timeline],
  );

  const latestBriefReport = useMemo(
    () => workspace?.latest ?? workspace?.timeline?.[0] ?? null,
    [workspace?.latest, workspace?.timeline],
  );
  const latestBriefSections = useMemo(
    () =>
      orderReportSections(
        (latestBriefReport?.sections ?? []).filter(
          (section) => section.body.trim().length > 0,
        ),
      ),
    [latestBriefReport],
  );
  const latestBriefSources = latestBriefReport?.sources ?? [];
  const evidenceSections = useMemo(
    () =>
      latestBriefSections.filter(
        (section) => getSectionSources(section, latestBriefSources).length > 0,
      ),
    [latestBriefSections, latestBriefSources],
  );
  const previousVisitedAt = useMemo(
    () => readPreviousEntityVisit(slug),
    [slug],
  );
  const visitBrief = useMemo(
    () => buildVisitBrief(workspace?.timeline ?? [], previousVisitedAt),
    [previousVisitedAt, workspace?.timeline],
  );
  const [selectedEvidenceSectionId, setSelectedEvidenceSectionId] = useState<
    string | null
  >(null);
  const [selectedEvidenceSourceKey, setSelectedEvidenceSourceKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      getEntityVisitStorageKey(slug),
      String(Date.now()),
    );
  }, [slug, workspace?.entity?.updatedAt]);

  useEffect(() => {
    const nextSection =
      evidenceSections.find(
        (section) => section.id === selectedEvidenceSectionId,
      ) ??
      evidenceSections[0] ??
      null;
    const nextSources = nextSection
      ? getSectionSources(nextSection, latestBriefSources)
      : [];
    const nextSource =
      nextSources.find(
        (source) => getSourceKey(source) === selectedEvidenceSourceKey,
      ) ??
      nextSources[0] ??
      null;
    const nextSectionId = nextSection?.id ?? null;
    const nextSourceKey = nextSource ? getSourceKey(nextSource) : null;

    if (nextSectionId !== selectedEvidenceSectionId) {
      setSelectedEvidenceSectionId(nextSectionId);
    }
    if (nextSourceKey !== selectedEvidenceSourceKey) {
      setSelectedEvidenceSourceKey(nextSourceKey);
    }
  }, [
    evidenceSections,
    latestBriefSources,
    selectedEvidenceSectionId,
    selectedEvidenceSourceKey,
  ]);

  // Hoisted above the loading/invite/share/not-found early returns so the
  // hook count stays stable across render passes. Rules of Hooks: every
  // hook that appears after a conditional `return` will crash the
  // component the first time workspace resolves from undefined.
  const openEntityWorkspaceDrawer = useCallback(
    (initialTab: "chat" | "scratchpad" | "flow" = "chat") => {
      openWithContext({
        initialTab,
        contextEntitySlug: workspace?.entity?.slug ?? slug,
        contextTitle: workspace?.entity?.name ?? slug,
      });
    },
    [openWithContext, slug, workspace?.entity?.name, workspace?.entity?.slug],
  );

  // Dedupe related entities by slug and drop any self-reference. The backend
  // list occasionally includes the current entity or repeats a peer (multiple
  // relation edges → same slug), producing duplicate React keys across three
  // render sites below (console: "Encountered two children with the same key,
  // `<slug>`"). Duplicate keys force React to bail out of keyed reconciliation
  // for the whole list — expensive on every parent render. Kept above the
  // loading-state early-return so hook order is stable across renders.
  const uniqueRelatedEntities = useMemo(() => {
    const list = workspace?.relatedEntities ?? [];
    if (list.length === 0) return list;
    const seen = new Set<string>();
    const out: typeof list = [];
    for (const r of list) {
      if (!r?.slug) continue;
      if (r.slug === slug) continue;
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      out.push(r);
    }
    return out;
  }, [workspace?.relatedEntities, slug]);

  // Loading state
  if (
    liveWorkspace === undefined &&
    systemWorkspace === undefined &&
    !starterWorkspace
  ) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-24 rounded bg-white/[0.06]" />
          <div className="h-8 w-64 rounded bg-white/[0.06]" />
          <div className="h-4 w-48 rounded bg-white/[0.06]" />
          <div className="mt-8 h-32 rounded-lg bg-white/[0.03]" />
          <div className="mt-4 h-48 rounded-lg bg-white/[0.03]" />
        </div>
      </div>
    );
  }

  const currentUserEmail = normalizeWorkspaceEmail(
    typeof loggedInUser?.email === "string" ? loggedInUser.email : null,
  );
  const inviteTargetEmail = normalizeWorkspaceEmail(invitePreview?.email);
  const memberTargetEmail = normalizeWorkspaceEmail(accessTokenPreview?.email);

  if (inviteToken) {
    if (
      invitePreview === undefined ||
      authLoading ||
      (isAuthenticated && loggedInUser === undefined)
    ) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-4 w-24 rounded bg-white/[0.06]" />
            <div className="h-8 w-64 rounded bg-white/[0.06]" />
            <div className="h-24 rounded-lg bg-white/[0.03]" />
          </div>
        </div>
      );
    }

    if (!invitePreview) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <button
            type="button"
            onClick={() => navigate("/entity")}
            className="mb-6 flex items-center gap-1.5 text-sm text-content-muted transition hover:text-content"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All entities
          </button>
          <div className="rounded-3xl border border-white/6 bg-white/[0.02] px-6 py-12 text-center">
            <Users className="mx-auto h-8 w-8 text-content-muted/40" />
            <p className="mt-3 text-sm text-content-muted">
              This invite is unavailable.
            </p>
            <p className="mt-1 text-xs text-content-muted/60">
              It may have been accepted, revoked, or expired.
            </p>
          </div>
        </div>
      );
    }

    if (!currentUserEmail) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-3xl border border-white/6 bg-white/[0.02] px-6 py-8">
            <div className="text-sm font-semibold text-content">
              Join {invitePreview.entityName}
            </div>
            <p className="mt-2 text-sm text-content-muted">
              Sign in with{" "}
              <span className="font-medium text-content">
                {invitePreview.email}
              </span>{" "}
              to {invitePreview.access === "edit" ? "edit" : "view"} this
              workspace.
            </p>
            <div className="mt-5">
              <SignInForm
                initialEmail={invitePreview.email}
                allowAnonymous={false}
              />
            </div>
          </div>
        </div>
      );
    }

    if (currentUserEmail !== inviteTargetEmail) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-3xl border border-white/6 bg-white/[0.02] px-6 py-8">
            <div className="text-sm font-semibold text-content">
              Wrong account
            </div>
            <p className="mt-2 text-sm text-content-muted">
              This invite was sent to{" "}
              <span className="font-medium text-content">
                {invitePreview.email}
              </span>
              , but you are signed in as{" "}
              <span className="font-medium text-content">
                {loggedInUser?.email}
              </span>
              .
            </p>
            <div className="mt-4">
              <SignOutButton />
            </div>
          </div>
        </div>
      );
    }

    if (!workspace) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-3xl border border-white/6 bg-white/[0.02] px-6 py-8">
            <div className="text-sm font-semibold text-content">
              Join workspace
            </div>
            <p className="mt-2 text-sm text-content-muted">
              You have been invited to{" "}
              {invitePreview.access === "edit" ? "edit" : "view"}{" "}
              {invitePreview.entityName}.
            </p>
            <button
              type="button"
              onClick={() => void handleAcceptInvite()}
              disabled={acceptingInvite}
              className="nb-primary-button mt-5 rounded-full px-4 py-2 text-sm"
            >
              {acceptingInvite ? "Joining..." : "Join workspace"}
            </button>
          </div>
        </div>
      );
    }
  }

  if (shareToken && !workspace && accessTokenPreview?.kind === "member") {
    if (authLoading || (isAuthenticated && loggedInUser === undefined)) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-4 w-24 rounded bg-white/[0.06]" />
            <div className="h-8 w-64 rounded bg-white/[0.06]" />
            <div className="h-24 rounded-lg bg-white/[0.03]" />
          </div>
        </div>
      );
    }

    if (!currentUserEmail) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-3xl border border-white/6 bg-white/[0.02] px-6 py-8">
            <div className="text-sm font-semibold text-content">
              Sign in to open {accessTokenPreview.entityName}
            </div>
            <p className="mt-2 text-sm text-content-muted">
              This workspace is shared with a named account. Sign in with{" "}
              <span className="font-medium text-content">
                {accessTokenPreview.email}
              </span>{" "}
              to continue.
            </p>
            <div className="mt-5">
              <SignInForm
                initialEmail={accessTokenPreview.email}
                allowAnonymous={false}
              />
            </div>
          </div>
        </div>
      );
    }

    if (memberTargetEmail && currentUserEmail !== memberTargetEmail) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-3xl border border-white/6 bg-white/[0.02] px-6 py-8">
            <div className="text-sm font-semibold text-content">
              Wrong account
            </div>
            <p className="mt-2 text-sm text-content-muted">
              This workspace is for{" "}
              <span className="font-medium text-content">
                {accessTokenPreview.email}
              </span>
              , but you are signed in as{" "}
              <span className="font-medium text-content">
                {loggedInUser?.email}
              </span>
              .
            </p>
            <div className="mt-4">
              <SignOutButton />
            </div>
          </div>
        </div>
      );
    }
  }

  // Entity not found
  if (!workspace) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <button
          type="button"
          onClick={() => navigate("/entity")}
          className="mb-6 flex items-center gap-1.5 text-sm text-content-muted hover:text-content transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All entities
        </button>
        <div className="rounded-lg border border-white/6 bg-white/[0.02] px-6 py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-content-muted/40" />
          <p className="mt-3 text-sm text-content-muted">
            {shareToken
              ? "This share link is unavailable."
              : `No entity found for “${slug}”`}
          </p>
          <p className="mt-1 text-xs text-content-muted/60">
            {shareToken
              ? "It may have been revoked, expired, or moved."
              : "Search something in Chat to create an entity page."}
          </p>
        </div>
      </div>
    );
  }

  const { entity, note, timeline, evidence } = workspace;
  const viewerAccess = workspace.viewerAccess ?? {
    mode: "owner" as const,
    access: hasLiveEntity ? ("edit" as const) : ("view" as const),
    canEditNotes: hasLiveEntity,
    canEditNotebook: hasLiveEntity,
    canManageShare: hasLiveEntity && !shareToken,
    canManageMembers: false,
  };
  const isSharedWorkspace =
    viewerAccess.mode === "share" || viewerAccess.mode === "member";
  const canEditNotes = hasLiveEntity && viewerAccess.canEditNotes;
  const canEditNotebook = hasLiveEntity && viewerAccess.canEditNotebook;
  const canManageShare = hasLiveEntity && viewerAccess.canManageShare;
  const canManageMembers = hasLiveEntity && viewerAccess.canManageMembers;
  // openEntityWorkspaceDrawer hoisted above early returns — see earlier.
  const shareAccessLabel = isSharedWorkspace
    ? viewerAccess.access === "edit"
      ? viewerAccess.mode === "member"
        ? "Member edit"
        : "Shared edit"
      : viewerAccess.mode === "member"
        ? "Member view"
        : "Shared view"
    : null;
  const buildEntityPathWithShare = (nextSlug: string) =>
    buildEntityPath(nextSlug, shareToken);
  const canTraverseLinkedEntities = !shareToken;
  // liveNotebookEnabled hoisted above (see earlier in component)
  const unifiedNotebookSurface = liveNotebookEnabled && hasLiveEntity;
  const effectiveEntityViewMode = (
    unifiedNotebookSurface
      ? "live"
      : entityViewMode === "classic"
        ? "notebook"
        : entityViewMode
  ) as "classic" | "notebook" | "live";
  const showPrimaryDrawerAction =
    unifiedNotebookSurface && !isSharedWorkspace && !isReadMode;
  const showTrackHeaderButton =
    !unifiedNotebookSurface && !isSharedWorkspace && !isReadMode;
  const showShareHeaderButton =
    canManageShare && !isReadMode && !unifiedNotebookSurface;
  const showRefreshHeaderButton =
    !unifiedNotebookSurface &&
    !isSharedWorkspace &&
    !isReadMode &&
    hasLiveEntity &&
    Boolean(latestBriefReport?._id);
  const showHeaderActionsMenu = !isReadMode;
  // When the identity redesign is on AND Live is available, the three-way
  // Classic/Notebook/Live toggle is hidden — Live becomes the only user-
  // facing editable surface. The toggle re-appears automatically when
  // either flag is off (kill-switch / fallback path).
  const showViewModeToggle = false;

  // PR1 refactor — stable callback identity for EntityNotebookLiveMount.
  // Without this, the inline arrow created a new closure every render,
  // cascading into the notebook editor's prop diff and causing visible
  // re-renders on every keystroke elsewhere on the page.
  const latestReport = latestBriefReport;
  const latestDiffSummary = latestReport
    ? computeDiffSummary(latestReport.diffs ?? [])
    : "";
  const latestSections = latestBriefSections;
  const latestWhatItIs =
    latestSections.find(
      (section) => normalizeSectionKey(section) === "what-it-is",
    )?.body ??
    latestReport?.summary ??
    entity.summary;
  const latestNextStep =
    latestSections.find(
      (section) => normalizeSectionKey(section) === "what-to-do-next",
    )?.body ?? "";
  const supportingSections = latestSections.filter((section) => {
    const normalized = normalizeSectionKey(section);
    return normalized !== "what-it-is" && normalized !== "what-to-do-next";
  });
  const spotlightSections = supportingSections.slice(0, 3);
  const hiddenSupportingSectionCount = Math.max(
    0,
    supportingSections.length - spotlightSections.length,
  );
  const latestSourcePreview = latestBriefSources;
  const selectedEvidenceSection =
    evidenceSections.find(
      (section) => section.id === selectedEvidenceSectionId,
    ) ??
    evidenceSections[0] ??
    null;
  const selectedEvidenceSources = selectedEvidenceSection
    ? getSectionSources(selectedEvidenceSection, latestSourcePreview)
    : [];
  const selectedEvidenceSource =
    selectedEvidenceSources.find(
      (source) => getSourceKey(source) === selectedEvidenceSourceKey,
    ) ??
    selectedEvidenceSources[0] ??
    null;
  const selectedEvidenceSupportTitles = selectedEvidenceSource
    ? getSourceSupportingSections(selectedEvidenceSource, latestSections)
    : [];
  const relatedEntityCount = workspace.relatedEntities?.length ?? 0;
  const noteDocument = workspace.noteDocument ?? noteDocumentDraft;

  return (
    <div
      className="mx-auto w-full max-w-[min(1760px,95vw)] px-4 py-6 pb-16 sm:px-6 sm:py-8"
      data-view-mode={isReadMode ? "read" : "edit"}
    >
      {/* ── Sticky entity bar carrying IDENTITY + properties row.
           Ship-gate rubric §5: "Users can recover context at any scroll
           depth." Two rows: (1) back + entity name + kebab, (2) dense
           properties (stage/industry/updated/sources/reports). */}
      <div className="sticky top-0 z-30 -mx-4 mb-5 border-b border-black/[0.04] bg-white/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 dark:border-white/[0.06] dark:bg-[#151413]/85">
        <div className="entity-page-header-shell flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(buildCockpitPath({ surfaceId: "packets" }))}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-500 transition-colors hover:bg-black/[0.04] hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-gray-200"
            aria-label="Back to reports"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reports</span>
          </button>
          <div
            className="h-4 w-px shrink-0 bg-gray-200 dark:bg-white/[0.08]"
            aria-hidden="true"
          />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
            {entity.name}
          </h2>
          {/* Dense properties row — right-aligned so the title holds the
              eye, and metadata stays secondary (Linear pattern). */}
          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 md:flex">
            {shareAccessLabel ? (
              <span className="rounded-full border border-black/8 bg-black/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-content-muted dark:border-white/10 dark:bg-white/[0.04]">
                {shareAccessLabel}
              </span>
            ) : null}
            <PulseBadge entitySlug={entity.slug} variant="dot" />
            {entity.updatedAt ? (
              <span title={new Date(entity.updatedAt).toLocaleString()}>
                updated {formatRelative(entity.updatedAt)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Entity Header (Linear-style) ── */}
      <header className="mb-5 border-b border-gray-100 pb-4 dark:border-white/[0.06]">
        <div
          className={`entity-page-header-shell ${
            isReadMode
              ? "entity-page-header-shell--read"
              : unifiedNotebookSurface
                ? "entity-page-header-shell--live"
                : ""
          }`}
        >
          {/* Compact eyebrow — identity only, not a second dashboard row. */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5 capitalize">
              {entityTypeIcon(entity.entityType)}
              {entity.entityType}
            </span>
            {entity.savedBecause ? (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="truncate">
                  Saved because: {entity.savedBecause}
                </span>
              </>
            ) : null}
            {!unifiedNotebookSurface && shareAccessLabel ? (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="rounded-full border border-black/8 bg-black/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-content-muted dark:border-white/10 dark:bg-white/[0.04]">
                  {shareAccessLabel}
                </span>
              </>
            ) : null}
          </div>

          {/* Title + actions row */}
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {entity.name}
              </h1>
              <p className="entity-page-summary mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {entity.summary}
              </p>
            </div>

            {/* Action cluster */}
            <div className="flex flex-shrink-0 items-center gap-2">
              <ViewModeToggle hidden={Boolean(shareToken)} />
              {showPrimaryDrawerAction ? (
                <button
                  type="button"
                  onClick={() => openEntityWorkspaceDrawer("chat")}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--accent-primary-hover)]"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Open drawer
                </button>
              ) : null}
              {!unifiedNotebookSurface && !isSharedWorkspace && !isReadMode ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        buildEntityReopenChatPath(timeline[0] ?? null, entity),
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--accent-primary-hover)]"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Reopen in Chat
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        buildEntityPrepChatPath(timeline[0] ?? null, entity),
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Prep brief
                  </button>
                </>
              ) : null}
              {showTrackHeaderButton ? (
                <button
                  type="button"
                  onClick={handleToggleTrack}
                  disabled={trackPending}
                  aria-pressed={isTracked}
                  title={
                    isTracked
                      ? "Stop notifying me when an agent updates this entity"
                      : "Notify me when an agent updates this entity"
                  }
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition disabled:opacity-60 ${
                    isTracked
                      ? "border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/[0.08] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/[0.12]"
                      : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  {isTracked ? (
                    <BellRing className="h-3.5 w-3.5" />
                  ) : (
                    <Bell className="h-3.5 w-3.5" />
                  )}
                  {isTracked ? "Tracking" : "Track"}
                </button>
              ) : null}
              {showShareHeaderButton ? (
                <button
                  type="button"
                  onClick={() => setShowShareSheet((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Share
                </button>
              ) : null}
              {showRefreshHeaderButton ? (
                <button
                  type="button"
                  onClick={() => void handleRefreshLatestReport()}
                  disabled={refreshingReport}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                  aria-label="Refresh report"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshingReport ? "animate-spin" : ""}`}
                  />
                  {refreshingReport ? "Refreshing..." : "Refresh"}
                </button>
              ) : null}
              {showHeaderActionsMenu ? (
                <button
                  type="button"
                  aria-expanded={showActions}
                  aria-label={
                    showActions ? "Close actions menu" : "Open actions menu"
                  }
                  onClick={() => setShowActions((current) => !current)}
                  className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-1.5 text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                >
                  <Ellipsis className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Metadata row — this is the single notebook-facing status strip. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              First seen {formatDate(entity.createdAt)}
            </span>
            {entity.reportCount > 0 ? (
              <span className="tabular-nums">
                {entity.reportCount}{" "}
                {entity.reportCount === 1 ? "report" : "reports"}
              </span>
            ) : null}
            {sourceCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowSources(true)}
                className="tabular-nums underline-offset-2 transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200"
                aria-label={`View all ${sourceCount} sources`}
              >
                {sourceCount} source{sourceCount === 1 ? "" : "s"}
              </button>
            ) : null}
            {note ? <span>1 note</span> : null}
            {shareAccessLabel ? (
              <span className="tabular-nums">
                {shareAccessLabel.toLowerCase()}
              </span>
            ) : null}
            <PulseBadge entitySlug={entity.slug} />
            {latestCollaborationStatus ? (
              <span data-testid="entity-collaboration-status">
                {latestCollaborationStatus}
              </span>
            ) : null}
            {!unifiedNotebookSurface ? (
              <span className="ml-auto tabular-nums">
                Updated{" "}
                {formatRelative(latestReport?.updatedAt ?? entity.updatedAt)}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {showShareSheet && canManageShare ? (
        <EntityShareSheet
          entitySlug={entity.slug}
          viewLink={workspace.shareLinks?.view}
          editLink={workspace.shareLinks?.edit}
          busyAccess={shareBusyAccess}
          copyState={shareCopyState}
          canManageMembers={canManageMembers}
          peopleAuthSlot={
            !canManageMembers ? (
              <div className="space-y-3">
                <p className="text-sm text-content-muted">
                  Invite by email requires a signed-in account so access stays
                  attached to a real person.
                </p>
                <SignInForm allowAnonymous={false} />
              </div>
            ) : null
          }
          inviteEmail={inviteEmail}
          inviteAccess={inviteAccess}
          inviteBusy={inviteBusy}
          collaboratorCopyKey={collaboratorCopyKey}
          onInviteEmailChange={setInviteEmail}
          onInviteAccessChange={setInviteAccess}
          onInvite={() => void handleInviteCollaborator()}
          members={(workspace.collaborators?.members ?? []).map((member) => ({
            ...member,
            notificationStatus: member.notificationStatus,
            notificationUpdatedAt: member.notificationUpdatedAt,
            notificationError: member.notificationError,
          }))}
          invites={(workspace.collaborators?.invites ?? []).map((invite) => ({
            id: invite._id,
            email: invite.email,
            access: invite.access,
            token: invite.token,
            notificationStatus: invite.notificationStatus,
            notificationUpdatedAt: invite.notificationUpdatedAt,
            notificationError: invite.notificationError,
          }))}
          onCopyMemberLink={(userId) => void handleCopyMemberLink(userId)}
          onCopyInviteLink={(inviteId) => void handleCopyInviteLink(inviteId)}
          onUpdateMemberAccess={(userId, access) =>
            void handleUpdateMemberPermission(userId, access)
          }
          onUpdateInviteAccess={(inviteId, access) =>
            void handleUpdateInvitePermission(inviteId, access)
          }
          onRevokeMember={(userId) => void handleRevokeMember(userId)}
          onRevokeInvite={(inviteId) => void handleRevokeInvite(inviteId)}
          onCopyOrCreate={(access) => void handleShareCopy(access)}
          onRevoke={(access) => void handleRevokeShare(access)}
        />
      ) : null}

      {/* ── Sources modal ── */}
      <Dialog open={showSources} onOpenChange={setShowSources}>
          <DialogContent
            className="top-4 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[720px] translate-y-0 gap-0 overflow-hidden rounded-lg border-gray-200 bg-white p-0 shadow-xl sm:top-8 sm:max-h-[calc(100vh-4rem)] dark:border-white/[0.1] dark:bg-[#1a1a1b]"
            overlayClassName="bg-black/40 backdrop-blur-sm"
            showCloseButton={false}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-white/[0.06]">
              <div>
                <DialogTitle className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {sourceCount} source{sourceCount === 1 ? "" : "s"}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Across all saved revisions of {entity.name}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
                  aria-label="Close sources"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </DialogClose>
            </div>

            {/* Source list */}
            <div className="max-h-[60vh] overflow-y-auto">
              {allSources.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                  No sources yet.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                  {allSources.map((source, idx) => {
                    const domain = source.domain ?? extractDomain(source.href);
                    const hasLink = Boolean(source.href);
                    const content = (
                      <>
                        <span className="w-6 flex-shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {source.label}
                          </div>
                          {domain ? (
                            <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                              {domain}
                            </div>
                          ) : null}
                        </div>
                        {source.type ? (
                          <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-white/[0.05] dark:text-gray-400">
                            {source.type}
                          </span>
                        ) : null}
                        {hasLink ? (
                          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500" />
                        ) : null}
                      </>
                    );
                    return (
                      <li key={source.id || source.label}>
                        {hasLink ? (
                          <a
                            href={source.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                          >
                            {content}
                          </a>
                        ) : (
                          <div className="flex items-center gap-3 px-5 py-2.5">
                            {content}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </DialogContent>
      </Dialog>

      {/* ── Inline context strip — earned-complexity: only the
           "Since last visit" chip is ever rendered when there are
           real updates to summarize. On a calm entity, this region
           collapses to just the "Saved because" affordance (or
           disappears entirely when shared). Keeps the first fold
           quiet instead of padding it with ceremony. ── */}
      {!unifiedNotebookSurface &&
      (visitBrief.title !== "No new changes since your last visit" ||
        !isSharedWorkspace) ? (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50/40 px-4 py-3 text-sm dark:border-white/[0.06] dark:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
          {/* Since last visit — shown only when there are real changes. */}
          {visitBrief.title !== "No new changes since your last visit" ? (
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex-shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Since last visit
              </span>
              <span className="truncate text-gray-700 dark:text-gray-300">
                {visitBrief.title}
              </span>
              {visitBrief.items.find((item) => item.icon === "time") ? (
                <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
                  {visitBrief.items.find((item) => item.icon === "time")?.value}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="hidden sm:block" />
          )}

          {/* Saved because — compact inline editor */}
          {isSharedWorkspace ? (
            <div className="flex flex-shrink-0 items-center gap-2 text-xs text-content-muted">
              <Bookmark className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
              <span>
                {viewerAccess.access === "edit"
                  ? "Shared editor"
                  : "Read-only viewer"}
              </span>
            </div>
          ) : (
            <div className="flex flex-shrink-0 items-center gap-2">
              <Bookmark className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                id={savedBecauseInputId}
                name="entitySavedBecause"
                value={savedBecauseDraft}
                onChange={(event) => setSavedBecauseDraft(event.target.value)}
                onBlur={() => {
                  if (
                    hasLiveEntity &&
                    savedBecauseDraft.trim() &&
                    savedBecauseDraft.trim() !==
                      (entity.savedBecause ?? "").trim()
                  ) {
                    void handleSaveSavedBecause();
                  }
                }}
                placeholder={getSavedBecausePlaceholder(entity.entityType)}
                aria-label="Saved because"
                className="w-full max-w-[300px] rounded-md border border-gray-200 bg-white px-2.5 py-1 text-sm text-gray-700 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:placeholder:text-gray-500"
              />
              {savingSavedBecause ? (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  Saving...
                </span>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* ── Activity ribbon (Google Doc-style: who touched what) ── */}
      {!unifiedNotebookSurface && (timeline.length > 0 || note) && (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-medium text-gray-600 dark:text-gray-400">
            Recent edits:
          </span>
          {timeline.slice(0, 3).map((report) => (
            <span key={report._id} className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-primary)]/15 text-[9px] font-semibold text-[var(--accent-primary)]">
                AI
              </span>
              <span>
                {report.lens ? `${report.lens} brief` : "brief"} rev{" "}
                {report.revision ?? "—"}
              </span>
              <span className="text-gray-400 dark:text-gray-500">
                · {formatRelative(report.updatedAt ?? report.createdAt)}
              </span>
            </span>
          ))}
          {note?.updatedAt ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[9px] font-semibold text-gray-700 dark:bg-white/[0.1] dark:text-gray-300">
                YO
              </span>
              <span>working notes</span>
              <span className="text-gray-400 dark:text-gray-500">
                · {formatRelative(note.updatedAt)}
              </span>
            </span>
          ) : null}
        </div>
      )}

      <EntityNotebookSurface
        entitySlug={entity.slug}
        shareToken={shareToken}
        entityViewMode={effectiveEntityViewMode}
        showViewModeToggle={showViewModeToggle}
        isReadMode={isReadMode}
        liveNotebookEnabled={liveNotebookEnabled}
        materializingLiveWorkspace={materializingLiveWorkspace}
        hasLiveEntity={hasLiveEntity}
        hasWorkspaceSlug={Boolean(workspace?.entity?.slug)}
        canEditNotebook={canEditNotebook}
        notebookDriftMessage={notebookDrift?.message ?? null}
        notebookDriftUpdatedLabel={
          notebookDrift ? formatRelative(notebookDrift.updatedAt) : null
        }
        viewerOwnerKey={workspace.viewerIdentity?.ownerKey ?? null}
        collaborationParticipants={collaborationParticipants}
        latestHumanEditorOwnerKey={
          blockSummary?.latestHumanEditorOwnerKey ?? null
        }
        latestHumanEditorUpdatedAt={
          blockSummary?.latestHumanEditorUpdatedAt ?? null
        }
        onSelectClassic={handleSelectClassicView}
        onSelectNotebook={handleSelectNotebookView}
        onSelectLive={handleSelectLiveView}
        onOpenReferenceNotebook={handleOpenReferenceNotebookToggle}
      />

      {/*
        Legacy inline notebook JSX was parked here behind `false &&` during
        the refactor that introduced <EntityNotebookSurface /> as a memoized
        render boundary. The Surface owns the drift banner, the
        Classic/Notebook/Live toggle, the Notebook view, and the Live-mount —
        all with stable props and a single React.memo guard so parent
        re-renders do not cascade into the ProseMirror editor subtree.

        The parked branch was deleted on 2026-04-19 after tsc + notebook
        unit tests + the entity-notebook-regression e2e all passed green.
        Active path:
          - src/features/entities/components/EntityNotebookSurface.tsx
          - src/features/entities/components/notebook/EntityNotebookLiveMount.tsx
          - docs/architecture/NOTEBOOK_REFACTOR_NOTES.md (PR1 + PR7)
      */}

      {/* ── Notebook flow (Roam/Notion-style: one continuous page) ── */}
      <section
        className={`mt-6 ${effectiveEntityViewMode !== "classic" ? "hidden" : ""}`}
      >
        <article>
          <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Current brief
              </h2>
              <div className="mt-1.5 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {latestReport?.title ?? `Saved ${entity.entityType} memory`}
              </div>
              <p className="mt-1.5 max-w-[720px] text-sm leading-6 text-gray-500 dark:text-gray-400">
                Open this first. The latest read should come before the graph,
                notes, and full history.
              </p>
              {latestReport?.operatorContext?.label ? (
                <p className="mt-3 text-xs leading-6 text-content-muted">
                  Saved with your context: {latestReport.operatorContext.label}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {latestReport && isPrepBriefType(latestReport.type) ? (
                <span className="nb-chip text-[10px] uppercase tracking-[0.18em]">
                  {getReportArtifactLabel(latestReport.type)}
                </span>
              ) : null}
              <span className="nb-chip text-[10px] uppercase tracking-[0.18em]">
                {latestReport?.lens ?? "founder"}
              </span>
              {routingToneLabel(latestReport) ? (
                <span className="nb-chip text-[10px] uppercase tracking-[0.18em]">
                  {routingToneLabel(latestReport)}
                </span>
              ) : null}
              {latestReport?.revision ? (
                <span className="nb-chip text-[10px] uppercase tracking-[0.18em]">
                  Rev {latestReport.revision}
                </span>
              ) : null}
              <span className="nb-chip text-[10px] uppercase tracking-[0.18em]">
                {latestSourcePreview.length} sources
              </span>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                What it is
              </div>
              <p className="mt-3 text-sm leading-7 text-content">
                {latestWhatItIs}
              </p>
            </div>

            {spotlightSections.map((section) => {
              const sectionSources = getSectionSources(
                section,
                latestSourcePreview,
                2,
              );
              return (
                <div
                  key={section.id}
                  className="border-t border-gray-100 pt-4 dark:border-white/[0.06]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {section.title}
                    </h3>
                    {section.status ? (
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        {section.status}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-7 text-gray-700 dark:text-gray-300">
                    {section.body}
                  </p>
                  {sectionSources.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <ProductSourceIdentity
                        sourceUrls={sectionSources
                          .map((source) => source.href)
                          .filter(
                            (href): href is string =>
                              typeof href === "string" &&
                              href.trim().length > 0,
                          )}
                        sourceLabels={sectionSources.map(
                          (source) => source.label,
                        )}
                        maxItems={2}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEvidenceSectionId(section.id);
                          setSelectedEvidenceSourceKey(
                            getSourceKey(sectionSources[0]),
                          );
                        }}
                        className="text-xs font-medium text-[#d97757] transition hover:text-[#c9684a]"
                      >
                        Inspect sources
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {hiddenSupportingSectionCount > 0 ? (
              <div className="text-sm text-content-muted">
                + {hiddenSupportingSectionCount} more section
                {hiddenSupportingSectionCount === 1 ? "" : "s"} in the timeline
                below
              </div>
            ) : null}

            {evidenceSections.length > 0 ? (
              <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                      Source trail
                    </div>
                    <p className="mt-2 max-w-[640px] text-sm leading-6 text-content-muted">
                      Open one section at a time and inspect the exact
                      supporting sources before reopening the run.
                    </p>
                  </div>
                  <div className="text-xs text-content-muted">
                    {evidenceSections.length} section
                    {evidenceSections.length === 1 ? "" : "s"} linked to
                    evidence
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {evidenceSections.map((section) => {
                    const isActive = section.id === selectedEvidenceSection?.id;
                    const linkedCount = getSectionSources(
                      section,
                      latestSourcePreview,
                    ).length;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => {
                          const firstSource =
                            getSectionSources(
                              section,
                              latestSourcePreview,
                            )[0] ?? null;
                          setSelectedEvidenceSectionId(section.id);
                          setSelectedEvidenceSourceKey(
                            firstSource ? getSourceKey(firstSource) : null,
                          );
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          isActive
                            ? "border-[#d97757]/30 bg-[#d97757]/10 text-[#d97757]"
                            : "border-black/8 bg-black/[0.03] text-content-muted hover:border-[#d97757]/20 hover:text-content dark:border-white/10 dark:bg-white/[0.03]"
                        }`}
                      >
                        {section.title}
                        <span className="ml-1.5 text-[10px] uppercase tracking-[0.16em] opacity-75">
                          {linkedCount}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectedEvidenceSection ? (
                  <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-2">
                      {selectedEvidenceSources.map((source) => {
                        const isActive =
                          getSourceKey(source) ===
                          (selectedEvidenceSource
                            ? getSourceKey(selectedEvidenceSource)
                            : null);
                        return (
                          <button
                            key={getSourceKey(source)}
                            type="button"
                            onClick={() =>
                              setSelectedEvidenceSourceKey(getSourceKey(source))
                            }
                            className={`w-full rounded-md border px-3 py-2 text-left transition ${
                              isActive
                                ? "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5"
                                : "border-gray-100 hover:border-gray-200 dark:border-white/[0.06] dark:hover:border-white/[0.12]"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-content">
                                {source.label}
                              </div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                                {source.type ?? "source"}
                              </div>
                            </div>
                            <div className="mt-2 text-xs leading-6 text-content-muted">
                              {(
                                source.domain ||
                                source.href ||
                                "No linked URL"
                              ).replace(/^https?:\/\//, "")}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                        Selected source
                      </div>
                      {selectedEvidenceSource ? (
                        <>
                          <div className="mt-3 text-base font-semibold tracking-tight text-content">
                            {selectedEvidenceSource.label}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-content-muted">
                            {selectedEvidenceSource.type ? (
                              <span className="nb-chip text-[10px] uppercase tracking-[0.16em]">
                                {selectedEvidenceSource.type}
                              </span>
                            ) : null}
                            {selectedEvidenceSource.domain ? (
                              <span className="nb-chip text-[10px] normal-case tracking-normal">
                                {selectedEvidenceSource.domain}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-3 text-sm leading-6 text-content-muted">
                            Supports{" "}
                            <span className="font-medium text-content">
                              {selectedEvidenceSection.title}
                            </span>
                            {selectedEvidenceSupportTitles.length > 1
                              ? ` and ${selectedEvidenceSupportTitles.length - 1} more saved section${
                                  selectedEvidenceSupportTitles.length - 1 === 1
                                    ? ""
                                    : "s"
                                }`
                              : ""}
                            .
                          </p>
                          {selectedEvidenceSource.href ? (
                            <a
                              href={selectedEvidenceSource.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#d97757] transition hover:text-[#c9684a]"
                            >
                              Open source
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <p className="mt-4 text-sm leading-6 text-content-muted">
                              This source is saved as a label only. Reopen the
                              run if you need a live link or fresher evidence.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-content-muted">
                          Pick a source to inspect the supporting evidence for
                          this section.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {relatedEntityCount > 0 ? (
              <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                      Graph walk
                    </div>
                    <p className="mt-2 max-w-[640px] text-sm leading-6 text-content-muted">
                      {canTraverseLinkedEntities
                        ? "Step into related entities without rebuilding the search from scratch."
                        : "Shared links keep the current workspace focused. Related entities stay visible here as context only."}
                    </p>
                  </div>
                  {canTraverseLinkedEntities ? (
                    <button
                      type="button"
                      onClick={() => setShowContextGraph(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-black/[0.03] px-3 py-1.5 text-xs font-medium text-content-muted transition hover:border-[#d97757]/20 hover:text-content dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Open graph
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {uniqueRelatedEntities.slice(0, 6).map((related) =>
                    canTraverseLinkedEntities ? (
                      <button
                        key={related.slug}
                        type="button"
                        onClick={() =>
                          navigate(buildEntityPathWithShare(related.slug))
                        }
                        className="inline-flex max-w-full items-center gap-2 rounded-full border border-black/8 bg-black/[0.03] px-3 py-1.5 text-left text-sm text-content transition hover:border-[#d97757]/20 hover:bg-[#d97757]/5 dark:border-white/10 dark:bg-white/[0.03]"
                      >
                        <span className="truncate">{related.name}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-content-muted">
                          {related.entityType}
                        </span>
                      </button>
                    ) : (
                      <div
                        key={related.slug}
                        className="inline-flex max-w-full items-center gap-2 rounded-full border border-black/8 bg-black/[0.03] px-3 py-1.5 text-left text-sm text-content dark:border-white/10 dark:bg-white/[0.03]"
                      >
                        <span className="truncate">{related.name}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-content-muted">
                          {related.entityType}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div
            className={`mt-5 grid gap-4 ${latestNextStep ? "lg:grid-cols-[minmax(0,1fr)_280px]" : ""}`}
          >
            {latestNextStep ? (
              <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  What to do next
                </div>
                <p className="mt-3 text-sm leading-7 text-content">
                  {latestNextStep}
                </p>
              </div>
            ) : null}

            <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                How this brief was built
              </div>
              <div className="mt-3 space-y-2">
                <div className="rounded-md border border-gray-100 dark:border-white/[0.06] px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                    Original ask
                  </div>
                  <p className="mt-2 text-sm leading-6 text-content">
                    {latestReport?.query?.trim() ||
                      `Update ${entity.name} and show me what changed.`}
                  </p>
                </div>
                <div className="rounded-md border border-gray-100 dark:border-white/[0.06] flex items-center justify-between gap-3 px-3 py-3">
                  <span className="text-sm text-content-muted">Lens</span>
                  <span className="text-sm font-medium text-content">
                    {latestReport?.lens ?? "founder"}
                  </span>
                </div>
                <div className="rounded-md border border-gray-100 dark:border-white/[0.06] flex items-center justify-between gap-3 px-3 py-3">
                  <span className="text-sm text-content-muted">
                    Reasoning lane
                  </span>
                  <span className="text-sm font-medium text-content">
                    {routingToneLabel(latestReport) ?? "Default"}
                  </span>
                </div>
                {latestReport?.operatorContext?.label ? (
                  <div className="rounded-md border border-gray-100 dark:border-white/[0.06] flex items-center justify-between gap-3 px-3 py-3">
                    <span className="text-sm text-content-muted">
                      Saved context
                    </span>
                    <span className="text-right text-sm font-medium text-content">
                      {latestReport.operatorContext.label}
                    </span>
                  </div>
                ) : null}
                {latestReport?.routing?.routingReason ? (
                  <div className="rounded-md border border-gray-100 dark:border-white/[0.06] px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                      Router note
                    </div>
                    <p className="mt-2 text-sm leading-6 text-content-muted">
                      {latestReport.routing.routingReason}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 text-[11px] text-content-muted">
                {sourceCount} total sources across {timeline.length} saved
                revision{timeline.length === 1 ? "" : "s"}.
              </div>
            </div>
          </div>

          {latestDiffSummary ? (
            <div className="mt-4 border-l-2 border-[var(--accent-primary)] pl-3">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--accent-primary)]">
                What changed
              </div>
              <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                {latestDiffSummary}
              </p>
            </div>
          ) : null}
        </article>
      </section>

      {/*
        ── Diligence blocks ────────────────────────────────────────────
        Pipeline output lives here — one DiligenceSection per block type.
        In Phase 1, the pipeline is wired at the contract level
        (server/pipeline/blocks/founder.ts) but the runtime is still
        behind agentHarness; until the v1 orchestrator emits structured
        output, sections render with empty state + actionable copy.
        See: docs/architecture/AGENT_PIPELINE.md
        ───────────────────────────────────────────────────────────── */}
      {effectiveEntityViewMode === "classic" ? (
        <section
          className="mt-8 flex flex-col gap-3"
          data-testid="entity-diligence-blocks"
        >
          <DiligenceSection<never>
            block="founder"
            title="Founders"
            description="Identified founders, co-founders, and key operators. Verified against official bios and corroborated by reputable press where possible."
            overallTier="unverified"
            candidates={[]}
            emptyLabel="We haven't identified founders for this entity yet. Run a diligence pass or upload a team bio to populate this block."
            renderer={() => null}
            defaultCollapsed={false}
          />
          <DiligenceSection<never>
            block="product"
            title="Products"
            description="Products this company offers — features, pricing, launch dates."
            overallTier="unverified"
            candidates={[]}
            emptyLabel="No products identified. Try adding the company homepage or a product-page URL to the ingest."
            renderer={() => null}
            defaultCollapsed
          />
          <DiligenceSection<never>
            block="funding"
            title="Funding"
            description="Funding rounds, investors, valuation hints — grounded in SEC EDGAR and company press releases where available."
            overallTier="unverified"
            candidates={[]}
            emptyLabel="No funding signals found. Add a press release or SEC filing to seed this block."
            renderer={() => null}
            defaultCollapsed
          />
        </section>
      ) : null}

      {showActions && !isReadMode ? (
        <section className="mt-4 rounded-3xl border border-black/8 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#111214]/90">
          {unifiedNotebookSurface || canManageShare || hasLiveEntity ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                Workspace
              </div>
              <p className="mt-2 text-sm leading-6 text-content-muted">
                Keep the notebook calm. Secondary controls live here instead of
                the page header.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {unifiedNotebookSurface && !isSharedWorkspace ? (
                  <button
                    type="button"
                    onClick={handleToggleTrack}
                    disabled={trackPending}
                    className="nb-secondary-button rounded-full px-3 py-1.5 text-xs"
                  >
                    {trackPending
                      ? "Updating..."
                      : isTracked
                        ? "Stop tracking"
                        : "Track updates"}
                  </button>
                ) : null}
                {canManageShare ? (
                  <button
                    type="button"
                    onClick={() => setShowShareSheet((current) => !current)}
                    className="nb-secondary-button rounded-full px-3 py-1.5 text-xs"
                  >
                    {showShareSheet ? "Hide share options" : "Share workspace"}
                  </button>
                ) : null}
                {!isSharedWorkspace && hasLiveEntity && latestReport?._id ? (
                  <button
                    type="button"
                    onClick={() => void handleRefreshLatestReport()}
                    disabled={refreshingReport}
                    className="nb-secondary-button rounded-full px-3 py-1.5 text-xs"
                  >
                    {refreshingReport ? "Refreshing..." : "Refresh report"}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          <div
            className={`${unifiedNotebookSurface || canManageShare || hasLiveEntity ? "mt-5 border-t border-black/8 pt-4 dark:border-white/10" : ""}`}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              Export
            </div>
            <p className="mt-2 text-sm leading-6 text-content-muted">
              Copy exactly what you need and leave the workspace alone.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ["brief", "Executive brief"],
                ["outreach", "Outreach memo"],
                ["crm", "CRM block"],
                ["markdown", "Markdown"],
                ["link", "Copy link"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => void copyPayload(kind)}
                className="nb-secondary-button rounded-full px-3 py-1.5 text-xs"
              >
                {copyState === kind ? "Copied" : label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className={`mt-10 pt-8 ${effectiveEntityViewMode !== "classic" ? "hidden" : ""}`}
      >
        <div className="grid gap-8 2xl:grid-cols-[minmax(0,3fr)_minmax(280px,0.7fr)] 2xl:items-start">
          <section data-testid="entity-working-notes" className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Working notes
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Use this as the primary working surface for the entity. Keep
                  your live read, synthesis, and follow-up questions here.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveNote()}
                disabled={noteSaving || !canEditNotes}
                className="nb-primary-button rounded-full px-4 py-2 text-sm"
              >
                {!canEditNotes
                  ? "Read-only"
                  : noteSaving
                    ? "Saving..."
                    : "Save notes"}
              </button>
            </div>

            <div className="mt-5" data-testid="entity-note-editor-shell">
              <Suspense
                fallback={
                  <div className="rounded-md border border-gray-100 dark:border-white/[0.06] p-6 text-sm text-content-muted">
                    Loading entity notebook...
                  </div>
                }
              >
                <EntityNoteEditor
                  ref={noteEditorRef}
                  document={noteDocumentDraft}
                  onChange={handleNoteDocumentDraftChange}
                  readOnly={!canEditNotes}
                  toolbarPreset="compact"
                  showStats={false}
                  statusLabel={
                    !hasLiveEntity
                      ? "Starter memory"
                      : !canEditNotes
                        ? "Read-only shared note"
                        : noteSaving
                          ? "Saving..."
                          : workspace.noteDocument?.updatedAt
                            ? `Saved ${formatRelative(workspace.noteDocument.updatedAt)}`
                            : note?.updatedAt
                              ? `Saved ${formatRelative(note.updatedAt)}`
                              : "Editable"
                  }
                />
              </Suspense>
            </div>
            {workspace.noteDocument?.snapshots?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {workspace.noteDocument.snapshots
                  .slice(0, 4)
                  .map((snapshot) => (
                    <span
                      key={snapshot._id ?? `snapshot-${snapshot.revision}`}
                      className="nb-chip text-xs normal-case tracking-normal"
                    >
                      Notebook rev {snapshot.revision}
                      <span className="normal-case tracking-normal">
                        {formatRelative(snapshot.createdAt)}
                      </span>
                    </span>
                  ))}
              </div>
            ) : null}
          </section>

          <aside
            data-testid="entity-workspace-rail"
            className="space-y-4 xl:sticky xl:top-24"
          >
            <section className="pt-2 xl:pt-0">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    {/* Framework audit §2: "Workspace rail" is jargon. The
                      panel sells itself by the tabs below, not a label. */}
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                      Companion
                    </h2>
                  </div>
                  {/* Framework audit §2: the internal names "evidence" and
                    "context" are engineering labels. Users see "Sources"
                    and "Related" — plain product language. The storage
                    key stays "evidence"/"context" so existing persisted
                    preferences don't get migrated. */}
                  <ToggleGroup
                    type="single"
                    value={workspaceRailView}
                    onValueChange={(value) => {
                      if (value === "evidence" || value === "context") setWorkspaceRailView(value);
                    }}
                    aria-label="Companion panel"
                    className="inline-flex rounded-full border border-black/8 bg-black/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <ToggleGroupItem
                      value="evidence"
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        workspaceRailView === "evidence"
                          ? "bg-[var(--accent-primary)] text-white"
                          : "text-content-muted hover:text-content"
                      }`}
                    >
                      Sources
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="context"
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        workspaceRailView === "context"
                          ? "bg-[var(--accent-primary)] text-white"
                          : "text-content-muted hover:text-content"
                      }`}
                    >
                      Related
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-content-muted">
                  <span className="nb-chip normal-case tracking-normal">
                    {entity.reportCount} saved
                  </span>
                  <span className="nb-chip normal-case tracking-normal">
                    {evidence.length} evidence
                  </span>
                  <span className="nb-chip normal-case tracking-normal">
                    {relatedEntityCount} linked
                  </span>
                </div>
              </div>

              {workspaceRailView === "evidence" ? (
                <div className="mt-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                        Attached evidence
                      </div>
                    </div>
                    {!isSharedWorkspace ? (
                      <label
                        className={`nb-secondary-button rounded-full px-3 py-2 text-xs ${
                          hasLiveEntity
                            ? "cursor-pointer"
                            : "cursor-not-allowed opacity-50"
                        }`}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {!hasLiveEntity
                          ? "Live entity only"
                          : uploadingEvidence
                            ? "Uploading..."
                            : "Attach file"}
                        <input
                          type="file"
                          name="entityEvidenceUpload"
                          className="hidden"
                          disabled={!hasLiveEntity}
                          onChange={async (event) => {
                            const input = event.currentTarget;
                            const file = event.target.files?.[0];
                            if (!file) return;
                            await handleAttachFile(file);
                            input.value = "";
                          }}
                        />
                      </label>
                    ) : null}
                  </div>

                  {!isSharedWorkspace &&
                  attachableEvidence &&
                  attachableEvidence.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                        Ready to attach
                      </div>
                      {attachableEvidence.slice(0, 3).map((item: any) => (
                        <div
                          key={String(item._id)}
                          className="rounded-md border border-gray-100 dark:border-white/[0.06] flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-content">
                              {item.label}
                            </div>
                            <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-content-muted">
                              {item.type ?? "file"}
                            </div>
                          </div>
                          {item.entityId ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-content-muted">
                              <Check className="h-3 w-3" />
                              Attached
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={async () => {
                                setAttachingEvidenceId(String(item._id));
                                try {
                                  await attachEvidence({
                                    anonymousSessionId,
                                    entityId: entity._id as any,
                                    evidenceId: item._id as any,
                                  });
                                } finally {
                                  setAttachingEvidenceId(null);
                                }
                              }}
                              className="nb-secondary-button px-3 py-1.5 text-xs"
                            >
                              {attachingEvidenceId === String(item._id)
                                ? "Attaching..."
                                : "Attach"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {evidence.length > 0 ? (
                    <div className="space-y-2">
                      {evidence.map((item) => (
                        <div
                          key={item._id}
                          className="rounded-md border border-gray-100 dark:border-white/[0.06] flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-content">
                              {item.label}
                            </div>
                            <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-content-muted">
                              {item.type ?? "file"}
                            </div>
                          </div>
                          {item.sourceUrl ? (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#d97757] transition hover:text-[#c9684a]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Source
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span className="text-xs text-content-muted">
                              Attached
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-4 text-sm leading-6 text-gray-500 dark:text-gray-400">
                      Attach files that should persist into the next run.
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                      Notebook metadata
                    </div>
                    <div className="mt-3">
                      <EntityNotebookMeta
                        document={noteDocument}
                        onOpenEntity={
                          canTraverseLinkedEntities
                            ? (nextSlug) =>
                                navigate(buildEntityPathWithShare(nextSlug))
                            : undefined
                        }
                      />
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                        Relationship graph
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setShowContextGraph((current) => !current)
                        }
                        className="nb-secondary-button rounded-full px-3 py-1.5 text-xs"
                      >
                        {showContextGraph ? "Hide graph" : "Show graph"}
                      </button>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-content-muted">
                      Open this only when you want the relationship view.
                    </p>
                    {showContextGraph ? (
                      <div className="mt-4">
                        <EntityMemoryGraph
                          entityName={entity.name}
                          relatedEntities={workspace.relatedEntities}
                          evidence={workspace.evidence}
                          onOpenEntity={
                            canTraverseLinkedEntities
                              ? (nextSlug) =>
                                  navigate(buildEntityPathWithShare(nextSlug))
                              : undefined
                          }
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                      Linked reports
                    </div>
                    {uniqueRelatedEntities.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {uniqueRelatedEntities.map((related) =>
                          canTraverseLinkedEntities ? (
                            <button
                              key={related.slug}
                              type="button"
                              onClick={() =>
                                navigate(buildEntityPathWithShare(related.slug))
                              }
                              className="rounded-md border border-gray-100 dark:border-white/[0.06] w-full px-4 py-3 text-left transition hover:bg-white/[0.04]"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-content">
                                  {related.name}
                                </div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                                  {related.entityType}
                                </div>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-content-muted">
                                {related.summary}
                              </p>
                              {related.reason ? (
                                <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-content-muted">
                                  {related.reason}
                                </div>
                              ) : null}
                            </button>
                          ) : (
                            <div
                              key={related.slug}
                              className="rounded-md border border-gray-100 dark:border-white/[0.06] w-full px-4 py-3 text-left"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-content">
                                  {related.name}
                                </div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                                  {related.entityType}
                                </div>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-content-muted">
                                {related.summary}
                              </p>
                              {related.reason ? (
                                <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-content-muted">
                                  {related.reason}
                                </div>
                              ) : null}
                            </div>
                          ),
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-content-muted">
                        Linked reports appear here as this entity connects to
                        more saved work.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          </aside>
        </div>
      </section>

      {/* ── User Notes (editable, Obsidian-like) ───────────────────────── */}
      {false ? (
        <>
          <section
            className={`mt-10 pt-8 ${effectiveEntityViewMode !== "classic" ? "hidden" : ""}`}
          >
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Connected node
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Related entities and attached evidence make this report compound
                like a real notebook page instead of a one-off answer.
              </p>
            </div>
            <EntityMemoryGraph
              entityName={entity.name}
              relatedEntities={workspace?.relatedEntities ?? []}
              evidence={workspace?.evidence ?? []}
              onOpenEntity={(nextSlug) =>
                navigate(buildEntityPathWithShare(nextSlug))
              }
            />

            {uniqueRelatedEntities.length > 0 ? (
              <div className="mt-4 space-y-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  Linked reports
                </h2>
                {uniqueRelatedEntities.map((related) => (
                  <button
                    key={related.slug}
                    type="button"
                    onClick={() =>
                      navigate(buildEntityPathWithShare(related.slug))
                    }
                    className="rounded-md border border-gray-100 dark:border-white/[0.06] w-full px-4 py-3 text-left transition hover:bg-white/[0.04]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-content">
                        {related.name}
                      </div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                        {related.entityType}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-content-muted">
                      {related.summary}
                    </p>
                    {related.reason ? (
                      <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-content-muted">
                        {related.reason}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {/* ── Evidence / Sources ──────────────────────────────────────────── */}

          {/* ── Research Timeline ──────────────────────────────────────────── */}
        </>
      ) : null}

      {/* ── Minimal bottom timeline scrub ─────────────────────────────── */}
      {effectiveEntityViewMode === "classic" && timeline.length > 0 ? (
        <div className="mt-10 border-t border-white/[0.06] pt-4">
          {/* Thin progress-like line */}
          <div className="relative h-[2px] w-full rounded-full bg-white/[0.04]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/[0.12]"
              style={{ width: "100%" }}
            />
          </div>
          {/* Metadata strip */}
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/30">
            <div className="flex items-center gap-2">
              <GitBranch className="h-3 w-3" />
              <span>
                {timeline.length} revision{timeline.length === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>last {formatRelative(timeline[0]?.updatedAt)}</span>
            </div>
            <button
              type="button"
              onClick={() =>
                openWithContext({
                  initialTab: "flow",
                  contextEntitySlug: slug,
                  contextTitle: workspace?.entity?.name ?? slug,
                })
              }
              className="inline-flex items-center gap-1 transition hover:text-white/60"
            >
              Open in Flow <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default EntityPage;
