/**
 * MobileShell — capture-first NodeBench on phone.
 *
 * Aligns with the locked design board (proposed-design-views.html#mobile-view):
 *   - Bottom 5-tab nav (Home · Reports · Chat · Inbox · Me) — never collapsed
 *   - Top mini-nav with the active live artifact pill
 *   - Capture ack card after speech-to-text turn
 *   - Bottom sheets for context (Sources / Graph / Card)
 *   - UniversalComposer pinned above the tab bar
 *
 * Mobile rejects: full graph by default, hidden capture target, desktop panes on phone.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SurfaceId } from "../fixtures";
import { Pill } from "./Pill";
import { UniversalComposer, type RouterTier } from "./UniversalComposer";
import { useLiveArtifacts, type LiveArtifactDetail } from "../hooks/useLiveArtifacts";
import { useReportsLive } from "../hooks/useReportsLive";
import { useInboxLive } from "../hooks/useInboxLive";
import { sanitizeDecisionText } from "../surfaces/ProductDecisionQueue";

interface MobileShellProps {
  active: SurfaceId;
  onChange: (id: SurfaceId) => void;
}

export function MobileShell({ active, onChange }: MobileShellProps) {
  const [sheet, setSheet] = useState<null | "sources" | "graph" | "entity">(null);
  const [tier, setTier] = useState<RouterTier>("auto");
  const liveArtifacts = useLiveArtifacts(8);
  const liveInboxSummary = useInboxLive();
  const primaryDetail = liveArtifacts.details[0];
  const contextTitle = primaryDetail?.title ?? (liveArtifacts.isLive ? "Live memory" : "Current report");

  return (
    <div
      // QA fix (2026-05-08): preserve legacy `mobile-home-surface` testid
      // on the redesign mobile shell so existing live-smoke-mobile tests
      // (live-smoke-mobile.spec.ts:35,273) still find a stable anchor at /.
      // The redirect from / → /redesign was added in PR #260; this keeps
      // the back-compat contract without reverting the redirect.
      data-testid="mobile-home-surface"
      data-redesign-mobile-shell="true"
      className="rd-stack"
      style={{
        height: "100dvh",
        background: "var(--rd-paper-warm)",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Top mini-nav */}
      <header
        style={{
          padding: "12px 14px 8px",
          background: "var(--rd-paper)",
          borderBottom: "1px solid var(--rd-line-faint)",
        }}
      >
        <div className="rd-row--between">
          <div className="rd-row" style={{ gap: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 8,
              background: "var(--rd-accent)", display: "grid", placeItems: "center",
              fontFamily: "var(--rd-font-mono)", fontSize: 12, fontWeight: 700, color: "#fff",
            }}>N</div>
            <strong style={{ fontSize: 13, color: "var(--rd-ink-strong)" }}>{titleFor(active)}</strong>
          </div>
          <Pill tone={liveArtifacts.isLive ? "green" : "accent"}>
            {liveArtifacts.isLive && <span className="rd-dot rd-dot--live" />}
            {contextTitle}
          </Pill>
        </div>
      </header>

      {/* Surface body — single column */}
      <div style={{ overflow: "auto", padding: "14px 14px 8px" }}>
        {active === "home" && <MobileHome onOpenReports={() => onChange("reports")} onOpenChat={() => onChange("chat")} />}
        {active === "reports" && <MobileReports />}
        {active === "chat" && <MobileChat onOpenSheet={setSheet} detail={primaryDetail} />}
        {active === "inbox" && <MobileInbox />}
        {active === "me" && <MobileMe />}
      </div>

      {/* Composer dock (always visible above the tabs) */}
      {(active === "chat" || active === "home") && (
        <div
          style={{
            padding: "8px 10px max(6px, env(safe-area-inset-bottom))",
            borderTop: "1px solid var(--rd-line-faint)",
            background: "var(--rd-paper)",
          }}
        >
          <UniversalComposer
            contextLabel={`Adding to: ${contextTitle}`}
            tier={tier}
            onTierChange={setTier}
          />
        </div>
      )}

      {/* Bottom 5-tab nav (locked) */}
      <nav
        aria-label="Mobile tabs"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          padding: "6px 4px env(safe-area-inset-bottom, 6px)",
          background: "var(--rd-paper)",
          borderTop: "1px solid var(--rd-line)",
          gap: 2,
        }}
      >
        {(["home", "reports", "chat", "inbox", "me"] as SurfaceId[]).map((id) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onChange(id)}
              className="rd-btn"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "8px 4px 6px",
                background: "transparent",
                color: isActive ? "var(--rd-accent-strong)" : "var(--rd-ink-soft)",
                fontSize: 10,
                fontWeight: 590,
                border: "none",
                position: "relative",
              }}
            >
              <TabIcon id={id} active={isActive} />
              <span style={{ textTransform: "capitalize" }}>{id}</span>
              {id === "inbox" && liveInboxSummary.items.length > 0 && (
                <span style={{
                  position: "absolute",
                  top: 2,
                  right: "calc(50% - 20px)",
                  background: "var(--rd-accent)",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 999,
                  lineHeight: 1.2,
                  minWidth: 18,
                  textAlign: "center",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                }}>{liveInboxSummary.items.length}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom sheet (Sources / Graph / Entity card) */}
      {sheet && (
        <BottomSheet kind={sheet} detail={primaryDetail} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

function titleFor(id: SurfaceId): string {
  return id === "home" ? "NodeBench" : id.charAt(0).toUpperCase() + id.slice(1);
}

function TabIcon({ id, active }: { id: SurfaceId; active: boolean }) {
  const paths: Record<SurfaceId, string> = {
    home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
    reports: "M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm0 6h14M9 13h6M9 17h4",
    chat: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z",
    inbox: "M3 13h6l1 2h4l1-2h6M3 13l3-8h12l3 8M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6",
    me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0",
  };
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill={active ? "var(--rd-accent-tint)" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[id]} />
    </svg>
  );
}

/* ──────────────────────────── Surface bodies ──────────────────────────── */

function MobileHome({ onOpenReports, onOpenChat }: { onOpenReports: () => void; onOpenChat: () => void }) {
  const liveArtifacts = useLiveArtifacts(8);
  const metrics = liveArtifacts.metrics;
  const primaryReport = liveArtifacts.reports[0];
  const pulseCards = liveArtifacts.pulse;
  const metricCells = metrics.length > 0
    ? metrics.slice(0, 4)
    : [{ label: "Live artifacts", value: liveArtifacts.isLoading ? "Loading" : "0" }];
  return (
    <div className="rd-stack" style={{ gap: 14 }}>
      {/* Hero */}
      <div className="rd-card rd-card__pad" style={{
        background: "linear-gradient(135deg, var(--rd-accent-tint), var(--rd-paper))",
        borderColor: "var(--rd-accent-ring)",
      }}>
        <div className="rd-row" style={{ gap: 6 }}>
          <Pill tone="green"><span className="rd-dot rd-dot--live" />Memory hot</Pill>
          <Pill>0 paid calls</Pill>
        </div>
        <h1 style={{
          fontFamily: "var(--rd-font-display)", fontSize: 22, fontWeight: 590,
          letterSpacing: "-0.4px", lineHeight: 1.2, margin: "10px 0 4px",
          color: "var(--rd-ink-strong)",
        }}>Capture now. Turn it into a report.</h1>
        <p className="rd-faint" style={{ fontSize: 12.5 }}>
          Ask, paste, or record. NodeBench turns messy input into a source-backed entity workspace.
        </p>
      </div>

      {liveArtifacts.isLive && (
        <button
          type="button"
          className="rd-card"
          onClick={onOpenReports}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "12px 14px",
            borderColor: "var(--rd-green-border)",
            background: "var(--rd-green-bg)",
          }}
        >
          <div className="rd-row" style={{ gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <Pill tone="green"><span className="rd-dot rd-dot--live" />Live public memory</Pill>
            <Pill>{liveArtifacts.archiveCount} posts</Pill>
            <Pill>{liveArtifacts.briefFeatureCount} brief signals</Pill>
          </div>
          <strong style={{ display: "block", fontSize: 13, color: "var(--rd-ink-strong)" }}>
            {primaryReport?.entity ?? "Open the live coverage library"}
          </strong>
          <span style={{ display: "block", marginTop: 3, fontSize: 11.5, lineHeight: 1.35, color: "var(--rd-ink-mute)" }}>
            {primaryReport?.description ? sanitizeDecisionText(primaryReport.description) : "Recent NodeBench artifacts are already wired into Reports."}
          </span>
          <span className="rd-mono" style={{ display: "block", marginTop: 8, fontSize: 10.5, color: "var(--rd-green)" }}>
            Open reports {">"}
          </span>
        </button>
      )}

      {!liveArtifacts.isLive && (
        <button
          type="button"
          className="rd-card"
          onClick={onOpenChat}
          style={{ width: "100%", textAlign: "left", padding: "12px 14px" }}
        >
          <div className="rd-eyebrow" style={{ marginBottom: 5 }}>First run</div>
          <strong style={{ display: "block", fontSize: 13, color: "var(--rd-ink-strong)" }}>
            Ask one question, then multiply it across a list.
          </strong>
          <span className="rd-mono" style={{ display: "block", marginTop: 8, fontSize: 10.5, color: "var(--rd-accent-strong)" }}>
            Start in chat {">"}
          </span>
        </button>
      )}

      {/* Memory pulse condensed */}
      <div>
        <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Memory pulse</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {metricCells.map((m) => (
            <div key={m.label} className="rd-card" style={{ padding: "10px 12px" }}>
              <div className="rd-eyebrow" style={{ fontSize: 9 }}>{m.label}</div>
              <div style={{
                fontFamily: "var(--rd-font-display)", fontSize: 18, fontWeight: 590,
                color: "var(--rd-ink-strong)", marginTop: 2, letterSpacing: "-0.2px",
              }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Today's intelligence — single column */}
      <div>
        <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Today's intelligence</div>
        <div className="rd-stack" style={{ gap: 8 }}>
          {pulseCards.slice(0, 3).map((card) => (
            <article key={`${card.title}-${card.meta}`} className="rd-card rd-card__pad-tight" style={{ padding: "12px 14px" }}>
              <div className="rd-row" style={{ gap: 6 }}>
                <Pill tone={card.kind === "follow_up" ? "amber" : card.kind === "report_update" ? "blue" : "green"}>
                  {card.kind.replace(/_/g, " ")}
                </Pill>
                <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{card.meta}</span>
              </div>
              <h3 style={{ margin: "6px 0 2px", fontSize: 13, fontWeight: 590 }}>{card.title}</h3>
              <p className="rd-faint" style={{ fontSize: 12 }}>{card.body}</p>
            </article>
          ))}
          {pulseCards.length === 0 && (
            <article className="rd-card rd-card__pad-tight" style={{ padding: "12px 14px" }}>
              <div className="rd-eyebrow">No live changes yet</div>
              <p className="rd-faint" style={{ fontSize: 12, marginTop: 4 }}>
                Daily Brief and archive artifacts will appear here once Convex returns them.
              </p>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileReports() {
  const navigate = useNavigate();
  const liveReports = useReportsLive();
  const visibleReports = liveReports.reports;
  const openReport = (reportId: string, tab: "brief" | "cards" | "chat") => {
    navigate(`/redesign/workspace?report=${encodeURIComponent(reportId)}&tab=${tab}`);
  };
  return (
    <div className="rd-stack" style={{ gap: 12 }}>
      <div className="rd-card" style={{
        padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--rd-ink-soft)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          placeholder="Search reports…"
          style={{
            border: "none", background: "transparent", color: "var(--rd-ink)",
            font: "inherit", fontSize: 13, flex: 1, outline: "none",
          }}
        />
      </div>

      <div className="rd-row" style={{ gap: 6, overflow: "auto", paddingBottom: 4 }}>
        {liveReports.isLive && (
          <Pill tone="green"><span className="rd-dot rd-dot--live" />{liveReports.sourceLabel}</Pill>
        )}
        {["All", "Verified", "Watching", "Review"].map((l, i) => (
          <button
            key={l}
            className="rd-btn"
            style={{
              padding: "5px 10px", fontSize: 11, flex: "0 0 auto",
              background: i === 0 ? "var(--rd-accent-tint)" : "var(--rd-panel)",
              color: i === 0 ? "var(--rd-accent-strong)" : "var(--rd-ink-mute)",
              border: `1px solid ${i === 0 ? "var(--rd-accent-ring)" : "var(--rd-line)"}`,
            }}
          >{l}</button>
        ))}
      </div>

      <div className="rd-stack" style={{ gap: 10 }}>
        {visibleReports.length === 0 && (
          <article className="rd-card rd-card__pad-tight" style={{ padding: "12px 14px" }}>
            <div className="rd-eyebrow">No live reports</div>
            <p className="rd-faint" style={{ fontSize: 12, marginTop: 4 }}>
              Reports will populate from daily briefs, archive rows, and batch runs. No fixture cards are shown on mobile.
            </p>
          </article>
        )}
        {visibleReports.slice(0, 10).map((r) => (
          <article key={r.id} className="rd-card rd-card__pad-tight" style={{ padding: "12px 14px" }}>
            <div className="rd-row--between">
              <div className="rd-row" style={{ gap: 6 }}>
                <span className={`rd-dot rd-dot--${r.status === "verified" ? "live" : r.status === "watching" ? "watch" : "review"}`} />
                <strong style={{ fontSize: 13, color: "var(--rd-ink-strong)" }}>{r.entity}</strong>
              </div>
              <Pill tone={r.status === "verified" ? "green" : r.status === "watching" ? "blue" : "amber"}>
                {r.status === "review" ? "Review" : r.status === "watching" ? "Watching" : "Verified"}
              </Pill>
            </div>
            <p className="rd-faint" style={{ fontSize: 12, marginTop: 4 }}>{sanitizeDecisionText(r.description)}</p>
            <div className="rd-row" style={{ gap: 8, marginTop: 6, fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
              <span>{r.sources} src</span>
              <span>{r.claims} claims</span>
              <span>{r.followUps} follow-ups</span>
              <span style={{ marginLeft: "auto" }}>{r.updatedAt}</span>
            </div>
            <div className="rd-row" style={{ gap: 6, marginTop: 8 }}>
              <button className="rd-btn rd-btn--primary rd-btn--sm" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }} onClick={() => openReport(r.id, "brief")}>Brief</button>
              <button className="rd-btn rd-btn--ghost rd-btn--sm" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }} onClick={() => openReport(r.id, "cards")}>Explore</button>
              <button className="rd-btn rd-btn--ghost rd-btn--sm" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }} onClick={() => openReport(r.id, "chat")}>Chat</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function MobileChat({ onOpenSheet, detail }: { onOpenSheet: (k: "sources" | "graph" | "entity") => void; detail?: LiveArtifactDetail }) {
  const title = detail?.title ?? "current report";
  const summary = detail?.summary ?? "Ask, paste, upload, or record. NodeBench turns messy input into a source-backed entity workspace.";
  const sourceCount = detail?.sourceCount ?? 0;
  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      {/* Capture ack — the headline mobile pattern */}
      <div className="rd-card rd-card__pad" style={{
        background: "var(--rd-accent-tint)",
        borderColor: "var(--rd-accent-ring)",
      }}>
        <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>{detail ? "Captured to live artifact" : "Capture-ready"}</div>
        <h3 style={{ margin: "6px 0 4px", fontSize: 14, fontWeight: 590 }}>
          {detail ? title : "Ask, paste, upload, or record"}
        </h3>
        <p className="rd-faint" style={{ fontSize: 12 }}>
          {detail ? `${detail.claimCount} claims · ${detail.sourceCount} sources · ${detail.followUps} follow-ups.` : "NodeBench will route it into a report, source trail, and review queue."}
        </p>
        <div className="rd-row" style={{ gap: 4, marginTop: 8, flexWrap: "wrap" }}>
          <button className="rd-btn rd-btn--primary rd-btn--sm" style={{ padding: "5px 11px", fontSize: 11 }}>Edit</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "5px 11px", fontSize: 11 }}>Move</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "5px 11px", fontSize: 11 }} onClick={() => onOpenSheet("entity")}>Open card</button>
        </div>
      </div>

      {/* Last message + answer summary */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div className="rd-card" style={{
          padding: "10px 12px", maxWidth: "82%",
          background: "var(--rd-paper-warm)", fontSize: 13, lineHeight: 1.5,
        }}>{detail ? `What changed in ${title}?` : "What changed in my live coverage?"}</div>
      </div>

      <article className="rd-card rd-card__pad" style={{ padding: 14 }}>
        <div className="rd-row" style={{ gap: 4, flexWrap: "wrap" }}>
          <Pill tone="green">Memory · {sourceCount} sources</Pill>
          <Pill>0 paid calls</Pill>
        </div>
        <p style={{
          fontFamily: "var(--rd-font-display)", fontSize: 15, fontWeight: 510,
          lineHeight: 1.4, color: "var(--rd-ink-strong)", margin: "8px 0 6px",
          letterSpacing: "-0.15px",
        }}>{summary}</p>
        <div className="rd-row" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onOpenSheet("sources")}>Sources ({sourceCount})</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onOpenSheet("graph")}>Graph</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onOpenSheet("entity")}>Entity</button>
        </div>
      </article>
    </div>
  );
}

function MobileInbox() {
  const liveInbox = useInboxLive();
  const visibleItems = liveInbox.items;
  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      <div className="rd-row" style={{ gap: 6, overflow: "auto", paddingBottom: 4 }}>
        {["All", "Needs confirmation", "Approvals", "Watchlist", "Auto"].map((l, i) => (
          <button
            key={l}
            className="rd-btn"
            style={{
              padding: "5px 10px", fontSize: 11, flex: "0 0 auto",
              background: i === 0 ? "var(--rd-accent-tint)" : "var(--rd-panel)",
              color: i === 0 ? "var(--rd-accent-strong)" : "var(--rd-ink-mute)",
              border: `1px solid ${i === 0 ? "var(--rd-accent-ring)" : "var(--rd-line)"}`,
            }}
          >{l}</button>
        ))}
      </div>

      <div className="rd-stack" style={{ gap: 8 }}>
        {visibleItems.length === 0 && (
          <article className="rd-card rd-card__pad-tight" style={{ padding: "12px 14px" }}>
            <div className="rd-eyebrow">No live review items</div>
            <p className="rd-faint" style={{ fontSize: 12, marginTop: 4 }}>
              Batch reviews and pipeline exceptions will appear here when the backend returns them.
            </p>
          </article>
        )}
        {visibleItems.slice(0, 4).map((item) => (
          <article key={item.id} className="rd-card rd-card__pad-tight" style={{ padding: "12px 14px" }}>
            <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Pill tone={
                item.category === "needs_confirmation" ? "amber"
                  : item.category === "approval" ? "accent"
                  : item.category === "watchlist" ? "blue"
                  : item.category === "automation" ? "green"
                  : undefined
              }>{item.category.replace(/_/g, " ")}</Pill>
              <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{item.meta}</span>
            </div>
            <h3 style={{ margin: "6px 0 2px", fontSize: 13, fontWeight: 590 }}>{item.title}</h3>
            <p className="rd-faint" style={{ fontSize: 12 }}>{item.body}</p>
            {typeof item.confidence === "number" && (
              <div className="rd-row" style={{ gap: 6, marginTop: 6, fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
                <span style={{ flex: 1, height: 4, background: "var(--rd-line)", borderRadius: 2, overflow: "hidden" }}>
                  <span style={{
                    display: "block",
                    width: `${(item.confidence * 100).toFixed(0)}%`,
                    height: "100%",
                    background: item.confidence > 0.85 ? "var(--rd-green)" : "var(--rd-accent)",
                  }} />
                </span>
                <span className="rd-mono">{(item.confidence * 100).toFixed(0)}%</span>
              </div>
            )}
            <div className="rd-row" style={{ gap: 4, marginTop: 8 }}>
              <button className="rd-btn rd-btn--primary rd-btn--sm" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }}>Attach</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }}>Move</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }}>Discard</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function MobileMe() {
  return (
    <div className="rd-stack" style={{ gap: 12 }}>
      <div className="rd-card rd-card__pad">
        <div className="rd-eyebrow">How NodeBench sees you</div>
        <h3 style={{ margin: "6px 0 4px", fontSize: 14, fontWeight: 590 }}>Founder / banker lens</h3>
        <p className="rd-faint" style={{ fontSize: 12 }}>Concise, evidence-led, report-first.</p>
        <div className="rd-row" style={{ gap: 6, marginTop: 8 }}>
          <button className="rd-btn rd-btn--ghost rd-btn--sm" style={{
            background: "var(--rd-accent-soft)",
            color: "var(--rd-accent-strong)",
            border: "1px solid var(--rd-accent-ring)",
          }}>Edit profile</button>
        </div>
      </div>

      <div className="rd-card" style={{ padding: 12 }}>
        <div className="rd-row--between" style={{ paddingBottom: 8, borderBottom: "1px solid var(--rd-line-faint)" }}>
          <div className="rd-eyebrow">USER.md / memory</div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 8px", borderRadius: 999,
            background: "var(--rd-green-bg)", color: "var(--rd-green)",
            fontFamily: "var(--rd-font-mono)", fontSize: 10, fontWeight: 700,
            border: "1px solid var(--rd-green-border)",
          }}>● Saved</span>
        </div>
        <ul className="rd-stack" style={{ gap: 8, marginTop: 10, listStyle: "none", padding: 0 }}>
          {[
            { h: "# Background", b: "Building NodeBench as an entity intelligence workspace.", perms: ["chat", "reports"] },
            { h: "# Communication style", b: "Banker memo cadence: answer, evidence, risk, next action.", perms: ["global"] },
            { h: "# Privacy boundaries", b: "Private captures stay private. Connector writes need diff.", perms: ["private"] },
          ].map((s) => (
            <li key={s.h}>
              <div style={{ fontSize: 12.5, fontWeight: 590, color: "var(--rd-ink-strong)" }}>{s.h}</div>
              <p style={{ fontSize: 11.5, color: "var(--rd-ink-mute)", margin: "2px 0 4px", fontFamily: "var(--rd-font-mono)" }}>{s.b}</p>
              <div className="rd-row" style={{ gap: 4 }}>
                {s.perms.map((p) => <Pill key={p} tone="accent">{p}</Pill>)}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rd-card rd-card__pad" style={{
        background: "var(--rd-accent-tint)", borderColor: "var(--rd-accent-ring)",
      }}>
        <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>Memory update</div>
        <p style={{ fontSize: 12.5, margin: "6px 0 8px", color: "var(--rd-ink)" }}>
          You often rewrite reports into banker-style next actions. Save to <strong>Communication style</strong>?
        </p>
        <div className="rd-row" style={{ gap: 6 }}>
          <button className="rd-btn rd-btn--primary rd-btn--sm">Accept</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Edit</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Reject</button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── Bottom sheet ──────────────────────────── */

function BottomSheet({ kind, detail, onClose }: { kind: "sources" | "graph" | "entity"; detail?: LiveArtifactDetail; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${kind} sheet`}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(15, 16, 17, 0.40)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        zIndex: 30,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--rd-panel)",
          borderRadius: "16px 16px 0 0",
          padding: "12px 16px 24px",
          maxHeight: "78%",
          overflow: "auto",
          boxShadow: "0 -10px 30px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{
          width: 36, height: 4, borderRadius: 4,
          background: "var(--rd-line-strong)", margin: "0 auto 12px",
        }} />
        <div className="rd-row--between" style={{ marginBottom: 10 }}>
          <div className="rd-eyebrow">{kind === "sources" ? "Sources" : kind === "graph" ? "Graph preview" : "Entity"}</div>
          <button onClick={onClose} className="rd-btn rd-btn--quiet rd-btn--sm">Close</button>
        </div>

        {kind === "sources" && <SheetSources detail={detail} />}
        {kind === "graph" && <SheetGraph detail={detail} />}
        {kind === "entity" && <SheetEntity detail={detail} />}
      </div>
    </div>
  );
}

function SheetSources({ detail }: { detail?: LiveArtifactDetail }) {
  const rows = detail?.sourceRows.slice(0, 8).map((row) => row.title) ?? ["Open a live artifact to hydrate sources."];
  return (
    <ul className="rd-stack" style={{ gap: 8, listStyle: "none", padding: 0 }}>
      {rows.map((s, i) => (
        <li key={i} className="rd-row" style={{ gap: 10, padding: "8px 10px", border: "1px solid var(--rd-line)", borderRadius: 10 }}>
          <span className="rd-mono" style={{
            fontSize: 10, background: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)",
            padding: "1px 5px", borderRadius: 4,
          }}>[{i + 1}]</span>
          <span style={{ flex: 1, fontSize: 12.5 }}>{s}</span>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "3px 8px", fontSize: 10 }}>Open</button>
        </li>
      ))}
    </ul>
  );
}

function SheetGraph({ detail }: { detail?: LiveArtifactDetail }) {
  const nodes = detail?.nodes.slice(1, 5) ?? [];
  return (
    <svg viewBox="0 0 320 220" width="100%" style={{ maxHeight: 280 }}>
      <g stroke="var(--rd-line-strong)" strokeWidth={1.2} fill="none">
        {[
          [80, 50],
          [240, 50],
          [80, 170],
          [240, 170],
        ].slice(0, nodes.length || 4).map(([x, y], i) => <path key={i} d={`M 160,110 L ${x},${y}`} />)}
      </g>
      <circle cx={160} cy={110} r={28} fill="var(--rd-accent-soft)" stroke="var(--rd-accent)" strokeWidth={1.2} />
      <text x={160} y={114} textAnchor="middle" fontSize={11} fontWeight={590} fill="var(--rd-accent-strong)">Root</text>
      {[
        { cx: 80, cy: 50, label: nodes[0]?.title ?? "Claim" },
        { cx: 240, cy: 50, label: nodes[1]?.title ?? "Source" },
        { cx: 80, cy: 170, label: nodes[2]?.title ?? "Follow-up" },
        { cx: 240, cy: 170, label: nodes[3]?.title ?? "Report" },
      ].map((n) => (
        <g key={n.label}>
          <circle cx={n.cx} cy={n.cy} r={16} fill="var(--rd-paper)" stroke="var(--rd-line-strong)" strokeWidth={1} />
          <text x={n.cx} y={n.cy + 4} textAnchor="middle" fontSize={10} fill="var(--rd-ink-mute)">{n.label}</text>
        </g>
      ))}
    </svg>
  );
}

function SheetEntity({ detail }: { detail?: LiveArtifactDetail }) {
  const title = detail?.title ?? "Current report";
  const summary = detail?.summary ?? "Open a live artifact or ask a question to hydrate the entity card.";
  return (
    <div className="rd-stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 590 }}>{title}</h3>
      <p className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)", margin: 0 }}>
        {detail?.kind ?? "Live artifact"} · {detail?.sourceCount ?? 0} sources · {detail?.claimCount ?? 0} claims
      </p>
      <p style={{ fontSize: 12.5, color: "var(--rd-ink-mute)", margin: "4px 0" }}>
        {summary}
      </p>
      <div className="rd-row" style={{ gap: 4, flexWrap: "wrap" }}>
        <Pill tone={detail?.status === "verified" ? "green" : detail?.status === "review" ? "amber" : "blue"}>{detail?.status ?? "Ready"}</Pill>
        {(detail?.tags ?? ["Report"]).slice(0, 2).map((tag) => <Pill key={tag}>{tag}</Pill>)}
      </div>
      <div className="rd-row" style={{ gap: 6, marginTop: 8 }}>
        <button className="rd-btn rd-btn--primary rd-btn--sm" style={{ flex: 1, justifyContent: "center" }}>Open report</button>
        <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ flex: 1, justifyContent: "center" }}>Track</button>
      </div>
    </div>
  );
}
