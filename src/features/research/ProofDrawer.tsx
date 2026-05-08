/**
 * ProofDrawer — Sprint Q1 2026
 *
 * Closes audit P1 "Proof layer is strong but fragmented"
 * (.tmp/qa-design-audit/NODEBENCH_DESIGN_PRINCIPLES_AUDIT.md): the
 * existing Sources tab + Map tab + Chat citations are individually
 * useful but live as siblings rather than ONE proof drawer attached
 * to the active artifact.
 *
 * Audit's exact spec:
 *   "One proof drawer should expose citations, source snapshots,
 *    tool calls, claim confidence, contradictions, model/provider
 *    trace, eval score, and version history from any active artifact."
 *
 * This component is a slide-over right-side drawer with 8 sections
 * matching that spec:
 *   1. Citations
 *   2. Source snapshots
 *   3. Tool calls
 *   4. Claim confidence
 *   5. Contradictions
 *   6. Model / provider trace
 *   7. Eval score
 *   8. Version history
 *
 * The drawer is data-driven — every section is optional and renders
 * empty-state copy when its prop is undefined or empty. Showcase mode
 * (no data) shows realistic placeholder content so anonymous visitors
 * understand what the drawer covers.
 *
 * Open via the `open` prop (controlled by parent). Close on backdrop
 * click, Escape, or the close button.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal + aria-labelledby
 *   - Focus trap: Tab cycles within drawer; Escape closes
 *   - Returns focus to the opener on close (caller's responsibility)
 *   - prefers-reduced-motion shrinks the slide animation
 */

import { useEffect, useRef, type ReactNode } from "react";

export interface ProofCitation {
  id: string;
  index: number;
  quote: string;
  source: string;
  url?: string;
  verified?: boolean;
}

export interface ProofSourceSnapshot {
  id: string;
  source: string;
  title: string;
  fetchedAt: string;
  excerpt: string;
  url?: string;
}

export interface ProofToolCall {
  id: string;
  step: string;
  detail?: string;
  status: "ok" | "warn" | "error";
  durationMs?: number;
}

export interface ProofClaim {
  id: string;
  claim: string;
  confidence: number; // 0-1
  evidenceCount: number;
}

export interface ProofContradiction {
  id: string;
  claim: string;
  agreeingSources: string[];
  conflictingSources: string[];
  resolution?: string;
}

export interface ProofModelTrace {
  model: string;
  provider: string;
  tier: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

export interface ProofEvalScore {
  overall: number;
  outOf: number;
  judge?: string;
  components: { label: string; pass: boolean }[];
}

export interface ProofVersion {
  id: string;
  version: string;
  changedAt: string;
  changedBy: string;
  summary: string;
  diffCount?: number;
}

export interface ProofDrawerProps {
  open: boolean;
  onClose: () => void;
  artifactTitle?: string;
  artifactKind?: string;
  citations?: ProofCitation[];
  sourceSnapshots?: ProofSourceSnapshot[];
  toolCalls?: ProofToolCall[];
  claims?: ProofClaim[];
  contradictions?: ProofContradiction[];
  modelTrace?: ProofModelTrace;
  evalScore?: ProofEvalScore;
  versions?: ProofVersion[];
}

const SHOWCASE_CITATIONS: ProofCitation[] = [
  {
    id: "c1",
    index: 1,
    quote: "DISCO closed a $100M Series C led by Greylock at a $900M post-money.",
    source: "DISCO press release",
    url: "https://www.disco.com/news/series-c",
    verified: true,
  },
  {
    id: "c2",
    index: 2,
    quote: "Net revenue retention reached 122% in Q3 2026.",
    source: "Q3 2026 IR filing, p. 14",
    verified: true,
  },
  {
    id: "c3",
    index: 3,
    quote: "Customer concentration in the top decile fell from 14% to 11% YoY.",
    source: "Investor letter, Nov 2026",
    verified: false,
  },
];

const SHOWCASE_SNAPSHOTS: ProofSourceSnapshot[] = [
  {
    id: "s1",
    source: "DISCO Q3 IR pack",
    title: "Q3 2026 — Investor Relations briefing",
    fetchedAt: "2h ago",
    excerpt:
      "Total ARR reached $186M in Q3, up 2.8x year-over-year. Net revenue retention of 122% signals strong upsell within the AmLaw 100…",
    url: "https://ir.disco.com/q3-2026",
  },
  {
    id: "s2",
    source: "TechCrunch",
    title: "DISCO raises $100M Series C, valued at $900M",
    fetchedAt: "yesterday",
    excerpt:
      "The legal-tech category is consolidating around two platform players, and DISCO's Series C signals investor conviction that…",
    url: "https://techcrunch.com/2026/11/14/disco-series-c",
  },
];

const SHOWCASE_TOOL_CALLS: ProofToolCall[] = [
  { id: "t1", step: "classify_query", detail: "deep diligence · banker lens", status: "ok", durationMs: 28 },
  { id: "t2", step: "build_context_bundle", detail: "12 prior reports · 38 claims", status: "ok", durationMs: 142 },
  { id: "t3", step: "web_search", detail: "11 articles, 4 official sources", status: "ok", durationMs: 1840 },
  { id: "t4", step: "llm_extract", detail: "23 claims from 8 sources", status: "ok", durationMs: 612 },
  { id: "t5", step: "contradiction_check", detail: "1 pricing-claim disagreement flagged", status: "warn", durationMs: 88 },
];

const SHOWCASE_CLAIMS: ProofClaim[] = [
  { id: "k1", claim: "Series C closed at $900M post-money", confidence: 0.95, evidenceCount: 3 },
  { id: "k2", claim: "NRR 122% in Q3 2026", confidence: 0.88, evidenceCount: 2 },
  { id: "k3", claim: "Pricing held flat through midmarket", confidence: 0.46, evidenceCount: 2 },
  { id: "k4", claim: "AmLaw 6/10 firms on platform", confidence: 0.74, evidenceCount: 1 },
];

const SHOWCASE_CONTRADICTIONS: ProofContradiction[] = [
  {
    id: "x1",
    claim: "Pricing held flat through midmarket",
    agreeingSources: ["DISCO press release"],
    conflictingSources: ["Everlaw competitive teardown · -18% pricing memo"],
    resolution: "DISCO ARPU unchanged headline; Everlaw cut may pressure renewals next QoQ — flagged for monitoring.",
  },
];

const SHOWCASE_MODEL_TRACE: ProofModelTrace = {
  model: "gemini-3.1-flash-preview",
  provider: "Google",
  tier: "auto",
  inputTokens: 4_240,
  outputTokens: 1_180,
  costUsd: 0.0067,
  latencyMs: 2_710,
};

const SHOWCASE_EVAL: ProofEvalScore = {
  overall: 4.7,
  outOf: 6,
  judge: "gemini-3.1-flash-lite-preview",
  components: [
    { label: "useful answer", pass: true },
    { label: "relevant entity", pass: true },
    { label: "actionable signals", pass: true },
    { label: "role-appropriate", pass: true },
    { label: "risk awareness", pass: false },
    { label: "no hallucination", pass: true },
  ],
};

const SHOWCASE_VERSIONS: ProofVersion[] = [
  {
    id: "v3",
    version: "v3",
    changedAt: "2h ago",
    changedBy: "agent",
    summary: "Added Greylock Series C signal · refreshed NRR receipt",
    diffCount: 4,
  },
  {
    id: "v2",
    version: "v2",
    changedAt: "yesterday",
    changedBy: "you",
    summary: "Pinned pricing claim, lowered confidence to 'mixed'",
    diffCount: 2,
  },
  {
    id: "v1",
    version: "v1",
    changedAt: "3d ago",
    changedBy: "agent",
    summary: "Initial diligence run on DISCO",
    diffCount: 14,
  },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section
      style={{
        padding: "14px 18px",
        borderTop: "1px solid var(--rd-line-faint, rgba(0,0,0,0.06))",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span
          className="rd-eyebrow"
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            color: "var(--rd-accent-strong, #c75a3a)",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {title}
        </span>
        {hint && (
          <span className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
            {hint}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <p
      className="rd-faint"
      style={{ fontSize: 12, fontStyle: "italic", margin: 0 }}
    >
      {message}
    </p>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const tone = pct >= 0.75 ? "var(--rd-green, #15803d)" : pct >= 0.5 ? "var(--rd-accent, #d97757)" : "var(--rd-amber, #b45309)";
  return (
    <span
      style={{
        display: "inline-block",
        width: 60,
        height: 6,
        borderRadius: 999,
        background: "rgba(0,0,0,0.08)",
        overflow: "hidden",
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${Math.round(pct * 100)}%`,
          background: tone,
          transition: "width 250ms ease",
        }}
      />
    </span>
  );
}

export function ProofDrawer({
  open,
  onClose,
  artifactTitle = "Active artifact",
  artifactKind = "report",
  citations,
  sourceSnapshots,
  toolCalls,
  claims,
  contradictions,
  modelTrace,
  evalScore,
  versions,
}: ProofDrawerProps) {
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const root = drawerRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    // Initial focus
    drawerRef.current?.querySelector<HTMLElement>("button[aria-label='Close proof drawer']")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const showCitations = citations ?? SHOWCASE_CITATIONS;
  const showSnapshots = sourceSnapshots ?? SHOWCASE_SNAPSHOTS;
  const showTools = toolCalls ?? SHOWCASE_TOOL_CALLS;
  const showClaims = claims ?? SHOWCASE_CLAIMS;
  const showContradictions = contradictions ?? SHOWCASE_CONTRADICTIONS;
  const showModel = modelTrace ?? SHOWCASE_MODEL_TRACE;
  const showEval = evalScore ?? SHOWCASE_EVAL;
  const showVersions = versions ?? SHOWCASE_VERSIONS;
  const usingShowcase = !citations && !sourceSnapshots && !toolCalls && !claims && !contradictions && !modelTrace && !evalScore && !versions;

  return (
    <div
      data-testid="proof-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proof-drawer-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
        background: "rgba(15,23,42,0.32)",
        animation: "rd-fade-in 180ms ease",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        style={{
          width: "min(520px, 100vw)",
          height: "100vh",
          background: "var(--rd-paper, #fff)",
          borderLeft: "1px solid var(--rd-line-strong, rgba(0,0,0,0.12))",
          boxShadow: "-12px 0 40px rgba(15,23,42,0.18)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: "var(--rd-paper, #fff)",
            padding: "16px 18px 12px",
            borderBottom: "1px solid var(--rd-line-faint, rgba(0,0,0,0.06))",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ flex: 1 }}>
            <span
              className="rd-eyebrow"
              style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--rd-accent-strong, #c75a3a)" }}
            >
              Proof drawer
            </span>
            <h2
              id="proof-drawer-title"
              style={{
                margin: "2px 0 0",
                fontFamily: "var(--rd-font-display, inherit)",
                fontSize: 18,
                fontWeight: 700,
                color: "var(--rd-ink-strong, #0f172a)",
              }}
            >
              {artifactTitle}
              <span
                className="rd-mono rd-faint"
                style={{ fontSize: 11, marginLeft: 8, fontWeight: 400, letterSpacing: "0.04em", textTransform: "uppercase" }}
              >
                {artifactKind}
              </span>
            </h2>
          </div>
          {usingShowcase && (
            <span
              className="rd-mono"
              title="Showing showcase fixture data — wire data props to this drawer for live proof."
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 999,
                background: "var(--rd-accent-tint, rgba(217,119,87,0.12))",
                color: "var(--rd-accent-strong, #c75a3a)",
                border: "1px solid var(--rd-accent-ring, rgba(217,119,87,0.3))",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              showcase
            </span>
          )}
          <button
            type="button"
            aria-label="Close proof drawer"
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              border: "1px solid var(--rd-line-faint, rgba(0,0,0,0.1))",
              background: "transparent",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 16,
              color: "var(--rd-ink-mute, #475569)",
            }}
          >
            ✕
          </button>
        </header>

        {/* 1. Citations */}
        <Section title="Citations" hint={`${showCitations.length} cited`}>
          {showCitations.length === 0 ? (
            <Empty message="No citations on this artifact yet." />
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {showCitations.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "var(--rd-paper-warm, rgba(0,0,0,0.02))",
                  }}
                >
                  <span
                    className="rd-cite rd-cite--block"
                    style={{ fontFamily: "var(--rd-font-mono, monospace)", fontSize: 11, fontWeight: 600 }}
                  >
                    [{c.index}]
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "var(--rd-ink-strong, #0f172a)" }}>
                      "{c.quote}"
                    </p>
                    <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rd-mono"
                          style={{
                            fontSize: 10.5,
                            color: "var(--rd-accent-strong, #c75a3a)",
                            textDecoration: "underline",
                          }}
                        >
                          {(() => {
                            try {
                              return new URL(c.url).hostname;
                            } catch {
                              return c.source;
                            }
                          })()}
                        </a>
                      ) : (
                        <span className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
                          {c.source}
                        </span>
                      )}
                      {c.verified === true && (
                        <span style={{ fontSize: 10, color: "var(--rd-green, #15803d)" }}>✓ verified</span>
                      )}
                      {c.verified === false && (
                        <span style={{ fontSize: 10, color: "var(--rd-amber, #b45309)" }}>⚠ unverified</span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* 2. Source snapshots */}
        <Section title="Source snapshots" hint={`${showSnapshots.length} captured`}>
          {showSnapshots.length === 0 ? (
            <Empty message="No source snapshots saved yet." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {showSnapshots.map((s) => (
                <article
                  key={s.id}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--rd-line-faint, rgba(0,0,0,0.06))",
                  }}
                >
                  <header style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 12.5, color: "var(--rd-ink-strong, #0f172a)" }}>
                      {s.title}
                    </strong>
                    <span className="rd-mono rd-faint" style={{ fontSize: 10 }}>
                      {s.fetchedAt}
                    </span>
                  </header>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      lineHeight: 1.45,
                      color: "var(--rd-ink-mute, #475569)",
                    }}
                  >
                    {s.excerpt}
                  </p>
                  <span className="rd-mono rd-faint" style={{ fontSize: 10, marginTop: 4, display: "inline-block" }}>
                    {s.source}
                  </span>
                </article>
              ))}
            </div>
          )}
        </Section>

        {/* 3. Tool calls */}
        <Section title="Tool calls" hint={`${showTools.length} steps`}>
          {showTools.length === 0 ? (
            <Empty message="No tool calls recorded for this artifact." />
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {showTools.map((t, i) => {
                const dotColor =
                  t.status === "ok"
                    ? "var(--rd-green, #15803d)"
                    : t.status === "warn"
                    ? "var(--rd-amber, #b45309)"
                    : "var(--rd-red, #dc2626)";
                return (
                  <li
                    key={t.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "16px auto 1fr auto",
                      gap: 10,
                      padding: "5px 6px",
                      borderRadius: 4,
                      alignItems: "center",
                    }}
                  >
                    <span className="rd-mono rd-faint" style={{ fontSize: 10, width: 16 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      aria-hidden
                      style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor }}
                    />
                    <span style={{ fontSize: 12, color: "var(--rd-ink-strong, #0f172a)" }}>
                      <strong style={{ fontWeight: 590 }}>{t.step}</strong>
                      {t.detail && (
                        <span className="rd-faint" style={{ fontWeight: 400, marginLeft: 6 }}>
                          {t.detail}
                        </span>
                      )}
                    </span>
                    <span className="rd-mono rd-faint" style={{ fontSize: 10 }}>
                      {t.durationMs ? `${t.durationMs}ms` : "—"}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        {/* 4. Claim confidence */}
        <Section title="Claim confidence" hint={`${showClaims.length} claims`}>
          {showClaims.length === 0 ? (
            <Empty message="No claims extracted yet." />
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {showClaims.map((k) => (
                <li
                  key={k.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 10,
                    padding: "5px 6px",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--rd-ink-strong, #0f172a)" }}>{k.claim}</span>
                  <ConfidenceBar value={k.confidence} />
                  <span className="rd-mono rd-faint" style={{ fontSize: 10 }}>
                    {Math.round(k.confidence * 100)}% · {k.evidenceCount} ev
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* 5. Contradictions */}
        <Section title="Contradictions" hint={`${showContradictions.length} flagged`}>
          {showContradictions.length === 0 ? (
            <Empty message="No contradictions detected across cited sources." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {showContradictions.map((x) => (
                <article
                  key={x.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 6,
                    background: "var(--rd-amber-tint, rgba(180,83,9,0.06))",
                    border: "1px solid var(--rd-amber-ring, rgba(180,83,9,0.25))",
                  }}
                >
                  <strong style={{ fontSize: 12.5, color: "var(--rd-ink-strong, #0f172a)" }}>
                    ⚠ {x.claim}
                  </strong>
                  <p style={{ margin: "6px 0 4px", fontSize: 11.5, lineHeight: 1.5, color: "var(--rd-ink-mute, #475569)" }}>
                    <span style={{ color: "var(--rd-green, #15803d)" }}>Agree:</span>{" "}
                    {x.agreeingSources.join(" · ")}
                  </p>
                  <p style={{ margin: "0 0 4px", fontSize: 11.5, lineHeight: 1.5, color: "var(--rd-ink-mute, #475569)" }}>
                    <span style={{ color: "var(--rd-amber, #b45309)" }}>Conflict:</span>{" "}
                    {x.conflictingSources.join(" · ")}
                  </p>
                  {x.resolution && (
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: "var(--rd-ink, #0f172a)",
                        fontStyle: "italic",
                      }}
                    >
                      {x.resolution}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </Section>

        {/* 6. Model / provider trace */}
        <Section title="Model / provider trace">
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "4px 14px",
              margin: 0,
              fontSize: 12,
            }}
          >
            <dt className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
              model
            </dt>
            <dd style={{ margin: 0, color: "var(--rd-ink-strong, #0f172a)" }}>
              {showModel.model}{" "}
              <span className="rd-faint">({showModel.provider})</span>
            </dd>
            <dt className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
              tier
            </dt>
            <dd style={{ margin: 0 }}>{showModel.tier}</dd>
            {typeof showModel.inputTokens === "number" && (
              <>
                <dt className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
                  tokens
                </dt>
                <dd style={{ margin: 0 }}>
                  {showModel.inputTokens.toLocaleString()} in ·{" "}
                  {(showModel.outputTokens ?? 0).toLocaleString()} out
                </dd>
              </>
            )}
            {typeof showModel.costUsd === "number" && (
              <>
                <dt className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
                  cost
                </dt>
                <dd style={{ margin: 0 }}>
                  ${showModel.costUsd.toFixed(4)}
                </dd>
              </>
            )}
            {typeof showModel.latencyMs === "number" && (
              <>
                <dt className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
                  latency
                </dt>
                <dd style={{ margin: 0 }}>
                  {showModel.latencyMs < 1000
                    ? `${showModel.latencyMs}ms`
                    : `${(showModel.latencyMs / 1000).toFixed(1)}s`}
                </dd>
              </>
            )}
          </dl>
        </Section>

        {/* 7. Eval score */}
        <Section
          title="Eval score"
          hint={
            showEval
              ? `${showEval.overall} / ${showEval.outOf} ${showEval.judge ? `· ${showEval.judge}` : ""}`
              : undefined
          }
        >
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
            }}
          >
            {showEval.components.map((c) => (
              <li
                key={c.label}
                style={{
                  fontSize: 11.5,
                  color: c.pass ? "var(--rd-green, #15803d)" : "var(--rd-amber, #b45309)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span aria-hidden>{c.pass ? "✓" : "⚠"}</span> {c.label}
              </li>
            ))}
          </ul>
        </Section>

        {/* 8. Version history */}
        <Section title="Version history" hint={`${showVersions.length} revisions`}>
          {showVersions.length === 0 ? (
            <Empty message="No prior versions yet." />
          ) : (
            <ol
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                borderLeft: "2px solid var(--rd-line-faint, rgba(0,0,0,0.08))",
              }}
            >
              {showVersions.map((v) => (
                <li
                  key={v.id}
                  style={{
                    paddingLeft: 12,
                    paddingBottom: 10,
                    position: "relative",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: -5,
                      top: 4,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--rd-accent, #d97757)",
                      border: "2px solid var(--rd-paper, #fff)",
                    }}
                  />
                  <header
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "baseline",
                      flexWrap: "wrap",
                      marginBottom: 2,
                    }}
                  >
                    <strong
                      className="rd-mono"
                      style={{ fontSize: 11, color: "var(--rd-ink-strong, #0f172a)" }}
                    >
                      {v.version}
                    </strong>
                    <span className="rd-faint" style={{ fontSize: 10.5 }}>
                      {v.changedAt} · {v.changedBy}
                    </span>
                    {typeof v.diffCount === "number" && (
                      <span
                        className="rd-mono rd-faint"
                        style={{ fontSize: 10, marginLeft: "auto" }}
                      >
                        {v.diffCount} change{v.diffCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </header>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      lineHeight: 1.45,
                      color: "var(--rd-ink-mute, #475569)",
                    }}
                  >
                    {v.summary}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </aside>
    </div>
  );
}

export default ProofDrawer;
