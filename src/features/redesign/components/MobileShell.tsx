/**
 * MobileShell — capture-first NodeBench on phone.
 *
 * Aligns with the locked design board (proposed-design-views.html#mobile-view):
 *   - Bottom 5-tab nav (Home · Reports · Chat · Inbox · Me) — never collapsed
 *   - Top mini-nav with active event pill ("Ship Demo Day" hot)
 *   - Capture ack card after speech-to-text turn
 *   - Bottom sheets for context (Sources / Graph / Card)
 *   - UniversalComposer pinned above the tab bar
 *
 * Mobile rejects: full graph by default, hidden capture target, desktop panes on phone.
 */

import { useState } from "react";
import type { SurfaceId } from "../fixtures";
import { Pill } from "./Pill";
import { reports, inboxItems, memoryPulse, sampleAnswer } from "../fixtures";
import { UniversalComposer, type RouterTier } from "./UniversalComposer";

interface MobileShellProps {
  active: SurfaceId;
  onChange: (id: SurfaceId) => void;
}

export function MobileShell({ active, onChange }: MobileShellProps) {
  const [sheet, setSheet] = useState<null | "sources" | "graph" | "entity">(null);
  const [tier, setTier] = useState<RouterTier>("auto");

  return (
    <div
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
          <Pill tone="accent">Ship Demo Day</Pill>
        </div>
      </header>

      {/* Surface body — single column */}
      <div style={{ overflow: "auto", padding: "14px 14px 8px" }}>
        {active === "home" && <MobileHome />}
        {active === "reports" && <MobileReports />}
        {active === "chat" && <MobileChat onOpenSheet={setSheet} />}
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
            contextLabel="Adding to: Ship Demo Day"
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
              {id === "inbox" && (
                <span style={{
                  position: "absolute",
                  top: 4,
                  right: "calc(50% - 18px)",
                  background: "var(--rd-accent)",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 999,
                  lineHeight: 1.2,
                }}>5</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom sheet (Sources / Graph / Entity card) */}
      {sheet && (
        <BottomSheet kind={sheet} onClose={() => setSheet(null)} />
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

function MobileHome() {
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
        }}>What are we researching today?</h1>
        <p className="rd-faint" style={{ fontSize: 12.5 }}>
          Tap the composer below or speak a quick capture. NodeBench picks the right home.
        </p>
      </div>

      {/* Memory pulse condensed */}
      <div>
        <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Memory pulse</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {memoryPulse.slice(0, 4).map((m) => (
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
          <article className="rd-card rd-card__pad-tight" style={{ padding: "12px 14px" }}>
            <div className="rd-row" style={{ gap: 6 }}>
              <Pill tone="green">Memory win</Pill>
              <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>2m ago</span>
            </div>
            <h3 style={{ margin: "6px 0 2px", fontSize: 13, fontWeight: 590 }}>Orbital Labs answered from event corpus</h3>
            <p className="rd-faint" style={{ fontSize: 12 }}>4 sources reused · 0 paid calls.</p>
          </article>
          <article className="rd-card rd-card__pad-tight" style={{ padding: "12px 14px" }}>
            <div className="rd-row" style={{ gap: 6 }}>
              <Pill tone="amber">Follow-up</Pill>
              <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>Due tomorrow</span>
            </div>
            <h3 style={{ margin: "6px 0 2px", fontSize: 13, fontWeight: 590 }}>Alex at Orbital Labs</h3>
            <p className="rd-faint" style={{ fontSize: 12 }}>Ask about healthcare pilot criteria.</p>
          </article>
        </div>
      </div>
    </div>
  );
}

function MobileReports() {
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
        {reports.map((r) => (
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
            <p className="rd-faint" style={{ fontSize: 12, marginTop: 4 }}>{r.description}</p>
            <div className="rd-row" style={{ gap: 8, marginTop: 6, fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
              <span>{r.sources} src</span>
              <span>{r.claims} claims</span>
              <span>{r.followUps} follow-ups</span>
              <span style={{ marginLeft: "auto" }}>{r.updatedAt}</span>
            </div>
            <div className="rd-row" style={{ gap: 4, marginTop: 8 }}>
              <button className="rd-btn rd-btn--ghost" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }}>Brief</button>
              <button className="rd-btn rd-btn--quiet" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }}>Explore</button>
              <button className="rd-btn rd-btn--quiet" style={{ flex: 1, padding: "6px 8px", fontSize: 11, justifyContent: "center" }}>Chat</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function MobileChat({ onOpenSheet }: { onOpenSheet: (k: "sources" | "graph" | "entity") => void }) {
  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      {/* Capture ack — the headline mobile pattern */}
      <div className="rd-card rd-card__pad" style={{
        background: "var(--rd-accent-tint)",
        borderColor: "var(--rd-accent-ring)",
      }}>
        <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>Captured to Ship Demo Day</div>
        <h3 style={{ margin: "6px 0 4px", fontSize: 14, fontWeight: 590 }}>
          Alex · Orbital Labs · voice-agent eval infra
        </h3>
        <p className="rd-faint" style={{ fontSize: 12 }}>Created 1 person, 1 company, 2 claims, 1 follow-up.</p>
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
        }}>Met Alex from Orbital Labs. They build voice-agent eval infra.</div>
      </div>

      <article className="rd-card rd-card__pad" style={{ padding: 14 }}>
        <div className="rd-row" style={{ gap: 4, flexWrap: "wrap" }}>
          <Pill tone="green">Memory · 4 sources</Pill>
          <Pill>0 paid calls</Pill>
        </div>
        <p style={{
          fontFamily: "var(--rd-font-display)", fontSize: 15, fontWeight: 510,
          lineHeight: 1.4, color: "var(--rd-ink-strong)", margin: "8px 0 6px",
          letterSpacing: "-0.15px",
        }}>{sampleAnswer.shortAnswer}</p>
        <div className="rd-row" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onOpenSheet("sources")}>Sources (4)</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onOpenSheet("graph")}>Graph</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onOpenSheet("entity")}>Entity</button>
        </div>
      </article>
    </div>
  );
}

function MobileInbox() {
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
        {inboxItems.slice(0, 4).map((item) => (
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

function BottomSheet({ kind, onClose }: { kind: "sources" | "graph" | "entity"; onClose: () => void }) {
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

        {kind === "sources" && <SheetSources />}
        {kind === "graph" && <SheetGraph />}
        {kind === "entity" && <SheetEntity />}
      </div>
    </div>
  );
}

function SheetSources() {
  return (
    <ul className="rd-stack" style={{ gap: 8, listStyle: "none", padding: 0 }}>
      {[
        "Orbital Labs whitepaper, p.4",
        "Founder note, Ship Demo Day",
        "Notion meeting recap, Apr 30",
        "TechCrunch coverage, Mar 2026",
      ].map((s, i) => (
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

function SheetGraph() {
  return (
    <svg viewBox="0 0 320 220" width="100%" style={{ maxHeight: 280 }}>
      <g stroke="var(--rd-line-strong)" strokeWidth={1.2} fill="none">
        <path d="M 160,110 L 80,50" />
        <path d="M 160,110 L 240,50" />
        <path d="M 160,110 L 80,170" />
        <path d="M 160,110 L 240,170" />
      </g>
      <circle cx={160} cy={110} r={28} fill="var(--rd-accent-soft)" stroke="var(--rd-accent)" strokeWidth={1.2} />
      <text x={160} y={114} textAnchor="middle" fontSize={11} fontWeight={590} fill="var(--rd-accent-strong)">Orbital</text>
      {[
        { cx: 80, cy: 50, label: "Alex" },
        { cx: 240, cy: 50, label: "Pilot" },
        { cx: 80, cy: 170, label: "Voice" },
        { cx: 240, cy: 170, label: "Health" },
      ].map((n) => (
        <g key={n.label}>
          <circle cx={n.cx} cy={n.cy} r={16} fill="var(--rd-paper)" stroke="var(--rd-line-strong)" strokeWidth={1} />
          <text x={n.cx} y={n.cy + 4} textAnchor="middle" fontSize={10} fill="var(--rd-ink-mute)">{n.label}</text>
        </g>
      ))}
    </svg>
  );
}

function SheetEntity() {
  return (
    <div className="rd-stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 590 }}>Orbital Labs</h3>
      <p className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)", margin: 0 }}>
        Voice-agent eval infra · Series Seed · 14 people
      </p>
      <p style={{ fontSize: 12.5, color: "var(--rd-ink-mute)", margin: "4px 0" }}>
        Healthcare design-partner angle is the wedge. Validate procurement timeline before you commit.
      </p>
      <div className="rd-row" style={{ gap: 4, flexWrap: "wrap" }}>
        <Pill tone="blue">Watching</Pill>
        <Pill tone="green">Pilot intent</Pill>
      </div>
      <div className="rd-row" style={{ gap: 6, marginTop: 8 }}>
        <button className="rd-btn rd-btn--primary rd-btn--sm" style={{ flex: 1, justifyContent: "center" }}>Open report</button>
        <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ flex: 1, justifyContent: "center" }}>Track</button>
      </div>
    </div>
  );
}
