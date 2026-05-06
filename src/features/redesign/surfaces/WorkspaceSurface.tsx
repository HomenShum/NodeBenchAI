/**
 * Workspace — the deep intelligence surface.
 *
 * Tabs: Brief · Cards · Notebook · Sources · Chat · Map.
 * Mounted at /redesign/workspace. Spec: separate deployed surface, not a sixth tab in main app.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConvex } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { Pill } from "../components/Pill";
import { ChatSurface } from "./ChatSurface";
import { ReportNotebookView } from "../components/ReportNotebookView";
import { showToast } from "../components/Toast";
import type { ReportCardData } from "../fixtures";
import {
  buildLiveArtifactNotebookHtml,
  useLiveArtifacts,
  type LiveArtifactDetail,
  type LiveArtifactMapNode,
} from "../hooks/useLiveArtifacts";

type Tab = "brief" | "cards" | "notebook" | "sources" | "chat" | "map";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "brief", label: "Brief", hint: "Read summary" },
  { id: "cards", label: "Cards", hint: "Graph traversal" },
  { id: "notebook", label: "Notebook", hint: "Editable artifact" },
  { id: "sources", label: "Sources", hint: "Verify claims" },
  { id: "chat", label: "Chat", hint: "Resume agent thread" },
  { id: "map", label: "Map", hint: "Wide-angle relationships" },
];

interface WorkspaceSurfaceProps {
  reportId?: string;
  initialTab?: Tab;
}

function isLiveArtifactReportId(id: string): boolean {
  return /^(daily|li|run)_/.test(id);
}

export function WorkspaceSurface({ reportId, initialTab = "brief" }: WorkspaceSurfaceProps) {
  const navigate = useNavigate();
  const convex = useConvex();
  const api = useConvexApi();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [promoting, setPromoting] = useState(false);
  const liveArtifacts = useLiveArtifacts(60);
  const selectedReportId = reportId ?? liveArtifacts.reports[0]?.id ?? "";
  const workspaceNeedsSelection = !selectedReportId;
  const selectedIsLiveArtifact = selectedReportId ? isLiveArtifactReportId(selectedReportId) : false;
  const liveReport = useMemo(
    () => liveArtifacts.reports.find((report) => report.id === selectedReportId),
    [liveArtifacts.reports, selectedReportId],
  );
  const liveDetail = useMemo(
    () => liveArtifacts.details.find((detail) => detail.id === selectedReportId),
    [liveArtifacts.details, selectedReportId],
  );
  const liveArtifactUnavailable = Boolean(selectedIsLiveArtifact && !liveDetail && !liveArtifacts.isLoading);
  const liveArtifactResolving = Boolean(selectedIsLiveArtifact && !liveDetail && liveArtifacts.isLoading);
  const workspaceTitle =
    liveDetail?.title ??
    liveReport?.entity ??
    (workspaceNeedsSelection
      ? "Loading live workspace"
      : liveArtifactResolving
        ? "Loading live artifact"
        : liveArtifactUnavailable
          ? "Live artifact unavailable"
          : "Workspace draft");
  const workspaceKind = liveDetail?.kind ?? liveReport?.kind ?? "Workspace";
  const workspaceSources = liveDetail?.sourceCount ?? liveReport?.sources ?? 0;
  const workspaceClaims = liveDetail?.claimCount ?? liveReport?.claims ?? 0;
  const workspaceFollowUps = liveDetail?.followUps ?? liveReport?.followUps ?? 0;
  const workspaceFreshness = liveDetail?.updatedAt ?? liveReport?.updatedAt ?? "awaiting live artifact";
  const createDraftReportRef = (api?.domains?.product?.reports as any)?.createDraftReport;
  const saveReportNotebookHtmlRef = (api?.domains?.product?.reports as any)?.saveReportNotebookHtml;
  const isPromotableLiveArtifact = Boolean(liveReport && selectedIsLiveArtifact);
  const canPromoteLiveArtifact = Boolean(isPromotableLiveArtifact && createDraftReportRef && saveReportNotebookHtmlRef);

  const promoteLiveArtifact = async () => {
    if (!liveReport) return;
    if (!canPromoteLiveArtifact) {
      showToast({
        tone: "info",
        message: "Report save controls are still connecting. Try again in a moment.",
      });
      return;
    }
    setPromoting(true);
    try {
      const anonymousSessionId = getAnonymousProductSessionId();
      const created = await convex.mutation(createDraftReportRef, {
        anonymousSessionId,
        title: liveReport.entity,
        summary: liveReport.description,
        query: liveReport.entity,
        type: liveReport.kind,
      });
      if (!created?.reportId) throw new Error("Missing report id");
      await convex.mutation(saveReportNotebookHtmlRef, {
        anonymousSessionId,
        reportId: created.reportId,
        notebookHtml: liveDetail ? buildLiveArtifactNotebookHtml(liveDetail) : buildPromotedLiveArtifactHtml(liveReport),
      });
      showToast({
        tone: "success",
        message: "Saved as an editable report notebook.",
      });
      navigate(`/redesign/reports/${created.reportId}`);
    } catch (error) {
      console.error("Failed to promote live artifact", error);
      showToast({
        tone: "warning",
        message: "Could not save this artifact yet. The live brief is still readable.",
      });
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="rd-stack" style={{ height: "100%", overflow: "hidden" }}>
      {/* Workspace header */}
      <header style={{
        padding: "16px 28px",
        borderBottom: "1px solid var(--rd-line-faint)",
        background: "var(--rd-paper)",
        flexShrink: 0,
      }}>
          <div className="rd-row" style={{ gap: 8 }}>
          <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
            REPORTS / {(selectedReportId || "LIVE").toUpperCase()}
          </span>
          <span style={{ color: "var(--rd-ink-faint)" }}>›</span>
          <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink)" }}>WORKSPACE</span>
        </div>

        <div className="rd-row--between" style={{ marginTop: 10 }}>
          <div className="rd-stack" style={{ gap: 6 }}>
            <h1 className="rd-h1" style={{ fontSize: 22 }}>{workspaceTitle}</h1>
            <div className="rd-row" style={{ gap: 8, fontSize: 11.5, color: "var(--rd-ink-soft)" }}>
              <Pill tone="green"><span className="rd-dot rd-dot--live" />Fresh · {workspaceFreshness}</Pill>
              <span>{workspaceSources} sources</span>
              <span>·</span>
              <span>{workspaceClaims} claims</span>
              <span>·</span>
              <span>{workspaceFollowUps} follow-ups</span>
              <span>·</span>
              <Pill tone="accent">{workspaceKind}</Pill>
            </div>
          </div>

          <div className="rd-row" style={{ gap: 6 }}>
            {isPromotableLiveArtifact && (
              <button
                className="rd-btn rd-btn--primary rd-btn--sm"
                disabled={promoting || !canPromoteLiveArtifact}
                onClick={promoteLiveArtifact}
              >
                {promoting ? "Saving..." : canPromoteLiveArtifact ? "Save report" : "Connecting..."}
              </button>
            )}
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => showToast({ tone: "success", message: "Workspace link copied." })}>Share</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => showToast({ tone: "success", message: "Export preview queued." })}>Export</button>
            <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={() => showToast({ tone: "info", message: "Refresh queued for this workspace." })}>Refresh</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ marginTop: 14 }}>
          <div className="rd-tabs" role="tablist" aria-label="Workspace tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                title={t.hint}
                className="rd-tab"
                onClick={() => setTab(t.id)}
              >{t.label}</button>
            ))}
          </div>
        </div>
      </header>

      {/* Active tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "var(--rd-paper-warm)" }}>
        {tab === "brief" && (
          (workspaceNeedsSelection || (selectedIsLiveArtifact && !liveDetail))
            ? <LiveArtifactPlaceholder loading={liveArtifacts.isLoading} reportId={selectedReportId} />
            : <BriefTab report={liveReport} detail={liveDetail} />
        )}
        {tab === "cards" && (
          liveDetail
            ? <LiveCardsTab detail={liveDetail} />
            : <LiveArtifactPlaceholder loading={liveArtifacts.isLoading} reportId={selectedReportId} />
        )}
        {tab === "notebook" && (
          (workspaceNeedsSelection || (selectedIsLiveArtifact && !liveDetail))
            ? <LiveArtifactPlaceholder loading={liveArtifacts.isLoading} reportId={selectedReportId} />
            : (
              <div style={{ height: "100%", padding: "16px 24px 24px" }}>
                <ReportNotebookView reportId={selectedReportId || "workspace-draft"} embedded liveDetail={liveDetail} />
              </div>
            )
        )}
        {tab === "sources" && (
          liveDetail
            ? <SourcesTab report={liveReport} detail={liveDetail} />
            : workspaceNeedsSelection || selectedIsLiveArtifact
              ? <LiveArtifactPlaceholder loading={liveArtifacts.isLoading} reportId={selectedReportId} />
              : <SourcesTab report={liveReport} />
        )}
        {tab === "chat" && <ChatSurface contextLabel={`Asking about: ${workspaceTitle}`} />}
        {tab === "map" && (
          liveDetail
            ? <MapTab detail={liveDetail} />
            : workspaceNeedsSelection || selectedIsLiveArtifact
              ? <LiveArtifactPlaceholder loading={liveArtifacts.isLoading} reportId={selectedReportId} />
              : <MapTab />
        )}
      </div>
    </div>
  );
}

function LiveArtifactPlaceholder({ loading, reportId }: { loading: boolean; reportId: string }) {
  return (
    <div className="rd-stack" style={{ gap: 14, padding: "28px 32px", maxWidth: 760 }}>
      <div className="rd-eyebrow">{loading ? "Resolving live artifact" : "Live artifact unavailable"}</div>
      <section className="rd-card rd-card__pad" style={{ background: "var(--rd-panel)" }}>
        <h2 className="rd-h2" style={{ marginBottom: 8 }}>
          {loading ? "Loading the live workspace body." : "This artifact is not in the current live window."}
        </h2>
        <p className="rd-body rd-faint">
          {loading
            ? "NodeBench is waiting for the Convex artifact detail before rendering Brief, Cards, Sources, or Map. Fixture workspace content is intentionally suppressed for live artifact ids."
            : `No live detail was returned for ${reportId || "the latest artifact"}. Open Reports to pick a currently indexed artifact, or refresh the live feed.`}
        </p>
      </section>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPromotedLiveArtifactHtml(report: ReportCardData): string {
  const title = escapeHtml(report.entity);
  const description = escapeHtml(report.description);
  const kind = escapeHtml(report.kind);
  const status = escapeHtml(report.status);
  const updatedAt = escapeHtml(report.updatedAt);
  return [
    `<h1>${title}</h1>`,
    `<p><strong>${kind}</strong> - ${description}</p>`,
    `<div data-block="claim" data-status="${status}">`,
    `<span data-claim-label>Claim - imported from live artifact - ${status}</span>`,
    `<p>${description}</p>`,
    `<span data-claim-source>${report.sources} sources - ${report.claims} claims - refreshed ${updatedAt}</span>`,
    `</div>`,
    `<h2>Why this matters</h2>`,
    `<p>This artifact started as first-party NodeBench memory and was promoted into an editable report notebook. Verify the claim trail, add source notes, then reuse it in chat, export, or workspace review.</p>`,
    `<h2>Next action</h2>`,
    `<p><strong>Review and preserve.</strong> Confirm the strongest claims, add missing sources, and decide whether this belongs in an active coverage universe.</p>`,
  ].join("");
}

function BriefTab({ report, detail }: { report?: ReportCardData; detail?: LiveArtifactDetail }) {
  if (detail) {
    return (
      <div className="rd-stack" style={{ gap: 18, padding: "28px 32px", maxWidth: 820, overflow: "auto", height: "100%" }}>
        <section>
          <div className="rd-eyebrow">Live artifact</div>
          <p style={{ fontFamily: "var(--rd-font-display)", fontSize: 22, lineHeight: 1.35, color: "var(--rd-ink-strong)", marginTop: 6 }}>
            {detail.title}
          </p>
          <p className="rd-body" style={{ marginTop: 8, color: "var(--rd-ink-mute)" }}>
            {detail.summary}
          </p>
        </section>

        <section className="rd-card rd-card__pad" style={{ background: "var(--rd-panel)" }}>
          <div className="rd-eyebrow">Audit trail</div>
          <div className="rd-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <Pill tone={detail.status === "verified" ? "green" : detail.status === "review" ? "amber" : "blue"}>
              {detail.status}
            </Pill>
            <Pill>{detail.sourceCount} sources</Pill>
            <Pill>{detail.claimCount} claims</Pill>
            <Pill>{detail.followUps} follow-ups</Pill>
            <Pill>Updated {detail.updatedAt}</Pill>
          </div>
        </section>

        {detail.sections.map((section) => (
          <section key={section.title} className="rd-stack" style={{ gap: 10 }}>
            <div>
              <div className="rd-eyebrow">{section.title}</div>
              <p className="rd-body" style={{ marginTop: 6, color: "var(--rd-ink-mute)" }}>{section.body}</p>
            </div>
            {section.items && section.items.length > 0 && (
              <div className="rd-stack" style={{ gap: 8 }}>
                {section.items.map((item, index) => (
                  <article
                    key={`${section.title}-${index}`}
                    className="rd-card rd-card__pad-tight"
                    style={{
                      background: "var(--rd-panel)",
                      display: "grid",
                      gridTemplateColumns: "auto 1fr",
                      gap: 10,
                    }}
                  >
                    <span
                      className="rd-dot"
                      style={{
                        marginTop: 7,
                        background:
                          item.status === "verified"
                            ? "var(--rd-green)"
                            : item.status === "watching"
                              ? "var(--rd-blue)"
                              : "var(--rd-amber)",
                      }}
                    />
                    <div className="rd-stack" style={{ gap: 4 }}>
                      <strong style={{ fontSize: 13, color: "var(--rd-ink-strong)" }}>{item.label}</strong>
                      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: "var(--rd-ink-mute)" }}>{item.body}</p>
                      {item.meta && <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{item.meta}</span>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ))}

        <section className="rd-card rd-card__pad" style={{ background: "var(--rd-accent-tint)", borderColor: "var(--rd-accent-ring)" }}>
          <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>Recommended next action</div>
          <p className="rd-body" style={{ marginTop: 6 }}>{detail.primaryAction}</p>
        </section>
      </div>
    );
  }

  if (report) {
    return (
      <div className="rd-stack" style={{ gap: 18, padding: "28px 32px", maxWidth: 820, overflow: "auto", height: "100%" }}>
        <section>
          <div className="rd-eyebrow">Live artifact</div>
          <p style={{ fontFamily: "var(--rd-font-display)", fontSize: 22, lineHeight: 1.35, color: "var(--rd-ink-strong)", marginTop: 6 }}>
            {report.entity}
          </p>
          <p className="rd-body" style={{ marginTop: 8, color: "var(--rd-ink-mute)" }}>
            {report.description}
          </p>
        </section>

        <section className="rd-card rd-card__pad" style={{ background: "var(--rd-panel)" }}>
          <div className="rd-eyebrow">Audit trail</div>
          <div className="rd-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <Pill tone={report.status === "verified" ? "green" : report.status === "review" ? "amber" : "blue"}>
              {report.status}
            </Pill>
            <Pill>{report.sources} sources</Pill>
            <Pill>{report.claims} claims</Pill>
            <Pill>Updated {report.updatedAt}</Pill>
          </div>
        </section>

        <section>
          <div className="rd-eyebrow">Next action</div>
          <p className="rd-body" style={{ marginTop: 6 }}>
            Treat this as reusable memory: verify the sources, turn the strongest claims into notebook blocks, then multiply the same rubric across a universe.
          </p>
        </section>
      </div>
    );
  }
  return (
    <div className="rd-stack" style={{ gap: 18, padding: "28px 32px", maxWidth: 760, overflow: "auto", height: "100%" }}>
      <section>
        <div className="rd-eyebrow">Workspace draft</div>
        <p style={{ fontFamily: "var(--rd-font-display)", fontSize: 22, lineHeight: 1.35, color: "var(--rd-ink-strong)", letterSpacing: "-0.3px", marginTop: 6 }}>
          Select a live artifact from Reports to hydrate this workspace.
        </p>
      </section>

      <section>
        <div className="rd-eyebrow">Why this is blank</div>
        <p className="rd-body" style={{ marginTop: 6, color: "var(--rd-ink-mute)" }}>
          Workspace routes no longer fall through to starter entity fixtures. Brief, Cards, Sources, Notebook,
          and Map wait for the selected live artifact or an editable report document before rendering intelligence.
        </p>
      </section>

      <section className="rd-card rd-card__pad" style={{ background: "var(--rd-accent-tint)", borderColor: "var(--rd-accent-ring)" }}>
        <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>No fixture fallback</div>
        <p className="rd-body" style={{ marginTop: 6 }}>
          This blank state is intentional: live artifact routes must prove their data path instead of looking populated by old sample content.
        </p>
      </section>
    </div>
  );
}

function NotebookTab() {
  return (
    <div className="rd-stack" style={{ gap: 16, padding: "28px 32px", maxWidth: 760, overflow: "auto", height: "100%" }}>
      <div className="rd-row" style={{ gap: 8 }}>
        <Pill tone="green"><span className="rd-dot rd-dot--live" />Saved · just now</Pill>
        <Pill>Public read-only mode</Pill>
        <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ marginLeft: "auto" }}>Improve selection with AI</button>
      </div>

      <article className="rd-stack" style={{ gap: 14 }}>
        <h1 style={{ fontFamily: "var(--rd-font-display)", fontSize: 28, fontWeight: 590, color: "var(--rd-ink-strong)", letterSpacing: "-0.5px" }}>
          Live artifact — notebook pre-read
        </h1>
        <p className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)" }}>
          Drafted by NodeBench · waiting for live claims and follow-ups
        </p>

        <h2 className="rd-h2">What they do</h2>
        <p className="rd-body">
          This notebook preserves an entity intelligence answer as editable report text, source-backed claims, and follow-up actions.
          The live path hydrates this body from Convex artifacts before showing editable intelligence{" "}
          <span className="rd-mono" style={{ fontSize: 10, background: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)", padding: "1px 5px", borderRadius: 4 }}>[2]</span>.
        </p>

        <h2 className="rd-h2">Why we should care</h2>
        <p className="rd-body">
          Live artifact notebooks keep the generated answer editable, but every claim still needs a source row before
          it becomes reusable memory. If the selected report has not hydrated yet, this surface stays blank instead
          of showing disconnected content.
        </p>

        <h2 className="rd-h2">Open questions</h2>
        <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0 }}>
          <li className="rd-row" style={{ gap: 8 }}>
            <span className="rd-dot rd-dot--review" />
            <span>Which claims still need source-backed verification?</span>
          </li>
          <li className="rd-row" style={{ gap: 8 }}>
            <span className="rd-dot rd-dot--review" />
            <span>Which next action should move into the review queue?</span>
          </li>
        </ul>

        <h2 className="rd-h2">Decision</h2>
        <p className="rd-body">
          <strong style={{ color: "var(--rd-accent-strong)" }}>Verify first.</strong> Promote only the claims that
          can be traced to live sources, then export the report or keep it in monitoring.
        </p>
      </article>
    </div>
  );
}

function LiveCardsTab({ detail }: { detail: LiveArtifactDetail }) {
  const items = detail.sections.flatMap((section) => section.items ?? []).slice(0, 12);
  return (
    <div className="rd-stack" style={{ gap: 14, padding: "28px 32px", overflow: "auto", height: "100%" }}>
      <header className="rd-row--between" style={{ gap: 12 }}>
        <div>
          <div className="rd-eyebrow">Cards</div>
          <h2 className="rd-h2" style={{ marginTop: 5 }}>{detail.title}</h2>
          <p className="rd-faint" style={{ marginTop: 4, fontSize: 12.5 }}>
            Live artifact cards turn each signal into a reviewable node before it moves into notebook memory.
          </p>
        </div>
        <button className="rd-btn rd-btn--primary rd-btn--sm">Promote top card</button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, maxWidth: 1040 }}>
        {items.map((item, index) => (
          <article key={`${item.label}-${index}`} className="rd-card rd-card__pad" style={{ background: "var(--rd-panel)" }}>
            <div className="rd-row" style={{ gap: 8, marginBottom: 10 }}>
              <Pill tone={item.status === "verified" ? "green" : item.status === "watching" ? "blue" : "amber"}>
                {item.status ?? "review"}
              </Pill>
              {item.meta && <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{item.meta}</span>}
            </div>
            <h3 style={{ fontSize: 15, lineHeight: 1.25, color: "var(--rd-ink-strong)", margin: 0 }}>{item.label}</h3>
            <p style={{ fontSize: 12.5, color: "var(--rd-ink-mute)", lineHeight: 1.45, margin: "8px 0 12px" }}>{item.body}</p>
            <div className="rd-row" style={{ gap: 6 }}>
              <button className="rd-btn rd-btn--quiet rd-btn--sm">Open</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm">Add to notebook</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm">Verify</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SourcesTab({ report, detail }: { report?: ReportCardData; detail?: LiveArtifactDetail }) {
  if (detail) {
    return (
      <div className="rd-stack" style={{ gap: 14, padding: "28px 32px", maxWidth: 920, overflow: "auto", height: "100%" }}>
        <header className="rd-stack" style={{ gap: 6 }}>
          <div className="rd-eyebrow">Sources</div>
          <h2 className="rd-h2">{detail.sourceCount} sources from this live artifact</h2>
          <p className="rd-faint" style={{ fontSize: 12.5 }}>
            Each row is tied to a claim, daily-brief check, or published archive artifact.
          </p>
        </header>

        <div className="rd-card" style={{ padding: 0 }}>
          {detail.sourceRows.map((s, i) => (
            <div key={s.id} className="rd-row--between" style={{
              padding: "12px 16px",
              borderBottom: i < detail.sourceRows.length - 1 ? "1px solid var(--rd-line-faint)" : "none",
              gap: 12,
            }}>
              <div className="rd-row" style={{ gap: 12, flex: 1, minWidth: 0 }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 8, background: "var(--rd-muted)",
                  display: "grid", placeItems: "center", fontSize: 10, fontWeight: 590,
                  color: "var(--rd-ink-mute)", textTransform: "uppercase",
                }}>{s.type.slice(0, 3)}</span>
                <div className="rd-stack" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 510, color: "var(--rd-ink-strong)" }}>{s.title}</span>
                  <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
                    Refreshed {s.refreshed} - reused {s.reused}x this session
                  </span>
                  <span style={{ fontSize: 12, color: "var(--rd-ink-soft)", lineHeight: 1.35 }}>{s.excerpt}</span>
                </div>
              </div>
              <div className="rd-row" style={{ gap: 4 }}>
                <button
                  className="rd-btn rd-btn--quiet rd-btn--sm"
                  onClick={() => {
                    if (s.href) window.open(s.href, "_blank", "noopener,noreferrer");
                    else showToast({ tone: "info", message: "Source row opened in the evidence drawer." });
                  }}
                >
                  Open
                </button>
                <button className="rd-btn rd-btn--quiet rd-btn--sm">Verify</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const sources = [
    ...(report ? [{ type: report.kind, title: report.entity, refreshed: report.updatedAt, reused: report.sources }] : []),
    { type: "Source", title: "Primary source packet", refreshed: "2d ago", reused: 4 },
    { type: "Note", title: "Captured context note", refreshed: "today", reused: 6 },
    { type: "Recap", title: "Notebook revision log", refreshed: "5d ago", reused: 2 },
    { type: "Web", title: "Public source refresh", refreshed: "1w ago", reused: 3 },
  ];
  const sourceTotal = sources.reduce((total, source) => total + Math.max(1, source.reused), 0);

  return (
    <div className="rd-stack" style={{ gap: 14, padding: "28px 32px", maxWidth: 880, overflow: "auto", height: "100%" }}>
      <header className="rd-stack" style={{ gap: 6 }}>
        <div className="rd-eyebrow">Sources</div>
        <h2 className="rd-h2">{sourceTotal} source links ready for review</h2>
        <p className="rd-faint" style={{ fontSize: 12.5 }}>Each row is one click from the claim it supports.</p>
      </header>

      <div className="rd-card" style={{ padding: 0 }}>
        {sources.map((s, i) => (
          <div key={i} className="rd-row--between" style={{
            padding: "12px 16px",
            borderBottom: i < sources.length - 1 ? "1px solid var(--rd-line-faint)" : "none",
            gap: 12,
          }}>
            <div className="rd-row" style={{ gap: 12, flex: 1, minWidth: 0 }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, background: "var(--rd-muted)",
                display: "grid", placeItems: "center", fontSize: 10, fontWeight: 590,
                color: "var(--rd-ink-mute)", textTransform: "uppercase",
              }}>{s.type.slice(0, 3)}</span>
              <div className="rd-stack" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 510, color: "var(--rd-ink-strong)" }}>{s.title}</span>
                <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
                  Refreshed {s.refreshed} · reused {s.reused}× this session
                </span>
              </div>
            </div>
            <div className="rd-row" style={{ gap: 4 }}>
              <button className="rd-btn rd-btn--quiet rd-btn--sm">Open</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm">Verify</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MapTab({ detail }: { detail?: LiveArtifactDetail }) {
  if (detail) {
    const positions = buildMapPositions(detail.nodes);
    return (
      <div style={{ position: "relative", height: "100%", padding: 32, overflow: "hidden" }}>
        <div className="rd-row--between" style={{ position: "absolute", top: 16, left: 32, right: 32, zIndex: 2 }}>
          <Pill tone="blue">Map - wide-angle relationships</Pill>
          <div className="rd-row" style={{ gap: 6 }}>
            <button className="rd-btn rd-btn--quiet rd-btn--sm">Filter</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm">Confidence &gt;= 0.7</button>
            <button className="rd-btn rd-btn--primary rd-btn--sm">Open in Cards</button>
          </div>
        </div>

        <svg viewBox="0 0 800 480" style={{ width: "100%", height: "100%", maxHeight: 600 }} aria-label="Relationship map">
          <defs>
            <radialGradient id="rd-glow-live" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--rd-accent-soft)" />
              <stop offset="100%" stopColor="var(--rd-paper)" stopOpacity="0" />
            </radialGradient>
          </defs>

          <g stroke="var(--rd-line-strong)" strokeWidth={1.2} fill="none">
            {detail.edges.map((edge, index) => {
              const from = positions[edge.from];
              const to = positions[edge.to];
              if (!from || !to) return null;
              return <path key={index} d={`M ${from.x},${from.y} L ${to.x},${to.y}`} />;
            })}
          </g>

          <circle cx="400" cy="240" r="90" fill="url(#rd-glow-live)" />
          {detail.nodes.map((node) => {
            const position = positions[node.id];
            if (!position) return null;
            return (
              <MapNode
                key={node.id}
                cx={position.x}
                cy={position.y}
                title={node.title}
                subtitle={node.subtitle}
                tone={node.tone}
                size={node.id === "root" ? "lg" : "md"}
              />
            );
          })}
        </svg>

        <p className="rd-mono" style={{ position: "absolute", bottom: 16, left: 32, fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
          Graph preview is generated from the selected report artifact. Cards remain the primary review surface.
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: "100%", padding: 32, overflow: "hidden" }}>
      <div className="rd-row--between" style={{ position: "absolute", top: 16, left: 32, right: 32, zIndex: 2 }}>
        <Pill tone="blue">Map · wide-angle relationships</Pill>
        <div className="rd-row" style={{ gap: 6 }}>
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Filter</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Confidence ≥ 0.7</button>
          <button className="rd-btn rd-btn--primary rd-btn--sm">Open in Cards</button>
        </div>
      </div>

      <svg viewBox="0 0 800 480" style={{ width: "100%", height: "100%", maxHeight: 600 }} aria-label="Relationship map">
        <defs>
          <radialGradient id="rd-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--rd-accent-soft)" />
            <stop offset="100%" stopColor="var(--rd-paper)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Edges */}
        <g stroke="var(--rd-line-strong)" strokeWidth={1.2} fill="none">
          <path d="M 400,240 L 240,140" />
          <path d="M 400,240 L 580,140" />
          <path d="M 400,240 L 240,360" />
          <path d="M 400,240 L 580,360" />
          <path d="M 240,140 L 240,360" strokeDasharray="3 4" />
          <path d="M 580,140 L 580,360" strokeDasharray="3 4" />
        </g>

        {/* Root placeholder graph */}
        <circle cx="400" cy="240" r="80" fill="url(#rd-glow)" />
        <MapNode cx={400} cy={240} title="Live report" subtitle="Artifact · root" tone="accent" size="lg" />

        {/* Spokes */}
        <MapNode cx={240} cy={140} title="Claim" subtitle="Needs evidence" tone="blue" />
        <MapNode cx={580} cy={140} title="Source" subtitle="Verified row" tone="default" />
        <MapNode cx={240} cy={360} title="Follow-up" subtitle="Human review" tone="green" />
        <MapNode cx={580} cy={360} title="Theme" subtitle="Coverage lane" tone="amber" />
      </svg>

      <p className="rd-mono" style={{ position: "absolute", bottom: 16, left: 32, fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
        Graph preview is generated from the selected report artifact. Cards remain the primary review surface.
      </p>
    </div>
  );
}

function buildMapPositions(nodes: LiveArtifactMapNode[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const root = nodes[0];
  if (!root) return positions;
  positions[root.id] = { x: 400, y: 240 };
  const spokes = nodes.slice(1);
  const radiusX = 220;
  const radiusY = 145;
  spokes.forEach((node, index) => {
    const angle = spokes.length <= 1 ? -Math.PI / 2 : (index / spokes.length) * Math.PI * 2 - Math.PI / 2;
    positions[node.id] = {
      x: 400 + Math.cos(angle) * radiusX,
      y: 240 + Math.sin(angle) * radiusY,
    };
  });
  return positions;
}

function MapNode({ cx, cy, title, subtitle, tone = "default", size = "md" }: {
  cx: number; cy: number; title: string; subtitle: string;
  tone?: "default" | "accent" | "blue" | "green" | "amber"; size?: "md" | "lg";
}) {
  const r = size === "lg" ? 36 : 26;
  const fillMap: Record<string, string> = {
    default: "var(--rd-muted)",
    accent: "var(--rd-accent-soft)",
    blue: "var(--rd-blue-bg)",
    green: "var(--rd-green-bg)",
    amber: "var(--rd-amber-bg)",
  };
  const colorMap: Record<string, string> = {
    default: "var(--rd-ink-mute)",
    accent: "var(--rd-accent-strong)",
    blue: "var(--rd-blue)",
    green: "var(--rd-green)",
    amber: "var(--rd-amber)",
  };
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fillMap[tone]} stroke={colorMap[tone]} strokeWidth={1.2} />
      <text x={cx} y={cy + r + 16} textAnchor="middle" fontSize={12} fontWeight={590} fill="var(--rd-ink-strong)">{title}</text>
      <text x={cx} y={cy + r + 30} textAnchor="middle" fontSize={10.5} fill="var(--rd-ink-soft)">{subtitle}</text>
    </g>
  );
}
