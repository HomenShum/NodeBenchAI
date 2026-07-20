import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useConvex, useQuery } from "convex/react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitBranch,
  Layers3,
  ListChecks,
  ShieldCheck,
  Sparkles,
  Wand2,
  XCircle,
} from "lucide-react";

import { RichNotebookEditor } from "@/features/notebook/components/RichNotebookEditor";
import {
  createNotebookActionPatch,
  type NotebookAction,
  type NotebookActionContext,
  type NotebookActionPatch,
  type NotebookCaptureInput,
  type NotebookClaimInput,
} from "@/features/notebook/lib/notebookActionEngine";
import {
  getStarterEntityWorkspace,
  type StarterEntityWorkspace,
} from "@/features/entities/lib/starterEntityWorkspaces";
import { buildWorkspaceUrl } from "@/features/workspace/lib/workspaceRouting";
import { getReportNotebookIdFromPath } from "@/features/reports/lib/reportNotebookRouting";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { cn } from "@/lib/utils";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleizeReportId(reportId: string) {
  return reportId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type SavedReportSection = {
  id?: string;
  title?: string;
  body?: string;
  status?: string;
};

export type SavedReportTruthSentence = {
  sentenceId?: string;
  text?: string;
};

export type SavedReportTruthSection = {
  id?: string;
  title?: string;
  sentences?: SavedReportTruthSentence[];
};

export type SavedReportSnapshot = {
  title?: string;
  summary?: string;
  query?: string;
  status?: string;
  type?: string;
  revision?: number;
  /** Free-form notebook HTML - persisted via reports.saveReportNotebookHtml. */
  notebookHtml?: string;
  /** Structured saved sections (productReports.sections). */
  sections?: SavedReportSection[];
  /** Compiled truth view (productReports.compiledAnswerV2.truthSections). */
  compiledAnswerV2?: {
    truthSections?: SavedReportTruthSection[];
  };
  sources?: Array<{
    label?: string;
    siteName?: string;
    title?: string;
    domain?: string;
    href?: string;
    type?: string;
  }>;
  updatedAt?: number;
};

type ReportWorkspaceSnapshot = {
  workspace?: {
    source?: string;
    updatedAt?: number;
  };
  entities?: Array<{
    entityKey?: string;
    name?: string;
    entityType?: string;
    confidence?: number;
  }>;
  evidence?: Array<{
    evidenceKey?: string;
    title?: string;
  }>;
  claims?: Array<{
    claimKey?: string;
    claim?: string;
    status?: string;
    evidenceKeys?: string[];
  }>;
  followUps?: Array<{
    followUpKey?: string;
    action?: string;
    priority?: string;
  }>;
  captures?: Array<{
    captureKey?: string;
    captureId?: string;
    rawText?: string;
    transcript?: string;
    extractedEntityKeys?: string[];
    extractedEntityIds?: string[];
  }>;
  runRecords?: Array<{
    status?: string;
    source?: string;
    updatedAt?: number;
  }>;
};

type NotebookGraphPersistResult = {
  entityCount?: number;
  claimCount?: number;
  followUpCount?: number;
  captureCount?: number;
  productEntityCount?: number;
  productClaimCount?: number;
  edgeCount?: number;
  runId?: string;
};

const NOTEBOOK_ACTIONS: Array<{
  action: NotebookAction;
  label: string;
  description: string;
  icon: typeof Wand2;
}> = [
  {
    action: "organize_notes",
    label: "Organize notes",
    description: "Group captures by company, person, or theme.",
    icon: ListChecks,
  },
  {
    action: "create_dossier",
    label: "Create dossier",
    description: "Turn selected context into a report structure.",
    icon: FileText,
  },
  {
    action: "extract_followups",
    label: "Extract follow-ups",
    description: "Find action language and turn it into tasks.",
    icon: CheckCircle2,
  },
  {
    action: "audit_claims",
    label: "Audit claims",
    description: "Mark unsupported claims for review.",
    icon: ShieldCheck,
  },
  {
    action: "link_concepts",
    label: "Link concepts",
    description: "Create an explanation edge from the context text.",
    icon: GitBranch,
  },
  {
    action: "clone_structure",
    label: "Clone structure",
    description: "Reuse a report outline without inventing facts.",
    icon: Wand2,
  },
];

function paragraphsToHtml(text: string) {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function sectionsToHtml(sections: SavedReportSection[] | undefined): string {
  if (!Array.isArray(sections) || sections.length === 0) return "";
  return sections
    .filter((s) => s && (s.title || s.body))
    .map((s) => {
      const title = (s.title ?? "").trim();
      const body = (s.body ?? "").trim();
      const titleHtml = title ? `<h3>${escapeHtml(title)}</h3>` : "";
      const bodyHtml = body ? paragraphsToHtml(body) : "";
      return `${titleHtml}${bodyHtml}`;
    })
    .join("");
}

function truthSectionsToHtml(
  truth: SavedReportTruthSection[] | undefined,
): string {
  if (!Array.isArray(truth) || truth.length === 0) return "";
  return truth
    .filter((s) => s && (s.title || (Array.isArray(s.sentences) && s.sentences.length)))
    .map((s) => {
      const titleHtml = s.title ? `<h3>${escapeHtml(s.title)}</h3>` : "";
      const sentencesHtml = (s.sentences ?? [])
        .map((sent) => (sent?.text ?? "").trim())
        .filter(Boolean)
        .map((text) => `<p>${escapeHtml(text)}</p>`)
        .join("");
      return `${titleHtml}${sentencesHtml}`;
    })
    .join("");
}

export function buildReportNotebookContent(
  workspace: StarterEntityWorkspace | null,
  reportName: string,
  savedReport?: SavedReportSnapshot | null,
) {
  // Real saved report -> render the saved answer as the notebook body.
  if (savedReport) {
    // User has explicitly edited the notebook HTML - that wins. Trust the
    // backend (server-sanitized) string verbatim; never re-escape stored
    // notebookHtml or we'd double-encode user content on every save.
    if (typeof savedReport.notebookHtml === "string" && savedReport.notebookHtml.trim()) {
      return savedReport.notebookHtml;
    }

    const heading = savedReport.title?.trim() || reportName;
    const summaryHtml = savedReport.summary?.trim()
      ? `<p><em>${escapeHtml(savedReport.summary.trim())}</em></p>`
      : "";
    const queryHtml = savedReport.query?.trim()
      ? `<p><strong>Question:</strong> ${escapeHtml(savedReport.query.trim())}</p>`
      : "";

    // Prefer structured sections (live productReports.sections), fall back to
    // compiledAnswerV2.truthSections for richer reports.
    const sectionsHtml =
      sectionsToHtml(savedReport.sections) ||
      truthSectionsToHtml(savedReport.compiledAnswerV2?.truthSections);

    return `
      <h2>${escapeHtml(heading)}</h2>
      ${summaryHtml}
      ${queryHtml}
      ${sectionsHtml || "<p>This report does not yet have a written answer attached. Open it in the full workspace for live exploration.</p>"}
    `;
  }

  // Starter fixture path (demo reports keyed by slug).
  if (workspace) {
    const sectionHtml =
      workspace.latest?.sections
        .map(
          (section) =>
            `<h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.body)}</p>`,
        )
        .join("") ?? "";

    return `
      <h2>${escapeHtml(workspace.latest?.title ?? `${workspace.entity.name} notebook`)}</h2>
      <p>${escapeHtml(workspace.note.content)}</p>
      ${sectionHtml}
    `;
  }

  // True empty fallback - no saved data, no starter fixture.
  return `
    <h2>${escapeHtml(reportName)} notebook</h2>
    <p>Use this web report notebook for quick memo cleanup, field-note synthesis, and small edits before opening the full workspace.</p>
    <p>For recursive cards, source verification, chat, and graph inspection, open the full Workspace surface.</p>
  `;
}

function normalizeNotebookClaimStatus(status?: string): NotebookClaimInput["status"] {
  if (status === "verified" || status === "field_note" || status === "rejected") {
    return status;
  }
  return "needs_review";
}

function fallbackCaptureFromStarter(
  workspace: StarterEntityWorkspace | null,
): NotebookCaptureInput[] {
  if (!workspace?.note?.content?.trim()) return [];
  return [
    {
      captureId: `starter.${workspace.entity.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      rawText: workspace.note.content,
      extractedEntityIds: [workspace.entity.name],
    },
  ];
}

function normalizeNotebookCaptures(
  snapshot: ReportWorkspaceSnapshot | null | undefined,
  starterWorkspace: StarterEntityWorkspace | null,
): NotebookCaptureInput[] {
  const captures = (snapshot?.captures ?? [])
    .map((capture, index) => {
      const rawText = (capture.rawText || capture.transcript || "").trim();
      if (!rawText) return null;
      return {
        captureId: capture.captureKey || capture.captureId || `capture.${index + 1}`,
        rawText,
        extractedEntityIds: capture.extractedEntityKeys || capture.extractedEntityIds,
      } satisfies NotebookCaptureInput;
    })
    .filter((capture): capture is NotebookCaptureInput => Boolean(capture));
  return captures.length > 0 ? captures : fallbackCaptureFromStarter(starterWorkspace);
}

function normalizeNotebookClaims(
  snapshot: ReportWorkspaceSnapshot | null | undefined,
): NotebookClaimInput[] {
  return (snapshot?.claims ?? [])
    .map((claim, index) => {
      const text = claim.claim?.trim();
      if (!text) return null;
      return {
        id: claim.claimKey || `claim.${index + 1}`,
        claim: text,
        status: normalizeNotebookClaimStatus(claim.status),
        evidenceIds: claim.evidenceKeys ?? [],
      } satisfies NotebookClaimInput;
    })
    .filter((claim): claim is NotebookClaimInput => Boolean(claim));
}

export function buildNotebookActionContext(args: {
  reportId: string;
  reportName: string;
  summary: string;
  selectedText: string;
  workspaceSnapshot: ReportWorkspaceSnapshot | null | undefined;
  starterWorkspace: StarterEntityWorkspace | null;
}): NotebookActionContext {
  const selectedText = args.selectedText.trim();
  const normalizedCaptures = normalizeNotebookCaptures(args.workspaceSnapshot, args.starterWorkspace);
  const captures =
    normalizedCaptures.length > 0
      ? normalizedCaptures
      : selectedText
        ? [
            {
              captureId: `manual.${args.reportId}`,
              rawText: selectedText,
            },
          ]
        : [];
  const claims = normalizeNotebookClaims(args.workspaceSnapshot);
  return {
    reportId: args.reportId,
    workspaceId: args.reportId,
    selectedText: selectedText || `${args.reportName}: ${args.summary}`,
    captures,
    claims,
    template: {
      templateId: "nodebench.web-report.v1",
      sections: [
        {
          title: "What changed",
          body: "Summarize the new signal or field-note delta.",
        },
        {
          title: "So what",
          body: "Write the implication, risk, or decision relevance.",
        },
        {
          title: "Now what",
          body: "List verification steps, owner follow-ups, and workspace handoffs.",
        },
      ],
    },
  };
}

function notebookBodyTextToHtml(value: string) {
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  const allBullets = lines.every((line) => /^[-*]\s+/.test(line));
  if (allBullets) {
    return `<ul>${lines
      .map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`)
      .join("")}</ul>`;
  }

  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function claimEvidenceForHtml(evidenceIds: string[]) {
  return evidenceIds.map((id, index) => ({
    n: index + 1,
    label: id,
    kind: "support" as const,
  }));
}

function claimBlockHtml(change: NotebookActionPatch["proposedClaimChanges"][number]) {
  const evidence = claimEvidenceForHtml(change.evidenceIds);
  const conflictCount = change.status === "needs_review" || evidence.length === 0 ? 1 : 0;
  return `<div data-type="nb-claim" data-statement="${escapeHtml(change.claim)}" data-support="${evidence.length}" data-conflict="${conflictCount}" data-evidence="${escapeHtml(JSON.stringify(evidence))}" data-open="true"></div>`;
}

export function buildNotebookActionPatchHtml(patch: NotebookActionPatch) {
  const blocks = patch.proposedBlockChanges
    .map((change) => {
      if (change.kind === "insert_callout") {
        return `<blockquote><p><strong>${escapeHtml(change.title)}:</strong> ${escapeHtml(change.body)}</p></blockquote>`;
      }
      return `<h3>${escapeHtml(change.title)}</h3>${notebookBodyTextToHtml(change.body)}`;
    })
    .join("");

  const entities = patch.proposedEntityChanges.length
    ? `<h3>Entity changes</h3><ul>${patch.proposedEntityChanges
        .map(
          (entity) =>
            `<li>${escapeHtml(entity.name)} <code>${escapeHtml(entity.entityType)}</code> <em>${Math.round(entity.confidence * 100)}% confidence</em></li>`,
        )
        .join("")}</ul>`
    : "";

  const followUps = patch.proposedFollowUpChanges.length
    ? `<h3>Follow-ups</h3><ul>${patch.proposedFollowUpChanges
        .map(
          (followUp) =>
            `<li><strong>${escapeHtml(followUp.priority)}</strong> ${escapeHtml(followUp.action)}</li>`,
        )
        .join("")}</ul>`
    : "";

  const edges = patch.proposedEdgeChanges.length
    ? `<h3>Relation proposals</h3><ul>${patch.proposedEdgeChanges
        .map(
          (edge) =>
            `<li><code>${escapeHtml(edge.edgeType)}</code> ${escapeHtml(edge.fromKey)} -> ${escapeHtml(edge.toKey)}: ${escapeHtml(edge.explanation)}</li>`,
        )
        .join("")}</ul>`
    : "";

  const claims = patch.proposedClaimChanges.map(claimBlockHtml).join("");

  const trace = patch.runTrace.length
    ? `<h3>Run trace</h3><ol>${patch.runTrace
        .map((step) => `<li><strong>${escapeHtml(step.label)}:</strong> ${escapeHtml(step.detail)}</li>`)
        .join("")}</ol>`
    : "";

  return `
    <hr/>
    <h2>Notebook action: ${escapeHtml(patch.summary)}</h2>
    ${patch.requiresConfirmation ? "<p><em>Accepted through the notebook action mutation; high-risk graph changes stay reviewable in memory.</em></p>" : ""}
    ${blocks}
    ${entities}
    ${claims}
    ${followUps}
    ${edges}
    ${trace}
  `;
}

export function buildNotebookActionMutationPatch(patch: NotebookActionPatch) {
  return {
    actionId: patch.actionId,
    action: patch.action,
    summary: patch.summary,
    proposedEntityChanges: patch.proposedEntityChanges,
    proposedClaimChanges: patch.proposedClaimChanges,
    proposedFollowUpChanges: patch.proposedFollowUpChanges,
    proposedEdgeChanges: patch.proposedEdgeChanges,
    requiresConfirmation: patch.requiresConfirmation,
    runTrace: patch.runTrace,
  };
}

function ContextCard({
  label,
  title,
  children,
  className,
}: {
  label: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-black/[0.06] bg-white p-4 shadow-sm", className)}>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
        {label}
      </div>
      <h2 className="mt-2 text-base font-semibold text-gray-950">{title}</h2>
      {children}
    </section>
  );
}

export function ReportNotebookDetail() {
  const location = useLocation();
  const reportId = getReportNotebookIdFromPath(location.pathname) ?? "new";
  const starterWorkspace = getStarterEntityWorkspace(reportId);
  const convex = useConvex();

  // Fetch real saved report - try authed `getReport`, fall back to public.
  // Convex IDs follow a predictable opaque-string shape; starter ids are
  // human-readable slugs ("starter-market"), so skip the fetch for those.
  const looksLikeConvexId = !starterWorkspace && reportId !== "new" && /^[a-z0-9]{20,}$/i.test(reportId);

  const api = useConvexApi();
  const ownReport = useQuery(
    looksLikeConvexId && (api?.domains?.product?.reports as any)?.getReport
      ? (api.domains.product.reports as any).getReport
      : "skip",
    looksLikeConvexId
      ? {
          reportId: reportId as any,
          anonymousSessionId: getAnonymousProductSessionId(),
        }
      : "skip",
  ) as SavedReportSnapshot | null | undefined;

  const publicReport = useQuery(
    looksLikeConvexId && ownReport === null && (api?.domains?.product?.reports as any)?.getPublicReport
      ? (api.domains.product.reports as any).getPublicReport
      : "skip",
    looksLikeConvexId && ownReport === null ? { reportId } : "skip",
  ) as SavedReportSnapshot | null | undefined;

  const workspaceSnapshot = useQuery(
    looksLikeConvexId && (api?.domains?.product as any)?.eventWorkspace?.getSnapshot
      ? (api.domains.product as any).eventWorkspace.getSnapshot
      : "skip",
    looksLikeConvexId
      ? {
          workspaceId: reportId,
          anonymousSessionId: getAnonymousProductSessionId(),
        }
      : "skip",
  ) as ReportWorkspaceSnapshot | null | undefined;

  const savedReport = ownReport ?? publicReport ?? null;
  const isSavedReportLoading =
    looksLikeConvexId &&
    (ownReport === undefined || (ownReport === null && publicReport === undefined));

  const reportName = useMemo(() => {
    if (savedReport?.title?.trim()) return savedReport.title.trim();
    if (starterWorkspace?.entity.name) return starterWorkspace.entity.name;
    return titleizeReportId(reportId);
  }, [savedReport, starterWorkspace, reportId]);

  const summary =
    savedReport?.summary?.trim() ||
    starterWorkspace?.entity.summary ||
    "A lightweight report notebook for quick web edits before deeper workspace exploration.";

  const evidence = useMemo(() => {
    if (Array.isArray(savedReport?.sources) && savedReport.sources.length > 0) {
      return savedReport.sources
        .slice(0, 8)
        .map((source) => ({
          label:
            source.siteName ||
            source.label ||
            source.title ||
            source.domain ||
            source.href ||
            "Source",
          type: source.type || (source.domain ? "web" : "source"),
        }));
    }
    return starterWorkspace?.evidence ?? [];
  }, [savedReport, starterWorkspace]);

  // Live persistence: debounced save of notebook HTML to Convex. Only wired
  // when we have a real saved (owner-owned) report - public-shared reports
  // and starter fixtures stay read-only.
  const saveNotebookMutationRef =
    looksLikeConvexId && ownReport && (api?.domains?.product?.reports as any)?.saveReportNotebookHtml
      ? (api.domains.product.reports as any).saveReportNotebookHtml
      : null;
  const acceptNotebookActionMutationRef =
    (api?.domains?.product as any)?.eventWorkspace?.acceptNotebookActionPatch ?? null;
  const canPersistNotebook = Boolean(
    looksLikeConvexId &&
      ownReport &&
      saveNotebookMutationRef,
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(savedReport?.notebookHtml ?? "");
  const [persistState, setPersistState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [actionSeedText, setActionSeedText] = useState("");
  const [activeActionPatch, setActiveActionPatch] = useState<NotebookActionPatch | null>(null);
  const [appendRequest, setAppendRequest] = useState<{ id: string; html: string } | undefined>();
  const [acceptedPatchIds, setAcceptedPatchIds] = useState<string[]>([]);
  const [graphPersistState, setGraphPersistState] = useState<
    "idle" | "saving" | "saved" | "error" | "skipped"
  >("idle");
  const [graphPersistResult, setGraphPersistResult] = useState<NotebookGraphPersistResult | null>(null);

  useEffect(() => {
    lastSavedRef.current = savedReport?.notebookHtml ?? "";
  }, [savedReport?.notebookHtml]);

  useEffect(() => {
    setActionSeedText((current) => {
      if (current.trim()) return current;
      return `${reportName}: ${summary}`;
    });
  }, [reportName, summary]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const onEditorChange = useMemo(() => {
    if (!canPersistNotebook || !saveNotebookMutationRef) return undefined;
    return (html: string) => {
      if (html === lastSavedRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setPersistState("saving");
      saveTimerRef.current = setTimeout(() => {
        convex.mutation(saveNotebookMutationRef, {
          reportId,
          notebookHtml: html,
          anonymousSessionId: getAnonymousProductSessionId(),
        })
          .then(() => {
            lastSavedRef.current = html;
            setPersistState("saved");
          })
          .catch(() => {
            setPersistState("error");
          });
      }, 1200);
    };
  }, [canPersistNotebook, convex, reportId, saveNotebookMutationRef]);

  const workspaceNotebookUrl = buildWorkspaceUrl({ workspaceId: reportId, tab: "notebook" });
  const workspaceBriefUrl = buildWorkspaceUrl({ workspaceId: reportId, tab: "brief" });
  const workspaceSourcesUrl = buildWorkspaceUrl({ workspaceId: reportId, tab: "sources" });
  const notebookContent = useMemo(
    () => buildReportNotebookContent(starterWorkspace, reportName, savedReport),
    [reportName, starterWorkspace, savedReport],
  );
  const notebookActionContext = useMemo(
    () =>
      buildNotebookActionContext({
        reportId,
        reportName,
        summary,
        selectedText: actionSeedText,
        workspaceSnapshot,
        starterWorkspace,
      }),
    [actionSeedText, reportId, reportName, starterWorkspace, summary, workspaceSnapshot],
  );
  const runNotebookAction = (action: NotebookAction) => {
    setActiveActionPatch(createNotebookActionPatch(action, notebookActionContext));
    setGraphPersistState("idle");
    setGraphPersistResult(null);
  };
  const acceptNotebookActionPatch = () => {
    if (!activeActionPatch) return;
    const acceptanceId = `${activeActionPatch.actionId}.${Date.now()}`;
    setAppendRequest({
      id: acceptanceId,
      html: buildNotebookActionPatchHtml(activeActionPatch),
    });
    setAcceptedPatchIds((current) => [activeActionPatch.actionId, ...current].slice(0, 4));
    if (!acceptNotebookActionMutationRef) {
      setGraphPersistState("skipped");
      return;
    }
    setGraphPersistState("saving");
    const mutationArgs = {
      workspaceId: reportId,
      ...(looksLikeConvexId ? { reportId: reportId as any } : {}),
      reportTitle: reportName,
      anonymousSessionId: getAnonymousProductSessionId(),
      acceptanceId,
      patch: buildNotebookActionMutationPatch(activeActionPatch),
      captures: notebookActionContext.captures ?? [],
    };
    convex
      .mutation(acceptNotebookActionMutationRef, mutationArgs)
      .then((result) => {
        setGraphPersistResult((result ?? null) as NotebookGraphPersistResult | null);
        setGraphPersistState("saved");
      })
      .catch(() => {
        setGraphPersistState("error");
      });
  };

  const sectionsCount = useMemo(() => {
    if (Array.isArray(savedReport?.sections) && savedReport.sections.length > 0) {
      return savedReport.sections.length;
    }
    const truthSections = savedReport?.compiledAnswerV2?.truthSections;
    if (Array.isArray(truthSections) && truthSections.length > 0) {
      return truthSections.length;
    }
    return starterWorkspace?.latest?.sections.length ?? 1;
  }, [savedReport, starterWorkspace]);

  const liveMemoryStats = useMemo(
    () => [
      { label: "captures", value: workspaceSnapshot?.captures?.length ?? 0 },
      { label: "runs", value: workspaceSnapshot?.runRecords?.length ?? 0 },
      { label: "entities", value: workspaceSnapshot?.entities?.length ?? 0 },
      { label: "claims", value: workspaceSnapshot?.claims?.length ?? 0 },
    ],
    [workspaceSnapshot],
  );
  const liveMemoryStatus = workspaceSnapshot
    ? `${workspaceSnapshot.workspace?.source ?? "live"} Convex memory`
    : looksLikeConvexId
      ? "No live capture/run rows yet"
      : "Fixture preview only";
  const latestRun = workspaceSnapshot?.runRecords?.reduce<
    NonNullable<ReportWorkspaceSnapshot["runRecords"]>[number] | null
  >((latest, run) => {
    if (!latest) return run;
    return (run.updatedAt ?? 0) > (latest.updatedAt ?? 0) ? run : latest;
  }, null);

  if (isSavedReportLoading) {
    return (
      <div
        data-testid="report-notebook-detail"
        className="flex min-h-screen items-center justify-center bg-[#f6f4f0] text-gray-700"
      >
        <div className="rounded-lg border border-black/[0.06] bg-white px-6 py-4 text-sm shadow-sm">
          Loading report...
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="report-notebook-detail"
      className="min-h-screen bg-[#f6f4f0] text-gray-950"
    >
      <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/?surface=reports"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-black/[0.08] bg-white text-gray-600 transition hover:text-gray-950"
            aria-label="Back to Reports"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ad5f45]">
              Reports / Web Detail
            </div>
            <h1 className="truncate text-lg font-semibold tracking-[-0.01em]">
              {reportName}
            </h1>
          </div>
          <a
            href={workspaceNotebookUrl}
            className="ml-auto inline-flex items-center gap-2 rounded-md bg-[#d97757] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c66a4c]"
          >
            Open full workspace
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1240px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <div className="mb-4 rounded-lg border border-black/[0.06] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d97757]/25 bg-[#d97757]/10 px-2.5 py-1 font-medium text-[#ad5f45]">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Web report edit
              </span>
              <span>Quick memo cleanup without leaving nodebenchai.com.</span>
            </div>
          </div>

          <RichNotebookEditor
            initialContent={notebookContent}
            storageKey={`nodebench.report.${reportId}.notebook`}
            testId="report-notebook-editor"
            className="min-h-[560px] p-5"
            onChange={onEditorChange}
            appendRequest={appendRequest}
            reportId={reportId}
            footer={
              <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-gray-400">
                <span>
                  TipTap / StarterKit /{" "}
                  {canPersistNotebook
                    ? persistState === "saving"
                      ? "saving to Convex..."
                      : persistState === "saved"
                        ? "synced to Convex"
                        : persistState === "error"
                          ? "save failed / retry on next edit"
                          : "synced to Convex"
                    : "saved locally"}
                </span>
                <span>Full cards, sources, chat, and map stay in Workspace</span>
              </div>
            }
          />
        </section>

        <aside className="space-y-4">
          <ContextCard label="Report context" title={reportName}>
            <p className="mt-3 text-sm leading-6 text-gray-600">{summary}</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-black/[0.06] bg-[#f6f4f0] p-3">
                <div className="font-mono text-lg font-semibold">
                  {starterWorkspace?.entity.reportCount ?? 1}
                </div>
                <div className="mt-1 text-[11px] text-gray-500">briefs</div>
              </div>
              <div className="rounded-md border border-black/[0.06] bg-[#f6f4f0] p-3">
                <div className="font-mono text-lg font-semibold">{evidence.length}</div>
                <div className="mt-1 text-[11px] text-gray-500">sources</div>
              </div>
              <div className="rounded-md border border-black/[0.06] bg-[#f6f4f0] p-3">
                <div className="font-mono text-lg font-semibold">{sectionsCount}</div>
                <div className="mt-1 text-[11px] text-gray-500">sections</div>
              </div>
            </div>
          </ContextCard>

          <ContextCard label="Workspace handoff" title="Go deeper when needed">
            <div className="mt-4 space-y-2">
              {[
                { label: "Brief", icon: FileText, href: workspaceBriefUrl },
                { label: "Notebook", icon: BookOpen, href: workspaceNotebookUrl },
                { label: "Sources", icon: ShieldCheck, href: workspaceSourcesUrl },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    className="flex items-center justify-between rounded-md border border-black/[0.06] bg-[#f6f4f0] px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-[#d97757]/30 hover:text-[#ad5f45]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {item.label}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                );
              })}
            </div>
          </ContextCard>

          <ContextCard label="Executable notebook" title="Propose a safe patch">
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Actions read this report, live captures, and claim state. They produce a
              reviewable patch first; accepting writes into TipTap and the canonical
              workspace memory tables through one owner-scoped mutation.
            </p>
            <label className="mt-4 block text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">
              Action context
            </label>
            <textarea
              data-testid="notebook-action-context"
              value={actionSeedText}
              onChange={(event) => setActionSeedText(event.target.value)}
              className="mt-2 min-h-24 w-full resize-y rounded-md border border-black/[0.08] bg-[#f6f4f0] px-3 py-2 text-sm leading-6 text-gray-700 outline-none transition focus:border-[#d97757]/45 focus:bg-white"
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              {NOTEBOOK_ACTIONS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.action}
                    type="button"
                    onClick={() => runNotebookAction(item.action)}
                    className="min-h-20 rounded-md border border-black/[0.06] bg-[#f6f4f0] px-3 py-2 text-left text-sm transition hover:border-[#d97757]/35 hover:bg-white"
                  >
                    <span className="flex items-center gap-2 font-semibold text-gray-950">
                      <Icon className="h-4 w-4 text-[#ad5f45]" aria-hidden="true" />
                      {item.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500">
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </div>
            {activeActionPatch ? (
              <div
                data-testid="notebook-action-patch-preview"
                className="mt-4 border-t border-black/[0.06] pt-4"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#d97757]/10 text-[#ad5f45]">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-950">
                      {activeActionPatch.summary}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-gray-500">
                      {activeActionPatch.proposedBlockChanges.length} blocks /{" "}
                      {activeActionPatch.proposedEntityChanges.length} entities /{" "}
                      {activeActionPatch.proposedClaimChanges.length} claim changes /{" "}
                      {activeActionPatch.proposedFollowUpChanges.length} follow-ups
                    </div>
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-xs leading-5 text-gray-600">
                  {activeActionPatch.runTrace.slice(0, 3).map((step) => (
                    <div key={`${activeActionPatch.actionId}-${step.label}`} className="flex gap-2">
                      <span className="font-semibold text-gray-900">{step.label}:</span>
                      <span>{step.detail}</span>
                    </div>
                  ))}
                </div>
                {activeActionPatch.requiresConfirmation ? (
                  <div className="mt-3 rounded-md border border-[#d97757]/20 bg-[#d97757]/10 px-3 py-2 text-xs leading-5 text-[#8f4f3a]">
                    This action stays reviewable: the accepted patch is written as notebook
                    HTML plus bounded workspace memory rows, not uncontrolled graph CRUD.
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={acceptNotebookActionPatch}
                    className="inline-flex items-center gap-2 rounded-md bg-[#d97757] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c66a4c]"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Accept into notebook
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveActionPatch(null)}
                    className="inline-flex items-center gap-2 rounded-md border border-black/[0.08] bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:text-gray-950"
                  >
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Dismiss
                  </button>
                </div>
                {acceptedPatchIds.includes(activeActionPatch.actionId) ? (
                  <div
                    data-testid="notebook-action-persistence-status"
                    className="mt-3 text-xs font-medium text-emerald-700"
                  >
                    Latest accepted patch inserted into the editor.
                    {graphPersistState === "saving" ? " Saving canonical memory..." : null}
                    {graphPersistState === "saved" ? (
                      <>
                        {" "}
                        Canonical memory saved: {graphPersistResult?.entityCount ?? 0} entities,{" "}
                        {graphPersistResult?.claimCount ?? 0} claims,{" "}
                        {graphPersistResult?.followUpCount ?? 0} follow-ups,{" "}
                        {graphPersistResult?.captureCount ?? 0} captures.
                      </>
                    ) : null}
                    {graphPersistState === "skipped"
                      ? " Canonical memory skipped because the mutation was not available."
                      : null}
                    {graphPersistState === "error"
                      ? " Canonical memory save failed; notebook HTML is still inserted."
                      : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-black/[0.1] px-3 py-3 text-xs leading-5 text-gray-500">
                Run an action to review proposed sections, entities, claims, follow-ups,
                and trace before anything is inserted.
              </div>
            )}
          </ContextCard>

          <ContextCard label="Live memory" title="Capture and run persistence">
            <p className="mt-3 text-sm leading-6 text-gray-600">
              This web report reads the saved report row and, when present, the same
              Convex event workspace tables that power live captures and agent runs.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {liveMemoryStats.map((item) => (
                <div
                  key={item.label}
                  className="rounded-md border border-black/[0.06] bg-[#f6f4f0] p-3"
                >
                  <div className="font-mono text-lg font-semibold">{item.value}</div>
                  <div className="mt-1 text-[11px] text-gray-500">{item.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-black/[0.06] bg-white px-3 py-2 text-xs leading-5 text-gray-600">
              <div className="font-semibold text-gray-900">{liveMemoryStatus}</div>
              <div>
                Latest run:{" "}
                {latestRun ? `${latestRun.status ?? "unknown"} / ${latestRun.source ?? "run"}` : "none"}
              </div>
            </div>
          </ContextCard>

          <ContextCard label="Evidence" title="Attached sources">
            <div className="mt-3 space-y-2">
              {(evidence.length > 0 ? evidence : [{ label: "No sources attached yet", type: "empty" }]).map(
                (source) => (
                  <div
                    key={`${source.label}-${source.type}`}
                    className="rounded-md border border-black/[0.06] bg-[#f6f4f0] p-3"
                  >
                    <div className="flex items-start gap-2">
                      <Layers3 className="mt-0.5 h-3.5 w-3.5 text-[#ad5f45]" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">
                          {source.label}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">{source.type}</div>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </ContextCard>
        </aside>
      </main>
    </div>
  );
}

export default ReportNotebookDetail;
