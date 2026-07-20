/**
 * ReportNotebookView — full report-as-notebook surface.
 *
 * Wires three writers to a single TipTap document:
 *   1. The user editing inline
 *   2. Chat (panel on the right) — answers append a block to the notebook
 *   3. Agents (queued patches the user accepts) — run autonomously, write claims
 *
 * Architecture demonstrated here:
 *
 *   Convex `reports.notebookHtml` ──┐
 *                                    ├─► <ReportNotebookEditor />  (TipTap)
 *   Chat thread (this report) ──────┤        ▲
 *   Agent runtime (this report) ────┘        │
 *                                            │ applyChatPatch / applyAgentPatch
 *                                       imperative refs
 *
 * Production notes:
 *   - Persistence: `editor.getHTML()` is debounced into Convex via a `useMutation`
 *   - Read-only public mode is a flag on the report doc (`reports.publicShare`)
 *   - Chat → notebook: when `chatThread.messages.last.role === 'assistant'` and the
 *     user clicks "Save to notebook", the rendered answer HTML is wrapped in a
 *     <div data-block="chat-turn"> and applied via `applyChatPatch`
 *   - Agent → notebook: a Convex action publishes a `notebookPatch` event; the
 *     client subscribes and queues the patch in the audit feed for accept/reject
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useConvex, useQuery } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { ReportNotebookEditor, NotebookSaveStatePill, type ReportNotebookEditorHandle, type NotebookPatch, type SaveState } from "./ReportNotebookEditor";
import { Pill } from "./Pill";
import { showToast } from "./Toast";
import type { LiveArtifactDetail } from "../hooks/useLiveArtifacts";

interface ReportNotebookViewProps {
  reportId: string;
  /** Show the right-side audit + agent feed. Default true on standalone route. */
  showSidebar?: boolean;
  /** Hide the workspace breadcrumb header (used when embedded in WorkspaceSurface). */
  embedded?: boolean;
  /** Full live artifact payload for daily briefs, archive rows, and production runs. */
  liveDetail?: LiveArtifactDetail;
}

const LIVE_LOADING_TITLE = "Preparing live artifact";
const WORKSPACE_DRAFT_TITLE = "Workspace draft";
const EMPTY_NOTEBOOK_HTML =
  "<h1>Workspace draft</h1><p>Select a live report, promote an artifact, or start writing the analyst notebook here.</p>";

/** Cmd/Ctrl + \\ toggles distraction-free mode (Karpathy-flow).
 *  Initial state honors `?focus=zen` URL param so deep links + persona QA can land in writing mode.
 *  Side-effect: tags <body> with `data-redesign-focus-mode="on"` so the left rail can collapse via CSS. */
function useZenMode(): { zen: boolean; toggle: () => void } {
  const [zen, setZen] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("focus") === "zen";
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setZen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-redesign-focus-mode", zen ? "on" : "off");
    return () => { document.body.setAttribute("data-redesign-focus-mode", "off"); };
  }, [zen]);
  return { zen, toggle: () => setZen((v) => !v) };
}

interface AuditEntry {
  source: NotebookPatch["source"];
  label: string;
  at: number;
}

interface PendingPatch {
  id: string;
  source: NotebookPatch["source"];
  label: string;
  preview: string;
  patch: NotebookPatch;
}

function liveIcon(kind?: string): string {
  if (!kind) return "📝";
  if (/daily/i.test(kind)) return "🗞";
  if (/funding|deal/i.test(kind)) return "📈";
  if (/fda|regulatory/i.test(kind)) return "⚕️";
  return "🧠";
}

function isLiveArtifactReportId(id: string): boolean {
  return /^(daily|li|run)_/.test(id);
}

function buildLiveAudit(detail?: LiveArtifactDetail, loadingLiveArtifact = false): AuditEntry[] {
  if (loadingLiveArtifact) {
    return [
      { source: "agent", label: "Waiting for live artifact hydration before showing notebook activity", at: Date.now() },
    ];
  }
  if (!detail) {
    return [
      { source: "user", label: "Created report notebook", at: Date.now() - 3600_000 * 3 },
      { source: "agent", label: "Imported a source-backed claim", at: Date.now() - 1800_000 },
      { source: "user", label: "Marked a weak claim as needs-review", at: Date.now() - 720_000 },
    ];
  }
  return [
    { source: "agent", label: `Hydrated ${detail.kind} from saved artifact`, at: detail.updatedAtMs },
    { source: "agent", label: `Attached ${detail.sourceCount} source references`, at: detail.updatedAtMs + 1 },
    { source: "user", label: `Opened ${detail.title} for notebook review`, at: Date.now() },
  ];
}

function buildLivePatches(detail?: LiveArtifactDetail, loadingLiveArtifact = false): PendingPatch[] {
  if (loadingLiveArtifact) return [];
  if (!detail) {
    return [
      {
        id: "p1",
        source: "agent",
        label: "Agent: refresh the strongest source-backed claim?",
        preview: "Adds a new reviewable claim from the latest attached source row.",
        patch: {
          source: "agent",
          label: "Refreshed claim",
          html: `<div data-block="claim" data-status="review"><span data-claim-label>Claim · agent · needs review</span><p>Latest artifact signal needs a stronger source before verification.</p><span data-claim-source>Source refresh · pending review</span></div>`,
        },
      },
    ];
  }
  const firstRow = detail.sourceRows[0];
  return [
    {
      id: `${detail.id}-promote`,
      source: "agent",
      label: `Agent: promote strongest ${detail.kind} signal?`,
      preview: firstRow
        ? `Adds a reviewed claim from "${firstRow.title}" with ${firstRow.reused} source references.`
        : `Adds the strongest ${detail.kind} signal as a reviewable claim block.`,
      patch: {
        source: "agent",
        label: `${detail.kind} claim`,
        html: `<div data-block="claim" data-status="${detail.status === "verified" ? "verified" : "review"}"><span data-claim-label>${detail.kind} · live artifact</span><p>${detail.summary}</p><span data-claim-source>${detail.sourceCount} sources · refreshed ${detail.updatedAt}</span></div>`,
      },
    },
  ];
}

export function ReportNotebookView({ reportId, showSidebar = true, embedded = false, liveDetail }: ReportNotebookViewProps) {
  const navigate = useNavigate();
  const convex = useConvex();
  const api = useConvexApi();
  const looksLikeConvexId = /^[a-z0-9]{20,}$/i.test(reportId);
  const getReportRef = looksLikeConvexId ? (api?.domains?.product?.reports as any)?.getReport : null;
  const ownReport = useQuery(
    getReportRef ?? "skip",
    getReportRef
      ? {
          anonymousSessionId: getAnonymousProductSessionId(),
          reportId: reportId as any,
        }
      : "skip",
  ) as { notebookHtml?: string; title?: string; summary?: string; sources?: unknown[]; claimIds?: unknown[] } | null | undefined;
  const saveNotebookMutationRef =
    looksLikeConvexId && ownReport && (api?.domains?.product?.reports as any)?.saveReportNotebookHtml
      ? (api.domains.product.reports as any).saveReportNotebookHtml
      : null;
  const canPersistNotebook = Boolean(saveNotebookMutationRef && ownReport);
  const isLiveArtifactId = isLiveArtifactReportId(reportId);
  const waitingForLiveArtifact = Boolean(isLiveArtifactId && !liveDetail);
  const editorRef = useRef<ReportNotebookEditorHandle>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedHtmlRef = useRef("");
  const [readOnly, setReadOnly] = useState(false);
  const { zen, toggle: toggleZen } = useZenMode();
  const sidebarVisible = showSidebar && !zen;
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [audit, setAudit] = useState<AuditEntry[]>(() => buildLiveAudit(liveDetail, waitingForLiveArtifact));
  const [pendingPatches, setPendingPatches] = useState<PendingPatch[]>(() =>
    buildLivePatches(liveDetail, waitingForLiveArtifact),
  );

  const initialHtml =
    ownReport?.notebookHtml ??
    liveDetail?.notebookHtml ??
    (isLiveArtifactId ? "<p>Preparing live artifact...</p>" : EMPTY_NOTEBOOK_HTML);
  const [pageIcon, setPageIcon] = useState<string>(liveIcon(liveDetail?.kind));
  const [pageTitle, setPageTitle] = useState<string>(
    ownReport?.title ?? liveDetail?.title ?? (isLiveArtifactId ? LIVE_LOADING_TITLE : WORKSPACE_DRAFT_TITLE),
  );

  useEffect(() => {
    lastSavedHtmlRef.current = ownReport?.notebookHtml ?? "";
  }, [ownReport?.notebookHtml]);

  useEffect(() => {
    if (!ownReport?.title) return;
    setPageTitle((current) => current === WORKSPACE_DRAFT_TITLE || current === LIVE_LOADING_TITLE ? ownReport.title ?? current : current);
  }, [ownReport?.title]);

  useEffect(() => {
    if (!liveDetail) return;
    setPageIcon(liveIcon(liveDetail.kind));
    setPageTitle((current) =>
      current === WORKSPACE_DRAFT_TITLE || current === LIVE_LOADING_TITLE
        ? liveDetail.title
        : current,
    );
    setAudit(buildLiveAudit(liveDetail));
    setPendingPatches(buildLivePatches(liveDetail));
  }, [liveDetail]);

  useEffect(() => {
    if (!waitingForLiveArtifact) return;
    setAudit(buildLiveAudit(undefined, true));
    setPendingPatches([]);
  }, [waitingForLiveArtifact]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleAuditEntry = useCallback((entry: AuditEntry) => {
    setAudit((a) => [entry, ...a].slice(0, 8));
  }, []);

  const handleNotebookChange = useCallback((html: string) => {
    if (!canPersistNotebook || !saveNotebookMutationRef) return;
    if (html === lastSavedHtmlRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveState("saving");
    saveTimerRef.current = window.setTimeout(() => {
      convex.mutation(saveNotebookMutationRef, {
        anonymousSessionId: getAnonymousProductSessionId(),
        notebookHtml: html,
        reportId: reportId as any,
      })
        .then(() => {
          lastSavedHtmlRef.current = html;
          setSaveState("saved");
        })
        .catch(() => {
          setSaveState("saved");
          showToast({
            tone: "warning",
            message: "Notebook edited locally. Saved sync could not confirm for this report.",
          });
        });
    }, 900);
  }, [canPersistNotebook, convex, reportId, saveNotebookMutationRef]);

  const acceptPatch = (id: string) => {
    const p = pendingPatches.find((x) => x.id === id);
    if (!p) return;
    if (p.source === "agent") editorRef.current?.applyAgentPatch(p.patch);
    else editorRef.current?.applyChatPatch(p.patch);
    setPendingPatches((q) => q.filter((x) => x.id !== id));
  };

  const rejectPatch = (id: string) => {
    setPendingPatches((q) => q.filter((x) => x.id !== id));
    const rejected = pendingPatches.find((x) => x.id === id);
    if (rejected) {
      handleAuditEntry({ source: "user", label: `Rejected: ${rejected.label}`, at: Date.now() });
    }
  };

  // Local interaction stub: mirrors saving an agent answer into the notebook.
  const simulateChatPatch = () => {
    const note = liveDetail
      ? liveDetail.primaryAction
      : "Write the next action here, then attach the supporting source before exporting.";
    editorRef.current?.applyChatPatch({
      source: "chat",
      label: `Chat: appended note for ${pageTitle}`,
      html: `<h3>Chat ${new Date().toLocaleTimeString()}</h3><blockquote>${escapeInlineHtml(note)}</blockquote><p>From the agent's last answer in this thread.</p>`,
    });
  };

  // Local interaction stub: mirrors an agent-suggested source-backed claim.
  const simulateAgentPatch = () => {
    const source = liveDetail?.sourceRows[0];
    const body = liveDetail
      ? liveDetail.summary
      : "A refreshed source should support one concrete claim before this notebook is marked verified.";
    const sourceLabel = source
      ? `${source.title} - refreshed ${source.refreshed}`
      : "Source refresh - attach evidence before verification";
    editorRef.current?.applyAgentPatch({
      source: "agent",
      label: `Agent: refreshed source - ${source?.title ?? "source review"}`,
      html: `<div data-block="claim" data-status="verified"><span data-claim-label>Claim - agent</span><p>${escapeInlineHtml(body)}</p><span data-claim-source>${escapeInlineHtml(sourceLabel)}</span></div>`,
    });
  };

  const insertNotebookBlock = useCallback((label: string, html: string, toastMessage?: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) {
      showToast({ tone: "warning", message: "Notebook editor is still loading." });
      return;
    }
    if (readOnly) {
      setReadOnly(false);
      editor.setEditable(true);
    }
    editor.chain().focus("end").insertContent(html).run();
    setSaveState("saving");
    window.setTimeout(() => setSaveState("saved"), 600);
    handleAuditEntry({ source: "user", label, at: Date.now() });
    showToast({ tone: "success", message: toastMessage ?? label });
  }, [handleAuditEntry, readOnly]);

  const copyShareLink = useCallback(() => {
    const href = typeof window !== "undefined" ? window.location.href : `/redesign/reports/${reportId}`;
    void navigator.clipboard?.writeText(href);
    showToast({ tone: "success", message: "Report link copied." });
  }, [reportId]);

  const exportNotebook = useCallback(() => {
    const html = editorRef.current?.getHtml() ?? initialHtml;
    const safeTitle = pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "nodebench-report";
    const body = `<!doctype html><meta charset="utf-8"><title>${pageTitle}</title><h1>${pageTitle}</h1>${html}`;
    const blob = new Blob([body], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}.html`;
    link.click();
    URL.revokeObjectURL(url);
    showToast({ tone: "success", message: "Notebook export started." });
    handleAuditEntry({ source: "user", label: "Exported notebook HTML", at: Date.now() });
  }, [handleAuditEntry, initialHtml, pageTitle]);

  const refreshSources = useCallback(() => {
    simulateAgentPatch();
    showToast({ tone: "info", message: "Source refresh added a verified claim block." });
  }, []);

  const addCover = useCallback(() => {
    insertNotebookBlock(
      "Added report cover block",
      '<div data-block="cover"><p><strong>Cover summary</strong></p><p>Write the one-paragraph analyst read before exporting or sharing this report.</p></div><p></p>',
      "Cover block added."
    );
  }, [insertNotebookBlock]);

  const addComment = useCallback(() => {
    insertNotebookBlock(
      "Added comment block",
      '<blockquote data-block="comment"><p>Comment: capture the reviewer note or manager feedback here.</p></blockquote><p></p>',
      "Comment block added."
    );
  }, [insertNotebookBlock]);

  const addClaim = useCallback(() => {
    insertNotebookBlock(
      "Added claim block",
      '<div data-block="claim" data-status="review"><span data-claim-label>Claim - needs review</span><p>State the claim here.</p><span data-claim-source>Attach a source before marking verified.</span></div><p></p>',
      "Claim block added."
    );
  }, [insertNotebookBlock]);

  const addFollowUp = useCallback(() => {
    insertNotebookBlock(
      "Added follow-up block",
      '<div data-block="follow-up" data-due="this-week"><p>What is the next action?</p></div><p></p>',
      "Follow-up block added."
    );
  }, [insertNotebookBlock]);

  const addSource = useCallback(() => {
    insertNotebookBlock(
      "Added source block",
      '<div data-block="source-list"><ol><li>New source - refreshed today</li></ol></div><p></p>',
      "Source block added."
    );
  }, [insertNotebookBlock]);

  const propertyStatus = liveDetail?.status ?? (ownReport ? "verified" : "review");
  const propertyKind = liveDetail?.kind ?? (ownReport ? "Report" : "Draft");
  const propertySources = liveDetail?.sourceCount ?? ownReport?.sources?.length ?? 0;
  const propertyClaims = liveDetail?.claimCount ?? ownReport?.claimIds?.length ?? 0;
  const propertyFollowUps = liveDetail?.followUps ?? 0;
  const propertyUpdated = liveDetail?.updatedAt ?? "workspace draft";
  const linkedTags = liveDetail?.tags?.length
    ? liveDetail.tags.slice(0, 6)
    : ["Live memory", "Claim evidence", "Review queue", "Source trail"];

  return (
    <div
      className="rd-stack"
      data-focus-mode={zen ? "on" : "off"}
      style={{
        height: "100%",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: sidebarVisible ? "minmax(0, 1fr) 272px" : "minmax(0, 1fr)",
        gap: 14,
        padding: embedded ? 0 : "20px 24px 24px",
        transition: "grid-template-columns 200ms ease",
      }}
    >
      <main className="rd-stack" style={{ minWidth: 0, gap: 0, height: "100%", overflow: "hidden", background: "var(--rd-panel)", borderRadius: "var(--rd-r-lg)", border: "1px solid var(--rd-line)" }}>
        {!embedded && (
          <div className="rd-row--between" style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--rd-line-faint)",
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            position: "sticky", top: 0, zIndex: 5,
          }}>
            <div className="rd-row" style={{ gap: 8 }}>
              <button
                className="rd-btn rd-btn--quiet rd-btn--sm"
                onClick={() => navigate("/redesign/reports")}
                style={{ padding: "4px 10px" }}
              >← Reports</button>
              <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{pageTitle}</span>
            </div>
            <div className="rd-row" style={{ gap: 6 }}>
              <NotebookSaveStatePill state={saveState} readOnly={readOnly} />
              <button
                className="rd-btn rd-btn--quiet rd-btn--sm"
                onClick={() => editorRef.current?.editor?.chain().focus().undo().run()}
                title="Undo (⌘Z)"
                aria-label="Undo"
                style={{ padding: "5px 8px" }}
              >
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7" />
                </svg>
              </button>
              <button
                className="rd-btn rd-btn--quiet rd-btn--sm"
                onClick={() => editorRef.current?.editor?.chain().focus().redo().run()}
                title="Redo (⌘⇧Z)"
                aria-label="Redo"
                style={{ padding: "5px 8px" }}
              >
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7" />
                </svg>
              </button>
              <button
                type="button"
                className="rd-btn rd-btn--quiet rd-btn--sm"
                onClick={() => navigate(`/redesign/workspace?report=${encodeURIComponent(reportId)}&tab=map`)}
                title="Open relationship graph"
                data-workspace-tab-target="map"
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 4 }}>
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="4" cy="5" r="2" />
                  <circle cx="20" cy="5" r="2" />
                  <circle cx="4" cy="19" r="2" />
                  <circle cx="20" cy="19" r="2" />
                  <path d="M9.6 10.4 5.4 6.4M14.4 10.4l4.2-4M9.6 13.6l-4.2 4M14.4 13.6l4.2 4" />
                </svg>
                Map
              </button>
              <button
                className="rd-btn rd-btn--quiet rd-btn--sm"
                onClick={toggleZen}
                aria-pressed={zen}
                title="Distraction-free mode (⌘\\)"
              >
                {zen ? "Exit focus" : "Focus"}
              </button>
              <button
                className="rd-btn rd-btn--quiet rd-btn--sm"
                onClick={() => setReadOnly((v) => !v)}
                aria-pressed={readOnly}
              >
                {readOnly ? "Switch to edit" : "Public read-only"}
              </button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={copyShareLink}>Share link</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={exportNotebook}>Export</button>
              <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={refreshSources}>Refresh sources</button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {/* Notion-style page chrome — ultra-compact: single row + meta pills */}
          <div className="rd-page-chrome" style={{ padding: "12px 96px 0" }}>
            <div className="rd-page-chrome__row">
              <button
                className="rd-page-chrome__icon"
                onClick={() => setPageIcon(prev => randomEmoji(prev))}
                aria-label="Change icon"
              >{pageIcon}</button>
              <h1
                className="rd-page-chrome__title"
                contentEditable={!readOnly}
                suppressContentEditableWarning
                spellCheck
                onBlur={(e) => setPageTitle(e.currentTarget.textContent ?? pageTitle)}
                role="textbox"
                aria-label="Report title"
              >{pageTitle}</h1>
              <span className="rd-style-chip" title="Style that produced this report — click to swap (coming soon)">
                Banker lens v3
              </span>
            </div>

            {/* Notion / Obsidian frontmatter — CRM-mappable key/value pairs */}
            <div className="rd-page-chrome__props" role="list" aria-label="Report properties">
              <div className="rd-page-chrome__prop" role="listitem">
                <span className="rd-page-chrome__prop-key">Status</span>
                <span className="rd-page-chrome__prop-val">
                  <Pill tone={propertyStatus === "verified" ? "green" : propertyStatus === "watching" ? "blue" : "amber"}>
                    {propertyStatus === "review" ? "Needs review" : propertyStatus === "watching" ? "Watching" : "Verified"}
                  </Pill>
                </span>
              </div>
              <div className="rd-page-chrome__prop" role="listitem">
                <span className="rd-page-chrome__prop-key">Type</span>
                <span className="rd-page-chrome__prop-val"><strong>{propertyKind}</strong></span>
              </div>
              <div className="rd-page-chrome__prop" role="listitem">
                <span className="rd-page-chrome__prop-key">Sources</span>
                <span className="rd-page-chrome__prop-val"><strong>{propertySources}</strong> - refreshed {liveDetail?.updatedAt ?? "2h ago"}</span>
              </div>
              <div className="rd-page-chrome__prop" role="listitem">
                <span className="rd-page-chrome__prop-key">Claims</span>
                <span className="rd-page-chrome__prop-val"><strong>{propertyClaims}</strong></span>
              </div>
              <div className="rd-page-chrome__prop" role="listitem">
                <span className="rd-page-chrome__prop-key">Follow-ups</span>
                <span className="rd-page-chrome__prop-val"><strong>{propertyFollowUps}</strong></span>
              </div>
              <div className="rd-page-chrome__prop" role="listitem">
                <span className="rd-page-chrome__prop-key">Updated</span>
                <span className="rd-page-chrome__prop-val rd-page-chrome__meta-mono">{propertyUpdated}</span>
              </div>
              <div className="rd-page-chrome__prop" role="listitem">
                <span className="rd-page-chrome__prop-key">Sync</span>
                <span className="rd-page-chrome__prop-val rd-page-chrome__meta-mono">
                  {canPersistNotebook ? "Synced notebook" : liveDetail ? "live artifact draft" : "workspace draft"}
                </span>
              </div>
              <div className="rd-page-chrome__prop rd-page-chrome__prop--wide" role="listitem">
                <span className="rd-page-chrome__prop-key">Linked</span>
                <span className="rd-page-chrome__prop-val">
                  {linkedTags.map((tag, index) => (
                    <a key={`${tag}-${index}`} className="rd-entity-link" href="#" data-entity={tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}>{tag}</a>
                  ))}
                </span>
              </div>
            </div>

            <div className="rd-page-chrome__addons" aria-hidden={false}>
              <button type="button" onClick={() => setPageIcon(prev => randomEmoji(prev))}>Change icon</button>
              <button type="button" onClick={addCover}>Add cover</button>
              <button type="button" onClick={addComment}>Add comment</button>
              <button type="button" onClick={addClaim}>+ Claim</button>
              <button type="button" onClick={addFollowUp}>+ Follow-up</button>
              <button type="button" onClick={addSource}>+ Source</button>
            </div>
          </div>

          <div className="rd-notebook-divider" role="separator" aria-label="Notebook body begins">
            <span className="rd-notebook-divider__label">TipTap notebook</span>
            <span className="rd-notebook-divider__line" aria-hidden="true" />
            <span className="rd-notebook-divider__hint">Editable report body below</span>
          </div>

          {/* TipTap editor surface — page chrome owns the spacing above */}
          <div>
            <ReportNotebookEditor
              key={`${reportId}:${liveDetail?.updatedAtMs ?? ownReport?.title ?? "static"}`}
              ref={editorRef}
              initialHtml={initialHtml}
              readOnly={readOnly}
              onChange={handleNotebookChange}
              onAuditEntry={handleAuditEntry}
              onSaveStateChange={canPersistNotebook ? setSaveState : undefined}
            />
          </div>
        </div>
      </main>

      {sidebarVisible && (
        <>
          {/* Sidebar collapse chevron — explicit visual affordance for ⌘\ Focus mode */}
          <button
            type="button"
            onClick={toggleZen}
            aria-label="Collapse sidebar"
            title="Collapse sidebar (⌘\\)"
            style={{
              position: "absolute",
              right: 308,
              top: 76,
              zIndex: 6,
              width: 22,
              height: 38,
              padding: 0,
              borderRadius: "8px 0 0 8px",
              border: "1px solid var(--rd-line)",
              borderRight: "none",
              background: "var(--rd-paper)",
              color: "var(--rd-ink-mute)",
              cursor: "pointer",
              boxShadow: "var(--rd-shadow-xs)",
            }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        <aside
          className="rd-stack"
          style={{
            gap: 12,
            overflow: "auto",
            paddingRight: 4,
          }}
        >
          {/* Pending patches (chat / agent edits awaiting user review) — quiet by default */}
          <section className="rd-card rd-card__pad-tight">
            <div className="rd-row--between">
              <div className="rd-eyebrow">Suggestions to review</div>
              <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{pendingPatches.length}</span>
            </div>
            {pendingPatches.length === 0 ? (
              <p className="rd-meta" style={{ marginTop: 8, fontSize: 12 }}>No pending agent or chat patches.</p>
            ) : (
              <ul className="rd-stack" style={{ gap: 8, listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                {pendingPatches.map((p) => (
                  <li key={p.id} className="rd-card rd-card__pad-tight" style={{ background: "var(--rd-panel)" }}>
                    <div className="rd-row" style={{ gap: 6, marginBottom: 4 }}>
                      <SourceBadge source={p.source} />
                      <strong style={{ fontSize: 12.5, color: "var(--rd-ink-strong)" }}>{p.label}</strong>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--rd-ink-mute)", margin: "4px 0" }}>{p.preview}</p>
                    <div className="rd-row" style={{ gap: 4, marginTop: 6 }}>
                      <button
                        className="rd-btn rd-btn--sm"
                        onClick={() => acceptPatch(p.id)}
                        style={{
                          background: "transparent",
                          color: "var(--rd-green)",
                          border: "1px solid color-mix(in srgb, var(--rd-green) 38%, transparent)",
                          fontWeight: 590,
                        }}
                      >✓ Accept</button>
                      <button
                        className="rd-btn rd-btn--sm"
                        onClick={() => rejectPatch(p.id)}
                        style={{
                          background: "var(--rd-paper)",
                          border: "1px solid var(--rd-line-strong)",
                          color: "var(--rd-ink-mute)",
                        }}
                      >Reject</button>
                      <button
                        className="rd-btn rd-btn--sm"
                        style={{
                          background: "var(--rd-paper)",
                          border: "1px solid var(--rd-line-strong)",
                          color: "var(--rd-ink-mute)",
                        }}
                      >Edit diff</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Demo controls — collapsed under a single overflow row to reduce chrome noise */}
          <details className="rd-card rd-card__pad-tight" style={{ background: "var(--rd-paper-warm)" }}>
            <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--rd-ink-soft)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700 }}>
              Try it ▸
            </summary>
            <p style={{ fontSize: 11.5, color: "var(--rd-ink-soft)", margin: "6px 0 8px" }}>
              See how chat answers and agents add to this report.
            </p>
            <div className="rd-row" style={{ gap: 4, flexWrap: "wrap" }}>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={simulateChatPatch}>
                Save chat answer
              </button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={simulateAgentPatch}>
                Add agent finding
              </button>
            </div>
          </details>

          {/* Audit feed */}
          <section className="rd-card rd-card__pad-tight">
            <div className="rd-eyebrow">Recent activity</div>
            <ul className="rd-stack" style={{ gap: 8, listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {audit.map((entry, i) => (
                <li key={i} className="rd-row" style={{ gap: 8, alignItems: "flex-start", fontSize: 12 }}>
                  <SourceBadge source={entry.source} />
                  <div className="rd-stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ color: "var(--rd-ink)", lineHeight: 1.4 }}>{entry.label}</span>
                    <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>
                      {timeAgo(entry.at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
        </>
      )}
      {!sidebarVisible && (
        <button
          type="button"
          onClick={toggleZen}
          aria-label="Expand sidebar"
          title="Show sidebar (⌘\\)"
          style={{
            position: "absolute",
            right: 12,
            top: 76,
            zIndex: 6,
            width: 22,
            height: 38,
            padding: 0,
            borderRadius: "8px 0 0 8px",
            border: "1px solid var(--rd-line)",
            borderRight: "none",
            background: "var(--rd-paper)",
            color: "var(--rd-ink-mute)",
            cursor: "pointer",
            boxShadow: "var(--rd-shadow-xs)",
          }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: NotebookPatch["source"] }) {
  const map: Record<NotebookPatch["source"], { label: string; bg: string; color: string }> = {
    user: { label: "you", bg: "var(--rd-muted)", color: "var(--rd-ink-mute)" },
    chat: { label: "chat", bg: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)" },
    agent: { label: "agent", bg: "var(--rd-blue-bg)", color: "var(--rd-blue)" },
  };
  const m = map[source];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 7px",
        borderRadius: 999,
        background: m.bg,
        color: m.color,
        fontFamily: "var(--rd-font-mono)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.04,
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >{m.label}</span>
  );
}

function PropIcon({ kind }: { kind: "status" | "kind" | "sources" | "claims" | "followups" | "people" }) {
  const map: Record<typeof kind, string> = {
    status: "M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zM9 12l2 2 4-4",
    kind: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
    sources: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    claims: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
    followups: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    people: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  };
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={map[kind]} />
    </svg>
  );
}

const ICON_OPTIONS = ["🏢", "🏛", "🎯", "🔬", "🎟", "📊", "🧭", "🗺", "🪐", "📡", "📈", "💡", "📝", "🪙"];
function randomEmoji(prev: string): string {
  const others = ICON_OPTIONS.filter((e) => e !== prev);
  return others[Math.floor(Math.random() * others.length)];
}

function escapeInlineHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  const m = Math.floor(delta / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
