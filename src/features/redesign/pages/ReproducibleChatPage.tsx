/**
 * Phase 3 — /redesign/chat/r/{hash} route.
 *
 * Renders an immutable answer cached in `redesignChatRuns by_hash`.
 * Same packet → same hash → same URL across deploys, so anyone with
 * the link sees what you saw. Closes the loop on Sprint 4 P2.13:
 * the Share button now produces a URL that actually serves a 200.
 *
 * Behavior:
 *   - Loading: skeleton card
 *   - Not found: helpful message + back-to-chat CTA
 *   - Complete: full AnswerPacket render with hash banner + re-run CTA
 *
 * Accessibility: doc title set to "{shortAnswer} · NodeBench" so the
 * tab name reflects the cached answer.
 */
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useRedesignChatByHash, type ChatAnswer } from "../hooks/useRedesignChatRun";

interface ReproducibleChatPageProps {
  hash: string;
}

function evidenceTrustBadge(row: ChatAnswer["evidence"][number]): { label: string; title: string; color: string } | null {
  if (row.verified === true || row.verificationState === "verified") {
    return {
      label: "verified in source body",
      title: row.verificationDetail ?? "Quote substring confirmed in source body.",
      color: "var(--rd-green, #15803d)",
    };
  }
  if (row.verificationState === "cached_reference") {
    return {
      label: "cached reference",
      title: row.verificationDetail ?? "Cached memory/source-cache reference; no URL fetch was available.",
      color: "var(--rd-amber, #b45309)",
    };
  }
  if (row.verificationState === "fetch_blocked") {
    return {
      label: "fetch blocked",
      title: row.verificationDetail ?? `Publisher fetch blocked post-hoc validation: ${row.validationError ?? "unknown reason"}`,
      color: "var(--rd-amber, #b45309)",
    };
  }
  if (row.verificationState === "provider_grounded") {
    return {
      label: "provider-grounded",
      title: row.verificationDetail ?? "Search provider supplied the source, but the exact snippet was not found during post-hoc fetch.",
      color: "var(--rd-amber, #b45309)",
    };
  }
  if (row.verified === false || row.verificationState === "unsupported") {
    return {
      label: `unsupported (${row.validationError ?? "no_match"})`,
      title: row.verificationDetail ?? `Source validation failed: ${row.validationError ?? "unknown reason"}`,
      color: "var(--rd-red, #b91c1c)",
    };
  }
  return null;
}

export function ReproducibleChatPage({ hash }: ReproducibleChatPageProps) {
  const navigate = useNavigate();
  const row = useRedesignChatByHash(hash);

  // Tab title reflects the cached answer
  useEffect(() => {
    if (row?.packet?.shortAnswer) {
      const prev = document.title;
      const txt = String(row.packet.shortAnswer).slice(0, 80);
      document.title = `${txt} · NodeBench`;
      return () => { document.title = prev; };
    }
  }, [row?.packet?.shortAnswer]);

  const packet: ChatAnswer | null = (row?.packet as ChatAnswer | undefined) ?? null;

  const evidenceWithCites = useMemo(() => {
    if (!packet?.evidence) return [];
    return packet.evidence.map((e) => ({ ...e }));
  }, [packet?.evidence]);

  // Loading state — Convex query returns undefined while in flight
  if (row === undefined) {
    return (
      <div className="rd-stack" style={{ padding: "40px 24px", maxWidth: 880, margin: "0 auto" }}>
        <div className="rd-card" style={{ padding: 24 }}>
          <div className="rd-eyebrow">Reproducible answer · {hash}</div>
          <p className="rd-body" style={{ color: "var(--rd-ink-mute)", marginTop: 12 }}>
            Loading the cached run from Convex…
          </p>
        </div>
      </div>
    );
  }

  // Not found — hash doesn't match any run
  if (row === null || !packet) {
    return (
      <div className="rd-stack" style={{ padding: "60px 24px", maxWidth: 720, margin: "0 auto", gap: 16 }}>
        <div className="rd-card" style={{ padding: 24 }}>
          <div className="rd-eyebrow">Reproducible answer · {hash}</div>
          <h1 style={{ fontFamily: "var(--rd-font-display)", fontSize: 22, color: "var(--rd-ink-strong)", margin: "10px 0 8px" }}>
            No cached run found for this link
          </h1>
          <p className="rd-body" style={{ color: "var(--rd-ink-mute)", margin: 0 }}>
            Reproducible answers are cached by a deterministic hash of the
            prompt, tier, model, and grounded source URLs. The cache may
            have been pruned, the hash may be malformed, or the run may
            have errored before the packet was sealed. Start a new chat to
            generate a fresh, citable answer.
          </p>
          <div className="rd-row" style={{ gap: 8, marginTop: 16 }}>
            <button
              type="button"
              className="rd-btn rd-btn--primary rd-btn--sm"
              onClick={() => navigate("/redesign/chat")}
            >
              Open chat →
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => navigate("/redesign")}
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cost = row.estimatedCostUsd;
  const latencyStr = row.totalLatencyMs
    ? row.totalLatencyMs < 1000
      ? `${row.totalLatencyMs}ms`
      : `${(row.totalLatencyMs / 1000).toFixed(1)}s`
    : null;
  const costStr = typeof cost === "number"
    ? cost >= 0.01 ? `$${cost.toFixed(3)}` : "<$0.01"
    : null;

  const created = new Date(row.createdAt);

  return (
    <div className="rd-stack" style={{ padding: "32px 24px 48px", maxWidth: 920, margin: "0 auto", gap: 16 }}>
      {/* Banner */}
      <div className="rd-card" style={{
        padding: "12px 16px",
        background: "var(--rd-accent-tint)",
        borderColor: "var(--rd-accent-ring)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <span className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>
          Reproducible answer
        </span>
        <span className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-mute)" }}>
          /r/{hash}
        </span>
        <span className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)" }}>
          {row.tier} tier · {row.model} · {created.toISOString().slice(0, 10)}
          {latencyStr && ` · ${latencyStr}`}
          {costStr && ` · ${costStr}`}
        </span>
        <button
          type="button"
          className="rd-btn rd-btn--quiet rd-btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={() => {
            navigate(`/redesign/chat?prompt=${encodeURIComponent(row.prompt)}`);
          }}
          title="Re-run this prompt with current memory + sources"
        >
          Re-run prompt →
        </button>
      </div>

      {/* User prompt */}
      <article className="rd-card" style={{ padding: 16 }}>
        <div className="rd-eyebrow">Prompt</div>
        <p className="rd-body" style={{ marginTop: 6, color: "var(--rd-ink)" }}>{row.prompt}</p>
      </article>

      {/* AnswerPacket */}
      <article className="rd-card rd-chat-msg__body" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        <header className="rd-chat-msg__header">
          <span className="rd-chat-msg__name">NodeBench</span>
          <span className="rd-chat-msg__sep">·</span>
          <span className="rd-chat-msg__meta">
            {row.tier} tier · {packet.sourceCount} sources
            {latencyStr && ` · ${latencyStr}`}
            {costStr && ` · ${costStr}`}
          </span>
        </header>

        <section>
          <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Short answer</div>
          <p style={{
            fontFamily: "var(--rd-font-display)",
            fontSize: 18,
            fontWeight: 510,
            lineHeight: 1.4,
            color: "var(--rd-ink-strong)",
            letterSpacing: "-0.18px",
            margin: 0,
          }}>
            {packet.shortAnswer}
          </p>
        </section>

        <section>
          <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Why useful</div>
          <p className="rd-body" style={{ color: "var(--rd-ink-mute)", margin: 0 }}>{packet.whyItMatters}</p>
        </section>

        <section>
          <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Evidence ({evidenceWithCites.length})</div>
          <ol className="rd-stack" style={{ gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
            {evidenceWithCites.map((e) => {
              const isUrl = /^https?:\/\//i.test(e.source);
              const trustBadge = evidenceTrustBadge(e);
              return (
                <li
                  key={e.idx}
                  className="rd-card rd-card__pad-tight"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 10,
                    alignItems: "start",
                  }}
                >
                  <span className="rd-cite rd-cite--block">[{e.idx}]</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <p className="rd-body" style={{ margin: 0, fontSize: 13 }}>{e.quote}</p>
                    {trustBadge && (
                      <span
                        className="rd-mono"
                        title={trustBadge.title}
                        style={{ fontSize: 10, color: trustBadge.color, display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        {e.verified === true ? "ok" : e.blocking ? "blocked" : "warn"} - {trustBadge.label}
                      </span>
                    )}
                  </div>
                  {isUrl ? (
                    <a
                      href={e.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rd-mono"
                      style={{ fontSize: 10.5, color: "var(--rd-accent-strong)", textDecoration: "underline" }}
                    >
                      {(() => {
                        try { return new URL(e.source).hostname; } catch { return e.source; }
                      })()}
                    </a>
                  ) : (
                    <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{e.source}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {packet.risks?.length > 0 && (
          <section>
            <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Risks / unknowns</div>
            <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {packet.risks.map((r, i) => (
                <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
                  <span className="rd-dot rd-dot--review" style={{ marginTop: 6, flexShrink: 0 }} />
                  <span style={{ color: "var(--rd-ink-mute)" }}>{r}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {packet.nextAction && (
          <section className="rd-card" style={{
            padding: 14,
            background: "var(--rd-accent-tint)",
            borderColor: "var(--rd-accent-ring)",
            borderRadius: "var(--rd-r-sm)",
          }}>
            <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)", marginBottom: 4 }}>Next action</div>
            <p className="rd-body" style={{ margin: 0, color: "var(--rd-ink)" }}>{packet.nextAction}</p>
          </section>
        )}

        {/* Trace — collapsible */}
        {packet.trace?.length > 0 && (
          <details>
            <summary className="rd-eyebrow" style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <span>How we got this answer</span>
              <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{packet.trace.length} steps</span>
            </summary>
            <ol className="rd-stack" style={{ marginTop: 10, gap: 4, listStyle: "none", padding: 0 }}>
              {packet.trace.map((step, i) => (
                <li key={i} className="rd-row" style={{ gap: 12, fontSize: 12, padding: "6px 8px" }}>
                  <span className="rd-mono" style={{ width: 24, color: "var(--rd-ink-soft)" }}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={`rd-dot rd-dot--${step.status === "ok" ? "live" : step.status === "warn" ? "review" : step.status === "error" ? "watch" : "watch"}`} />
                  <span style={{ flex: 1, color: "var(--rd-ink)" }}>
                    <strong style={{ fontWeight: 590 }}>{step.step}.</strong>{" "}
                    <span style={{ color: "var(--rd-ink-mute)" }}>{step.detail}</span>
                  </span>
                  <span className="rd-mono" style={{ color: "var(--rd-ink-soft)", fontSize: 10.5 }}>
                    {step.durationMs ? `${step.durationMs}ms` : "—"}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </article>

      {/* Footer */}
      <div className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)", textAlign: "center" }}>
        Hash deterministic over {`{prompt, tier, model, shortAnswer, sortedEvidenceUrls}`} · same input → same URL
      </div>
    </div>
  );
}
